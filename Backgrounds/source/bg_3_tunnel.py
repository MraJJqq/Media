"""
背景 3：时空隧道（螺旋收束的光圈，中心无暖光，整体偏暗），1920x1080 PNG
依赖：pip install numpy scipy pillow
用法：python bg_3_tunnel.py   # 在当前目录生成 bg3_time_tunnel.png
"""
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

W, H = 1920, 1080
OUT = "."
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
CX, CY = W / 2, H / 2

# ---------- 通用工具 ----------
def col(c): return np.array(c, np.float32) / 255.0
def lerp(a, b, t): return a + (b - a) * t
def blur(a, s): return gaussian_filter(a, sigma=(s, s, 0))
def canvas(): return np.zeros((H, W, 3), np.float32)
def to_arr(im): return np.asarray(im, np.float32) / 255.0
def scaled(c, a): return tuple(int(max(0, min(255, v * a))) for v in c)

def new_layer():
    im = Image.new("RGB", (W, H), (0, 0, 0))
    return im, ImageDraw.Draw(im)

def vgrad(top, bot, y0=0, y1=H, power=1.0):
    t = np.clip((yy - y0) / (y1 - y0), 0, 1) ** power
    return lerp(col(top), col(bot), t[..., None])

def glow(img, cx, cy, rx, ry, color, strength=1.0, power=2.0):
    d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    img += (np.clip(1 - d, 0, 1) ** power * strength)[..., None] * col(color)

def finish(img, name, exposure=1.3, vig=0.6, grain=0.010, seed=0):
    img = 1 - np.exp(-np.maximum(img, 0) * exposure)                       # 柔和曝光
    r = np.sqrt(((xx - CX) / CX) ** 2 + ((yy - CY) / CY) ** 2)
    img *= (1 - vig * np.clip(r - 0.35, 0, 1) ** 1.6)[..., None]           # 暗角
    noise = np.random.default_rng(seed).normal(0, grain, (H, W, 1)).astype(np.float32)
    img = np.clip(img + noise, 0, 1)                                       # 胶片颗粒
    Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(f"{OUT}/{name}.png", optimize=True)
    print("saved", name)

# ---------- 时空隧道 ----------
def tunnel():
    rng = np.random.default_rng(3)
    cx, cy = CX, H * 0.47
    img = canvas()
    img += vgrad((1, 2, 8), (3, 4, 14), 0, H)
    glow(img, cx, cy, 1200, 800, (30, 50, 190), 0.35, 2.4)

    im, d = new_layer()
    N, r = 40, 0.865
    for k in range(N):
        s = r ** k
        ang = np.deg2rad(k * 1.6)
        hw, hh = W * 0.80 * s, H * 0.80 * s
        pts = [(cx + x * np.cos(ang) - y * np.sin(ang), cy + x * np.sin(ang) + y * np.cos(ang))
               for x, y in [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]]
        t = k / (N - 1)
        c = lerp(col((50, 100, 255)), col((255, 200, 120)), t ** 2.2) * 255
        a = 0.10 + 0.9 * t ** 1.3
        d.line(pts + [pts[0]], fill=scaled(c, a), width=3 if k < 20 else 2)

    im2, d2 = new_layer()
    for _ in range(420):
        th, r0 = rng.uniform(0, 2 * np.pi), rng.uniform(60, 1300)
        ln = r0 * rng.uniform(0.04, 0.12)
        p = (cx + np.cos(th) * r0, cy + np.sin(th) * r0 * 0.75)
        q = (cx + np.cos(th) * (r0 + ln), cy + np.sin(th) * (r0 + ln) * 0.75)
        d2.line([p, q], fill=scaled((140, 190, 255), rng.uniform(0.15, 0.7) * (r0 / 1300) ** 0.5), width=1)

    L, S = to_arr(im), to_arr(im2)
    img += L * 0.55 + blur(L, 3) * 0.7 + blur(L, 14) * 0.35 + S * 0.45 + blur(S, 2) * 0.5
    finish(img, "bg3_time_tunnel", exposure=1.0, vig=0.75, seed=3)

if __name__ == "__main__":
    tunnel()
