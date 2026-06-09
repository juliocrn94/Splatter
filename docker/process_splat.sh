#!/bin/bash
# Splatter — Pipeline: video → .ply + .spz
# Uso: /opt/process_splat.sh <video_path> <project_id> [standard|hq]
# Corre con cwd = /tmp/jobs/{project_id} — outputs van en ese directorio

set -euo pipefail

VIDEO=$1
PROJECT=${2:-"proyecto"}
QUALITY=${3:-"standard"}
MAX_FRAMES=400

if [ -z "$VIDEO" ] || [ -z "$PROJECT" ]; then
  echo "Uso: $0 <video> <project_id> [standard|hq]"
  exit 1
fi

# Outputs en el cwd (que es job_dir = /tmp/jobs/{project_id})
# handler.py busca: {job_dir}/{project_id}.ply — coincide con $PROJECT.ply aquí
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
  echo "  → Modo standard: submuestreando a $MAX_FRAMES frames (de $FRAME_COUNT)..."
  STEP=$(( FRAME_COUNT / MAX_FRAMES ))
  i=0
  for f in "$FRAMES_DIR/"*.jpg; do
    i=$(( i + 1 ))
    if [ $(( i % STEP )) -ne 0 ]; then
      rm -f "$f"
    fi
  done
  FRAME_COUNT=$(find "$FRAMES_DIR" -name "*.jpg" | wc -l | tr -d ' ')
  echo "  → $FRAME_COUNT frames seleccionados"
fi

# ─── Paso 2: COLMAP feature extraction ──────────────────────────────────────
echo "[2/4] Extrayendo features (COLMAP)..."
# Intentar GPU primero, fallback a CPU
colmap feature_extractor \
  --database_path "./colmap.db" \
  --image_path "$FRAMES_DIR" \
  --ImageReader.camera_model OPENCV \
  --SiftExtraction.use_gpu 1 2>/dev/null || \
colmap feature_extractor \
  --database_path "./colmap.db" \
  --image_path "$FRAMES_DIR" \
  --ImageReader.camera_model OPENCV \
  --SiftExtraction.use_gpu 0

# ─── Paso 3: COLMAP matching + mapper ────────────────────────────────────────
echo "[3/4] Estimando posiciones de cámara (COLMAP)..."
colmap vocab_tree_matcher \
  --database_path "./colmap.db" \
  --VocabTreeMatching.vocab_tree_path /opt/vocab_tree.bin 2>/dev/null || \
colmap sequential_matcher \
  --database_path "./colmap.db"

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

echo "  → .ply listo: $PLY_OUT ($(du -sh "$PLY_OUT" | cut -f1))"

# ─── Convertir a .spz ────────────────────────────────────────────────────────
if command -v ply2spz >/dev/null 2>&1; then
  ply2spz "$PLY_OUT" "$SPZ_OUT"
  echo "  → .spz listo: $SPZ_OUT ($(du -sh "$SPZ_OUT" | cut -f1))"
else
  echo "  → ply2spz no encontrado — solo .ply disponible"
fi

echo ""
echo "=== Pipeline completado ==="
