// Drop what the game never uses, then compress for the web:
//  - UVs / tangents / extra colours on untextured meshes (the game swaps in its own slot materials)
//  - on textured materials (a paint tint map or "orig_*" slots) only the base colour texture is kept
//  - textures -> WebP, geometry -> meshopt
// Needs @gltf-transform/core, /extensions, /functions, meshoptimizer and sharp (npm i in a scratch folder).
// usage: node strip_attributes.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
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
// material extensions from the sources (variants, specular, clearcoat...) are not used by the game
for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName.startsWith('KHR_materials_')) e.dispose();
for (const mat of doc.getRoot().listMaterials()) {
  mat.setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
  if (!mat.getBaseColorTexture()) continue;
  mat.setAlphaMode('OPAQUE'); // texture alpha from ripped models is unreliable; glass is its own slot
}
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  const textured = !!p.getMaterial()?.getBaseColorTexture();
  for (const a of ['TANGENT', 'TEXCOORD_1', 'COLOR_1', ...(textured ? [] : ['TEXCOORD_0'])]) if (p.getAttribute(a)) { p.setAttribute(a, null); n++; }
}
await doc.transform(
  prune({ keepLeaves: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 86 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(process.argv[3], doc);
const tex = doc.getRoot().listTextures().map((t) => `${t.getName() || 'tex'} ${t.getSize()?.join('x')} ${(t.getImage()?.byteLength / 1024).toFixed(0)}KB`);
console.log('removed', n, 'attributes; textures:', tex.join(', ') || 'none');
