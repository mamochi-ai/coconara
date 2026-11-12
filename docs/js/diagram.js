// バッグの模式図。描画命令（path / rect / text）の配列を作り、
// SVG（画面）と Canvas（PNG書き出し）の両方で同じ内容を描く。
import { evaluateDims, diffOrders, colorOf, colorLabel, fmt } from './model.js';

export const PALETTE = {
  paper: '#FFFDF8',
  line: '#33312E',
  dim: '#5A5753',
  text: '#2B2926',
  muted: '#77736C',
  change: '#D9690B',
  changeBg: '#FFF1E3',
  hl: '#1F5FBF',
  hlBg: '#E4EDFB',
  handle: '#4A4743',
  hatch: '#B9B2A5',
  divider: '#E2DCCF',
};

export const FONT_FAMILY =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Noto Sans JP", "Yu Gothic", "Meiryo", "IPAGothic", sans-serif';

/** 文字幅の見積もり（配置計算用。全角=1em、半角=0.6em） */
export function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) w += /[\x20-\x7e]/.test(ch) ? size * 0.6 : size;
  return w;
}

const PLACEHOLDER = { height: 300, mouthWidth: 400, gusset: 100, handleHeight: 150 };

/** 図形用の寸法（cm）。未入力・不正な箇所は仮の値で形だけ作り、unknown として扱う。 */
export function geometry(order) {
  const ev = evaluateDims(order.dims);
  const known = (k) => ev[k].status === 'ok';
  let W = known('mouthWidth') ? ev.mouthWidth.value : PLACEHOLDER.mouthWidth;
  let G = known('gusset') ? ev.gusset.value : Math.min(PLACEHOLDER.gusset, Math.round(W * 0.25));
  if (!known('mouthWidth') && known('gusset') && G >= W) W = G + 100;
  if (G >= W) G = Math.round(W * 0.25);
  const H = known('height') ? ev.height.value : PLACEHOLDER.height;
  const Hh = known('handleHeight') ? ev.handleHeight.value : PLACEHOLDER.handleHeight;
  return {
    ev,
    cm: { H: H / 10, W: W / 10, G: G / 10, B: (W - G) / 10, Hh: Hh / 10 },
    order,
  };
}

// ---------- 描画命令 ----------
const P = {
  hatch: (clip, x, y, w, h, o = {}) => ({ t: 'hatch', clip, x, y, w, h, step: 7, stroke: PALETTE.hatch, width: 1, ...o }),
  path: (d, o = {}) => ({ t: 'path', d, ...o }),
  rect: (x, y, w, h, o = {}) => ({ t: 'rect', x, y, w, h, ...o }),
  text: (x, y, text, o = {}) => ({ t: 'text', x, y, text: String(text), size: 13, weight: 400, fill: PALETTE.text, anchor: 'start', ...o }),
};
const n = (v) => Math.round(v * 10) / 10;

function styleFor(st) {
  if (st.highlight) return { stroke: PALETTE.hl, width: 2.4, color: st.changed ? PALETTE.change : PALETTE.hl, bg: PALETTE.hlBg, border: PALETTE.hl };
  if (st.changed) return { stroke: PALETTE.change, width: 2.2, color: PALETTE.change, bg: PALETTE.changeBg, border: PALETTE.change };
  return { stroke: PALETTE.dim, width: 1.2, color: PALETTE.text, bg: PALETTE.paper, border: null };
}

function valueText(evd, opts = {}) {
  if (evd.status === 'ok') return `${fmt(evd.value)}cm${opts.auto ? '（自動）' : ''}`;
  if (evd.status === 'invalid') return '！値を確認';
  return '？cm';
}
function suffix(st, evd) {
  if (evd.status === 'empty') return '（未入力）';
  if (st.changed) return '（変更）';
  return '';
}

/** 複数行ラベル。anchor: start|middle|end。(x,y) は中心の高さ。 */
function label(items, x, y, lines, anchor, sty) {
  const size = 12.5;
  const lh = 16;
  const w = Math.max(...lines.map((l) => textWidth(l.text, l.size || size))) + 8;
  const h = lines.length * lh + 4;
  const left = anchor === 'start' ? x - 4 : anchor === 'end' ? x - w + 4 : x - w / 2;
  items.push(P.rect(n(left), n(y - h / 2), n(w), h, { fill: sty.bg, stroke: sty.border, width: sty.border ? 1 : 0, r: 4 }));
  lines.forEach((l, i) => {
    items.push(P.text(n(x), n(y - h / 2 + 2 + lh * i + lh / 2), l.text, {
      anchor, size: l.size || size, weight: l.bold ? 700 : 400, fill: l.color || sty.color,
    }));
  });
}

function tick(items, x, y, vertical, sty) {
  const d = vertical ? `M${n(x - 5)} ${n(y)}H${n(x + 5)}` : `M${n(x)} ${n(y - 5)}V${n(y + 5)}`;
  items.push(P.path(d, { stroke: sty.stroke, width: sty.width }));
}

/** 水平寸法線。xa..xb、y。extFrom: 各端の引出線の始点y。 */
function hDim(items, xa, xb, y, extA, extB, name, evd, st, labelAbove, opts) {
  const sty = styleFor(st);
  const dash = evd.status === 'ok' ? null : [4, 3];
  const ext = { stroke: sty.stroke, width: 0.8, dash: [2, 2] };
  items.push(P.path(`M${n(xa)} ${n(extA)}V${n(y + (labelAbove ? -4 : 4))}`, ext));
  items.push(P.path(`M${n(xb)} ${n(extB)}V${n(y + (labelAbove ? -4 : 4))}`, ext));
  items.push(P.path(`M${n(xa)} ${n(y)}H${n(xb)}`, { stroke: sty.stroke, width: sty.width, dash }));
  tick(items, xa, y, false, sty);
  tick(items, xb, y, false, sty);
  const txt = `${name} ${valueText(evd, opts)}${suffix(st, evd)}`;
  label(items, (xa + xb) / 2, y + (labelAbove ? -14 : 15), [{ text: txt, bold: st.changed || st.highlight }], 'middle', sty);
}

/** 垂直寸法線。ya(上)..yb(下)。side: 'left'|'right'（ラベルの位置） */
function vDim(items, x, ya, yb, extA, extB, name, evd, st, side) {
  const sty = styleFor(st);
  const dash = evd.status === 'ok' ? null : [4, 3];
  const ext = { stroke: sty.stroke, width: 0.8, dash: [2, 2] };
  const toward = side === 'left' ? -4 : 4;
  if (extA !== null) items.push(P.path(`M${n(extA)} ${n(ya)}H${n(x + toward)}`, ext));
  if (extB !== null) items.push(P.path(`M${n(extB)} ${n(yb)}H${n(x + toward)}`, ext));
  items.push(P.path(`M${n(x)} ${n(ya)}V${n(yb)}`, { stroke: sty.stroke, width: sty.width, dash }));
  tick(items, x, ya, true, sty);
  tick(items, x, yb, true, sty);
  const lines = [{ text: name, size: 12 }, { text: valueText(evd), bold: st.changed || st.highlight }];
  const suf = suffix(st, evd);
  if (suf) lines.push({ text: suf, size: 11.5 });
  const lx = side === 'left' ? x - 9 : x + 9;
  label(items, lx, (ya + yb) / 2, lines, side === 'left' ? 'end' : 'start', sty);
}

// ---------- 色 ----------
// 素材色は変更の有無にかかわらず同じ色で描く。変更の強調は寸法線・ラベル・外側の囲みだけに使う。

function hexLum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 1;
  const v = parseInt(m[1], 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
/** 塗りの上に描く線・文字の色（濃い色の上では明るい色） */
export function contrastOn(fill) {
  return fill && hexLum(fill) < 0.18 ? '#F2EEE6' : PALETTE.line;
}
/** 指定された色の塗り。未定なら null（塗らずにハッチングで示す） */
function fillFor(colorKey) {
  const c = colorOf(colorKey);
  return c ? c.hex : null;
}

/** 外側の囲み（変更の強調）。部品そのものは塗らない */
function changeFrame(items, x, y, w, h, pad = 6) {
  items.push(P.rect(n(x - pad), n(y - pad), n(w + pad * 2), n(h + pad * 2), { stroke: PALETTE.change, width: 2.2, dash: [7, 4], r: 6 }));
}

// レイアウト定数
const FRONT = { left: 100, right: 100, top: 66, bottom: 100 };
const SIDE = { left: 100, right: 28, top: 40, bottom: 58 };
const INTERIOR_H = 222;
const HEAD_H = 40;

/** 正面図。yBottom（底の位置）を基準に描く。 */
function drawFront(items, g, cx, yBottom, s, st, x0, rowTop) {
  const { H, W, B, Hh } = g.cm;
  const ev = g.ev;
  const yMouth = yBottom - H * s;
  const yApex = yMouth - Hh * s;
  const halfW = (W * s) / 2;
  const halfB = (B * s) / 2;
  const bodyUnknown = ['height', 'mouthWidth', 'gusset'].some((k) => ev[k].status !== 'ok');
  items.push(P.text(x0 + 6, rowTop + 12, '正面図', { size: 13, weight: 700, fill: PALETTE.muted }));

  // 持ち手：色の指定がないため、中空の帯で中立的に描く（変更があっても色を変えない）
  const a = Math.max(halfW * 0.5, 4);
  const hh = Hh * s;
  const r = Math.min(a, hh) * 0.7;
  const hDash = ev.handleHeight.status !== 'ok' ? [7, 5] : null;
  const hd = `M${n(cx - a)} ${n(yMouth)}V${n(yApex + r)}Q${n(cx - a)} ${n(yApex)} ${n(cx - a + r)} ${n(yApex)}H${n(cx + a - r)}Q${n(cx + a)} ${n(yApex)} ${n(cx + a)} ${n(yApex + r)}V${n(yMouth)}`;
  items.push(P.path(hd, { stroke: PALETTE.handle, width: 6, dash: hDash, cap: 'butt' }));
  items.push(P.path(hd, { stroke: PALETTE.paper, width: 2.6, dash: hDash, cap: 'butt' }));

  // 本体（台形：上＝袋口幅、下＝底幅）
  const bd = `M${n(cx - halfW)} ${n(yMouth)}H${n(cx + halfW)}L${n(cx + halfB)} ${n(yBottom)}H${n(cx - halfB)}Z`;
  const fill = fillFor(g.order.outerColor);
  if (fill) items.push(P.path(bd, { fill }));
  else items.push(P.hatch(bd, cx - halfW, yMouth, halfW * 2, yBottom - yMouth));
  items.push(P.path(bd, { stroke: PALETTE.line, width: 2, dash: bodyUnknown ? [7, 5] : null, join: 'round' }));
  // 袋口の線（濃い色の上でも見えるように）
  items.push(P.path(`M${n(cx - halfW + 3)} ${n(yMouth + 4)}H${n(cx + halfW - 3)}`, { stroke: contrastOn(fill), width: 1, dash: [3, 3] }));

  // 寸法線（ラベルは図の外側に置き、引出線でつなぐ）
  hDim(items, cx - halfW, cx + halfW, rowTop + 44, yMouth - 4, yMouth - 4, '袋口幅', ev.mouthWidth, st('mouthWidth'), true);
  hDim(items, cx - halfB, cx + halfB, yBottom + 20, yBottom + 4, yBottom + 4, '底幅', ev.bottomWidth, st('bottomWidth'), false, { auto: true });
  vDim(items, cx - halfW - 22, yMouth, yBottom, cx - halfW - 4, cx - halfB - 4, '本体高さ', ev.height, st('height'), 'left');
  vDim(items, cx + halfW + 22, yApex, yMouth, cx + a + 4, null, '持ち手高さ', ev.handleHeight, st('handleHeight'), 'right');

  // 表地の色（色名を必ず文字で。底幅ラベルと接しないよう間隔をあける）
  const oc = st('outerColor');
  const sty = styleFor(oc);
  const known = !!fill;
  const t = `表地：${colorLabel(g.order.outerColor)}${oc.changed ? '（変更）' : ''}`;
  const sw = 14;
  const tw = textWidth(t, 12.5);
  const lx = cx - (tw + sw + 6) / 2;
  const ly = yBottom + 72;
  items.push(P.rect(n(lx - 5), ly - 12, n(tw + sw + 16), 24, { fill: sty.bg, stroke: sty.border, width: sty.border ? 1.4 : 0, r: 4 }));
  if (known) items.push(P.rect(n(lx), ly - 7, sw, sw, { fill, stroke: PALETTE.line, width: 1 }));
  else {
    const sq = `M${n(lx)} ${ly - 7}h${sw}v${sw}h-${sw}Z`;
    items.push(P.hatch(sq, lx, ly - 7, sw, sw, { step: 4 }));
    items.push(P.path(sq, { stroke: PALETTE.line, width: 1, dash: [2, 2] }));
  }
  items.push(P.text(n(lx + sw + 6), ly, t, { size: 12.5, fill: sty.color, weight: oc.changed ? 700 : 400 }));
}

/** 側面図 */
function drawSide(items, g, cx, yBottom, s, st, x0, rowTop) {
  const { H, G } = g.cm;
  const ev = g.ev;
  const yMouth = yBottom - H * s;
  const halfG = (G * s) / 2;
  const top = Math.min(halfG, 2);
  const unknown = ev.height.status !== 'ok' || ev.gusset.status !== 'ok';
  items.push(P.text(x0 + 6, rowTop + 12, '側面図', { size: 13, weight: 700, fill: PALETTE.muted }));
  const d = `M${n(cx - top)} ${n(yMouth)}H${n(cx + top)}L${n(cx + halfG)} ${n(yBottom)}H${n(cx - halfG)}Z`;
  const fill = fillFor(g.order.outerColor);
  if (fill) items.push(P.path(d, { fill }));
  else items.push(P.hatch(d, cx - halfG, yMouth, halfG * 2, yBottom - yMouth));
  items.push(P.path(d, { stroke: PALETTE.line, width: 2, dash: unknown ? [7, 5] : null, join: 'round' }));
  vDim(items, cx - Math.max(halfG, 2) - 22, yMouth, yBottom, cx - top - 4, cx - halfG - 4, '本体高さ', ev.height, st('height'), 'left');
  hDim(items, cx - halfG, cx + halfG, yBottom + 20, yBottom + 4, yBottom + 4, 'マチ', ev.gusset, st('gusset'), false);
}

/** 内側の模式図（縮尺なし） */
function drawInterior(items, order, cx, y0, st, x0) {
  items.push(P.text(x0 + 6, y0 + 12, '内側図（縮尺なし）', { size: 13, weight: 700, fill: PALETTE.muted }));
  const pw = 200;
  const ph = 96;
  const px = cx - pw / 2;
  const py = y0 + 60;
  const liningChanged = st('lining').changed || st('liningColor').changed;
  const lsty = styleFor({ changed: liningChanged });
  let lText;
  let fill = null;
  let dash = null;
  if (order.lining === 'yes') {
    const lc = colorOf(order.liningColor);
    lText = lc ? `裏地：あり〈${lc.label}〉` : '裏地：あり〈色は未定〉';
    fill = lc ? lc.hex : null;
    if (!lc) dash = [5, 4];
  } else if (order.lining === 'none') {
    lText = '裏地：なし（表地の裏側）';
    fill = fillFor(order.outerColor);
  } else {
    lText = '裏地：未定';
    dash = [5, 4];
  }
  if (liningChanged) lText += '（変更）';
  label(items, cx, y0 + 36, [{ text: lText, bold: liningChanged }], 'middle', lsty);
  const panel = `M${px} ${py}h${pw}v${ph}h-${pw}Z`;
  if (fill) items.push(P.path(panel, { fill }));
  else items.push(P.hatch(panel, px, py, pw, ph));
  items.push(P.path(panel, { stroke: PALETTE.line, width: 1.6, dash }));
  items.push(P.path(`M${px} ${py}H${px + pw}`, { stroke: PALETTE.line, width: 3 }));
  items.push(P.text(px + pw + 13, py, '袋口', { size: 11, fill: PALETTE.muted }));
  if (liningChanged) changeFrame(items, px, py, pw, ph, 7);

  // ポケット：色・大きさの指定がないため、塗らずに輪郭と斜線で示す
  const pk = order.pocket;
  const pChanged = st('pocket').changed;
  const qw = 72;
  const qh = 40;
  const qx = cx - qw / 2;
  const qy = py + ph / 2 - qh / 2;
  const ink = contrastOn(fill);
  if (pk === 'yes' || pk === 'undecided') {
    const q = `M${n(qx)} ${n(qy)}h${qw}v${qh}h-${qw}Z`;
    if (pk === 'yes') items.push(P.hatch(q, qx, qy, qw, qh, { stroke: ink, width: 0.9, step: 6 }));
    items.push(P.path(q, { stroke: ink, width: 1.6, dash: pk === 'undecided' ? [4, 3] : [6, 2] }));
    if (pk === 'undecided') items.push(P.text(cx, qy + qh / 2, '？', { anchor: 'middle', size: 14, weight: 700, fill: ink }));
  }
  if (pChanged) changeFrame(items, qx, qy, qw, qh, 4);
  const psty = styleFor({ changed: pChanged });
  const ch = pChanged ? '（変更）' : '';
  const lines = pk === 'yes'
    ? [{ text: `内ポケット：あり${ch}`, bold: true }, { text: '片面中央に1個・色と大きさは未指定', size: 11.5 }]
    : pk === 'none'
      ? [{ text: `内ポケット：なし${ch}`, bold: !!ch }]
      : [{ text: `内ポケット：未定${ch}`, bold: !!ch }];
  label(items, cx, py + ph + 14 + lines.length * 8, lines, 'middle', psty);
}

// ---------- 縮尺・配置 ----------

function fitScale(geoms, frontW, sideW, maxH, cap) {
  let s = cap;
  for (const g of geoms) {
    const { W, G, H, Hh } = g.cm;
    s = Math.min(s, frontW / W, maxH / (H + Hh));
    if (G > 0) s = Math.min(s, sideW / G);
  }
  return s;
}

export function stateFn(changes, highlight) {
  const set = new Set(changes);
  return (key) => ({ changed: set.has(key), highlight: highlight === key });
}
const NONE = stateFn([], null);

const NARROW_W = 420;
const COL_W = 390;

/** 図の下に添える注記（対象を明示） */
function footnote(compare, parts) {
  const a = [];
  if (compare && (parts.front || parts.side)) {
    const what = [parts.front && '正面図', parts.side && '側面図'].filter(Boolean).join('・');
    a.push(`${what}の変更前後は共通縮尺`);
  } else if (parts.front && parts.side) a.push('正面図と側面図は共通縮尺');
  if (parts.interior) a.push('内側図は縮尺なし');
  const line1 = a.join('。');
  const line2 = parts.interior ? '持ち手・ポケットの色はこの図では指定していません' : (parts.front ? '持ち手の色はこの図では指定していません' : '');
  return [line1, line2].filter(Boolean);
}

/**
 * 図をまとめて組み立てる。
 * cols: [{order, title?, st}]（1列＝現在の内容、2列＝変更前・変更後）
 * opts: {front, side, interior, narrow, footnote}
 * 縮尺は表示する図の種類によらず同じ式で決めるため、お客様用・作家用で図の大きさの関係が変わらない。
 */
export function buildFigure(cols, opts = {}) {
  const parts = { front: opts.front !== false, side: opts.side !== false, interior: opts.interior !== false };
  const geoms = cols.map((c) => geometry(c.order));
  const two = cols.length === 2;
  const narrow = !!opts.narrow;
  const items = [];
  let width;
  let s;
  if (narrow) {
    width = NARROW_W;
    s = fitScale(geoms, NARROW_W - FRONT.left - FRONT.right, NARROW_W - SIDE.left - SIDE.right, 260, 8);
  } else if (two) {
    width = COL_W * 2;
    s = fitScale(geoms, COL_W - FRONT.left - FRONT.right, COL_W - SIDE.left - SIDE.right - 60, 280, 8);
  } else {
    width = parts.front && parts.side ? 760 : 520;
    s = fitScale(geoms, 300, 132, 300, 10);
  }
  const bodyMax = Math.max(...geoms.map((g) => (g.cm.H + g.cm.Hh) * s));
  const sideMax = Math.max(...geoms.map((g) => g.cm.H * s));
  const header = (x, y, w, title, i) => {
    items.push(P.rect(x + 6, y + 2, w - 12, 28, { fill: i ? PALETTE.changeBg : '#F1EEE7', stroke: i ? PALETTE.change : '#CFC8BA', width: 1, r: 5 }));
    items.push(P.text(x + w / 2, y + 16, title, { anchor: 'middle', size: 14, weight: 700, fill: i ? PALETTE.change : PALETTE.text }));
  };
  const sep = (y, x1 = 10, x2 = width - 10) => items.push(P.path(`M${x1} ${n(y)}H${x2}`, { stroke: PALETTE.divider, width: 1 }));
  let y = 0;

  if (narrow || !two) {
    // 縦積み（狭い画面）または1列
    const w = narrow ? NARROW_W : width;
    cols.forEach((c, i) => {
      const g = geoms[i];
      const st = c.st || NONE;
      if (c.title) { header(0, y, w, c.title, i); y += HEAD_H; }
      let blockStart = true;
      if (parts.front) {
        const yBottom = y + FRONT.top + bodyMax;
        const frontW = !narrow && parts.side ? 500 : w;
        drawFront(items, g, FRONT.left + (frontW - FRONT.left - FRONT.right) / 2, yBottom, s, st, 0, y);
        if (!narrow && parts.side) {
          drawSide(items, g, 500 + SIDE.left + (260 - SIDE.left - SIDE.right) / 2, yBottom, s, st, 500, y);
        }
        y = yBottom + FRONT.bottom;
        blockStart = false;
      }
      if (parts.side && (narrow || !parts.front)) {
        if (!blockStart) sep(y - 6);
        const yBottom = y + SIDE.top + sideMax;
        drawSide(items, g, SIDE.left + (Math.min(w, 420) - SIDE.left - SIDE.right) / 2, yBottom, s, st, 0, y);
        y = yBottom + SIDE.bottom;
        blockStart = false;
      }
      if (parts.interior) {
        if (!blockStart) sep(y - 6);
        drawInterior(items, c.order, w / 2, y, st, 0);
        y += INTERIOR_H;
      }
      y += 8;
    });
  } else {
    // 2列（変更前・変更後）。行ごとに底の位置をそろえる
    cols.forEach((c, i) => c.title && header(i * COL_W, 0, COL_W, c.title, i));
    y = cols.some((c) => c.title) ? HEAD_H : 4;
    const top = y;
    const frontCx = FRONT.left + (COL_W - FRONT.left - FRONT.right) / 2;
    const sideCx = SIDE.left + 70;
    let first = true;
    if (parts.front) {
      const yBottom = y + FRONT.top + bodyMax;
      cols.forEach((c, i) => drawFront(items, geoms[i], i * COL_W + frontCx, yBottom, s, c.st || NONE, i * COL_W, y));
      y = yBottom + FRONT.bottom;
      first = false;
    }
    if (parts.side) {
      if (!first) sep(y - 6);
      const yBottom = y + SIDE.top + sideMax;
      cols.forEach((c, i) => drawSide(items, geoms[i], i * COL_W + sideCx, yBottom, s, c.st || NONE, i * COL_W, y));
      y = yBottom + SIDE.bottom;
      first = false;
    }
    if (parts.interior) {
      if (!first) sep(y - 6);
      cols.forEach((c, i) => drawInterior(items, c.order, i * COL_W + COL_W / 2, y, c.st || NONE, i * COL_W));
      y += INTERIOR_H;
    }
    items.push(P.path(`M${COL_W} ${top}V${n(y - 6)}`, { stroke: PALETTE.divider, width: 1 }));
    y += 6;
  }

  if (opts.footnote !== false) {
    for (const t of footnote(two, parts)) {
      items.push(P.text(width / 2, y + 6, t, { anchor: 'middle', size: 12, fill: PALETTE.muted }));
      y += 18;
    }
  }
  return { width, height: Math.ceil(y + 8), items, scale: s };
}

/** 1案の図（画面表示用）。opts.baseline があれば変更箇所を示す。 */
export function buildScene(order, opts = {}) {
  const changes = opts.baseline ? diffOrders(opts.baseline, order).map((c) => c.key) : [];
  const sc = buildFigure([{ order, st: stateFn(changes, opts.highlight) }], {
    side: opts.side !== false, interior: !opts.compact && opts.interior !== false, narrow: opts.narrow, front: opts.front,
    footnote: opts.footnote,
  });
  return { ...sc, changes };
}

/** 変更前・変更後を同じ縮尺で並べた図 */
export function buildCompareScene(before, after, opts = {}) {
  const changes = diffOrders(before, after).map((c) => c.key);
  const sc = buildFigure([
    { order: before, title: opts.beforeTitle || '変更前', st: NONE },
    { order: after, title: opts.afterTitle || '変更後', st: stateFn(changes, opts.highlight) },
  ], { front: opts.front, side: opts.side, interior: opts.interior, narrow: opts.narrow, footnote: opts.footnote });
  return { ...sc, changes };
}

// ---------- レンダラー ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 斜線（x + y = t の線）を矩形内に収めたパス */
function hatchPath(x, y, w, h, step) {
  let d = '';
  for (let t = x + y + step / 2; t < x + w + y + h; t += step) {
    const x1 = Math.max(x, t - (y + h));
    const x2 = Math.min(x + w, t - y);
    if (x2 <= x1) continue;
    d += `M${n(x1)} ${n(t - x1)}L${n(x2)} ${n(t - x2)}`;
  }
  return d;
}

let clipSeq = 0;
export function sceneToSvg(scene, title) {
  const out = [];
  const uid = `k${++clipSeq}`;
  let ci = 0;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="100%" role="img" aria-label="${esc(title || 'バッグの模式図')}" font-family='${FONT_FAMILY}'>`);
  out.push(`<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${PALETTE.paper}"/>`);
  for (const it of scene.items) {
    const dash = it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : '';
    if (it.t === 'path') {
      out.push(`<path d="${it.d}" fill="${it.fill || 'none'}" stroke="${it.stroke || 'none'}" stroke-width="${it.width || 1}"${dash} stroke-linecap="${it.cap || 'butt'}" stroke-linejoin="${it.join || 'miter'}"/>`);
    } else if (it.t === 'hatch') {
      const id = `${uid}c${ci++}`;
      out.push(`<clipPath id="${id}"><path d="${it.clip}"/></clipPath><path d="${hatchPath(it.x, it.y, it.w, it.h, it.step)}" clip-path="url(#${id})" fill="none" stroke="${it.stroke}" stroke-width="${it.width}"/>`);
    } else if (it.t === 'rect') {
      const stroke = it.stroke && it.width ? ` stroke="${it.stroke}" stroke-width="${it.width}"` : '';
      out.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="${it.r || 0}" fill="${it.fill || 'none'}"${stroke}${dash}/>`);
    } else if (it.t === 'text') {
      const anchor = it.anchor === 'middle' ? 'middle' : it.anchor === 'end' ? 'end' : 'start';
      out.push(`<text x="${it.x}" y="${it.y}" font-size="${it.size}" font-weight="${it.weight}" fill="${it.fill}" text-anchor="${anchor}" dominant-baseline="central">${esc(it.text)}</text>`);
    }
  }
  out.push('</svg>');
  return out.join('');
}

/** Canvas に描く（ox, oy に配置し、k 倍に拡大） */
export function drawSceneToCanvas(ctx, scene, ox, oy, k) {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(k, k);
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, scene.width, scene.height);
  for (const it of scene.items) {
    ctx.setLineDash(it.dash || []);
    if (it.t === 'path') {
      const p = new Path2D(it.d);
      if (it.fill) { ctx.fillStyle = it.fill; ctx.fill(p); }
      if (it.stroke) {
        ctx.strokeStyle = it.stroke;
        ctx.lineWidth = it.width || 1;
        ctx.lineCap = it.cap || 'butt';
        ctx.lineJoin = it.join || 'miter';
        ctx.stroke(p);
      }
    } else if (it.t === 'hatch') {
      ctx.save();
      ctx.clip(new Path2D(it.clip));
      ctx.setLineDash([]);
      ctx.strokeStyle = it.stroke;
      ctx.lineWidth = it.width;
      ctx.stroke(new Path2D(hatchPath(it.x, it.y, it.w, it.h, it.step)));
      ctx.restore();
    } else if (it.t === 'rect') {
      const p = new Path2D();
      const r = it.r || 0;
      if (r) {
        const { x, y, w, h } = it;
        p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
        p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
        p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); p.closePath();
      } else {
        p.rect(it.x, it.y, it.w, it.h);
      }
      if (it.fill) { ctx.fillStyle = it.fill; ctx.fill(p); }
      if (it.stroke && it.width) { ctx.strokeStyle = it.stroke; ctx.lineWidth = it.width; ctx.stroke(p); }
    } else if (it.t === 'text') {
      ctx.setLineDash([]);
      ctx.font = `${it.weight} ${it.size}px ${FONT_FAMILY}`;
      ctx.fillStyle = it.fill;
      ctx.textAlign = it.anchor === 'middle' ? 'center' : it.anchor === 'end' ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.text, it.x, it.y);
    }
  }
  ctx.restore();
}
