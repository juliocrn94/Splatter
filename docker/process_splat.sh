#!/bin/bash
# Splatter — Pipeline: video → .ply + .spz
# Uso: /opt/process_splat.sh <video_path> <project_id> [standard|hq] [sift|superpoint] [opensplat|gsplat]
# VERSION: 2026-06-12-v5 (cache-bust)

set -euo pipefail

VIDEO=$1
PROJECT=${2:-"proyecto"}
QUALITY=${3:-"standard"}
FEATURE_EXTRACTOR=${4:-"sift"}
TRAINER=${5:-"opensplat"}
SKIP_COLMAP_MAPPER=0
MAX_FRAMES=150

if [ -z "$VIDEO" ] || [ -z "$PROJECT" ]; then
  echo "Uso: $0 <video> <project_id> [standard|hq] [sift|superpoint] [opensplat|gsplat]"
  exit 1
fi

FRAMES_DIR="./images"
SPARSE_DIR="./sparse"
PLY_OUT="./${PROJECT}.ply"
SPZ_OUT="./${PROJECT}.spz"

export QT_QPA_PLATFORM=offscreen

mkdir -p "$FRAMES_DIR" "$SPARSE_DIR"

echo "=== Splatter pipeline VERSION 2026-06-12-v5 ==="
echo "Video:              $VIDEO"
echo "Proyecto:           $PROJECT"
echo "Calidad:            $QUALITY"
echo "Feature extractor:  $FEATURE_EXTRACTOR"
echo "Trainer:            $TRAINER"
echo ""

# ─── Paso 1: Extraer frames ──────────────────────────────────────────────────
echo "[1/4] Extrayendo frames del video..."
# fps=2 sin filtros adicionales: frames equidistantes a 0.5s.
# No usar mpdecimate (elimina frames en videos lentos → gaps → COLMAP falla).
# No usar histeq (normaliza cada frame diferente → SIFT no puede matchear across frames).
ffmpeg -i "$VIDEO" \
  -vf "fps=2" \
  -qscale:v 2 \
  "$FRAMES_DIR/frame_%04d.jpg" \
  -hide_banner -loglevel error

FRAME_COUNT=$(find "$FRAMES_DIR" -name "*.jpg" | wc -l | tr -d ' ')
echo "  → $FRAME_COUNT frames extraídos"

if [ "$FRAME_COUNT" -lt 15 ]; then
  echo "ERROR: Muy pocos frames ($FRAME_COUNT). El video puede estar corrupto o ser demasiado corto (mínimo 8s)."
  exit 1
fi

# ─── Cap de frames ────────────────────────────────────────────────────────────
if [ "$QUALITY" = "standard" ] && [ "$FRAME_COUNT" -gt "$MAX_FRAMES" ]; then
  echo "  → Submuestreando de $FRAME_COUNT a $MAX_FRAMES frames (standard)..."
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
  echo "  → $FRAME_COUNT frames (step=$STEP)"
fi

echo "  → Procesando con $FRAME_COUNT frames"

# ─── Paso 2: Extracción de features ──────────────────────────────────────────
echo "[2/4] Extrayendo features (SIFT)..."

if [ "$FEATURE_EXTRACTOR" = "superpoint" ] && [ -d "/opt/hloc" ]; then
  echo "  → SuperPoint+LightGlue detectado"
  python3 -m hloc.extractors.superpoint --image_dir "$FRAMES_DIR" --export_dir "./hloc_features" 2>&1 | tail -3
  python3 -m hloc.matchers.lightglue --features_dir "./hloc_features" --pairs_path "./hloc_pairs.txt" --match_path "./hloc_matches.h5" 2>&1 | tail -3
  python3 -m hloc.pipelines.colmap.sfm --sfm_dir "$SPARSE_DIR" --image_dir "$FRAMES_DIR" --features "./hloc_features" --matches "./hloc_matches.h5" --pairs "./hloc_pairs.txt" 2>&1 | tail -10
  if [ -d "$SPARSE_DIR/0" ]; then
    echo "  → SuperPoint reconstrucción OK"
    SKIP_COLMAP_MAPPER=1
  else
    echo "  → SuperPoint falló → usando SIFT"
    FEATURE_EXTRACTOR="sift"
  fi
else
  [ "$FEATURE_EXTRACTOR" = "superpoint" ] && echo "  → hloc no instalado → usando SIFT"
  FEATURE_EXTRACTOR="sift"
fi

if [ "$FEATURE_EXTRACTOR" = "sift" ]; then
  # use_gpu=0: SIFT GPU usa SiftGPU/OpenGL → crash en headless serverless.
  # max_num_features=8192: más features → mejor matching en interiores lisos.
  # num_threads=4: paralelismo moderado.
  colmap feature_extractor \
    --database_path "./colmap.db" \
    --image_path "$FRAMES_DIR" \
    --ImageReader.camera_model OPENCV \
    --SiftExtraction.use_gpu 0 \
    --SiftExtraction.max_image_size 1600 \
    --SiftExtraction.max_num_features 8192 \
    --SiftExtraction.num_threads 4
fi

# ─── Paso 3: Matching + mapper ────────────────────────────────────────────────
if [ "$SKIP_COLMAP_MAPPER" = "0" ]; then
  echo "[3/4] Estimando posiciones de cámara (COLMAP sequential_matcher)..."

  # overlap=15: busca matches en los 15 frames adyacentes en cada dirección.
  # Default=5 era insuficiente para fps=2 con 150 frames submuestreados.
  colmap sequential_matcher \
    --database_path "./colmap.db" \
    --SiftMatching.use_gpu 0 \
    --SequentialMatching.overlap 15

  # Diagnóstico pre-mapper
  MATCH_PAIRS=$(python3 -c "
import sqlite3
try:
    conn = sqlite3.connect('./colmap.db')
    n = conn.execute('SELECT COUNT(*) FROM matches WHERE rows > 0').fetchone()[0]
    conn.close()
    print(n)
except Exception as e:
    print(0)
" 2>/dev/null || echo 0)
  echo "  → $MATCH_PAIRS pares con matches encontrados"

  if [ "$MATCH_PAIRS" -lt 10 ]; then
    echo "ERROR: COLMAP no encontró suficientes matches ($MATCH_PAIRS pares)."
    echo "Causas: video muy corto, poca superposición entre frames, iluminación pobre."
    exit 1
  fi

  colmap mapper \
    --database_path "./colmap.db" \
    --image_path "$FRAMES_DIR" \
    --output_path "$SPARSE_DIR"

  if [ ! -d "$SPARSE_DIR/0" ]; then
    echo "ERROR: COLMAP no pudo reconstruir la escena (0 modelos generados)."
    echo "Causas: poca superposición, iluminación inconsistente, video muy corto."
    exit 1
  fi
  echo "  → Reconstrucción OK: $(ls $SPARSE_DIR/0/ 2>/dev/null | wc -l) archivos en sparse/0/"
else
  echo "[3/4] Reconstrucción completada por SuperPoint — omitiendo mapper"
fi

# ─── Paso 4: Gaussian Splatting ───────────────────────────────────────────────
echo "[4/4] Entrenando Gaussian Splat (trainer=$TRAINER)..."
ITERATIONS=30000
[ "$QUALITY" = "hq" ] && ITERATIONS=50000

if [ "$TRAINER" = "gsplat" ] && command -v gsplat >/dev/null 2>&1; then
  gsplat "." --iterations $ITERATIONS --output "$PLY_OUT" 2>&1 | tail -10 || true
  [ ! -f "$PLY_OUT" ] && TRAINER="opensplat" && echo "  → gsplat falló → OpenSplat"
fi

if [ "$TRAINER" = "opensplat" ] || [ ! -f "$PLY_OUT" ]; then
  opensplat "." -n $ITERATIONS -o "$PLY_OUT"
fi

PLY_SIZE=$(stat -c%s "$PLY_OUT" 2>/dev/null || echo 0)
if [ "$PLY_SIZE" -lt 1048576 ]; then
  echo "ERROR: .ply inválido o vacío (${PLY_SIZE} bytes)"
  exit 1
fi
echo "  → .ply: $(du -sh "$PLY_OUT" | cut -f1)"

# ─── Convertir a .spz ─────────────────────────────────────────────────────────
if command -v ply_to_spz >/dev/null 2>&1; then
  ply_to_spz "$PLY_OUT" "$SPZ_OUT"
  echo "  → .spz: $(du -sh "$SPZ_OUT" | cut -f1)"
else
  echo "  → AVISO: ply_to_spz no encontrado"
fi

echo ""
echo "=== Pipeline OK: frames=$FRAME_COUNT quality=$QUALITY trainer=$TRAINER ==="
