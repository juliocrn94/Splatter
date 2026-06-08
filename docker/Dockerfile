# Base de RunPod con PyTorch + CUDA ya instalados — evita compilar LibTorch
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# Sistema + COLMAP desde apt (sin compilar)
RUN apt-get update && apt-get install -y \
    colmap \
    ffmpeg \
    git cmake ninja-build \
    python3-pip wget \
    && rm -rf /var/lib/apt/lists/*

# Vocab tree para COLMAP vocab_tree_matcher
RUN wget -q "https://demuc.de/colmap/vocab_tree_flickr100K_words32K.bin" \
    -O /opt/vocab_tree.bin

# Python packages
RUN pip install --no-cache-dir runpod boto3 pillow numpy requests spz

# OpenSplat — compila usando PyTorch ya instalado en la imagen base
RUN git clone --depth=1 https://github.com/pierotofy/OpenSplat.git /tmp/opensplat && \
    cd /tmp/opensplat && mkdir build && cd build && \
    cmake .. -GNinja -DCMAKE_BUILD_TYPE=Release \
        -DTORCH_DIR="$(python3 -c 'import torch; print(torch.utils.cmake_prefix_path)')" && \
    ninja && \
    cp opensplat /usr/local/bin/ && \
    rm -rf /tmp/opensplat

# Archivos del pipeline (rutas relativas a la raíz del repo)
COPY docker/process_splat.sh /opt/process_splat.sh
COPY docker/handler.py /opt/handler.py
RUN chmod +x /opt/process_splat.sh

WORKDIR /opt
CMD ["python3", "/opt/handler.py"]
