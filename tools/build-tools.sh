#!/bin/bash
# build-tools.sh - compila las herramientas nativas de assets L2 para macOS arm64.
# Todo queda dentro de tools/ (no instala nada en el sistema).
#
# Uso:  tools/build-tools.sh            # compila todo lo que falte
#       tools/build-tools.sh --force    # recompila aunque ya existan los binarios
#
# Resultados:
#   tools/bin/umodel      - UE Viewer (UTX -> TGA/DDS), con parche macOS arm64
#   tools/bin/umodel-view - UE Viewer con RENDERING (visor OpenGL headless, ground truth)
#   tools/bin/l2encdec    - cifra/descifra archivos L2 (protocolos 111-414)
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$TOOLS_DIR/src"
VENDOR_DIR="$TOOLS_DIR/vendor"
BIN_DIR="$TOOLS_DIR/bin"
CMAKE="$VENDOR_DIR/cmake-3.30.5-macos-universal/CMake.app/Contents/bin/cmake"
CMAKE_URL="https://github.com/Kitware/CMake/releases/download/v3.30.5/cmake-3.30.5-macos-universal.tar.gz"
SSE2NEON_URL="https://raw.githubusercontent.com/DLTcollab/sse2neon/master/sse2neon.h"
UEVIEWER_URL="https://github.com/gildor2/UEViewer.git"
L2ENCDEC_URL="https://github.com/ritsuwastaken/open-l2encdec.git"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

mkdir -p "$SRC_DIR" "$VENDOR_DIR" "$BIN_DIR"

# --- cmake local (solo si no hay uno en PATH) -------------------------------
if ! command -v cmake >/dev/null 2>&1 && [ ! -x "$CMAKE" ]; then
	echo ">> Descargando cmake portable a tools/vendor ..."
	curl -sL "$CMAKE_URL" -o "$VENDOR_DIR/cmake.tar.gz"
	tar xzf "$VENDOR_DIR/cmake.tar.gz" -C "$VENDOR_DIR"
	rm "$VENDOR_DIR/cmake.tar.gz"
fi
command -v cmake >/dev/null 2>&1 && CMAKE="$(command -v cmake)"

# --- sse2neon (cabecera SSE->NEON para el parche de umodel) ------------------
if [ ! -f "$VENDOR_DIR/sse2neon.h" ]; then
	echo ">> Descargando sse2neon.h ..."
	curl -sL "$SSE2NEON_URL" -o "$VENDOR_DIR/sse2neon.h"
fi

# --- umodel (UE Viewer) ------------------------------------------------------
if [ ! -x "$BIN_DIR/umodel" ] || [ "$FORCE" = 1 ]; then
	echo ">> Compilando umodel ..."
	[ -d "$SRC_DIR/UEViewer" ] || git clone --depth 1 "$UEVIEWER_URL" "$SRC_DIR/UEViewer"
	cd "$SRC_DIR/UEViewer"
	# Aplica el parche macOS arm64 solo si aun no esta aplicado
	if ! grep -q sse2neon Core/MathSSE.h; then
		git apply "$TOOLS_DIR/patches/ueviewer-macos-arm64.patch"
	fi
	./build.sh
	cp umodel "$BIN_DIR/umodel"
	echo ">> OK: $BIN_DIR/umodel"
else
	echo ">> umodel ya existe ($BIN_DIR/umodel)"
fi

# --- umodel-view (UE Viewer con RENDERING, visor OpenGL) ----------------------
# Binario separado: NO sustituye al CLI umodel. Necesita SDL2 vendored.
SDL2_VERSION="2.30.5"
SDL2_URL="https://github.com/libsdl-org/SDL/releases/download/release-$SDL2_VERSION/SDL2-$SDL2_VERSION.tar.gz"

if [ ! -x "$BIN_DIR/umodel-view" ] || [ "$FORCE" = 1 ]; then
	echo ">> Compilando umodel-view (visor con rendering) ..."
	# SDL2 vendored (no toca el sistema)
	if [ ! -f "$VENDOR_DIR/SDL2/lib/libSDL2.dylib" ]; then
		echo ">> Descargando y compilando SDL2 $SDL2_VERSION en tools/vendor ..."
		[ -d "$VENDOR_DIR/SDL2-src" ] || {
			curl -sL "$SDL2_URL" -o "$VENDOR_DIR/SDL2.tar.gz"
			tar xzf "$VENDOR_DIR/SDL2.tar.gz" -C "$VENDOR_DIR"
			mv "$VENDOR_DIR/SDL2-$SDL2_VERSION" "$VENDOR_DIR/SDL2-src"
			rm "$VENDOR_DIR/SDL2.tar.gz"
		}
		"$CMAKE" -S "$VENDOR_DIR/SDL2-src" -B "$VENDOR_DIR/SDL2-build" \
			-DCMAKE_BUILD_TYPE=Release -DSDL_SHARED=ON -DSDL_STATIC=OFF \
			-DCMAKE_INSTALL_PREFIX="$VENDOR_DIR/SDL2" \
			-DCMAKE_OSX_ARCHITECTURES=arm64 -DSDL_TEST=OFF
		"$CMAKE" --build "$VENDOR_DIR/SDL2-build" -j
		"$CMAKE" --install "$VENDOR_DIR/SDL2-build"
	fi
	[ -d "$SRC_DIR/UEViewer" ] || git clone --depth 1 "$UEVIEWER_URL" "$SRC_DIR/UEViewer"
	cd "$SRC_DIR/UEViewer"
	# parches, en orden: arm64 (base del CLI) + render (visor)
	if ! grep -q sse2neon Core/MathSSE.h; then
		git apply "$TOOLS_DIR/patches/ueviewer-macos-arm64.patch"
	fi
	if ! grep -q UMODEL_AUTOSHOT UmodelTool/UmodelApp.cpp; then
		git apply "$TOOLS_DIR/patches/ueviewer-macos-render.patch"
	fi
	./build.sh --exe umodel-view
	cp umodel-view "$BIN_DIR/umodel-view"
	echo ">> OK: $BIN_DIR/umodel-view"
else
	echo ">> umodel-view ya existe ($BIN_DIR/umodel-view)"
fi

# --- l2encdec (open-l2encdec) -------------------------------------------------
if [ ! -x "$BIN_DIR/l2encdec" ] || [ "$FORCE" = 1 ]; then
	echo ">> Compilando l2encdec ..."
	[ -d "$SRC_DIR/open-l2encdec" ] || git clone --depth 1 "$L2ENCDEC_URL" "$SRC_DIR/open-l2encdec"
	cd "$SRC_DIR/open-l2encdec"
	"$CMAKE" -B build -DL2ENCDEC_BUILD_CLI=ON -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release
	"$CMAKE" --build build -j
	cp build/cli/l2encdec "$BIN_DIR/l2encdec"
	echo ">> OK: $BIN_DIR/l2encdec"
else
	echo ">> l2encdec ya existe ($BIN_DIR/l2encdec)"
fi

echo ">> Listo. Binarios en $BIN_DIR"
