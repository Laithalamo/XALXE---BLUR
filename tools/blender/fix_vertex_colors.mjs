// Needs @gltf-transform/core, @gltf-transform/extensions and meshoptimizer (npm i in a scratch folder).
// Blender's exporter writes a white COLOR_0 plus our real colours as COLOR_1: keep only the real ones.
// usage: node fixcolors.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(process.argv[2]);
let n = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  const c1 = p.getAttribute('COLOR_1');
  if (c1) { p.setAttribute('COLOR_0', c1); p.setAttribute('COLOR_1', null); n++; }
}
await io.write(process.argv[3], doc);
console.log('fixed', n, 'primitives');
