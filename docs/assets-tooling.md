# Toolchain de assets del cliente Lineage 2 Interlude (L2Vzla)

Estado: **spike verificado** (julio 2026, macOS arm64 / Apple Silicon).

Este documento describe el pipeline de extracción de assets del cliente Interlude
que **funciona hoy en esta máquina**, qué puede y qué no puede hacer cada
herramienta, qué falta para un ciclo completo de edición-reimportación, y la
arquitectura recomendada para el futuro editor interactivo de texturas.

Todo vive dentro de `tools/` (no se instaló nada a nivel sistema).

```
tools/
├── bin/
│   ├── umodel              # UE Viewer compilado nativo arm64 (CLI: UTX -> TGA/DDS)
│   └── l2encdec            # open-l2encdec nativo arm64 (cifra/descifra 111-414)
├── build-tools.sh          # recompila ambos binarios desde cero
├── patches/
│   └── ueviewer-macos-arm64.patch   # parches aplicados a UEViewer (ver abajo)
├── vendor/
│   ├── sse2neon.h          # traducción SSE -> NEON (MIT), la usa el parche
│   └── cmake-3.30.5-...    # cmake portable (solo se usa para compilar)
├── src/                    # clones de UEViewer y open-l2encdec
└── samples/
    ├── t_aden.utx          # .utx real cifrado Lineage2Ver121 (texturas de terreno C5/IL)
    ├── modern-system/system/l2.ini   # archivo real cifrado Lineage2Ver413 (cliente moderno)
    └── exported/AS_N_02.png          # prueba: textura extraída t_aden.utx -> TGA -> PNG
```

---

## 1. Lo que funciona hoy (verificado)

| Tarea | Estado | Herramienta |
|---|---|---|
| Leer .utx Interlude **cifrados** (121) directamente | ✅ | `tools/bin/umodel -game=l2` |
| Listar contenido de un .utx | ✅ | `umodel -list` |
| Exportar texturas .utx → TGA (y DDS con `-dds`) | ✅ | `umodel -export` (59/59 objetos exportados en la prueba) |
| TGA → PNG | ✅ | `sips` (incluido en macOS) |
| Descifrar archivos L2 (121, 211/212, 413, etc.) | ✅ | `tools/bin/l2encdec` (verificado con 121 y 413 reales) |
| **Re-cifrar** archivos L2 (round-trip) | ✅ | `l2encdec -c encode` (un .utx re-cifrado 121 vuelve a abrir en umodel) |
| **Reempaquetar** un .utx (meter texturas editadas dentro) | ❌ | ninguna herramienta nativa conocida (ver §4) |
| Editar .dat (armorgrp, etcitemgrp, ...) | ❌ parcial | descifrar sí; parsear/serializar el formato binario requiere l2asm-disasm (Windows/Java) o parser propio |

Evidencia: `tools/samples/exported/AS_N_02.png` (1024×1024, extraída del
`t_aden.utx` cifrado) y el round-trip 413 documentado en §3.4.

## 2. Pipeline de extracción verificado (comandos exactos)

### 2.1 Compilar las herramientas (una sola vez)

```bash
tools/build-tools.sh
```

Descarga lo necesario dentro de `tools/vendor` y `tools/src`, aplica
`tools/patches/ueviewer-macos-arm64.patch` y deja los binarios en `tools/bin/`.
Requisitos: Xcode Command Line Tools (clang/make) y curl. Docker **no** es
necesario: ambos binarios son nativos arm64.

### 2.2 Listar el contenido de un .utx

```bash
tools/bin/umodel -game=l2 -list <archivo.utx>
```

`-game=l2` fuerza el modo Lineage 2. umodel descifra internamente los paquetes
`Lineage2Ver121`: **no hace falta pasar l2encdec antes** para leer.

### 2.3 Exportar texturas a TGA

```bash
# Una textura concreta:
tools/bin/umodel -game=l2 -export -out="$(pwd)/salida" <archivo.utx> <NombreTextura>

# Todo el paquete:
tools/bin/umodel -game=l2 -export -out="$(pwd)/salida" <archivo.utx>
```

Notas:
- Usa **ruta absoluta** en `-out`. Con ruta relativa umodel resuelve la salida
  contra el home del usuario (comportamiento observado en este build).
- La salida queda en `salida/<paquete>/Texture/<nombre>.tga`.
- `-dds` exporta en DDS sin descomprimir DXT (útil si luego se reimporta).

### 2.4 TGA → PNG

```bash
sips -s format png salida/<paquete>/Texture/<nombre>.tga --out <nombre>.png
```

### 2.5 Descifrar / cifrar con l2encdec

```bash
# Descifrar (protocolo se puede omitir; se autodetecta por la cabecera "Lineage2Ver###")
tools/bin/l2encdec -c decode -p 121 -o salida.dec <archivo>
tools/bin/l2encdec -c decode -p 413 -o l2.ini.dec l2.ini

# Cifrar de vuelta (obligatorio -p para elegir protocolo)
tools/bin/l2encdec -c encode -p 121 -o archivo.utx salida.dec
```

Protocolos soportados: XOR 111/120/121, Blowfish 211/212, RSA 411-414.
En Interlude: los .utx/.ukx/.u suelen ir en **121** y los .dat del System en
**121/211/212** según el cliente; los archivos de muestra de este repo cubren
121 (utx) y 413 (l2.ini de cliente moderno).

## 3. Verificación realizada (evidencia)

1. `umodel -list t_aden.utx` sobre el archivo **cifrado** → `Ver: 117/0, 59 exports`.
2. `umodel -export` del paquete completo → `Exported 59/59 objects`, 59 TGA.
3. `sips` TGA→PNG → `AS_N_02.png` 1024×1024 con alpha (imagen de terreno de Aden,
   inspeccionada visualmente).
4. `l2encdec -c decode -p 413 l2.ini` → INI en claro (`[URL] Protocol=unreal ...`);
   re-encode + decode → idéntico byte a byte (`cmp` OK).
5. Round-trip de paquete: `decode 121` → `encode 121` → umodel abre el .utx
   re-cifrado y exporta texturas de él sin error.

## 4. Qué falta para el ciclo editar → reimportar (la parte dura)

Extraer está resuelto. **Reempaquetar un .utx no lo está** en macOS/Linux:

- **umodel es solo lectura** (exporta, nunca escribe paquetes UE2).
- El cifrado NO es el problema: l2encdec re-cifra perfectamente (verificado).
  El problema es serializar el formato Unreal Package (cabecera, name table,
  import/export tables, datos del objeto Texture con sus mipmaps en DXT).

Opciones existentes hoy (todas Windows, closed-source salvo excepción):

- **UnrealEd del UE2Runtime-22261903**: el flujo clásico de modding. Importa DDS
  y guarda .utx legibles por L2. Requiere Windows (o VM/Wine; UE2Runtime es
  x86 de 2003, en Wine funciona según la comunidad).
- **L2Tool / L2Editor (japonés)**: reemplaza texturas dentro de .utx existentes.
  Windows; versiones antiguas en Java. Fuentes: foros (MaxCheater, elmorelab).
- **UTPT (Unreal Package Tool)**: visor de paquetes, Windows.
- **L2FileEdit / l2asm-disasm**: para los .dat del System (descifrado → texto),
  Windows/Java.
- **Librerías**: en Java existe `acmi/L2crypt` (cifrado, no paquetes). No hay
  ninguna librería Python mantenida que **escriba** paquetes UE2 versión 117
  (Interlude). Leerlos es factible (el formato está documentado en el propio
  código de UEViewer, `Unreal/UnrealPackage/`); escribirlos es trabajo propio.

Conclusión para el editor: el primer hito realista es **visor/extractor
interactivo** (todo nativo, ya probado). El reimport tiene dos caminos:

1. **Corto plazo**: generar el .utx nuevo fuera de la cadena (UnrealEd en
   Windows/VM) y automatizar solo el cifrado final con l2encdec.
2. **Largo plazo**: escritor propio de paquetes UE2-v117 para el caso
   restringido de "reemplazar textura existente por otra del mismo formato"
   (DXT1/DXT5, mismas dimensiones), que es el 90% del uso real (retexturizar
   UI, íconos, terreno). Es mucho más acotado que un serializador general.

## 5. Arquitectura recomendada para el editor interactivo

Reutilizar el stack del panel (`panel/server.py`: HTTP stdlib Python 3.9, sin
dependencias, + `index.html` vanilla):

```
navegador (index.html)
   │  GET /api/utx/list?file=...        -> umodel -list (parseo de stdout)
   │  GET /api/utx/thumb?file=...&obj=  -> umodel -export + sips -> PNG (cache en disco)
   │  GET /api/utx/texture.png?...      -> sirve el PNG cacheado
   ▼
backend Python (stdlib, como panel/server.py)
   ├── invoca tools/bin/umodel  (subprocess, rutas absolutas, -out a tmp/cache)
   ├── invoca tools/bin/l2encdec (cuando haga falta descifrar .dat/.ini)
   └── cache de PNGs por (archivo, objeto, mtime)
```

Decisiones clave:

- **No reimplementar el parser UE2 en Python para leer**: umodel CLI ya lo hace
  y está verificado. El backend lo trata como proceso externo (igual que el
  panel trata los .properties como texto). Coste: parsing de stdout; beneficio:
  cero riesgo de formato.
- **Cache de thumbnails**: exportar un paquete entero tarda <1 s (medido:
  59 texturas en 0.4 s), así que la estrategia simple es exportar todo el .utx
  a un directorio cache la primera vez y servir PNGs desde ahí.
- La fase de **escritura** (cuando exista) será un módulo separado
  (`tools/utx_repack.py` o similar) con su propio spike previo.

## 6. Origen de las muestras y licencias

- `tools/samples/t_aden.utx`: del paquete comunitario
  `lineage2-detail-textures-c5-interlude.rar` (repo GitLab
  `geekrainian/lineage2-modding`, carpeta `client_addons`). Archivos de un
  cliente C5/Interlude real, cifrados Lineage2Ver121.
- `tools/samples/modern-system/system/l2.ini`: de `bcat-legend/lineage-2-client`
  (HuggingFace, `system.rar`). Es de un cliente moderno (413), útil solo para
  probar el cifrado RSA.
- Cuando el cliente completo esté en `assets/interlude/` (descarga en curso por
  otro agente), los mismos comandos aplican directamente a sus
  `systextures/*.utx` y `system/*.dat`.
- UEViewer © Gildor (código fuente disponible, licencia "no determinada";
  uso local/herramienta). sse2neon: MIT. open-l2encdec: ver su LICENSE (MIT).

## 7. Notas técnicas del port de umodel a macOS arm64

`tools/patches/ueviewer-macos-arm64.patch` (8 archivos):

1. `common.project`: quita `-msse2` en osx, usa zlib/libpng bundled en vez de
   los del sistema, añade `tools/vendor` al include path.
2. `Core/MathSSE.h`: en arm64 incluye `sse2neon.h` en vez de `<xmmintrin.h>`
   (todos los intrinsics usados están cubiertos por sse2neon).
3. `libs/nvtt` (posh.h / nvcore.h): detección de CPU `__aarch64__`.
4. `libs/libpng`: `fp.h` ya no existe en macOS moderno; NEON de libpng off
   (los fuentes arm/ no se compilan en este build).
5. `Unreal/FileSystem/GameFileSystem.cpp`: macOS no tiene `stat64`; `stat` ya
   es 64-bit.
6. `Exporters/ExportMaterial.cpp` (**el bug importante**): en macOS `Build.h`
   desactiva `RENDERING`, lo que dejaba `ExportMaterial()` vacía y la
   exportación CLI de texturas era un no-op silencioso. El parche despacha
   texturas/cubemaps por `IsA()` cuando `RENDERING` está off.

Limitaciones del build resultante: sin GUI ni visor 3D (no hay SDL2/GL en este
build; es CLI puro), sin sonidos Oodle (warning inofensivo al compilar). Para
extraer texturas de Interlude es suficiente. Plan B si el build nativo se
rompe en el futuro: Docker `--platform linux/amd64` con el binario Linux
oficial de gildor.org vía Rosetta (probado que la emulación amd64 funciona en
este Docker Desktop).
