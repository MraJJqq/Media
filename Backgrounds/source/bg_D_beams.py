"""
背景 D：暗室光束（两道体积光从画面外斜射，中间偏暗），1920x1080 PNG
依赖：pip install numpy scipy pillow
用法：python bg_D_beams.py   # 在当前目录生成 bgD_light_beams.png
"""
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, zoom

W, H = 1920, 1080
OUT = "."
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
CX, CY = W / 2, H / 2

def col(c): return np.array(c, np.float32) / 255.0
def lerp(a, b, t): return a + (b - a) * t
def blur(a, s): return gaussian_filter(a, sigma=(s, s, 0))
def canvas(): return np.zeros((H, W, 3), np.float32)

def vgrad(top, bot, y0=0, y1=H, power=1.0):
    t = np.clip((yy - y0) / (y1 - y0), 0, 1) ** power
    return lerp(col(top), col(bot), t[..., None])

def glow(img, cx, cy, rx, ry, color, strength=1.0, power=2.0):
    d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    img += (np.clip(1 - d, 0, 1) ** power * strength)[..., None] * col(color)

def stars(rng, n, y0, y1, bright, sigma, tint=((190, 215, 255), (255, 232, 205))):
    L = canvas()
    xs = rng.integers(0, W, n)
    ys = rng.integers(int(y0), int(y1), n)
    b = (rng.random(n) ** 3) * bright + 0.1 * bright
    t = rng.random(n)[:, None]
    np.add.at(L, (ys, xs), (col(tint[0]) * t + col(tint[1]) * (1 - t)) * b[:, None])
    return blur(L, sigma) * (2 * np.pi * sigma ** 2) if sigma > 0 else L

def fractal1d(rng, n, c0, octaves=4, gain=0.5):
    out = np.zeros(n, np.float32)
    a = 1.0
    for o in range(octaves):
        cs = max(2, int(c0 / 2 ** o))
        g = rng.normal(size=n // cs + 4).astype(np.float32)
        out += zoom(g, cs, order=3)[:n] * a
        a *= gain
    out -= out.min()
    return out / out.max()

def calm_center(img, amount=0.55):
    m = np.exp(-(((xx - CX) / (0.30 * W)) ** 2 + ((yy - CY) / (0.34 * H)) ** 2))
    img *= (1 - amount * m)[..., None]

def finish(img, name, exposure=1.1, vig=0.65, grain=0.010, seed=0):
    img = 1 - np.exp(-np.maximum(img, 0) * exposure)
    r = np.sqrt(((xx - CX) / CX) ** 2 + ((yy - CY) / CY) ** 2)
    img *= (1 - vig * np.clip(r - 0.35, 0, 1) ** 1.6)[..., None]
    noise = np.random.default_rng(seed).normal(0, grain, (H, W, 1)).astype(np.float32)
    img = np.clip(img + noise, 0, 1)
    Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(f"{OUT}/{name}.png", optimize=True)
    print("saved", name)

def beams():
    rng = np.random.default_rng(51)
    img = canvas()
    img += vgrad((1, 2, 8), (3, 6, 16), 0, H)
    for sx, sy, color, aim in [(W * 0.10, -420, (90, 150, 255), 1.25),
                               (W * 0.90, -420, (140, 100, 255), 1.89)]:
        th = np.arctan2(yy - sy, xx - sx)
        dist = np.sqrt((xx - sx) ** 2 + (yy - sy) ** 2)
        nz = fractal1d(rng, 2000, 40, 4)
        idx = np.clip((th - (aim - 0.5)) / 1.0 * 1999, 0, 1999).astype(int)
        fan = np.exp(-(((th - aim) / 0.42) ** 2))
        beam = np.clip(nz[idx] - 0.42, 0, 1) ** 1.5 * 3.0 * fan * np.exp(-dist / 1300)
        img += gaussian_filter(beam, 4)[..., None] * col(color)
        glow(img, sx, 0, 500, 300, color, 0.5, 2.0)
    img += stars(rng, 400, 0, H, 0.5, 0.9)
    calm_center(img, 0.6)
    finish(img, "bgD_light_beams", exposure=1.1, vig=0.7, seed=14)

if __name__ == "__main__":
    beams()
