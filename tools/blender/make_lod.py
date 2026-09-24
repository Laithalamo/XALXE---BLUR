# Build a light LOD of a processed car GLB for AI opponents:
# merge materials into a few slots, decimate, one mesh per wheel (vertex-coloured).
# usage: python make_lod.py -- in.glb out.glb [detail] [far]
#   detail scales the decimate ratios; 'far' also merges everything except paint, glass and lights
#   (wheels included, they don't need to turn when far away) into one vertex-coloured 'rest' mesh.
import bpy, sys
args = sys.argv[sys.argv.index('--')+1:]
src, out = args[0], args[1]
DETAIL = float(args[2]) if len(args) > 2 else 1.0
FAR = len(args) > 3 and args[3] == 'far'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene

GROUP = {  # source slot -> LOD slot
  'paint': 'paint', 'glass': 'glass', 'chrome': 'chrome', 'metal': 'chrome', 'rim': 'chrome',
  'light_tail': 'light_tail', 'light_brake': 'light_tail', 'light_head': 'light_head', 'light_drl': 'light_head',
}
RATIO = {'paint': 0.28, 'glass': 0.4, 'chrome': 0.25, 'dark': 0.14, 'light_tail': 0.3, 'light_head': 0.4, 'wheel': 0.3, 'tex': 0.3}
RATIO = {k: v * DETAIL for k, v in RATIO.items()}
mats = {}
def mat(name):
    if name not in mats:
        m = bpy.data.materials.new(name); m.use_nodes = True; mats[name] = m
    return mats[name]

def color_attr(o, rgb):
    me = o.data
    for a in list(me.color_attributes):
        if a.name != 'Col': me.color_attributes.remove(a)
    if 'Col' not in me.color_attributes:
        me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    ca = me.color_attributes['Col']
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = me.color_attributes.find('Col')
    for d in ca.data: d.color = (rgb[0], rgb[1], rgb[2], 1.0)

# approximate albedo of each source slot, for the far LOD's merged mesh
SLOT_RGB = {'chrome': (0.8, 0.8, 0.82), 'metal': (0.33, 0.34, 0.36), 'rim': (0.6, 0.62, 0.66), 'tire': (0.02, 0.02, 0.02),
            'brake_disc': (0.4, 0.4, 0.42), 'metal_dark': (0.05, 0.05, 0.055)}

def textured(o):
    # textured parts (a paint tint map, 'orig_*' source materials) keep their own material and UVs
    m = o.data.materials[0] if o.data.materials else None
    return bool(m and m.use_nodes and any(n.type == 'TEX_IMAGE' and n.image for n in m.node_tree.nodes))

def keep_textured(objs, name, ratio):
    # join per material, keep the material
    by = {}
    for o in objs: by.setdefault(o.data.materials[0].name, []).append(o)
    for mname, grp in by.items():
        o = join(grp, name + '_' + mname)
        decimate(o, ratio)

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name; o.data.name = name
    return o

def decimate(o, r):
    # weld the pieces split along UV seams first, or decimation opens cracks between them
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.00005); bpy.ops.object.mode_set(mode='OBJECT')
    if r < 1:
        m = o.modifiers.new('d', 'DECIMATE'); m.ratio = r
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=m.name)

body = bpy.data.objects['Body']
# static brake calipers (cars that have them) go with the body
for o in list(scene.objects):
    if o.type == 'EMPTY' and o.name.startswith('Caliper_'):
        for c in list(o.children):
            if c.type != 'MESH': continue
            mw = c.matrix_world.copy()
            c.parent = body
            c.matrix_world = mw
if FAR:
    # paint / glass / lights stay separate (own materials), the rest becomes one mesh
    groups = {}
    rest = []
    tex = []
    for c in list(body.children):
        if c.type != 'MESH': continue
        slot = c.data.materials[0].name if c.data.materials else 'dark'
        g = GROUP.get(slot, 'dark')
        if textured(c):
            tex.append(c)
        elif g in ('paint', 'glass', 'light_tail', 'light_head'):
            groups.setdefault(g, []).append(c)
        else:
            color_attr(c, SLOT_RGB.get(slot, (0.03, 0.03, 0.035)))
            rest.append(c)
    keep_textured(tex, 'Body', RATIO['tex'])
    for tag in ('FL', 'FR', 'RL', 'RR'):
        kids = [c for c in bpy.data.objects['Wheel_' + tag].children if c.type == 'MESH']
        keep_textured([k for k in kids if textured(k)], 'Wheel_' + tag, RATIO['wheel'])
        for k in kids:
            if textured(k): continue
            slot = k.data.materials[0].name if k.data.materials else ''
            color_attr(k, SLOT_RGB.get(slot, (0.6, 0.62, 0.66)))
            rest.append(k)
    for g, objs in groups.items():
        o = join(objs, 'Body_' + g)
        o.data.materials.clear(); o.data.materials.append(mat(g))
        decimate(o, RATIO[g])
    if rest:
        o = join(rest, 'Body_rest')
        o.parent = body
        o.data.materials.clear(); o.data.materials.append(mat('rest'))
        decimate(o, RATIO['dark'])
else:
    groups = {}
    tex = []
    for c in list(body.children):
        if c.type != 'MESH': continue
        if textured(c):
            tex.append(c); continue
        slot = c.data.materials[0].name if c.data.materials else 'dark'
        g = GROUP.get(slot, 'dark')
        groups.setdefault(g, []).append(c)
    keep_textured(tex, 'Body', RATIO['tex'])
    for g, objs in groups.items():
        o = join(objs, 'Body_' + g)
        o.data.materials.clear(); o.data.materials.append(mat(g))
        decimate(o, RATIO[g])

    for tag in ('FL', 'FR', 'RL', 'RR'):
        piv = bpy.data.objects['Wheel_' + tag]
        kids = [c for c in piv.children if c.type == 'MESH']
        keep_textured([k for k in kids if textured(k)], 'Wheel_' + tag, RATIO['wheel'])
        kids = [k for k in kids if not textured(k)]
        if not kids: continue
        for k in kids:
            slot = k.data.materials[0].name if k.data.materials else ''
            color_attr(k, (0.02, 0.02, 0.02) if slot == 'tire' else (0.6, 0.62, 0.66))
        o = join(kids, 'Wheel_' + tag + '_wheel')
        o.data.materials.clear(); o.data.materials.append(mat('wheel'))
        decimate(o, RATIO['wheel'])

tris = 0
for o in scene.objects:
    if o.type == 'MESH':
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
print('LOD triangles', tris, 'meshes', len([o for o in scene.objects if o.type == 'MESH']))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True, export_cameras=False, export_lights=False, use_selection=False)
