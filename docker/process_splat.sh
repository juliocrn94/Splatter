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

# Filtro anti-blur: usa ffmpeg blurdetect (FFmpeg >= 5.1) con fallback a varianza
# de Laplaciano vía Python. Si ninguno está disponible, se salta el filtro con aviso.
echo "  → Filtrando frames borrosos..."
REMOVED=0

# blurdetect devuelve 0.0 (nítido) → 1.0 (muy borroso); se eliminan frames >= 0.6
BLUR_MAX=60  # porcentaje entero

# Varianza de Laplaciano: < 100 = borroso (umbral conservador para interiores)
LAP_MIN=100

HAS_BLURDETECT=$(ffmpeg -filters 2>/dev/null | grep -c "^ *blurdetect" || echo 0)

if [ "$HAS_BLURDETECT" -gt 0 ]; then
  echo "    modo: ffmpeg blurdetect (umbral ${BLUR_MAX}%)"
  for f in "$WORKDIR/frames/"*.jpg; do
    SCORE=$(ffmpeg -i "$f" \
      -vf "blurdetect,metadata=print:file=-" \
      -frames:v 1 -f null - 2>/dev/null \
      | awk -F= '/lavfi\.blur=/{printf "%d", $2 * 100; exit}')
    SCORE=${SCORE:-0}
    if [ "$SCORE" -ge "$BLUR_MAX" ] 2>/dev/null; then
      rm -f "$f"
      REMOVED=$(( REMOVED + 1 ))
    fi
  done

elif command -v python3 >/dev/null 2>&1; then
  echo "    modo: varianza de Laplaciano Python (umbral ${LAP_MIN})"
  for f in "$WORKDIR/frames/"*.jpg; do
    IS_BLURRY=$(python3 - "$f" <<'PYEOF'
import sys
try:
    from PIL import Image, ImageFilter
    import numpy as np
    img = Image.open(sys.argv[1]).convert('L')
    arr = np.array(img.filter(ImageFilter.FIND_EDGES), dtype=float)
    print(1 if arr.var() < 100 else 0)
except Exception:
    print(0)
PYEOF
    )
    if [ "${IS_BLURRY:-0}" = "1" ]; then
      rm -f "$f"
      REMOVED=$(( REMOVED + 1 ))
    fi
  done

else
  echo "    AVISO: ffmpeg blurdetect y python3+PIL no disponibles — filtro de blur omitido"
fi

FRAME_COUNT=$(ls "$WORKDIR/frames/" | wc -l | tr -d ' ')
echo "  → $REMOVED frames borrosos eliminados, quedan $FRAME_COUNT"

# Filtro de transición brusca — elimina frames con cambio abrupto de escena
echo "  → Filtrando transiciones bruscas..."
SCENE_REMOVED=0
PREV_BRIGHTNESS=""
for f in "$WORKDIR/frames/"*.jpg; do
  BRIGHTNESS=$(ffmpeg -i "$f" -vf "signalstats" -f null - 2>&1 | grep "YAVG" | tail -1 | grep -o '[0-9]*\.[0-9]*' | head -1)
  BRIGHTNESS=${BRIGHTNESS:-128}
  if [ -n "$PREV_BRIGHTNESS" ]; then
    DIFF=$(echo "$BRIGHTNESS $PREV_BRIGHTNESS" | awk '{d=$1-$2; if(d<0)d=-d; printf "%d", d}')
    if [ "${DIFF:-0}" -gt 40 ] 2>/dev/null; then
      rm -f "$f"
      SCENE_REMOVED=$(( SCENE_REMOVED + 1 ))
    else
      PREV_BRIGHTNESS=$BRIGHTNESS
    fi
  else
    PREV_BRIGHTNESS=$BRIGHTNESS
  fi
done
FRAME_COUNT=$(ls "$WORKDIR/frames/" | wc -l | tr -d ' ')
echo "  → $SCENE_REMOVED frames de transición eliminados, quedan $FRAME_COUNT"

# Normalización de exposición — reduce variaciones de brillo entre frames
echo "  → Normalizando exposición entre frames..."
for f in "$WORKDIR/frames/"*.jpg; do
  ffmpeg -i "$f" -vf "histeq=strength=0.15:intensity=0.15" -y "${f}.eq.jpg" 2>/dev/null && mv "${f}.eq.jpg" "$f" || true
done
echo "  → Normalización completada"

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
