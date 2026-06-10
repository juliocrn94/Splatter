# ─── Worker de VALIDACIÓN gsplat (rama gsplat-validation) ─────────────────────
# Reemplaza OpenSplat por gsplat (Nerfstudio) con rasterización antialiased
# (mip-splatting). NO tocar producción (main usa OpenSplat).
FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
# RTX 4090 = Ada = compute capability 8.9 (para compilar fused-ssim)
ENV TORCH_CUDA_ARCH_LIST="8.9"
ENV PYTHONUNBUFFERED=1

# Sistema: COLMAP + ffmpeg + Python 3.10 + build tools (ply_to_spz, fused-ssim)
RUN apt-get update && apt-get install -y --no-install-recommends \
    colmap ffmpeg \
    python3.10 python3-pip \
    git cmake ninja-build g++ wget \
    zlib1g-dev libzstd-dev \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN ln -sf /usr/bin/python3.10 /usr/bin/python

# 1) torch 2.1.2 + cu121 PRIMERO (ABI que esperan los wheels de gsplat)
RUN pip install --no-cache-dir torch==2.1.2 torchvision==0.16.2 \
    --index-url https://download.pytorch.org/whl/cu121

# 2) gsplat por WHEEL PRECOMPILADO (sin compilar la extensión CUDA en cold start)
# --extra-index-url (no --index-url): mantiene PyPI como fuente de deps transitivas
# (rich, etc.). --index-url las bloqueaba y rompía el install.
RUN pip install --no-cache-dir gsplat==1.5.3+pt21cu121 \
    --extra-index-url https://docs.gsplat.studio/whl/pt21cu121

# 3) deps de simple_trainer 'default' + worker (runpod, requests para handler)
RUN pip install --no-cache-dir \
    "numpy<2.0.0" scipy scikit-learn opencv-python-headless "imageio[ffmpeg]" \
    "tyro>=0.8.8" tqdm Pillow "torchmetrics[image]" tensorboard \
    runpod requests boto3 \
    "git+https://github.com/rmbrualla/pycolmap@cc7ea4b7301720ac29287dbe450952511b32125e"

# 4) fused-ssim es opcional — gsplat detecta su ausencia y usa torchmetrics.SSIM.
#    NO lo compilamos en el build: requiere nvcc + CUDA en el runner de CI (que no tiene GPU),
#    y en el worker de RunPod compilaría en cold start. El fallback es suficiente para validación.

# 5) código de gsplat (simple_trainer.py + datasets/colmap.py)
RUN git clone --depth 1 https://github.com/nerfstudio-project/gsplat /opt/gsplat

# 6) ply_to_spz v2 (gzip, compatible con Spark) — mismo converter que producción
COPY docker/ply_to_spz_v2.cpp /tmp/ply_to_spz_v2.cpp
RUN git clone --depth=1 https://github.com/nianticlabs/spz.git /tmp/spz && \
    cp /tmp/ply_to_spz_v2.cpp /tmp/spz/cli_tools/src/ply_to_spz.cpp && \
    cd /tmp/spz && \
    cmake -B build -DSPZ_BUILD_TOOLS=ON -DCMAKE_BUILD_TYPE=Release . && \
    cmake --build build --parallel 2 && \
    find /tmp/spz/build -name "ply_to_spz" -type f -exec cp {} /usr/local/bin/ply_to_spz \; && \
    test -f /usr/local/bin/ply_to_spz && chmod +x /usr/local/bin/ply_to_spz && \
    rm -rf /tmp/spz /tmp/ply_to_spz_v2.cpp && \
    echo "ply_to_spz OK (v2)"

# Archivos del pipeline
COPY docker/process_splat.sh /opt/process_splat.sh
COPY docker/handler.py /opt/handler.py
RUN chmod +x /opt/process_splat.sh

WORKDIR /opt
CMD ["python3", "/opt/handler.py"]

