# XALXE generic car pipeline (Blender/bpy, headless), driven by a JSON config per car:
#   python process_model.py -- config.json in.glb out.glb
# Steps: bake transforms -> delete logos / unwanted parts -> turn + scale so forward = +Y (= -Z in
# glTF) -> map materials to game slots -> find the 4 wheels (tyre parts clustered per corner) and rig
# Wheel_FL/FR/RL/RR (+ static Caliper_XX) -> ground at z = 0, centred between the axles -> join per
# slot, decimate -> export GLB.
# Slots named "orig_*" keep their original (textured) material; with "paint_texture" the paint slot
# keeps its base-colour texture, which the game uses as a tint mask (white areas take the paint colour).
# Config keys (see tools/blender/cars/*.json):
#   rotate_z/rotate_x, length or scale      orientation + size
#   slots [[regex, slot]], default_slot     source material (or "obj:<name>") -> game slot; "orig", "delete"
#   delete_materials / delete_objects       regexes of logo parts etc.
#   texture_edits                           fill rects (colour or "row" = blend across) / delete faces by UV rect
#   delete_parts [[x0,y0,z0,x1,y1,z1,max]]  delete small loose parts (3D badges) by position, final frame
#   paint_boxes, slot_boxes                 repaint texture under faces in a box / move faces to another slot
#   material_params {regex: {metallic, roughness}}   fix-ups for kept source materials
#   wheels: default = tyre slot pieces clustered per corner; wheel_geometry + wheel_candidates + tyre_all
#     (+ tyre_keep) for single-material wheels; wheel_cylinders to cut wheels out of fused meshes
#   decimate {slot: ratio, "*": default}, crop_to_slot/crop_pad, max_texture
import bpy, bmesh, sys, json, re, math, mathutils

args = sys.argv[sys.argv.index('--') + 1:]
cfg = json.load(open(args[0]))
src, out = args[1], args[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
V = mathutils.Vector


def meshes():
    return [o for o in scene.objects if o.type == 'MESH']


def rx(p):
    return re.compile(p, re.I)


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


# ---- source materials get a prefix so slot materials keep their exact names ------------------------
for m in list(bpy.data.materials):  # (renaming re-sorts the collection: iterate a copy)
    if 'src_name' in m: continue
    m['src_name'] = m.name
    m.name = 'src_' + m.name


def src_name(m):
    return m.get('src_name', m.name) if m else ''


# ---- variants / object-linked materials -> plain mesh materials ------------------------------
for me in bpy.data.meshes:
    if hasattr(me, 'gltf_variant_mesh_data'): me.gltf_variant_mesh_data.clear()
if hasattr(scene, 'gltf_variants'): scene.gltf_variants.clear()
for o in meshes():
    for i, s in enumerate(o.material_slots):
        m = s.material
        s.link = 'DATA'
        o.data.materials[i] = m

# ---- bake world transforms, drop the hierarchy ---------------------------------------------------
for o in meshes():
    mw = o.matrix_world.copy()
    if o.data.users > 1: o.data = o.data.copy()
    o.parent = None
    o.matrix_world = mathutils.Matrix.Identity(4)
    o.data.transform(mw)
    if mw.determinant() < 0: o.data.flip_normals()
for o in list(scene.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)

# ---- drop exact duplicates (ripped game models often stack several copies of a part) --------------
sig = {}
for o in list(meshes()):
    vs = o.data.vertices
    if not vs: continue
    a = V([min(v.co[i] for v in vs) for i in range(3)]); b = V([max(v.co[i] for v in vs) for i in range(3)])
    key = (tuple(src_name(m) for m in o.data.materials), len(vs), len(o.data.polygons),
           tuple(round(x, 3) for x in (*a, *b)))
    if key in sig:
        bpy.data.objects.remove(o, do_unlink=True)
    else:
        sig[key] = o.name
print('after dedupe', len(meshes()), 'objects')

# ---- texture clean-up: paint over logos baked into textures, or delete the faces that show them ----
# rects are in texture pixels of the original image, origin top-left (as seen in an image viewer)
def base_image(m):
    if not m or not m.use_nodes: return None
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf: return None
    todo = [l.from_node for l in bsdf.inputs['Base Color'].links]
    while todo:
        n = todo.pop()
        if n.type == 'TEX_IMAGE': return n.image
        todo += [l.from_node for i in n.inputs for l in i.links]
    return None


for ed in cfg.get('texture_edits', []):
    r = rx(ed['material'])
    mats = [m for m in bpy.data.materials if r.search(src_name(m))]
    for m in mats:
        img = base_image(m)
        if img is None: continue
        W, H = img.size
        if ed.get('fill'):
            px = list(img.pixels)
            for x0, y0, x1, y1, col in ed['fill']:
                for yt in range(max(0, y0), min(H, y1)):
                    row = H - 1 - yt
                    if col == 'row':  # blend the pixels just left and right of the rect along the row
                        j = (row * W + max(0, x0 - 2)) * 4; cl = px[j:j + 3]
                        j = (row * W + min(W - 1, x1 + 1)) * 4; cr = px[j:j + 3]
                    else:
                        cl = cr = [v / 255 for v in col]
                    for x in range(max(0, x0), min(W, x1)):
                        t = (x - x0 + 0.5) / max(1, x1 - x0)
                        i = (row * W + x) * 4
                        px[i:i + 3] = [cl[k] + (cr[k] - cl[k]) * t for k in range(3)]
            img.pixels[:] = px
            img.update()
            print('texture fill', m.name, len(ed['fill']), 'rects')
        rects = ed.get('delete_uv', [])
        if not rects: continue
        for o in meshes():
            if m.name not in [mm.name for mm in o.data.materials if mm]: continue
            mi = [mm.name if mm else '' for mm in o.data.materials].index(m.name)
            uvl = o.data.uv_layers.active
            if uvl is None: continue
            bm = bmesh.new(); bm.from_mesh(o.data)
            uv = bm.loops.layers.uv.active
            dead = []
            for f in bm.faces:
                if f.material_index != mi: continue
                u = sum(l[uv].uv.x for l in f.loops) / len(f.loops)
                v = sum(l[uv].uv.y for l in f.loops) / len(f.loops)
                x, yt = (u % 1.0) * W, (1 - (v % 1.0)) * H
                if any(x0 <= x <= x1 and y0 <= yt <= y1 for x0, y0, x1, y1 in rects): dead.append(f)
            if dead:
                bmesh.ops.delete(bm, geom=dead, context='FACES'); bm.to_mesh(o.data)
                print('uv delete:', len(dead), 'faces from', o.name)
            bm.free()

# ---- delete by object / material name ---------------------------------------------------------------
del_obj = [rx(p) for p in cfg.get('delete_objects', [])]
del_mat = [rx(p) for p in cfg.get('delete_materials', [])]
for o in list(meshes()):
    if any(r.search(o.name) for r in del_obj):
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    kill = {i for i, m in enumerate(o.data.materials) if m and any(r.search(src_name(m)) for r in del_mat)}
    if not kill: continue
    if all(p.material_index in kill for p in o.data.polygons):
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in kill], context='FACES')
    bm.to_mesh(o.data); bm.free()

# ---- orientation + scale ----------------------------------------------------------------------------------
R = mathutils.Matrix.Rotation(math.radians(cfg.get('rotate_z', 0)), 4, 'Z')
if cfg.get('rotate_x'): R = R @ mathutils.Matrix.Rotation(math.radians(cfg['rotate_x']), 4, 'X')
for o in meshes(): o.data.transform(R)


def bbox_objs(objs):
    pts = [v.co for o in objs for v in o.data.vertices]
    return V([min(p[i] for p in pts) for i in range(3)]), V([max(p[i] for p in pts) for i in range(3)])


mn, mx = bbox_objs(meshes())
k = cfg['length'] / (mx.y - mn.y) if 'length' in cfg else cfg.get('scale', 1.0)
for o in meshes(): o.data.transform(mathutils.Matrix.Scale(k, 4))
mn, mx = bbox_objs(meshes())
print(f'SCALE x{k:.4f} size', [round(mx[i] - mn[i], 3) for i in range(3)])

# ---- split by material, record source material, assign slots -----------------------------------------------
for o in list(meshes()):
    if len(o.data.materials) > 1:
        select_only([o]); bpy.ops.mesh.separate(type='MATERIAL')
rules = [(rx(p), s) for p, s in cfg['slots']]
default = cfg.get('default_slot', 'black_plastic')
slot_mats = {}


def slot_material(name, orig):
    keep_tex = name.startswith('orig_') or (name == 'paint' and cfg.get('paint_texture'))
    if name not in slot_mats:
        if keep_tex and orig is not None:
            m = orig.copy(); m.name = name
            # fix up the source's shading values (ripped models often say metallic = 1 everywhere)
            bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            for pat, prm in cfg.get('material_params', {}).items():
                if not bsdf or not re.search(pat, src_name(orig), re.I): continue
                for key, inp in (('metallic', 'Metallic'), ('roughness', 'Roughness')):
                    if key in prm:
                        for l in list(bsdf.inputs[inp].links): m.node_tree.links.remove(l)
                        bsdf.inputs[inp].default_value = prm[key]
        else:
            m = bpy.data.materials.new(name); m.use_nodes = True
        slot_mats[name] = m
    return slot_mats[name]


slot_log = {}
for o in list(meshes()):
    used = {p.material_index for p in o.data.polygons}
    if not used:
        bpy.data.objects.remove(o, do_unlink=True); continue
    m = o.data.materials[min(used)]
    mname = src_name(m)
    s = default
    for r, sl in rules:
        if r.search(mname) or r.search('obj:' + o.name):
            s = sl; break
    if s == 'delete':
        bpy.data.objects.remove(o, do_unlink=True); continue
    if s == 'orig': s = 'orig_' + re.sub(r'\W+', '_', mname).strip('_')
    o['src_mat'] = mname
    o['slot'] = s
    o.data.materials.clear()
    o.data.materials.append(slot_material(s, m))
    slot_log[(mname, s)] = slot_log.get((mname, s), 0) + len(o.data.polygons)
for (mname, s), n in sorted(slot_log.items(), key=lambda kv: kv[0][1]):
    print(f'SLOT {s:16s} <- {mname} ({n} faces)')
if cfg.get('stop_after_slots'): raise SystemExit(0)

# ---- optional crop: remove loose parts outside the body (stray planes, light cones...) ----------------------
if 'crop_to_slot' in cfg:
    ref = [o for o in meshes() if o['slot'] == cfg['crop_to_slot']]
    cmn, cmx = bbox_objs(ref)
    pad = cfg.get('crop_pad', 0.08)
    for o in list(meshes()):
        bm = bmesh.new(); bm.from_mesh(o.data)
        bm.verts.ensure_lookup_table()
        dead = []
        seen = set()
        for f in bm.faces:
            if f.index in seen: continue
            stack = [f]; comp = []; seen.add(f.index)
            while stack:
                x = stack.pop(); comp.append(x)
                for e in x.edges:
                    for g in e.link_faces:
                        if g.index not in seen: seen.add(g.index); stack.append(g)
            c = sum((v.co for ff in comp for v in ff.verts), V()) / sum(len(ff.verts) for ff in comp)
            if any(c[i] < cmn[i] - pad or c[i] > cmx[i] + pad for i in range(3)): dead.extend(comp)
        if dead:
            bmesh.ops.delete(bm, geom=dead, context='FACES'); bm.to_mesh(o.data)
            print('crop: removed', len(dead), 'faces from', o.name)
        bm.free()
    for o in list(meshes()):
        if not o.data.polygons: bpy.data.objects.remove(o, do_unlink=True)

# ---- wheels: split wheel parts into loose pieces, cluster tyres per corner ----------------------------------
def wheels_from_parts():
    wheel_slots = set(cfg.get('wheel_slots', ['tire', 'rim', 'brake_disc', 'caliper']))
    extra = [rx(p) for p in cfg.get('wheel_extra', [])]
    geo_mode = cfg.get('wheel_geometry', False)
    # geometry mode: tyres are found by shape; wheel_candidates limits which source materials are searched
    only = [rx(p) for p in cfg.get('wheel_candidates', [])]

    def is_cand(o):
        if geo_mode: return not only or any(r.search(o['src_mat']) for r in only)
        return o['slot'] in wheel_slots or any(r.search(o['src_mat']) for r in extra)


    for o in [o for o in meshes() if is_cand(o)]:
        select_only([o]); bpy.ops.mesh.separate(type='LOOSE')
    parts = [o for o in meshes() if is_cand(o)]

    def obb(o):
        a, b = bbox_objs([o]); return a, b, (a + b) / 2, b - a


    tyres = []
    amn, amx = bbox_objs(meshes())
    for o in parts:
        a, b, c, e = obb(o)
        if cfg.get('debug') and max(e) > 0.25:
            print('PART', o.name, 'c', [round(v, 3) for v in c], 'e', [round(v, 3) for v in e], 'faces', len(o.data.polygons))
        if cfg.get('tyre_all'):
            tyres.append(o)  # the candidates are wheel meshes only: every piece counts for the wheel size
        elif geo_mode:
            # wheel-shaped: round in the side view, narrow, low, off the centre line
            if 0.1 < e.x < 0.5 and 0.4 < e.z < 1.0 and 0.8 < e.y / max(e.z, 1e-6) < 1.25 and c.z - amn.z < 0.75 and abs(c.x - (amn.x + amx.x) / 2) > 0.35:
                tyres.append(o)
        elif o['slot'] == 'tire':
            tyres.append(o)
    if not tyres: raise SystemExit('no tyres found')
    ty = [obb(o)[2] for o in tyres]
    ymid = (min(c.y for c in ty) + max(c.y for c in ty)) / 2
    xmid = (min(c.x for c in ty) + max(c.x for c in ty)) / 2
    wheels = {}
    for tag, fx, fy in (('FL', -1, 1), ('FR', 1, 1), ('RL', -1, -1), ('RR', 1, -1)):
        grp = [o for o, c in zip(tyres, ty) if (c.x - xmid) * fx > 0 and (c.y - ymid) * fy > 0]
        if not grp: raise SystemExit('no tyre for ' + tag)
        # keep the pieces around the biggest one (drops stray bits such as an exhaust sharing the material)
        ref = max(grp, key=lambda o: max(obb(o)[3]))
        _, _, rc, re_ = obb(ref)
        rr = max(re_.y, re_.z) / 2
        keep = rr * cfg.get('tyre_keep', 1.5)
        grp = [o for o in grp if abs(obb(o)[2].x - rc.x) < 0.35 and (V((0, *obb(o)[2].yz)) - V((0, *rc.yz))).length < keep]
        a, b = bbox_objs(grp)
        wheels[tag] = {'c': (a + b) / 2, 'r': (b.z - a.z) / 2, 'w': b.x - a.x, 'parts': [], 'cal': []}
    for o in parts:
        a, b, c, e = obb(o)
        best, bd = None, 1e9
        for tag, w in wheels.items():
            d = (V((0, c.y, c.z)) - V((0, w['c'].y, w['c'].z))).length
            if abs(c.x - w['c'].x) < w['w'] / 2 + 0.15 and d < w['r'] * 1.05 and max(e.y, e.z) < w['r'] * 2.25 and d < bd:
                best, bd = tag, d
        if best is None: continue
        (wheels[best]['cal'] if o['slot'] == 'caliper' else wheels[best]['parts']).append(o)
    for tag, w in wheels.items():
        print(f"WHEEL {tag} centre={tuple(round(v, 4) for v in w['c'])} r={w['r']:.4f} w={w['w']:.3f} parts={len(w['parts'])} calipers={len(w['cal'])}")
    return wheels


def split_faces(o, pred, name):
    """move the faces where pred(face) holds into a new object; returns it (or None)"""
    bm = bmesh.new(); bm.from_mesh(o.data)
    idx = {f.index for f in bm.faces if pred(f)}
    if not idx:
        bm.free(); return None
    new = o.copy(); new.data = o.data.copy(); new.name = name
    scene.collection.objects.link(new)
    bm2 = bmesh.new(); bm2.from_mesh(new.data)
    bmesh.ops.delete(bm2, geom=[f for f in bm2.faces if f.index not in idx], context='FACES')
    bm2.to_mesh(new.data); bm2.free()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in idx], context='FACES')
    bm.to_mesh(o.data); bm.free()
    return new


def wheels_from_cylinders():
    """fused meshes (scans): cut the wheels out by position. Each entry: tag, c (centre), r (tyre radius),
    cut (cut radius around the axle), x (lateral range [inner, outer] as distances from the centre line)"""
    wheels = {}
    for wc in cfg['wheel_cylinders']:
        c = V(wc['c']); cut = wc['cut']; low = wc.get('cut_low', cut); xi, xo = wc['x']
        wheels[wc['tag']] = {'c': c, 'r': wc['r'], 'w': wc.get('w', xo - xi), 'parts': [], 'cal': []}

        # the arch lining hugs the top of the tyre: a tight cut above the axle, a looser one below
        def inside(f, c=c, cut=cut, low=low, xi=xi, xo=xo):
            p = f.calc_center_median()
            return xi <= abs(p.x) <= xo and p.x * c.x > 0 and math.hypot(p.y - c.y, p.z - c.z) < (cut if p.z > c.z else low)
        for o in list(meshes()):
            if o.get('wheel'): continue
            n = split_faces(o, inside, 'wheel_' + wc['tag'] + '_' + o.name)
            if n is None: continue
            n['wheel'] = wc['tag']
            wheels[wc['tag']]['parts'].append(n)
            if not o.data.polygons: bpy.data.objects.remove(o, do_unlink=True)
    for tag, w in wheels.items():
        print(f"WHEEL {tag} centre={tuple(round(v, 4) for v in w['c'])} r={w['r']:.4f} w={w['w']:.3f} parts={len(w['parts'])} faces={sum(len(o.data.polygons) for o in w['parts'])}")
    return wheels


wheels = wheels_from_cylinders() if 'wheel_cylinders' in cfg else wheels_from_parts()


# ---- ground + centre: lowest tyre point at z = 0, x centred, y centred between the axles ------------------
zg = min(w['c'].z - w['r'] for w in wheels.values())
xc = sum(w['c'].x for w in wheels.values()) / 4
yc = (wheels['FL']['c'].y + wheels['FR']['c'].y + wheels['RL']['c'].y + wheels['RR']['c'].y) / 4
T = mathutils.Matrix.Translation(V((-xc, -yc, -zg)))
for o in meshes(): o.data.transform(T)
for w in wheels.values(): w['c'] = w['c'] + V((-xc, -yc, -zg))

# ---- delete small parts by position (3D badges): [x0, y0, z0, x1, y1, z1, max_size] in the final frame -----------
def components(bm):
    seen = set()
    for f in bm.faces:
        if f.index in seen: continue
        stack = [f]; comp = []; seen.add(f.index)
        while stack:
            x = stack.pop(); comp.append(x)
            for e in x.edges:
                for g in e.link_faces:
                    if g.index not in seen: seen.add(g.index); stack.append(g)
        yield comp


for box in cfg.get('delete_parts', []):
    lo, hi, mxs = V(box[0:3]), V(box[3:6]), box[6] if len(box) > 6 else 1e9
    for o in list(meshes()):
        bm = bmesh.new(); bm.from_mesh(o.data)
        dead = []
        for comp in components(bm):
            vs = {v for f in comp for v in f.verts}
            a = V([min(v.co[i] for v in vs) for i in range(3)]); b = V([max(v.co[i] for v in vs) for i in range(3)])
            c = (a + b) / 2
            if all(lo[i] <= c[i] <= hi[i] for i in range(3)) and max(b - a) <= mxs: dead.extend(comp)
        if dead:
            bmesh.ops.delete(bm, geom=dead, context='FACES'); bm.to_mesh(o.data)
            print('delete_parts:', len(dead), 'faces from', o.name)
        bm.free()
        if not o.data.polygons: bpy.data.objects.remove(o, do_unlink=True)

# ---- face winding vs normals: ripped models often have faces wound against their (custom) normals, which
# renders dark / mirror-like in three.js. Turn those faces round and keep the original normals. -----------------
def fix_winding(o):
    me = o.data
    cn = [c.vector.copy() for c in me.corner_normals]
    flip = [p.index for p in me.polygons if sum((cn[li] for li in p.loop_indices), V()).dot(p.normal) < 0]
    if not flip: return 0
    per = {(p.index, me.loops[li].vertex_index): cn[li] for p in me.polygons for li in p.loop_indices}
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    bmesh.ops.reverse_faces(bm, faces=[bm.faces[i] for i in flip])
    bm.to_mesh(me); bm.free()
    me.normals_split_custom_set([per.get((p.index, me.loops[li].vertex_index), V((0, 0, 1))) for p in me.polygons for li in p.loop_indices])
    return len(flip)


# ---- doubled surfaces (ripped models stack panels a few mm apart with different UVs -> z-fighting):
# for the listed slots, where two faces overlap, delete the one that samples a darker texel
# (the textured paint mask: the dark copy is the hidden inner layer; it shows through as grey patches) -----------
def remove_overlaps(slots, gap=0.004):
    from mathutils.bvhtree import BVHTree
    objs = [o for o in meshes() if o.get('slot') in slots and not o.get('wheel')]
    if not objs: return
    bm = bmesh.new(); own = []; lum = []
    for k, o in enumerate(objs):
        img = base_image(o.data.materials[0])
        W, H = img.size if img else (1, 1)
        px = img.pixels[:] if img else None
        n0 = len(bm.faces); bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        uv = bm.loops.layers.uv.active
        for i in range(n0, len(bm.faces)):
            own.append((k, i - n0))
            if px is None or uv is None:
                lum.append(1.0); continue
            f = bm.faces[i]
            u = sum(l[uv].uv.x for l in f.loops) / len(f.loops); v = sum(l[uv].uv.y for l in f.loops) / len(f.loops)
            j = (min(H - 1, int((v % 1) * H)) * W + min(W - 1, int((u % 1) * W))) * 4
            lum.append(0.3 * px[j] + 0.59 * px[j + 1] + 0.11 * px[j + 2])
    tree = BVHTree.FromBMesh(bm)
    dead = set()
    for f in bm.faces:
        if f.index in dead: continue
        c, n = f.calc_center_median(), f.normal
        for co, ng, idx, d in tree.find_nearest_range(c, gap):
            if idx == f.index or idx in dead or ng is None or abs(ng.dot(n)) < 0.8: continue
            # f's centre must lie over g (not just next to it on the same plane)
            if d > 1e-6 and (c - co).cross(ng).length > 0.3 * d: continue
            lo = idx if lum[idx] < lum[f.index] else f.index
            if abs(lum[idx] - lum[f.index]) > 0.15: dead.add(lo)
    per = {}
    for i in dead: per.setdefault(own[i][0], set()).add(own[i][1])
    for k, idxs in per.items():
        o = objs[k]
        b2 = bmesh.new(); b2.from_mesh(o.data); b2.faces.ensure_lookup_table()
        bmesh.ops.delete(b2, geom=[b2.faces[i] for i in idxs], context='FACES')
        b2.to_mesh(o.data); b2.free()
    bm.free()
    print('overlaps: removed', len(dead), 'darker overlapping faces in', sorted(slots))


if cfg.get('remove_overlaps'):
    for o in meshes(): fix_winding(o)  # face normals must point outwards to tell outer from inner
    remove_overlaps(set(cfg['remove_overlaps']))

# ---- add plain blocks, e.g. to close the hole a deleted badge leaves: {"box": [...], "slot": "black_plastic"}
for ab in cfg.get('add_boxes', []):
    lo, hi = V(ab['box'][0:3]), V(ab['box'][3:6])
    me = bpy.data.meshes.new('added'); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=hi - lo, verts=bm.verts)
    bmesh.ops.translate(bm, vec=(lo + hi) / 2, verts=bm.verts)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('added_' + ab['slot'], me); scene.collection.objects.link(o)
    o['slot'] = ab['slot']; o['src_mat'] = 'added'
    me.materials.append(slot_material(ab['slot'], None))

# ---- re-slot faces by position: {"box": [...], "from": slot, "to": slot} (e.g. front lamps sharing the tail-lamp material)
for sb in cfg.get('slot_boxes', []):
    lo, hi = V(sb['box'][0:3]), V(sb['box'][3:6])
    for o in list(meshes()):
        if o.get('slot') != sb['from'] or o.get('wheel') or o.parent is not None: continue
        n = split_faces(o, lambda f: all(lo[i] <= f.calc_center_median()[i] <= hi[i] for i in range(3)), o.name + '_' + sb['to'])
        if n is None: continue
        n['slot'] = sb['to']
        n.data.materials.clear(); n.data.materials.append(slot_material(sb['to'], None))
        print('slot_box:', len(n.data.polygons), 'faces', sb['from'], '->', sb['to'])
        if not o.data.polygons: bpy.data.objects.remove(o, do_unlink=True)

# ---- paint over logos baked into a texture, picked by 3D position (scans with scrambled atlases) --------------
# entries: {"box": [x0, y0, z0, x1, y1, z1] (final frame), "color": [r, g, b] or "ring" (average around the box)}
def raster(px, W, H, tri, col):
    c = sum(tri, V((0, 0))) / 3
    tri = [p + (p - c).normalized() * 1.5 if (p - c).length > 1e-6 else p for p in tri]  # 1.5 px bleed
    x0, x1 = max(0, int(min(p.x for p in tri))), min(W - 1, int(max(p.x for p in tri)) + 1)
    y0, y1 = max(0, int(min(p.y for p in tri))), min(H - 1, int(max(p.y for p in tri)) + 1)
    (ax, ay), (bx, by), (cx, cy) = tri
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(den) < 1e-9: return
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            qx, qy = x + 0.5, y + 0.5
            l1 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / den
            l2 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / den
            if l1 >= 0 and l2 >= 0 and l1 + l2 <= 1:
                i = (y * W + x) * 4
                px[i:i + 3] = col


for pb in cfg.get('paint_boxes', []):
    lo, hi = V(pb['box'][0:3]), V(pb['box'][3:6])
    ring = pb.get('ring', 0.04)
    jobs, samples = [], []
    for o in meshes():
        m = o.data.materials[0] if o.data.materials else None
        img = base_image(m)
        if img is None or not o.data.uv_layers: continue
        W, H = img.size
        bm = bmesh.new(); bm.from_mesh(o.data)
        uv = bm.loops.layers.uv.active
        hits = []
        for f in bm.faces:
            p = f.calc_center_median()
            inside = all(lo[i] <= p[i] <= hi[i] for i in range(3))
            if inside:
                hits.append([V(((l[uv].uv.x % 1) * W, (l[uv].uv.y % 1) * H)) for l in f.loops])
            elif all(lo[i] - ring <= p[i] <= hi[i] + ring for i in range(3)):
                u = sum(l[uv].uv.x for l in f.loops) / len(f.loops); v = sum(l[uv].uv.y for l in f.loops) / len(f.loops)
                samples.append((img, min(H - 1, int((v % 1) * H)) * W + min(W - 1, int((u % 1) * W))))
        bm.free()
        if hits: jobs.append((img, hits, o.name))
    col = pb.get('color', 'ring')
    if col == 'ring':  # median colour of the faces around the box (robust against trim and shadows)
        cache = {}
        vals = []
        for img, i in samples:
            if img.name not in cache: cache[img.name] = img.pixels[:]
            vals.append(cache[img.name][i * 4:i * 4 + 3])
        col = [sorted(v[k] for v in vals)[len(vals) // 2] for k in range(3)] if vals else [0.5, 0.5, 0.5]
    else:
        col = [v / 255 for v in col]
    for img in {id(j[0]): j[0] for j in jobs}.values():
        W, H = img.size
        px = list(img.pixels)
        n = 0
        for im2, hits, name in jobs:
            if im2 != img: continue
            for pts in hits:
                for k in range(1, len(pts) - 1): raster(px, W, H, [pts[0], pts[k], pts[k + 1]], col)
            n += len(hits)
        img.pixels[:] = px; img.update()
        print('paint_box:', n, 'faces on', img.name, 'colour', [round(c * 255) for c in col])

# ---- rig ---------------------------------------------------------------------------------------------------------
root = bpy.data.objects.new('Car', None); scene.collection.objects.link(root)
body = bpy.data.objects.new('Body', None); scene.collection.objects.link(body); body.parent = root
in_wheel = set()
for tag, w in wheels.items():
    piv = bpy.data.objects.new('Wheel_' + tag, None); scene.collection.objects.link(piv)
    piv.parent = root; piv.location = w['c']
    cal = bpy.data.objects.new('Caliper_' + tag, None); scene.collection.objects.link(cal)
    cal.parent = root; cal.location = w['c']
    for group, parent in ((w['parts'], piv), (w['cal'], cal)):
        for o in group:
            o.data.transform(mathutils.Matrix.Translation(-w['c']))
            o.parent = parent; o.matrix_parent_inverse.identity()
            in_wheel.add(o.name)
for o in meshes():
    if o.name in in_wheel: continue
    o.parent = body; o.matrix_parent_inverse.identity()

# ---- join per slot + decimate ---------------------------------------------------------------------------------
dec = cfg.get('decimate', {})


def join_by_slot(parent):
    groups = {}
    for c in list(parent.children):
        if c.type == 'MESH': groups.setdefault(c.data.materials[0].name, []).append(c)
    for mat, objs in groups.items():
        select_only(objs)
        if cfg.get('debug'): print('JOIN', parent.name, mat, len(objs), 'selected', len(bpy.context.selected_objects))
        if len(objs) > 1: bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        o.name = parent.name + '_' + mat; o.data.name = o.name
        # weld first: ripped / scanned meshes are often split into loose pieces along UV seams, and
        # decimating those pulls the pieces apart (cracks)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=0.00005); bpy.ops.object.mode_set(mode='OBJECT')
        r = dec.get(mat, dec.get('*'))
        if r and r < 1.0:
            mod = o.modifiers.new('dec', 'DECIMATE'); mod.ratio = r
            bpy.ops.object.modifier_apply(modifier=mod.name)


join_by_slot(body)
for o in list(scene.objects):
    if o.type == 'EMPTY' and o.name.startswith(('Wheel_', 'Caliper_')): join_by_slot(o)

nflip = sum(fix_winding(o) for o in meshes())
print('winding: turned', nflip, 'faces')

# ---- textures: keep them small -------------------------------------------------------------------------------
mt = cfg.get('max_texture', 1024)
for img in bpy.data.images:
    if img.size[0] > mt or img.size[1] > mt:
        f = mt / max(img.size[0], img.size[1])
        img.scale(max(1, int(img.size[0] * f)), max(1, int(img.size[1] * f)))

tri = {}
for o in meshes():
    tri[o.data.materials[0].name] = tri.get(o.data.materials[0].name, 0) + sum(len(p.vertices) - 2 for p in o.data.polygons)
print('TRIS total', sum(tri.values()), dict(sorted(tri.items(), key=lambda kv: -kv[1])))
mn, mx = bbox_objs([o for o in meshes() if o.parent == body])
print('BODY BBOX', [round(v, 3) for v in mn], [round(v, 3) for v in mx])
fl, rl = wheels['FL']['c'], wheels['RL']['c']
print('SPEC wheels: front x=±%.4f z(glTF)=%.4f  rear x=±%.4f z(glTF)=%.4f  y=%.4f r=%.4f wF=%.3f wR=%.3f' % (
    (abs(wheels['FL']['c'].x) + abs(wheels['FR']['c'].x)) / 2, -(fl.y + wheels['FR']['c'].y) / 2,
    (abs(rl.x) + abs(wheels['RR']['c'].x)) / 2, -(rl.y + wheels['RR']['c'].y) / 2,
    sum(w['c'].z for w in wheels.values()) / 4, sum(w['r'] for w in wheels.values()) / 4,
    (wheels['FL']['w'] + wheels['FR']['w']) / 2, (wheels['RL']['w'] + wheels['RR']['w']) / 2))
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True, export_cameras=False, export_lights=False, use_selection=False)
