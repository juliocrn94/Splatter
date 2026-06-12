#!/bin/bash
# Splatter — Pipeline: video → .ply + .spz
# Uso: /opt/process_splat.sh <video_path> <project_id> [standard|hq] [sift|superpoint] [opensplat|gsplat]
# Corre con cwd = /tmp/jobs/{project_id}

set -euo pipefail

VIDEO=$1
PROJECT=${2:-"proyecto"}
QUALITY=${3:-"standard"}
FEATURE_EXTRACTOR=${4:-"sift"}
TRAINER=${5:-"opensplat"}
SKIP_COLMAP_MAPPER=0

# 150 frames es el cap seguro para COLMAP en contenedores RunPod con 16-24GB RAM.
# 400 frames → ~20GB RAM en feature extraction → OOM.
# Usamos fps=2+mpdecimate para seleccionar los mejores 150 frames del pool.
MAX_FRAMES=150

if [ -z "$VIDEO" ] || [ -z "$PROJECT" ]; then
  echo "Uso: $0 <video> <project_id> [standard|hq] [sift|superpoint] [opensplat|gsplat]"
  exit 1
fi

# OpenSplat busca las imágenes en <proyecto>/images/ — el dir DEBE llamarse "images".
FRAMES_DIR="./images"
SPARSE_DIR="./sparse"
PLY_OUT="./${PROJECT}.ply"
SPZ_OUT="./${PROJECT}.spz"

# COLMAP y sus matchers intentan abrir un display Qt en headless — esto los crashea.
# offscreen evita el SIGABRT en sequential_matcher/vocab_tree_matcher.
export QT_QPA_PLATFORM=offscreen

mkdir -p "$FRAMES_DIR" "$SPARSE_DIR"

echo "=== Splatter pipeline ==="
echo "Video:              $VIDEO"
echo "Proyecto:           $PROJECT"
echo "Calidad:            $QUALITY"
echo "Feature extractor:  $FEATURE_EXTRACTOR"
echo "Trainer:            $TRAINER"
echo ""

# ─── Paso 1: Extraer frames ──────────────────────────────────────────────────
echo "[1/4] Extrayendo frames del video..."
# fps=2 (sin mpdecimate): mantiene frames equidistantes cada 0.5s.
# mpdecimate eliminaba frames en videos lentos → dejaba huecos temporales grandes
# que sequential_matcher no podía enlazar → "failed to create sparse model".
ffmpeg -i "$VIDEO" \
  -vf "fps=2" \
  -qscale:v 2 \
  "$FRAMES_DIR/frame_%04d.jpg" \
  -hide_banner -loglevel error

FRAME_COUNT=$(find "$FRAMES_DIR" -name "*.jpg" | wc -l | tr -d ' ')
echo "  → $FRAME_COUNT frames extraídos"

if [ "$FRAME_COUNT" -lt 10 ]; then
  echo "ERROR: Muy pocos frames ($FRAME_COUNT). El video puede estar corrupto o ser demasiado corto."
  exit 1
fi

# ─── Filtro de blur ──────────────────────────────────────────────────────────
# Frames borrosos destruyen la extracción SIFT → fallos de reconstrucción COLMAP.
echo "  → Filtrando frames borrosos..."
BLUR_REMOVED=0

# blurdetect: 0.0 (nítido) → 1.0 (borroso). Umbral 60% elimina el peor tercio.
BLUR_MAX=60

HAS_BLURDETECT=$(ffmpeg -filters 2>/dev/null | grep -c "^ *blurdetect" || true)
HAS_BLURDETECT=${HAS_BLURDETECT:-0}

if [ "$HAS_BLURDETECT" -gt 0 ]; then
  for f in "$FRAMES_DIR/"*.jpg; do
    RAW_SCORE=$(ffmpeg -i "$f" \
      -vf "blurdetect,metadata=print:file=-" \
      -frames:v 1 -f null - 2>/dev/null \
      | awk -F= '/lavfi\.blur=/{v=$2+0; printf "%d", v*100; exit}')
    # Sanear: extraer solo los primeros dígitos (protección contra embedded newlines)
    SCORE=$(printf '%s' "${RAW_SCORE:-}" | grep -oE '^[0-9]+' || true)
    SCORE=${SCORE:-0}
    # Usar aritmética bash en lugar de [ -ge ] para evitar el bug de integer expected
    if (( SCORE >= BLUR_MAX )); then
      rm -f "$f"
      BLUR_REMOVED=$(( BLUR_REMOVED + 1 ))
    fi
  done
  echo "  → $BLUR_REMOVED frames borrosos eliminados"
else
  echo "  → AVISO: blurdetect no disponible en este ffmpeg — filtro de blur omitido"
fi

FRAME_COUNT=$(find "$FRAMES_DIR" -name "*.jpg" | wc -l | tr -d ' ')
echo "  → $FRAME_COUNT frames útiles"

if [ "$FRAME_COUNT" -lt 10 ]; then
  echo "ERROR: Muy pocos frames tras filtro ($FRAME_COUNT). El video puede estar sobreexpuesto o muy borroso."
  exit 1
fi

# ─── Normalización de exposición ─────────────────────────────────────────────
# Reduce variaciones de brillo entre frames — mejora matching SIFT en interiores.
echo "  → Normalizando exposición entre frames..."
NORM_ERRORS=0
for f in "$FRAMES_DIR/"*.jpg; do
  if ! ffmpeg -i "$f" -vf "histeq=strength=0.15:intensity=0.15" -y "${f}.eq.jpg" 2>/dev/null; then
    NORM_ERRORS=$(( NORM_ERRORS + 1 ))
  else
    mv "${f}.eq.jpg" "$f"
  fi
done
[ "$NORM_ERRORS" -gt 0 ] && echo "  → AVISO: $NORM_ERRORS frames no pudieron normalizarse (histeq no soportado?)" || echo "  → Normalización completada"

# ─── Cap de frames: máximo MAX_FRAMES en modo standard ───────────────────────
if [ "$QUALITY" = "standard" ] && [ "$FRAME_COUNT" -gt "$MAX_FRAMES" ]; then
  echo "  → Modo standard: submuestreando de $FRAME_COUNT a $MAX_FRAMES frames..."
  STEP=$(( (FRAME_COUNT + MAX_FRAMES - 1) / MAX_FRAMES ))
  i=0
  shopt -s nullglob
  for f in "$FRAMES_DIR/"*.jpg; do
    if [ $(( i % STEP )) -ne 0 ]; then
      rm -f "$f"
    fi
    i=$(( i + 1 ))
  done
  shopt -u nullglob
  FRAME_COUNT=$(find "$FRAMES_DIR" -name "*.jpg" | wc -l | tr -d ' ')
  echo "  → $FRAME_COUNT frames seleccionados (step=$STEP)"
fi

# ─── Paso 2: Extracción de features ──────────────────────────────────────────
echo "[2/4] Extrayendo features..."

if [ "$FEATURE_EXTRACTOR" = "superpoint" ] && [ -d "/opt/hloc" ]; then
  echo "  → Usando SuperPoint+LightGlue (hloc)"
  python3 -m hloc.extractors.superpoint \
    --image_dir "$FRAMES_DIR" \
    --export_dir "./hloc_features" 2>&1 | tail -5

  python3 -m hloc.matchers.lightglue \
    --features_dir "./hloc_features" \
    --pairs_path "./hloc_pairs.txt" \
    --match_path "./hloc_matches.h5" 2>&1 | tail -5

  python3 -m hloc.pipelines.colmap.sfm \
    --sfm_dir "$SPARSE_DIR" \
    --image_dir "$FRAMES_DIR" \
    --features "./hloc_features" \
    --matches "./hloc_matches.h5" \
    --pairs "./hloc_pairs.txt" 2>&1 | tail -20

  # Si hloc generó el sparse, saltar al paso de OpenSplat
  if [ -d "$SPARSE_DIR/0" ]; then
    echo "  → Reconstrucción con SuperPoint completada"
    SKIP_COLMAP_MAPPER=1
  else
    echo "  → AVISO: hloc no generó sparse/0 — cayendo a SIFT"
    FEATURE_EXTRACTOR="sift"
    SKIP_COLMAP_MAPPER=0
  fi
else
  [ "$FEATURE_EXTRACTOR" = "superpoint" ] && echo "  → AVISO: SuperPoint solicitado pero hloc no instalado — usando SIFT"
  FEATURE_EXTRACTOR="sift"
  SKIP_COLMAP_MAPPER=0
fi

if [ "$FEATURE_EXTRACTOR" = "sift" ]; then
  echo "  → Usando SIFT (COLMAP)"
  # max_image_size=2000: mejor resolución de features que 1600, sin OOM a 150 frames.
  # max_num_features=8192: más puntos por frame → mejor matching en interiores con paredes lisas.
  # use_gpu=0 OBLIGATORIO: SIFT GPU de COLMAP usa SiftGPU/OpenGL → crash en headless serverless.
  colmap feature_extractor \
      --database_path "./colmap.db" \
      --image_path "$FRAMES_DIR" \
      --ImageReader.camera_model OPENCV \
      --SiftExtraction.use_gpu 0 \
      --SiftExtraction.max_image_size 2000 \
      --SiftExtraction.max_num_features 8192 \
      --SiftExtraction.num_threads 4
fi

# ─── Paso 3: COLMAP matching + mapper ────────────────────────────────────────
if [ "${SKIP_COLMAP_MAPPER:-0}" = "0" ]; then
  echo "[3/4] Estimando posiciones de cámara (COLMAP)..."

  # sequential_matcher con overlap=15: busca matches en los 15 frames adyacentes
  # (default=5 era insuficiente para fps=2 con submuestreo a 150 frames).
  # SiftMatching.use_gpu=0 evita el crash de OpenGL en headless.
  colmap sequential_matcher \
    --database_path "./colmap.db" \
    --SiftMatching.use_gpu 0 \
    --SequentialMatching.overlap 15

  # Diagnóstico: ver cuántos image pairs se encontraron antes del mapper
  MATCH_COUNT=$(python3 -c "
import sqlite3, sys
try:
    conn = sqlite3.connect('./colmap.db')
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM matches WHERE rows > 0')
    print(c.fetchone()[0])
    conn.close()
except: print(0)
" 2>/dev/null || echo 0)
  echo "  → $MATCH_COUNT pares con matches (sequential_matcher)"
  if [ "$MATCH_COUNT" -lt 20 ]; then
    echo "  → AVISO: muy pocos matches. El video puede tener poco movimiento o mala iluminación."
  fi

  colmap mapper \
    --database_path "./colmap.db" \
    --image_path "$FRAMES_DIR" \
    --output_path "$SPARSE_DIR"

  if [ ! -d "$SPARSE_DIR/0" ]; then
    echo "ERROR: COLMAP no pudo reconstruir la escena."
    echo "Causas posibles: poca superposición entre frames, iluminación inconsistente, video muy corto."
    exit 1
  fi
else
  echo "[3/4] Reconstrucción ya completada por hloc — saltando mapper COLMAP"
fi

# ─── Paso 4: Trainer de Gaussian Splatting ───────────────────────────────────
echo "[4/4] Entrenando Gaussian Splat (trainer=$TRAINER)..."
ITERATIONS=30000
[ "$QUALITY" = "hq" ] && ITERATIONS=50000

if [ "$TRAINER" = "gsplat" ] && command -v gsplat >/dev/null 2>&1; then
  echo "  → Usando gsplat (antialiased, experimental)"
  gsplat "." \
    --iterations $ITERATIONS \
    --output "$PLY_OUT" 2>&1 | tail -20 || true

  if [ ! -f "$PLY_OUT" ]; then
    echo "  → AVISO: gsplat no generó .ply — cayendo a OpenSplat"
    TRAINER="opensplat"
  fi
fi

if [ "$TRAINER" = "opensplat" ] || [ ! -f "$PLY_OUT" ]; then
  [ "$TRAINER" != "opensplat" ] && echo "  → gsplat no disponible o falló — usando OpenSplat"
  # OpenSplat recibe el proyecto raíz (cwd = job_dir), que contiene images/ y sparse/0/.
  opensplat "." \
    -n $ITERATIONS \
    -o "$PLY_OUT"
fi

# Validar que el .ply tenga contenido
PLY_SIZE=$(stat -c%s "$PLY_OUT" 2>/dev/null || echo 0)
if [ "$PLY_SIZE" -lt 1048576 ]; then
  echo "ERROR: OpenSplat generó un .ply inválido o vacío (${PLY_SIZE} bytes)"
  exit 1
fi
echo "  → .ply listo: $PLY_OUT ($(du -sh "$PLY_OUT" | cut -f1))"

# ─── Convertir a .spz ────────────────────────────────────────────────────────
# El binario se llama ply_to_spz (nianticlabs/spz, C++, v2 forzado para compatibilidad)
if command -v ply_to_spz >/dev/null 2>&1; then
  ply_to_spz "$PLY_OUT" "$SPZ_OUT"
  echo "  → .spz listo: $SPZ_OUT ($(du -sh "$SPZ_OUT" | cut -f1))"
else
  echo "  → AVISO: ply_to_spz no encontrado — solo .ply disponible. El viewer de clientes no funcionará."
fi

echo ""
echo "=== Pipeline completado ==="
echo "frames=$FRAME_COUNT quality=$QUALITY trainer=$TRAINER feature_extractor=$FEATURE_EXTRACTOR"
