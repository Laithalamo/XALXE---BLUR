"""
XALXE procedural PBR texture generator.

Every texture made here is original (generated from noise), so there are no
licence questions. All outputs tile seamlessly (everything is built with
periodic noise / wrap-around distances).

Usage:  python tools/textures/generate.py [out_dir]
Needs:  numpy, scipy, pillow
"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '../../assets/textures')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1337)


# ----------------------------------------------------------------- helpers
def spectral_noise(n, beta=2.0, fmin=1.0, fmax=None, seed=None):
    """Tileable fractal noise via FFT (1/f^beta spectrum), normalised to 0..1."""
    r = np.random.default_rng(seed) if seed is not None else rng
    fx = np.fft.fftfreq(n) * n
    fy = np.fft.fftfreq(n) * n
    f = np.sqrt(fx[None, :] ** 2 + fy[:, None] ** 2)
    f[0, 0] = 1
    amp = 1.0 / f ** (beta / 2)
    amp[f < fmin] = 0
    if fmax is not None:
        amp[f > fmax] = 0
    phase = r.uniform(0, 2 * np.pi, (n, n))
    spec = amp * np.exp(1j * phase)
    out = np.real(np.fft.ifft2(spec))
    out -= out.min()
    out /= max(out.max(), 1e-9)
    return out


def wrap_blur(img, sigma):
    return ndimage.gaussian_filter(img, sigma, mode='wrap')


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = dy * strength  # OpenGL convention (+Y up in texture space)
    nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / l, ny / l, nz / l], axis=-1)
    return ((n * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)


def cavity_ao(h, sigma, strength):
    c = h - wrap_blur(h, sigma)
    ao = 1.0 + np.minimum(c, 0) * strength
    return ao.clip(0.35, 1.0)


def to_srgb8(lin):
    lin = np.clip(lin, 0, 1)
    s = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    return (s * 255 + 0.5).astype(np.uint8)


def save(name, arr, quality=92):
    path = os.path.join(OUT, name)
    img = Image.fromarray(arr)
    if name.endswith('.jpg'):
        img.save(path, quality=quality, subsampling=0 if 'normal' in name else 2)
    else:
        img.save(path, optimize=True)
    print('wrote', path, arr.shape)


def orm(ao, rough, metal=None):
    metal = np.zeros_like(ao) if metal is None else metal
    return (np.stack([ao, rough, metal], -1) * 255).clip(0, 255).astype(np.uint8)


def stamp_stones(n, count, rmin, rmax, seed, elong=0.45):
    """Height field of rounded, randomly oriented aggregate stones (tileable).
    Returns (height, stone_id_value, mask)."""
    r = np.random.default_rng(seed)
    h = np.zeros((n, n), np.float32)
    tint = np.zeros((n, n), np.float32)
    for _ in range(count):
        rad = r.uniform(rmin, rmax)
        cx, cy = r.uniform(0, n), r.uniform(0, n)
        ang = r.uniform(0, np.pi)
        ax = rad * r.uniform(1 - elong, 1.0)
        R = int(np.ceil(rad)) + 1
        ys, xs = np.mgrid[-R:R + 1, -R:R + 1].astype(np.float32)
        fx = xs + (cx - np.floor(cx))
        fy = ys + (cy - np.floor(cy))
        ca, sa = np.cos(ang), np.sin(ang)
        u = (fx * ca + fy * sa) / rad
        v = (-fx * sa + fy * ca) / ax
        d = u * u + v * v
        dome = np.sqrt(np.clip(1 - d, 0, 1)) * rad
        iy = (np.arange(-R, R + 1) + int(np.floor(cy))) % n
        ix = (np.arange(-R, R + 1) + int(np.floor(cx))) % n
        sub = h[np.ix_(iy, ix)]
        upd = dome > sub
        sub[upd] = dome[upd]
        h[np.ix_(iy, ix)] = sub
        tsub = tint[np.ix_(iy, ix)]
        tsub[upd & (dome > 0)] = r.uniform(0.05, 1.0)
        tint[np.ix_(iy, ix)] = tsub
    return h, tint, (h > 0).astype(np.float32)


# ------------------------------------------------------------------ asphalt
def worley_layer(n, count, seed):
    """Densely packed angular 'stones' from periodic Worley noise.
    Returns (edge distance F2-F1 in px, per-cell random value 0..1)."""
    from scipy.spatial import cKDTree
    r = np.random.default_rng(seed)
    pts = r.uniform(0, n, (count, 2))
    tree = cKDTree(pts, boxsize=n)
    y, x = np.mgrid[0:n, 0:n]
    q = np.stack([x.ravel() + 0.5, y.ravel() + 0.5], -1)
    d, i = tree.query(q, k=2, workers=-1)
    edge = (d[:, 1] - d[:, 0]).reshape(n, n).astype(np.float32)
    val = r.uniform(0, 1, count)[i[:, 0]].reshape(n, n).astype(np.float32)
    return edge, val


def asphalt():
    n = 2048  # tile = 3 m  ->  1.46 mm / px
    print('asphalt...')
    e1, v1 = worley_layer(n, 26000, 11)   # coarse aggregate (~15-20 mm)
    e2, v2 = worley_layer(n, 150000, 12)  # fine aggregate (~6-8 mm)
    grit = spectral_noise(n, beta=0.5, fmin=260, seed=13)
    blotch = spectral_noise(n, beta=2.6, fmin=1, fmax=40, seed=15)

    # coarse stones only where the random cell value says so (~45 % of cells)
    coarse = (v1 > 0.55).astype(np.float32)
    s1 = np.clip((e1 - 1.2) / 2.5, 0, 1) * coarse   # stone body, 0 in the binder gaps
    s2 = np.clip((e2 - 0.9) / 1.6, 0, 1)
    stone = np.maximum(s1, s2 * (1 - coarse * 0.9))
    tint = np.where(s1 > 0.05, (v1 - 0.55) / 0.45, v2)

    # height: rounded stones proud of the binder, tops worn flat
    h = np.where(s1 > 0.05, np.sqrt(s1) * 2.2, np.sqrt(s2) * 1.2)
    h = np.minimum(h, 1.7) + grit * 0.25

    # albedo (linear): grey stones with slight warm/cool variation in dark binder
    binder = 0.032 + 0.012 * blotch
    stone_grey = 0.075 + 0.085 * tint ** 1.3
    stone_grey = stone_grey * (0.8 + 0.4 * spectral_noise(n, beta=1.0, fmin=90, seed=18))
    alb = binder + (stone_grey - binder) * stone
    alb *= 0.85 + 0.3 * grit
    alb = wrap_blur(alb, 0.55)
    warm = (spectral_noise(n, beta=0.8, fmin=120, seed=17) - 0.5) * 0.10
    rgb = np.stack([alb * (1.0 + warm), alb, alb * (0.97 - warm)], -1)
    save('asphalt_albedo.jpg', to_srgb8(rgb))

    save('asphalt_normal.jpg', normal_from_height(wrap_blur(h, 0.6), 1.1))
    ao = cavity_ao(h, 2.5, 0.45) * (0.75 + 0.25 * stone)
    rough = 0.94 - 0.16 * stone * (h > 1.5) - 0.04 * blotch
    save('asphalt_orm.jpg', orm(ao, wrap_blur(rough, 0.8)))


# ---------------------------------------------------------------- concrete
def concrete():
    n = 1024  # tile = 2 m
    print('concrete...')
    lo = spectral_noise(n, beta=2.8, fmin=1, fmax=30, seed=21)
    mid = spectral_noise(n, beta=1.6, fmin=8, seed=22)
    hi = spectral_noise(n, beta=0.3, fmin=150, seed=23)
    # pores / air bubbles
    pores = np.zeros((n, n), np.float32)
    r = np.random.default_rng(24)
    pts = r.integers(0, n, (2500, 2))
    pores[pts[:, 0], pts[:, 1]] = 1
    pores = wrap_blur(pores, 0.9)
    pores = (pores / pores.max()) ** 0.7
    stains = np.clip((spectral_noise(n, beta=2.4, fmin=2, fmax=50, seed=25) - 0.55) * 3, 0, 1)
    alb = 0.36 + 0.07 * (lo - 0.5) + 0.05 * (mid - 0.5) + 0.03 * (hi - 0.5)
    alb = alb * (1 - 0.35 * stains) * (1 - 0.5 * pores)
    rgb = np.stack([alb * 1.0, alb * 0.99, alb * 0.96], -1)
    save('concrete_albedo.jpg', to_srgb8(rgb))
    h = mid * 0.6 + hi * 0.3 - pores * 1.5
    save('concrete_normal.jpg', normal_from_height(h, 2.0))
    ao = cavity_ao(h, 2, 0.8)
    rough = 0.82 + 0.1 * (mid - 0.5) - 0.1 * stains
    save('concrete_orm.jpg', orm(ao, rough))


# --------------------------------------------------------- sidewalk pavers
def pavers():
    n = 1024  # tile = 2 m, 4x4 slabs of 0.5 m
    print('pavers...')
    slabs = 4
    cell = n // slabs
    y, x = np.mgrid[0:n, 0:n]
    cx = x % cell
    cy = y % cell
    edge = np.minimum(np.minimum(cx, cell - 1 - cx), np.minimum(cy, cell - 1 - cy)).astype(np.float32)
    groove = np.clip(edge / 5.0, 0, 1)  # 5px bevel ~ 1 cm
    sid = (x // cell) + (y // cell) * slabs
    r = np.random.default_rng(31)
    slab_tone = r.uniform(-1, 1, slabs * slabs)[sid]
    slab_tilt = r.uniform(-1, 1, (slabs * slabs, 2))
    mid = spectral_noise(n, beta=1.5, fmin=6, seed=32)
    hi = spectral_noise(n, beta=0.4, fmin=160, seed=33)
    lo = spectral_noise(n, beta=2.6, fmin=1, fmax=16, seed=34)
    gum = np.zeros((n, n), np.float32)
    pts = r.integers(0, n, (140, 2))
    gum[pts[:, 0], pts[:, 1]] = 1
    gum = np.clip(wrap_blur(gum, 3.0) * 60, 0, 1)
    alb = 0.30 + 0.03 * slab_tone + 0.05 * (mid - 0.5) + 0.03 * (hi - 0.5) + 0.05 * (lo - 0.5)
    alb = alb * (0.55 + 0.45 * groove) * (1 - 0.45 * gum)
    rgb = np.stack([alb * 1.01, alb, alb * 0.97], -1)
    save('pavers_albedo.jpg', to_srgb8(rgb))
    tilt = (slab_tilt[sid, 0] * (cx - cell / 2) + slab_tilt[sid, 1] * (cy - cell / 2)) / cell * 0.6
    h = groove * 2.0 + mid * 0.35 + hi * 0.2 + tilt
    save('pavers_normal.jpg', normal_from_height(h, 2.2))
    ao = np.clip(0.45 + 0.55 * groove, 0, 1) * cavity_ao(h, 2, 0.4)
    rough = 0.86 + 0.06 * (mid - 0.5) - 0.2 * gum
    save('pavers_orm.jpg', orm(ao, rough))


# ------------------------------------------------------------------- bricks
def bricks():
    n = 1024  # tile = 1.6 m wide
    print('bricks...')
    bw, bh, mortar = 128, 42, 5  # px: 20 cm x 6.5 cm bricks
    rows = n // bh + 1
    y, x = np.mgrid[0:n, 0:n]
    row = y // bh
    off = (row % 2) * (bw // 2)
    bx = (x + off) % bw
    by = y % bh
    bid = ((x + off) // bw) + row * 97
    edge = np.minimum(np.minimum(bx, bw - 1 - bx), np.minimum(by, bh - 1 - by)).astype(np.float32)
    inb = np.clip((edge - mortar / 2) / 2.5, 0, 1)
    r = np.random.default_rng(41)
    tone = r.uniform(0, 1, 97 * (rows + 2) + 200)[bid % (97 * (rows + 2) + 200)]
    mid = spectral_noise(n, beta=1.4, fmin=10, seed=42)
    hi = spectral_noise(n, beta=0.3, fmin=200, seed=43)
    red = np.array([0.30, 0.105, 0.065])
    dark = np.array([0.16, 0.07, 0.05])
    light = np.array([0.40, 0.2, 0.12])
    t = tone[..., None]
    col = np.where(t < 0.5, dark + (red - dark) * (t * 2), red + (light - red) * ((t - 0.5) * 2))
    col = col * (0.85 + 0.3 * mid[..., None]) * (0.9 + 0.2 * hi[..., None])
    mortar_col = np.array([0.33, 0.32, 0.30]) * (0.85 + 0.3 * mid[..., None])
    rgb = mortar_col * (1 - inb[..., None]) + col * inb[..., None]
    save('bricks_albedo.jpg', to_srgb8(rgb))
    h = inb * 2.0 + mid * 0.5 + hi * 0.4
    save('bricks_normal.jpg', normal_from_height(h, 2.5))
    ao = np.clip(0.5 + 0.5 * inb, 0, 1)
    rough = 0.88 - 0.05 * mid
    save('bricks_orm.jpg', orm(ao, rough))


# ------------------------------------------------------ plaster / stucco wall
def plaster():
    n = 1024  # tile = 3 m
    print('plaster...')
    lo = spectral_noise(n, beta=2.6, fmin=1, fmax=24, seed=51)
    mid = spectral_noise(n, beta=1.2, fmin=12, seed=52)
    hi = spectral_noise(n, beta=0.2, fmin=220, seed=53)
    streaks = spectral_noise(n, beta=2.0, fmin=2, seed=54)
    streaks = np.clip(ndimage.gaussian_filter(streaks, (40, 0.8), mode='wrap') * 2 - 0.9, 0, 1)
    v = 0.8 + 0.1 * (lo - 0.5) + 0.06 * (mid - 0.5) + 0.04 * (hi - 0.5) - 0.18 * streaks
    save('plaster_albedo.jpg', to_srgb8(np.stack([v, v, v], -1) * 0.75))
    h = mid * 0.4 + hi * 0.7
    save('plaster_normal.jpg', normal_from_height(h, 1.6))


# ---------------------------------------------------- world noise (RGBA 512)
def world_noise():
    n = 512
    print('noise...')
    chans = [spectral_noise(n, beta=b, fmin=fm, fmax=fx, seed=s) for b, fm, fx, s in
             [(2.4, 1, 24, 61), (2.0, 2, 64, 62), (1.4, 4, 128, 63), (2.8, 1, 10, 64)]]
    arr = (np.stack(chans, -1) * 255).astype(np.uint8)
    save('noise_rgba.png', arr)


# ---------------------------------------------------------------- chain link
def chainlink():
    n = 512  # tile = 0.5 m, 10 cm diamonds
    print('chainlink...')
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    p = n / 5.0
    u = (x + y) / p
    v = (x - y) / p
    du = np.abs(u - np.round(u))
    dv = np.abs(v - np.round(v))
    wire = np.clip(1.0 - np.minimum(du, dv) * p / 2.2, 0, 1)
    alpha = (wire > 0.2).astype(np.float32) * np.clip(wire * 1.6, 0, 1)
    c = (0.45 + 0.4 * wire)
    rgba = np.stack([c, c, c * 1.02, alpha], -1)
    save('chainlink.png', (rgba * 255).astype(np.uint8))


# ------------------------------------------------------------- smoke puffs
def smoke():
    n = 256
    print('smoke...')
    tiles = []
    for i in range(4):
        y, x = np.mgrid[0:n, 0:n].astype(np.float32)
        d = np.sqrt((x - n / 2) ** 2 + (y - n / 2) ** 2) / (n / 2)
        nz = spectral_noise(n, beta=2.0, fmin=2, seed=70 + i)
        nz2 = spectral_noise(n, beta=1.2, fmin=6, seed=80 + i)
        dd = d + (nz - 0.5) * 0.55 + (nz2 - 0.5) * 0.15
        a = np.clip(1 - dd, 0, 1) ** 1.6
        a *= 0.65 + 0.7 * nz2
        a = np.clip(a, 0, 1)
        shade = 0.75 + 0.25 * nz
        tiles.append(np.stack([shade, shade, shade, a], -1))
    atlas = np.zeros((n * 2, n * 2, 4), np.float32)
    for i, t in enumerate(tiles):
        atlas[(i // 2) * n:(i // 2 + 1) * n, (i % 2) * n:(i % 2 + 1) * n] = t
    save('smoke_atlas.png', (atlas * 255).astype(np.uint8))


# --------------------------------------------------------- paint flakes
def flakes():
    n = 512
    print('flakes...')
    r = np.random.default_rng(90)
    cells = 180
    y, x = np.mgrid[0:n, 0:n]
    cx = (x * cells // n)
    cy = (y * cells // n)
    idx = cx + cy * cells
    tilt = r.normal(0, 0.35, (cells * cells, 2))
    nx = tilt[idx, 0]
    ny = tilt[idx, 1]
    nz = np.ones_like(nx)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    arr = np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5
    save('flakes_normal.png', (arr * 255).astype(np.uint8))


if __name__ == '__main__':
    which = sys.argv[2:] or ['asphalt', 'concrete', 'pavers', 'bricks', 'plaster', 'world_noise', 'chainlink', 'smoke', 'flakes']
    for w in which:
        globals()[w]()
