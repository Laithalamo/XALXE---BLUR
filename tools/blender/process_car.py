# XALXE car pipeline (Blender/bpy, headless):
#  - strip real-world logos/badges
#  - map source materials to the game's material slots
#  - rebuild hierarchy: Body + Wheel_FL/FR/RL/RR pivots at wheel centres
#  - join meshes per material, decimate hidden interior parts
#  - export GLB (Y-up, forward = -Z, right = +X, ground at y=0)
import bpy, bmesh, sys, mathutils
args = sys.argv[sys.argv.index('--')+1:]
src, out = args[0], args[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene

def meshes(): return [o for o in scene.objects if o.type == 'MESH']

def islands(bm):
    seen=set(); res=[]
    for f in bm.faces:
        if f.index in seen: continue
        stack=[f]; comp=[]; seen.add(f.index)
        while stack:
            x=stack.pop(); comp.append(x)
            for e in x.edges:
                for g in e.link_faces:
                    if g.index not in seen: seen.add(g.index); stack.append(g)
        res.append(comp)
    return res

def inside(p, box):
    mn, mx = box
    return all(mn[i] <= p[i] <= mx[i] for i in range(3))

# Logo regions (Blender world coords, metres; car forward = +Y here)
FACE_BOXES = [  # chrome emblem/lettering faces
    ((-0.07, 2.12, 0.18), (0.07, 2.30, 0.37)),
    ((-0.07, -2.24, 0.77), (0.07, -2.14, 0.93)),
    ((-0.14, -1.96, 0.93), (0.14, -1.89, 0.97)),
]
ISLAND_BOXES = [  # loose badge parts on any mesh (must lie fully inside)
    ((-0.08, 2.10, 0.15), (0.08, 2.32, 0.40)),   # front emblem + mount
    ((-0.06, 2.00, 0.52), (0.06, 2.16, 0.66)),   # hood badge base
]
for o in meshes():
    mw = o.matrix_world
    bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
    kill = set()
    if o.name.startswith('chrome'):
        for f in bm.faces:
            c = mw @ f.calc_center_median()
            if any(inside(c, b) for b in FACE_BOXES): kill.add(f)
    for comp in islands(bm):
        pts = [mw @ v.co for f in comp for v in f.verts]
        mn = [min(p[i] for p in pts) for i in range(3)]; mx = [max(p[i] for p in pts) for i in range(3)]
        for b in ISLAND_BOXES:
            if inside(mn, b) and inside(mx, b): kill.update(comp); break
    if kill:
        bmesh.ops.delete(bm, geom=list(kill), context='FACES')
        bm.to_mesh(o.data); print('removed', len(kill), 'faces from', o.name)
    bm.free()
for o in list(meshes()):
    if o.name.startswith('yellow_trim'):
        bpy.data.objects.remove(o, do_unlink=True)

# ---- material slots -------------------------------------------------------
SLOT_BY_MESH = {
    'body': 'paint', 'glass': 'glass', 'chrome': 'chrome', 'metal': 'metal',
    'plastic_gray': 'plastic', 'grills': 'black_plastic', 'wipers': 'black_plastic',
    'lights_red': 'light_tail', 'brakes': 'light_brake', 'lights': 'light_head',
    'leds': 'light_drl', 'carbon fibre': 'carbon', 'carbon_fibre_trim': 'carbon',
    'steering_carbon': 'carbon', 'interior_light': 'interior_dark', 'interior_dark': 'interior_mid',
    'leather': 'leather', 'steering_leather': 'leather', 'trim': 'leather_accent',
    'steering_trim': 'leather_accent', 'carpet': 'carpet', 'blue': 'interior_dark',
    'steering_centre': 'metal_dark', 'steering_column': 'interior_dark', 'steering_metal': 'metal',
    'steering_red_lights': 'interior_dark',
    'tire': 'tire', 'rim': 'rim', 'wheel': 'rim', 'brake': 'brake_disc', 'nuts': 'metal_dark', 'centre': 'metal_dark',
}
slot_mats = {}
def slot_material(name):
    if name not in slot_mats:
        m = bpy.data.materials.new(name); m.use_nodes = True
        slot_mats[name] = m
    return slot_mats[name]

def base_name(n):
    n = n.split('.')[0]
    for pre in ('rim_',):
        if n.startswith(pre): return 'rim'
    return n

for o in meshes():
    key = base_name(o.name)
    slot = SLOT_BY_MESH.get(key)
    if slot is None: raise SystemExit('unmapped mesh ' + o.name)
    o.data.materials.clear(); o.data.materials.append(slot_material(slot))

# ---- hierarchy ------------------------------------------------------------
root = bpy.data.objects.new('Car', None); scene.collection.objects.link(root)
body_parent = bpy.data.objects.new('Body', None); scene.collection.objects.link(body_parent); body_parent.parent = root
wheel_groups = {}
for tag in ('fl', 'fr', 'rl', 'rr'):
    src_empty = bpy.data.objects.get('wheel_' + tag)
    kids = [c for c in src_empty.children if c.type == 'MESH']
    tire = [k for k in kids if k.name.startswith('tire')][0]
    ws = [tire.matrix_world @ mathutils.Vector(c) for c in tire.bound_box]
    centre = sum(ws, mathutils.Vector()) / 8.0
    radius = (max(p.z for p in ws) - min(p.z for p in ws)) / 2
    width = max(p.x for p in ws) - min(p.x for p in ws)
    piv = bpy.data.objects.new('Wheel_' + tag.upper(), None); scene.collection.objects.link(piv)
    piv.parent = root; piv.location = centre
    wheel_groups[tag] = (piv, kids, centre, radius, width)

def bake(o):
    """apply full world transform into mesh data"""
    mw = o.matrix_world.copy()
    o.parent = None; o.matrix_world = mathutils.Matrix.Identity(4)
    o.data.transform(mw)
    if mw.determinant() < 0: o.data.flip_normals()

wheel_mesh_names = set()
for tag, (piv, kids, centre, radius, width) in wheel_groups.items():
    for k in kids:
        bake(k); k.data.transform(mathutils.Matrix.Translation(-centre)); k.parent = piv; k.matrix_parent_inverse.identity()
        wheel_mesh_names.add(k.name)
for o in meshes():
    if o.name in wheel_mesh_names: continue
    bake(o); o.parent = body_parent; o.matrix_parent_inverse.identity()

# remove the now-empty source empties
for o in list(scene.objects):
    if o.type == 'EMPTY' and o.name not in ('Car', 'Body') and not o.name.startswith('Wheel_'):
        bpy.data.objects.remove(o, do_unlink=True)

# ---- decimate hidden-ish interior parts --------------------------------
DECIMATE = {'interior_dark': 0.45, 'interior_mid': 0.6, 'leather': 0.5, 'carpet': 1.0, 'leather_accent': 0.6}
def join_by_material(parent):
    groups = {}
    for c in list(parent.children):
        if c.type != 'MESH': continue
        groups.setdefault(c.data.materials[0].name, []).append(c)
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
        # clean up doubles
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=0.00005); bpy.ops.object.mode_set(mode='OBJECT')
join_by_material(body_parent)
for tag,(piv,*_) in wheel_groups.items(): join_by_material(piv)

tri = sum(len(o.data.polygons) for o in meshes())
print('objects', len(meshes()), 'faces', tri)
for tag,(piv,kids,centre,radius,width) in wheel_groups.items():
    print(f'WHEEL {tag} centre=({centre.x:.4f},{centre.y:.4f},{centre.z:.4f}) radius={radius:.4f} width={width:.4f}')

bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True, export_cameras=False, export_lights=False, use_selection=False)
