// ラックの見た目と動きの計算（画面に依存しない純粋な関数）。
// 位置 p は「何着目が中央にあるか」を小数で表す（0 = 1着目が中央）。

export interface Layout {
  /** ステージの幅・高さ（px） */
  width: number;
  height: number;
  /** レール（フックの頂点が掛かる線）の y */
  railY: number;
  /** 標準の服の高さ（px）。各服は product.scale 倍 */
  garmentH: number;
  /** 隣の服との間隔（服の幅より狭く、少し重なる） */
  spacing: number;
  /** フックの長さ・ハンガーのバーまでの高さ */
  hookLen: number;
  barDrop: number;
  /** 選んだ服を手前に出したときの位置・大きさ */
  frontX: number;
  frontY: number;
  frontScale: number;
  /** 選んだ服の左右を開く量 */
  spread: number;
  /** 狭い画面（詳細は下に表示） */
  narrow: boolean;
}

export interface LayoutInput {
  width: number;
  height: number;
  /** 詳細パネルの幅（横に出す場合）。0 なら下に出す */
  panelWidth: number;
  /** 下に出す詳細シートの上端（ステージ上端からの距離）。横に出す場合は null */
  sheetTop: number | null;
  reducedMotion: boolean;
}

export const GARMENT_ASPECT = 2 / 3;

export function computeLayout(i: LayoutInput): Layout {
  const narrow = i.panelWidth === 0;
  const topRail = Math.round(Math.max(28, Math.min(i.height * 0.1, 64)));
  // 服の大きさ：画面の高さと幅の両方に収まるように（中央の服が見やすく、左右にも次の服が見える）
  const byHeight = (i.height - topRail) * (narrow ? 0.66 : 0.72);
  const byWidth = i.width * (narrow ? 0.6 : 0.42);
  const garmentH = Math.round(Math.max(180, Math.min(byHeight, byWidth / GARMENT_ASPECT, 620)));
  // 縦長の画面では、ラックが画面の中心に来るようにレールを下げる（下の操作ボタンの分は空ける）
  const railY = narrow
    ? Math.round(Math.max(topRail, Math.min((i.height - 130 - garmentH * 1.18) / 2, i.height * 0.3)))
    : topRail;
  const w0 = garmentH * GARMENT_ASPECT;
  const hookLen = Math.max(16, Math.round(garmentH * 0.075));
  const barDrop = Math.max(8, Math.round(garmentH * 0.035));
  const spacing = Math.round(w0 * (narrow ? 0.58 : 0.56));
  const totalH = hookLen + barDrop + garmentH * 1.12; // フックから、丈の長い服の裾まで

  let frontX = 0;
  let frontY = Math.round(garmentH * 0.06);
  let frontScale = i.reducedMotion ? 1.04 : 1.12;
  if (!narrow) {
    // 横に詳細パネル：残りの領域の中央へ
    frontX = -Math.round(i.panelWidth / 2);
    const fit = (i.height - railY - frontY - 12) / totalH;
    frontScale = Math.min(frontScale, Math.max(0.8, fit));
  } else if (i.sheetTop !== null) {
    // 下に詳細シート：シートの上に収まるよう、少し上へ上げて縮める
    const top = 10;
    const avail = Math.max(120, i.sheetTop - top - 8);
    frontScale = Math.max(0.5, Math.min(frontScale, avail / totalH));
    frontY = top - railY;
  }
  return {
    width: i.width,
    height: i.height,
    railY,
    garmentH,
    spacing,
    hookLen,
    barDrop,
    frontX,
    frontY,
    frontScale,
    spread: Math.round(w0 * (narrow ? 0.42 : 0.5)),
    narrow,
  };
}

export interface Pose {
  x: number;
  y: number;
  rotY: number;
  scale: number;
  opacity: number;
  z: number;
  /** 影（壁に落ちる影）の濃さ・広がり・ずれ */
  shadowOpacity: number;
  shadowScale: number;
  shadowY: number;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 1着分の姿勢。
 * d: 中央からの距離（着数）、s: 手前に出ている量（0〜1）、offset: 左右に開く量（px）、dim: ほかの服を控えめにする量（0〜1）
 */
export function itemPose(d: number, s: number, offset: number, dim: number, L: Layout, reduced: boolean): Pose {
  const ad = Math.abs(d);
  const turn = reduced ? 8 : 15;
  const baseX = d * L.spacing + offset;
  const baseRot = clamp(d * turn, -45, 45);
  // 選んでいる間、ほかの服は少し奥へ下がる
  const baseScale = (1 - Math.min(ad, 3) * 0.055) * (1 - 0.06 * dim * (1 - s));
  const fade = ad > 3.4 ? clamp(1 - (ad - 3.4) * 0.9, 0, 1) : 1;
  const opacityBase = fade * (1 - 0.42 * dim * (1 - s));
  return {
    x: mix(baseX, L.frontX, s),
    y: mix(0, L.frontY, s),
    rotY: mix(baseRot, 0, s),
    scale: mix(baseScale, L.frontScale, s),
    opacity: mix(opacityBase, 1, s),
    z: Math.round(1000 - ad * 100 + s * 3000),
    shadowOpacity: mix(0.32 - Math.min(ad, 3) * 0.05, 0.22, s),
    shadowScale: mix(1, 1.35, s),
    shadowY: mix(0, L.garmentH * 0.08, s),
  };
}

/** 指を離した後に収まる位置（速度で少し先まで進み、近くの服に収まる） */
export function projectTarget(p: number, v: number, n: number): number {
  const ahead = p + clamp(v * 0.2, -3, 3);
  return clamp(Math.round(ahead), 0, n - 1);
}

/** 端より先へ引っ張ったときの抵抗 */
export function rubberBand(p: number, n: number): number {
  if (p < 0) return p * 0.32;
  if (p > n - 1) return n - 1 + (p - (n - 1)) * 0.32;
  return p;
}

/** ばね（臨界減衰に近い設定で使う）。安定のため小さな刻みで進める */
export function stepSpring(x: number, v: number, target: number, k: number, c: number, dt: number): [number, number] {
  let xx = x;
  let vv = v;
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = k * (target - xx) - c * vv;
    vv += a * h;
    xx += vv * h;
  }
  return [xx, vv];
}

export const settled = (x: number, v: number, target: number, eps = 0.001) => Math.abs(target - x) < eps && Math.abs(v) < eps * 4;

// ---------- コーデラック ----------

export type CoordResult = 'added' | 'duplicate' | 'full';

export function addToCoord(list: readonly string[], id: string, limit: number): { list: string[]; result: CoordResult } {
  if (list.includes(id)) return { list: [...list], result: 'duplicate' };
  if (list.length >= limit) return { list: [...list], result: 'full' };
  return { list: [...list, id], result: 'added' };
}

export function removeFromCoord(list: readonly string[], id: string): string[] {
  return list.filter((x) => x !== id);
}

/** 保存データの検証（知らないID・重複・上限超えを取り除く） */
export function sanitizeCoord(raw: unknown, validIds: readonly string[], limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && validIds.includes(v) && !out.includes(v)) out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}
