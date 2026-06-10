#!/bin/bash
# Splatter — Pipeline VALIDACIÓN gsplat (rama gsplat-validation)
# FFmpeg → COLMAP → gsplat simple_trainer (antialiased) → .ply + .spz
# Uso: /opt/process_splat.sh <video_path> <project_id> [standard|hq]
set -euo pipefail

VIDEO=$1
PROJECT=${2:-"proyecto"}
QUALITY=${3:-"standard"}

# standard: 300 frames / fps=2 (mejor cobertura vs OpenSplat que usaba 150/fps=1)
# hq: sin cap
MAX_FRAMES=300
ITERATIONS=30000
[ "$QUALITY" = "hq" ] && ITERATIONS=50000

if [ -z "$VIDEO" ] || [ -z "$PROJECT" ]; then
  echo "Uso: $0 <video> <project_id> [standard|hq]"
  exit 1
fi

# gsplat simple_trainer espera: images/ + sparse/0/
# → FRAMES_DIR=images (no "frames") para compatibilidad directa
FRAMES_DIR="./images"
SPARSE_DIR="./sparse"
PLY_OUT="./${PROJECT}.ply"
SPZ_OUT="./${PROJECT}.spz"

export QT_QPA_PLATFORM=offscreen
mkdir -p "$FRAMES_DIR" "$SPARSE_DIR"

echo "=== Splatter pipeline (gsplat) ==="
echo "Video:    $VIDEO"
echo "Proyecto: $PROJECT"
echo "Calidad:  $QUALITY ($ITERATIONS iters)"
echo ""

# ─── Paso 1: Extraer frames ──────────────────────────────────────────────────
echo "[1/4] Extrayendo frames..."
# fps=2 (vs fps=1 anterior): mejor overlap → mejor reconstrucción COLMAP
ffmpeg -i "$VIDEO" -vf "fps=2" -qscale:v 2 \
  "$FRAMES_DIR/frame_%04d.jpg" -hide_banner -loglevel error

FRAME_COUNT=$(find "$FRAMES_DIR" -name "*.jpg" | wc -l | tr -d ' ')
echo "  → $FRAME_COUNT frames extraídos"

[ "$FRAME_COUNT" -lt 10 ] && { echo "ERROR: muy pocos frames ($FRAME_COUNT)"; exit 1; }

if [ "$QUALITY" = "standard" ] && [ "$FRAME_COUNT" -gt "$MAX_FRAMES" ]; then
  echo "  → Submuestreando a $MAX_FRAMES frames..."
  STEP=$(( (FRAME_COUNT + MAX_FRAMES - 1) / MAX_FRAMES ))
  i=0
  shopt -s nullglob
  for f in "$FRAMES_DIR/"*.jpg; do
    [ $(( i % STEP )) -ne 0 ] && rm -f "$f"
    i=$(( i + 1 ))
  done
  shopt -u nullglob
  FRAME_COUNT=$(find "$FRAMES_DIR" -name "*.jpg" | wc -l | tr -d ' ')
  echo "  → $FRAME_COUNT frames (step=$STEP)"
fi

# ─── Paso 2: COLMAP feature extraction ───────────────────────────────────────
echo "[2/4] Extrayendo features (COLMAP)..."
# max_image_size=2400 y max_num_features=16384 vs 1600/4096 en producción
# → más detalle para mejor inicialización de gaussians
colmap feature_extractor \
    --database_path "./colmap.db" \
    --image_path "$FRAMES_DIR" \
    --ImageReader.camera_model OPENCV \
    --SiftExtraction.use_gpu 0 \
    --SiftExtraction.max_image_size 2400 \
    --SiftExtraction.max_num_features 16384 \
    --SiftExtraction.num_threads 2

# ─── Paso 3: COLMAP matching + mapper ────────────────────────────────────────
echo "[3/4] Estimando posiciones de cámara (COLMAP)..."
colmap sequential_matcher \
  --database_path "./colmap.db" \
  --SiftMatching.use_gpu 0

colmap mapper \
  --database_path "./colmap.db" \
  --image_path "$FRAMES_DIR" \
  --output_path "$SPARSE_DIR"

[ ! -d "$SPARSE_DIR/0" ] && { echo "ERROR: COLMAP no reconstruyó la escena."; exit 1; }

# ─── Paso 4: gsplat simple_trainer (antialiased) ─────────────────────────────
echo "[4/4] Entrenando Gaussian Splat (gsplat, antialiased, $ITERATIONS iters)..."
python3 /opt/gsplat/examples/simple_trainer.py default \
    --data_dir "." \
    --data_factor 1 \
    --result_dir "./gsplat_out" \
    --max_steps $ITERATIONS \
    --antialiased \
    --save_ply \
    --ply_steps $ITERATIONS

# gsplat guarda en: ./gsplat_out/ply/point_cloud_{step}.ply
GSPLAT_PLY="./gsplat_out/ply/point_cloud_${ITERATIONS}.ply"
if [ ! -f "$GSPLAT_PLY" ]; then
  echo "ERROR: gsplat no generó el .ply en $GSPLAT_PLY"
  ls -la ./gsplat_out/ply/ 2>/dev/null || echo "(dir ply no existe)"
  exit 1
fi

cp "$GSPLAT_PLY" "$PLY_OUT"

PLY_SIZE=$(stat -c%s "$PLY_OUT" 2>/dev/null || echo 0)
[ "$PLY_SIZE" -lt 1048576 ] && { echo "ERROR: .ply inválido (${PLY_SIZE} bytes)"; exit 1; }
echo "  → .ply listo: $PLY_OUT ($(du -sh "$PLY_OUT" | cut -f1))"

# ─── Convertir a .spz ────────────────────────────────────────────────────────
if command -v ply_to_spz >/dev/null 2>&1; then
  ply_to_spz "$PLY_OUT" "$SPZ_OUT"
  echo "  → .spz listo: $SPZ_OUT ($(du -sh "$SPZ_OUT" | cut -f1))"
else
  echo "  → AVISO: ply_to_spz no encontrado"
fi

echo ""
echo "=== Pipeline gsplat completado ==="
