#!/bin/bash
# Splatter — Pipeline: video → .ply + .spz
# Uso: /opt/process_splat.sh <video_path> <project_id> [standard|hq]
# Corre con cwd = /tmp/jobs/{project_id}

set -euo pipefail

VIDEO=$1
PROJECT=${2:-"proyecto"}
QUALITY=${3:-"standard"}
# 150 frames es suficiente para reconstruir una habitación con COLMAP.
# 400 frames → ~20GB RAM en feature extraction → OOM en el contenedor RunPod.
MAX_FRAMES=150

if [ -z "$VIDEO" ] || [ -z "$PROJECT" ]; then
  echo "Uso: $0 <video> <project_id> [standard|hq]"
  exit 1
fi

# OpenSplat busca las imágenes en <proyecto>/images/ — el dir DEBE llamarse "images".
# Pasar ./sparse/0 como proyecto y tener los frames en ./frames hace que OpenSplat
# no encuentre las imágenes → cvtColor(!_src.empty()) crash.
FRAMES_DIR="./images"
SPARSE_DIR="./sparse"
PLY_OUT="./${PROJECT}.ply"
SPZ_OUT="./${PROJECT}.spz"

# COLMAP y sus matchers intentan abrir un display Qt en headless — esto los crashea.
# offscreen evita el SIGABRT en sequential_matcher/vocab_tree_matcher.
export QT_QPA_PLATFORM=offscreen

mkdir -p "$FRAMES_DIR" "$SPARSE_DIR"

echo "=== Splatter pipeline ==="
echo "Video:    $VIDEO"
echo "Proyecto: $PROJECT"
echo "Calidad:  $QUALITY"
echo ""

# ─── Paso 1: Extraer frames ──────────────────────────────────────────────────
echo "[1/4] Extrayendo frames del video..."
# fps=1: con videos de 3-5 min genera 180-300 frames → submuestra a 150.
# fps=2 generaba 360-600 frames → demasiados para la RAM del contenedor RunPod.
ffmpeg -i "$VIDEO" \
  -vf "fps=1" \
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
# max_image_size=1600: COLMAP escala imágenes antes de SIFT → ~60% menos RAM por frame.
# max_num_features=4096: suficiente para Gaussian Splatting, reduce RAM de descriptores.
# num_threads=2: limita paralelismo CPU para evitar picos de RAM simultáneos.
# use_gpu=0 OBLIGATORIO: el SIFT en GPU de COLMAP usa OpenGL (SiftGPU), que necesita
# un contexto de display. En contenedores serverless headless no existe → crashea con
# "OpenGLContextManager Aborted (core dumped)". El SIFT en CPU no usa OpenGL y es
# estable. Con 150 frames a max 1600px el costo de CPU es aceptable.
colmap feature_extractor \
    --database_path "./colmap.db" \
    --image_path "$FRAMES_DIR" \
    --ImageReader.camera_model OPENCV \
    --SiftExtraction.use_gpu 0 \
    --SiftExtraction.max_image_size 1600 \
    --SiftExtraction.max_num_features 4096 \
    --SiftExtraction.num_threads 2

# ─── Paso 3: COLMAP matching + mapper ────────────────────────────────────────
echo "[3/4] Estimando posiciones de cámara (COLMAP)..."
# sequential_matcher es el correcto para frames de video en secuencia (frames
# consecutivos se solapan). vocab_tree_matcher es para colecciones desordenadas
# y además segfaultea en esta build de COLMAP. SiftMatching.use_gpu=0 evita el
# crash de OpenGL en headless.
colmap sequential_matcher \
  --database_path "./colmap.db" \
  --SiftMatching.use_gpu 0

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

# OpenSplat recibe el PROYECTO raíz (cwd = job_dir), que contiene images/ y sparse/0/.
# Internamente lee sparse/0/*.bin y carga las imágenes desde images/.
opensplat "." \
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
