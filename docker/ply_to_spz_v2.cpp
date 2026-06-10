// Converter .ply → .spz que fuerza el formato versión 2.
//
// Por qué v2: el HEAD de nianticlabs/spz cambió el default a versión 4, que usa
// compresión ZSTD y un contenedor NGSP crudo. Los viewers web (Spark @sparkjsdev/spark
// v2.x) solo leen versiones 1–3 (formato gzip legacy) y rechazan v4.
// La versión 2 además evita el encoding "smallest-three quaternions" (introducido en v3),
// dando la máxima compatibilidad con lectores existentes.
//
// Reemplaza el cli_tools/src/ply_to_spz.cpp del repo durante el build de Docker.
#include "cc/load-spz.h"
#include <iostream>

int main(int argc, char** argv) {
    if (argc < 3) {
        std::cerr << "Usage: ply_to_spz <input.ply> <output.spz>" << std::endl;
        return 1;
    }

    spz::UnpackOptions unpack_options;
    spz::GaussianCloud splat = spz::loadSplatFromPly(argv[1], unpack_options);

    if (splat.numPoints == 0) {
        std::cerr << "[ply_to_spz] Error: el .ply no contiene puntos o no se pudo leer" << std::endl;
        return 1;
    }

    spz::PackOptions pack_options;
    pack_options.version = 2;  // gzip legacy, sin smallest-three → compatible con Spark

    if (!spz::saveSpz(splat, pack_options, argv[2])) {
        std::cerr << "[ply_to_spz] Error al guardar el .spz" << std::endl;
        return 1;
    }

    std::cerr << "[ply_to_spz] OK: " << splat.numPoints << " puntos → " << argv[2]
              << " (formato v2 gzip)" << std::endl;
    return 0;
}
