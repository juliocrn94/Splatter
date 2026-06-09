FROM nvidia/cuda:12.1.0-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# Sistema base + COLMAP desde apt (Ubuntu 22.04 lo incluye)
RUN apt-get update && apt-get install -y \
    colmap \
    ffmpeg \
    cmake ninja-build wget unzip \
    python3 python3-pip \
    libboost-program-options-dev libboost-filesystem-dev \
    && rm -rf /var/lib/apt/lists/*

# Vocab tree para COLMAP vocab_tree_matcher
RUN wget -q "https://demuc.de/colmap/vocab_tree_flickr100K_words32K.bin" \
    -O /opt/vocab_tree.bin

# Python packages
RUN pip3 install --no-cache-dir runpod boto3 pillow numpy requests spz

# LibTorch para compilar OpenSplat (CUDA 12.1)
RUN wget -q \
    "https://download.pytorch.org/libtorch/cu121/libtorch-cxx11-abi-shared-with-deps-2.1.2%2Bcu121.zip" \
    -O /tmp/libtorch.zip && \
    unzip -q /tmp/libtorch.zip -d /opt && \
    rm /tmp/libtorch.zip

# OpenSplat — tarball desde GitHub Releases (sin git clone)
RUN wget -q \
    "https://github.com/pierotofy/OpenSplat/archive/refs/tags/v1.1.4.tar.gz" \
    -O /tmp/opensplat.tar.gz && \
    tar xzf /tmp/opensplat.tar.gz -C /tmp && \
    mv /tmp/OpenSplat-1.1.4 /tmp/opensplat && \
    cd /tmp/opensplat && mkdir build && cd build && \
    cmake .. -GNinja -DCMAKE_BUILD_TYPE=Release \
        -DTORCH_DIR=/opt/libtorch/share/cmake/Torch && \
    ninja opensplat && \
    cp opensplat /usr/local/bin/ && \
    rm -rf /tmp/opensplat /tmp/opensplat.tar.gz

# Archivos del pipeline
COPY docker/process_splat.sh /opt/process_splat.sh
COPY docker/handler.py /opt/handler.py
RUN chmod +x /opt/process_splat.sh

WORKDIR /opt
CMD ["python3", "/opt/handler.py"]
