#!/bin/sh
# Turn a processed car (process_model.py output) into the game's GLBs: full model + near/far LODs.
# usage: BPY=/path/to/python-with-bpy NODE_TOOLS=/path/to/npm-folder tools/blender/build_car.sh raw.glb name
#   NODE_TOOLS needs @gltf-transform/core, /extensions, /functions, meshoptimizer and sharp installed.
#   LOD_NEAR / LOD_FAR (default 0.9 / 0.2) scale the LOD decimation (scanned meshes need more detail).
# writes assets/models/cars/<name>.glb, <name>_lod.glb, <name>_lod2.glb
set -e
RAW=$(realpath "$1"); NAME=$2
OUT=$(pwd)/assets/models/cars
TMP=$NODE_TOOLS/build_$NAME; mkdir -p "$TMP"
cp tools/blender/strip_attributes.mjs tools/blender/fix_vertex_colors.mjs "$NODE_TOOLS/"
node "$NODE_TOOLS/strip_attributes.mjs" "$RAW" "$OUT/$NAME.glb"
"$BPY" tools/blender/make_lod.py -- "$RAW" "$TMP/lod.glb" "${LOD_NEAR:-0.9}" | grep 'LOD triangles'
"$BPY" tools/blender/make_lod.py -- "$RAW" "$TMP/lod2.glb" "${LOD_FAR:-0.2}" far | grep 'LOD triangles'
for n in lod lod2; do
  node "$NODE_TOOLS/fix_vertex_colors.mjs" "$TMP/$n.glb" "$TMP/${n}_fixed.glb"
  node "$NODE_TOOLS/strip_attributes.mjs" "$TMP/${n}_fixed.glb" "$OUT/${NAME}_$n.glb"
done
ls -la "$OUT/$NAME.glb" "$OUT/${NAME}_lod.glb" "$OUT/${NAME}_lod2.glb"
