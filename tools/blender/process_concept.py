# XALXE pipeline for the "Kestrel C" (Khronos CarConcept sample, CC BY 4.0), Blender/bpy headless:
#  - drop the Khronos logo parts (steering emblem; the licence plate keeps its shape, no texture)
#  - map the source materials to the game's material slots (textures are not used)
#  - reset the steered/spun wheel pivots; rebuild Body + Wheel_FL/FR/RL/RR (+ static Caliper_XX)
#  - turn the car round so forward = -Z in glTF, join meshes per slot, decimate heavy parts
# usage: python process_concept.py -- CarConcept.glb out.glb
import bpy, bmesh, sys, mathutils, math
args = sys.argv[sys.argv.index('--')+1:]
src, out = args[0], args[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
# the source has paint/interior colour variants (KHR_materials_variants): drop them, or the
# exporter writes the variant materials back instead of the game's slot materials
for me in bpy.data.meshes:
    if hasattr(me, 'gltf_variant_mesh_data'): me.gltf_variant_mesh_data.clear()
if hasattr(scene, 'gltf_variants'): scene.gltf_variants.clear()

MAT = {
    'Paint 1 Carmine': 'paint', 'Paint 2 Carmine': 'carbon',
    'Material_2': 'black_plastic', 'Mirror': 'chrome', 'Glass': 'glass', 'Mechanical': 'metal_dark',
    'Interior 1': 'interior_dark', 'Interior 2': 'interior_mid', 'Interior 3 Carmine': 'leather_accent',
    'Hardware': 'metal', 'Headlight': 'light_head', 'Brakelight': 'light_tail', 'Signallight': 'signal',
    'Floormat': 'carpet', 'Panel Sides': 'interior_dark', 'Dashboard': 'interior_mid', 'License': 'plastic',
    'Tireside': 'tire', 'Tiretread': 'tire', 'Disc': 'brake_disc', 'Brake': 'caliper', 'Rim1': 'rim', 'Rim2': 'metal_dark',
}
# heavy parts (faces) -> keep ratio
DECIMATE = {'black_plastic': 0.35, 'rim': 0.4, 'metal_dark': 0.5, 'caliper': 0.25, 'interior_dark': 0.5,
            'interior_mid': 0.6, 'leather_accent': 0.6, 'metal': 0.5, 'carpet': 0.7, 'carbon': 0.8}

def meshes(): return [o for o in scene.objects if o.type == 'MESH']

# ---- logos --------------------------------------------------------------------------
for name in ('InteriorSteeringEmblem',):
    o = bpy.data.objects.get(name)
    if o: bpy.data.objects.remove(o, do_unlink=True); print('removed', name)

# ---- slot materials ----------------------------------------------------------------
slot_mats = {}
def slot_material(name):
    if name not in slot_mats:
        m = bpy.data.materials.new(name); m.use_nodes = True; slot_mats[name] = m
    return slot_mats[name]
for o in meshes():
    for i, slot in enumerate(o.material_slots):
        m = slot.material  # the importer links variant materials to the object, not the mesh
        key = m.name if m else ''
        if key not in MAT: raise SystemExit(f'unmapped material {key!r} on {o.name}')
        slot.link = 'DATA'
        o.data.materials[i] = slot_material(MAT[key])

for m in list(bpy.data.materials):
    if m.name not in slot_mats: bpy.data.materials.remove(m)

# ---- turn round: forward -Y (source) -> +Y (Blender) = -Z in glTF -------------------------
R = mathutils.Matrix.Rotation(math.pi, 4, 'Z')

def bake(o, extra=mathutils.Matrix.Identity(4)):
    mw = extra @ o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mathutils.Matrix.Identity(4)
    o.data.transform(mw)
    if mw.determinant() < 0: o.data.flip_normals()

root = bpy.data.objects.new('Car', None); scene.collection.objects.link(root)
body = bpy.data.objects.new('Body', None); scene.collection.objects.link(body); body.parent = root

WHEELS = {'FL': 'WheelFrontL', 'FR': 'WheelFrontR', 'RL': 'WheelRearL', 'RR': 'WheelRearR'}
wheel_info = {}
wheel_meshes = set()
for tag, srcname in WHEELS.items():
    piv = bpy.data.objects[srcname]
    centre = R @ piv.matrix_world.translation
    inv = piv.matrix_world.inverted()  # un-steer / un-spin: use the pivot's own frame
    new_piv = bpy.data.objects.new('Wheel_' + tag, None); scene.collection.objects.link(new_piv)
    new_piv.parent = root; new_piv.location = centre
    cal = bpy.data.objects.new('Caliper_' + tag, None); scene.collection.objects.link(cal)
    cal.parent = root; cal.location = centre
    # the source's local wheel frame has the axle along X; after turning the car round,
    # left/right swap sides, so rotate the wheel 180 deg about Z too (keeps the rim face outboard)
    turn = mathutils.Matrix.Rotation(math.pi, 4, 'Z')
    for c in list(piv.children):
        if c.type != 'MESH': continue
        local = inv @ c.matrix_world
        c.parent = None
        c.matrix_world = mathutils.Matrix.Identity(4)
        c.data.transform(turn @ local)
        is_cal = any(m and m.name == 'caliper' for m in c.data.materials)
        c.parent = cal if is_cal else new_piv
        c.matrix_parent_inverse.identity()
        wheel_meshes.add(c.name)
    wheel_info[tag] = centre

for o in meshes():
    if o.name in wheel_meshes: continue
    bake(o, R)
    o.parent = body; o.matrix_parent_inverse.identity()

for o in list(scene.objects):
    if o.type == 'EMPTY' and o.name not in ('Car', 'Body') and not o.name.startswith(('Wheel_', 'Caliper_')):
        bpy.data.objects.remove(o, do_unlink=True)

# ---- split multi-material meshes, then join per slot + decimate --------------------------
def join_by_slot(parent):
    for c in list(parent.children):
        if c.type != 'MESH' or len(c.data.materials) < 2: continue
        bpy.ops.object.select_all(action='DESELECT'); c.select_set(True); bpy.context.view_layer.objects.active = c
        bpy.ops.mesh.separate(type='MATERIAL')
    groups = {}
    for c in list(parent.children):
        if c.type != 'MESH': continue
        # drop now-unused slots
        used = {p.material_index for p in c.data.polygons}
        mats = [m for i, m in enumerate(c.data.materials) if i in used]
        c.data.materials.clear()
        for m in mats: c.data.materials.append(m)
        groups.setdefault(mats[0].name, []).append(c)
    for mat, objs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1: bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        o.name = parent.name + '_' + mat; o.data.name = o.name
        r = DECIMATE.get(mat)
        if r and r < 1.0:
            mod = o.modifiers.new('dec', 'DECIMATE'); mod.ratio = r
            bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=0.00005); bpy.ops.object.mode_set(mode='OBJECT')

join_by_slot(body)
for o in list(scene.objects):
    if o.type == 'EMPTY' and o.name.startswith(('Wheel_', 'Caliper_')): join_by_slot(o)

tri = sum(len(o.data.polygons) for o in meshes())
print('objects', len(meshes()), 'faces', tri)
for tag, c in wheel_info.items():
    print(f'WHEEL {tag} centre=({c.x:.4f},{c.y:.4f},{c.z:.4f})')
ws = [o.matrix_world @ mathutils.Vector(v) for o in meshes() for v in o.bound_box]
print('BBOX min', [round(min(p[i] for p in ws), 3) for i in range(3)], 'max', [round(max(p[i] for p in ws), 3) for i in range(3)])
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True, export_cameras=False, export_lights=False, use_selection=False)
