#!/bin/bash
# Splatter — Pipeline: video → .ply + .spz
# Uso: /opt/process_splat.sh <video_path> <project_id> [standard|hq]
# Corre con cwd = /tmp/jobs/{project_id}

set -euo pipefail

VIDEO=$1
PROJECT=${2:-"proyecto"}
QUALITY=${3:-"standard"}
MAX_FRAMES=400

if [ -z "$VIDEO" ] || [ -z "$PROJECT" ]; then
  echo "Uso: $0 <video> <project_id> [standard|hq]"
  exit 1
fi

FRAMES_DIR="./frames"
SPARSE_DIR="./sparse"
PLY_OUT="./${PROJECT}.ply"
SPZ_OUT="./${PROJECT}.spz"

mkdir -p "$FRAMES_DIR" "$SPARSE_DIR"

echo "=== Splatter pipeline ==="
echo "Video:    $VIDEO"
echo "Proyecto: $PROJECT"
echo "Calidad:  $QUALITY"
echo ""

# ─── Paso 1: Extraer frames ──────────────────────────────────────────────────
echo "[1/4] Extrayendo frames del video..."
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

# ─── Cap de frames: máximo 400 en modo standard ──────────────────────────────
if [ "$QUALITY" = "standard" ] && [ "$FRAME_COUNT" -gt "$MAX_FRAMES" ]; then
  echo "  → Modo standard: submuestreando de $FRAME_COUNT a $MAX_FRAMES frames..."
  # División techo: STEP >= 2 siempre que FRAME_COUNT > MAX_FRAMES
  STEP=$(( (FRAME_COUNT + MAX_FRAMES - 1) / MAX_FRAMES ))
  i=0
  # nullglob evita que el glob se expanda literalmente si no hay archivos
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

# ─── Paso 2: COLMAP feature extraction ───────────────────────────────────────
echo "[2/4] Extrayendo features (COLMAP)..."
# Usar if/then para que set -e no cancele el script si GPU no está disponible
if ! colmap feature_extractor \
    --database_path "./colmap.db" \
    --image_path "$FRAMES_DIR" \
    --ImageReader.camera_model OPENCV \
    --SiftExtraction.use_gpu 1 2>/dev/null; then
  echo "  → GPU SIFT no disponible, usando CPU..."
  colmap feature_extractor \
    --database_path "./colmap.db" \
    --image_path "$FRAMES_DIR" \
    --ImageReader.camera_model OPENCV \
    --SiftExtraction.use_gpu 0
fi

# ─── Paso 3: COLMAP matching + mapper ────────────────────────────────────────
echo "[3/4] Estimando posiciones de cámara (COLMAP)..."
if ! colmap vocab_tree_matcher \
    --database_path "./colmap.db" \
    --VocabTreeMatching.vocab_tree_path /opt/vocab_tree.bin 2>/dev/null; then
  echo "  → vocab_tree_matcher falló, usando sequential_matcher..."
  colmap sequential_matcher \
    --database_path "./colmap.db"
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

# ─── Paso 4: OpenSplat ───────────────────────────────────────────────────────
echo "[4/4] Entrenando Gaussian Splat (OpenSplat)..."
ITERATIONS=30000
[ "$QUALITY" = "hq" ] && ITERATIONS=50000

opensplat "$SPARSE_DIR/0" \
  -n $ITERATIONS \
  -o "$PLY_OUT"

# Validar que el .ply tenga contenido (OpenSplat puede crear el archivo y luego crashear)
PLY_SIZE=$(stat -c%s "$PLY_OUT" 2>/dev/null || echo 0)
if [ "$PLY_SIZE" -lt 1048576 ]; then
  echo "ERROR: OpenSplat generó un .ply inválido o vacío (${PLY_SIZE} bytes)"
  exit 1
fi
echo "  → .ply listo: $PLY_OUT ($(du -sh "$PLY_OUT" | cut -f1))"

# ─── Convertir a .spz ────────────────────────────────────────────────────────
# El binario se llama ply_to_spz (nianticlabs/spz, C++)
if command -v ply_to_spz >/dev/null 2>&1; then
  ply_to_spz "$PLY_OUT" "$SPZ_OUT"
  echo "  → .spz listo: $SPZ_OUT ($(du -sh "$SPZ_OUT" | cut -f1))"
else
  echo "  → AVISO: ply_to_spz no encontrado — solo .ply disponible. El viewer de clientes no funcionará."
fi

echo ""
echo "=== Pipeline completado ==="
