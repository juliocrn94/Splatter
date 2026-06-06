#!/bin/bash
# Splatter — Pipeline: video → .ply listo para SuperSplat
# Uso: ./process_splat.sh video.mp4 nombre_proyecto
# Requiere: ffmpeg, colmap, opensplat (en PATH)

set -e

VIDEO=$1
PROJECT=${2:-"proyecto_$(date +%Y%m%d_%H%M%S)"}
QUALITY=${3:-"standard"}  # standard (400 frames) | hq (todos los frames)
MAX_FRAMES=400
WORKDIR="./output/$PROJECT"

if [ -z "$VIDEO" ]; then
  echo "Uso: $0 <video.mp4> [nombre_proyecto]"
  exit 1
fi

echo "=== Splatter pipeline ==="
echo "Video: $VIDEO"
echo "Proyecto: $PROJECT"
echo ""

# Setup
mkdir -p "$WORKDIR/frames" "$WORKDIR/sparse"

# Paso 1: extraer frames (2 fps, descartar duplicados)
echo "[1/4] Extrayendo frames del video..."
ffmpeg -i "$VIDEO" \
  -vf "fps=2,mpdecimate" \
  -qscale:v 2 \
  "$WORKDIR/frames/frame_%04d.jpg" \
  -hide_banner -loglevel error

FRAME_COUNT=$(ls "$WORKDIR/frames/" | wc -l | tr -d ' ')
echo "  → $FRAME_COUNT frames extraídos"

# Filtro anti-blur: elimina el 5% más pequeño (frames borrosos)
echo "  → Filtrando frames borrosos..."
REMOVE_N=$(( FRAME_COUNT / 20 ))
if [ $REMOVE_N -gt 0 ]; then
  ls -lS "$WORKDIR/frames/"*.jpg | tail -n $REMOVE_N | awk '{print $NF}' | xargs rm -f
  FRAME_COUNT=$(ls "$WORKDIR/frames/" | wc -l | tr -d ' ')
  echo "  → $REMOVE_N frames borrosos eliminados, quedan $FRAME_COUNT"
fi

# Cap de frames: máximo 400 en modo standard
if [ "$QUALITY" = "standard" ] && [ "$FRAME_COUNT" -gt "$MAX_FRAMES" ]; then
  echo "  → Modo standard: submuestreando a $MAX_FRAMES frames (de $FRAME_COUNT)..."
  STEP=$(( FRAME_COUNT / MAX_FRAMES ))
  i=0; count=0
  for f in "$WORKDIR/frames/"*.jpg; do
    i=$(( i + 1 ))
    if [ $(( i % STEP )) -ne 0 ]; then
      rm -f "$f"
    else
      count=$(( count + 1 ))
    fi
  done
  echo "  → $count frames seleccionados para procesamiento"
fi

# Paso 2: COLMAP feature extraction
echo "[2/4] Extrayendo features (COLMAP)..."
colmap feature_extractor \
  --database_path "$WORKDIR/colmap.db" \
  --image_path "$WORKDIR/frames" \
  --ImageReader.camera_model OPENCV \
  --SiftExtraction.use_gpu 1 2>/dev/null || \
colmap feature_extractor \
  --database_path "$WORKDIR/colmap.db" \
  --image_path "$WORKDIR/frames" \
  --ImageReader.camera_model OPENCV \
  --SiftExtraction.use_gpu 0

# Paso 3: COLMAP matching + mapper
echo "[3/4] Estimando posiciones de cámara (COLMAP)..."
# vocab_tree_matcher es correcto para 200-400 imágenes (exhaustive_matcher hace OOM)
colmap vocab_tree_matcher \
  --database_path "$WORKDIR/colmap.db" \
  --VocabTreeMatching.vocab_tree_path /opt/vocab_tree.bin 2>/dev/null || \
colmap sequential_matcher \
  --database_path "$WORKDIR/colmap.db" 2>/dev/null

colmap mapper \
  --database_path "$WORKDIR/colmap.db" \
  --image_path "$WORKDIR/frames" \
  --output_path "$WORKDIR/sparse" 2>/dev/null

if [ ! -d "$WORKDIR/sparse/0" ]; then
  echo "ERROR: COLMAP no pudo reconstruir la escena."
  echo "Posibles causas: muy poca superposición entre frames, iluminación mala, video muy corto."
  exit 1
fi

# Paso 4: OpenSplat
echo "[4/4] Entrenando Gaussian Splat (OpenSplat)..."
# Genera .ply (maestro) y .spz (entrega mobile-optimizada)
ITERATIONS=30000
[ "$QUALITY" = "hq" ] && ITERATIONS=50000

opensplat "$WORKDIR/sparse/0" \
  -n $ITERATIONS \
  -o "$WORKDIR/$PROJECT.ply"

# Convertir a .spz para entrega (4-6x más pequeño, mobile-optimizado)
if command -v ply2spz >/dev/null 2>&1; then
  ply2spz "$WORKDIR/$PROJECT.ply" "$WORKDIR/$PROJECT.spz"
  echo "Splat .spz: $WORKDIR/$PROJECT.spz ($(du -sh "$WORKDIR/$PROJECT.spz" | cut -f1))"
else
  echo "ply2spz no encontrado — solo .ply disponible. Instalar: https://github.com/nianticlabs/spz"
fi

echo ""
echo "=== Listo ==="
echo "Splat maestro (.ply): $WORKDIR/$PROJECT.ply ($(du -sh "$WORKDIR/$PROJECT.ply" | cut -f1))"
echo "Splat entrega (.spz): $WORKDIR/$PROJECT.spz"
echo "Próximo paso: subir ambos a R2, usar .spz para el viewer"
