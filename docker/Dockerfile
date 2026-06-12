FROM nvidia/cuda:12.1.0-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# Sistema base + COLMAP + dependencias de ply_to_spz
RUN apt-get update && apt-get install -y \
    colmap \
    ffmpeg \
    cmake ninja-build wget unzip git \
    g++ \
    zlib1g-dev libzstd-dev \
    python3 python3-pip \
    libopencv-dev \
    libboost-program-options-dev libboost-filesystem-dev \
    && rm -rf /var/lib/apt/lists/*

# Vocab tree para COLMAP vocab_tree_matcher (~38MB — verificar que no sea HTML de error)
RUN wget -q "https://demuc.de/colmap/vocab_tree_flickr100K_words32K.bin" \
    -O /opt/vocab_tree.bin && \
    test $(stat -c%s /opt/vocab_tree.bin) -gt 10000000 || \
    (echo "ERROR: vocab_tree descargado incompleto o inválido" && exit 1)

# Python packages
RUN pip3 install --no-cache-dir runpod boto3 pillow numpy requests

# ply_to_spz — convierte .ply → .spz (nianticlabs/spz, C++ con CMake)
# IMPORTANTE: reemplazamos el ply_to_spz.cpp del repo por el nuestro, que fuerza
# formato spz versión 2 (gzip). El HEAD del repo genera v4 (ZSTD) que los viewers
# web como Spark NO leen (solo soportan v1-3 gzip).
COPY docker/ply_to_spz_v2.cpp /tmp/ply_to_spz_v2.cpp
RUN git clone --depth=1 https://github.com/nianticlabs/spz.git /tmp/spz && \
    cp /tmp/ply_to_spz_v2.cpp /tmp/spz/cli_tools/src/ply_to_spz.cpp && \
    cd /tmp/spz && \
    cmake -B build -DSPZ_BUILD_TOOLS=ON -DCMAKE_BUILD_TYPE=Release . && \
    cmake --build build --parallel 2 && \
    find /tmp/spz/build -name "ply_to_spz" -type f -exec cp {} /usr/local/bin/ply_to_spz \; && \
    test -f /usr/local/bin/ply_to_spz || (echo "ERROR: ply_to_spz no encontrado tras el build" && exit 1) && \
    chmod +x /usr/local/bin/ply_to_spz && \
    rm -rf /tmp/spz /tmp/ply_to_spz_v2.cpp && \
    echo "ply_to_spz OK (v2 forzado)"

# LibTorch
RUN wget -v \
    "https://download.pytorch.org/libtorch/cu121/libtorch-cxx11-abi-shared-with-deps-2.1.2%2Bcu121.zip" \
    -O /tmp/libtorch.zip
RUN unzip -q /tmp/libtorch.zip -d /opt && rm /tmp/libtorch.zip && \
    echo "LibTorch OK: $(ls /opt/libtorch/share/cmake/Torch)"

# OpenSplat — descargar y compilar
RUN wget -v \
    "https://github.com/pierotofy/OpenSplat/archive/refs/tags/v1.1.4.tar.gz" \
    -O /tmp/opensplat.tar.gz && \
    tar xzf /tmp/opensplat.tar.gz -C /tmp && \
    mv /tmp/OpenSplat-1.1.4 /tmp/opensplat && \
    echo "OpenSplat src OK"

RUN cd /tmp/opensplat && mkdir build && cd build && \
    cmake .. -GNinja -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_PREFIX_PATH=/opt/libtorch && \
    ninja opensplat && \
    cp opensplat /usr/local/bin/ && \
    rm -rf /tmp/opensplat /tmp/opensplat.tar.gz && \
    echo "OpenSplat binary OK"

# Archivos del pipeline — ARG CACHEBUST invalida este layer en cada build
ARG CACHEBUST=2026-06-12-v5
COPY docker/process_splat.sh /opt/process_splat.sh
COPY docker/handler.py /opt/handler.py
RUN chmod +x /opt/process_splat.sh && \
    echo "Script version: $(head -4 /opt/process_splat.sh | tail -1)"

WORKDIR /opt
CMD ["python3", "/opt/handler.py"]
