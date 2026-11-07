"""
背景 A：极光光幕（两侧垂直光幕，中间深暗），1920x1080 PNG
依赖：pip install numpy scipy pillow
用法：python bg_A_aurora.py   # 在当前目录生成 bgA_aurora_curtain.png
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

def aurora():
    rng = np.random.default_rng(21)
    img = canvas()
    img += vgrad((1, 3, 9), (3, 8, 20), 0, H, 1.2)
    side = (np.abs(xx - CX) / CX) ** 1.15
    layers = [((0, 205, 170), 0.30, 3.0, 0.9, 1.0),
              ((50, 130, 255), 0.22, 2.0, 1.4, 0.85),
              ((130, 80, 230), 0.16, 1.4, 2.1, 0.7)]
    for color, y0, f, ph, st in layers:
        ytop = H * y0 + 80 * np.sin(2 * np.pi * xx / W * f + ph)
        v = (yy - ytop) / (H * 0.30)
        top = 1 / (1 + np.exp(-np.clip(v * 9, -30, 30)))
        hang = np.exp(-np.clip(v, 0, None) * 1.7)
        streak = (0.25 + 0.75 * fractal1d(rng, W, 60, 5))[None, :] ** 1.3
        cur = top * hang * streak * side
        img += blur(cur[..., None] * col(color) * st * 1.4, 3)
    img += stars(rng, 500, 0, H * 0.7, 0.8, 0.7)
    calm_center(img, 0.5)
    finish(img, "bgA_aurora_curtain", exposure=1.1, vig=0.65, seed=11)

if __name__ == "__main__":
    aurora()
