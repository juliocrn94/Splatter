FROM nvidia/cuda:12.1.0-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/usr/local/bin:${PATH}"

# Dependencias del sistema
RUN apt-get update && apt-get install -y \
    python3 python3-pip git cmake build-essential ninja-build \
    ffmpeg libboost-all-dev libeigen3-dev libflann-dev \
    libfreeimage-dev libmetis-dev libgoogle-glog-dev \
    libgflags-dev libsqlite3-dev libglew-dev \
    qtbase5-dev libqt5opengl5-dev libcgal-dev libceres-dev \
    wget curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Python packages
RUN pip3 install --no-cache-dir runpod boto3 pillow numpy requests

# COLMAP
RUN git clone --depth=1 https://github.com/colmap/colmap.git /tmp/colmap && \
    cd /tmp/colmap && mkdir build && cd build && \
    cmake .. -GNinja -DCMAKE_BUILD_TYPE=Release && \
    ninja && ninja install && \
    rm -rf /tmp/colmap

# Vocab tree para COLMAP vocab_tree_matcher
RUN wget -q https://demuc.de/colmap/vocab_tree_flickr100K_words32K.bin \
    -O /opt/vocab_tree.bin

# OpenSplat
RUN git clone --depth=1 https://github.com/pierotofy/OpenSplat.git /tmp/opensplat && \
    cd /tmp/opensplat && mkdir build && cd build && \
    cmake .. -GNinja -DCMAKE_BUILD_TYPE=Release && \
    ninja && cp opensplat /usr/local/bin/ && \
    rm -rf /tmp/opensplat

# spz — conversión .ply → .spz
RUN pip3 install --no-cache-dir spz

# Archivos del pipeline (rutas relativas a la raíz del repo)
COPY docker/process_splat.sh /opt/process_splat.sh
COPY docker/handler.py /opt/handler.py
RUN chmod +x /opt/process_splat.sh

WORKDIR /opt
CMD ["python3", "/opt/handler.py"]
