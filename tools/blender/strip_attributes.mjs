// Drop vertex attributes the game never uses (no textures on cars): UVs, tangents, extra colours.
// usage: node strip.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(process.argv[2]);
let n = 0;
// meshes that lost their material to KHR_materials_variants: the slot is in the mesh name (Body_paint...)
const mats = new Map(doc.getRoot().listMaterials().map((m) => [m.getName(), m]));
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  if (p.getMaterial()) continue;
  const slot = m.getName().replace(/^(Body|Wheel_..|Caliper_..)_/, '').replace(/\.\d+$/, '');
  let mat = mats.get(slot);
  if (!mat) { mat = doc.createMaterial(slot); mats.set(slot, mat); }
  p.setMaterial(mat);
  console.log('material', slot, '->', m.getName());
}
doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'KHR_materials_variants')?.dispose();
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  for (const a of ['TANGENT', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_1']) if (p.getAttribute(a)) { p.setAttribute(a, null); n++; }
}
for (const t of doc.getRoot().listTextures()) t.dispose();
await doc.transform(prune({ keepLeaves: true }));
await io.write(process.argv[3], doc);
console.log('removed', n, 'attributes');
