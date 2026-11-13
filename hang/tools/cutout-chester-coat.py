"""コート写真の背景を取り除き、背景透過の画像にする（ハンガーとフックは残す）。"""
import sys
import cv2
import numpy as np
from PIL import Image

src, out_png, out_webp = sys.argv[1], sys.argv[2], sys.argv[3]
img = cv2.cvtColor(np.array(Image.open(src).convert('RGB')), cv2.COLOR_RGB2BGR)
H, W = img.shape[:2]
lum = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# ---- 1. GrabCut（コート本体とハンガー） ----
# 手でなぞったコートの輪郭（元画像の座標）。この線の内側は確実にコート、外側は確実に背景とし、
# 線の近く（±BAND px）だけを GrabCut に判定させる（背景の光とコートの色が近いため）
OUTLINE = [
    (430, 150), (470, 112), (540, 106), (590, 140), (615, 150), (690, 200), (752, 252), (800, 300), (815, 360),
    (840, 480), (862, 600), (885, 750), (900, 900), (908, 1035), (860, 1045), (800, 1042), (805, 1100), (810, 1300),
    (812, 1507), (500, 1512), (188, 1507), (195, 1300), (205, 1100), (215, 1045), (165, 1045), (117, 1042), (122, 900),
    (135, 750), (150, 600), (170, 480), (195, 360), (215, 300), (245, 262), (330, 205), (395, 160),
]
BAND = 30
poly = np.zeros((H, W), np.uint8)
cv2.fillPoly(poly, [np.array(OUTLINE, np.int32)], 255)
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * BAND + 1, 2 * BAND + 1))
inner = cv2.erode(poly, k)
outer = cv2.dilate(poly, k)
mask = np.full((H, W), cv2.GC_BGD, np.uint8)
mask[outer > 0] = cv2.GC_PR_BGD
mask[poly > 0] = cv2.GC_PR_FGD
mask[inner > 0] = cv2.GC_FGD
mask[lum < 30] = cv2.GC_BGD
mask[1516:, :] = cv2.GC_BGD  # 裾より下（背景の光）
bgd = np.zeros((1, 65), np.float64)
fgd = np.zeros((1, 65), np.float64)
cv2.grabCut(img, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
body = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

# いちばん大きい塊だけを残し、内側の穴を埋める
n, labels, stats, _ = cv2.connectedComponentsWithStats(body)
if n > 1:
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    body = np.where(labels == big, 255, 0).astype(np.uint8)
inv = cv2.bitwise_not(body)
cv2.floodFill(inv, None, (0, 0), 0)
body = cv2.bitwise_or(body, inv)
body = cv2.morphologyEx(body, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

# ---- 2. フック（背景との差で取り出す。上部の細い金属） ----
top = 118
region = img[:top].astype(np.float32)
bgest = cv2.blur(cv2.medianBlur(img[:top], 21), (15, 15)).astype(np.float32)
diff = np.abs(region - bgest).max(axis=2)
hook = np.zeros((H, W), np.uint8)
hm = (diff > 13).astype(np.uint8) * 255
hm[:, :430] = 0
hm[:, 600:] = 0
# 細い線として連続している部分だけ（ノイズを除く）
n2, lab2, st2, _ = cv2.connectedComponentsWithStats(hm)
keep = np.zeros_like(hm)
for i in range(1, n2):
    if st2[i, cv2.CC_STAT_AREA] >= 40:
        keep[lab2 == i] = 255
keep = cv2.dilate(keep, np.ones((2, 2), np.uint8))
hook[:top] = keep
alpha = cv2.bitwise_or(body, hook)

# ---- 3. 縁をなめらかに（1px程度） ----
soft = cv2.GaussianBlur(alpha, (3, 3), 0.8)
rgba = np.dstack([cv2.cvtColor(img, cv2.COLOR_BGR2RGB), soft])

# ---- 4. 余白を切り詰める ----
ys, xs = np.where(soft > 8)
m = 6
y0, y1 = max(0, ys.min() - m), min(H, ys.max() + m + 1)
x0, x1 = max(0, xs.min() - m), min(W, xs.max() + m + 1)
crop = rgba[y0:y1, x0:x1]
out = Image.fromarray(crop, 'RGBA')
out.save(out_png, optimize=True)
out.save(out_webp, quality=88, method=6)

# フックの頂点（いちばん上の不透明な点）を、切り抜き後の座標で出力
hy, hx = np.where(crop[:, :, 3] > 100)
t = hy.min()
tx = int(np.median(hx[hy <= t + 2]))
print(f'crop=({x0},{y0})-({x1},{y1}) size={out.size} hookTop=({tx},{t}) anchor=({tx / out.size[0]:.4f},{t / out.size[1]:.4f}) aspect={out.size[0] / out.size[1]:.4f}')
