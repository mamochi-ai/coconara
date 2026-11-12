// バッグの模式図。描画命令（path / rect / text）の配列を作り、
// SVG（画面）と Canvas（PNG書き出し）の両方で同じ内容を描く。
import { evaluateDims, diffOrders, colorOf, colorLabel, fmt, POCKET_CONDITION } from './model.js';

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
  unknownFill: '#FFFFFF',
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
  if (evd.status === 'empty') return '（要確認）';
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

function fillFor(colorKey) {
  const c = colorOf(colorKey);
  return c ? c.hex : PALETTE.unknownFill;
}

// レイアウト定数
const FRONT = { left: 100, right: 100, top: 66, bottom: 82 };
const SIDE = { left: 100, right: 28, top: 40, bottom: 50 };

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

  // 持ち手（模式的に袋口幅の中央寄りに1本）
  const a = Math.max(halfW * 0.5, 4);
  const hh = Hh * s;
  const r = Math.min(a, hh) * 0.7;
  const hUnknown = ev.handleHeight.status !== 'ok';
  const hSty = st('handleHeight');
  items.push(P.path(
    `M${n(cx - a)} ${n(yMouth)}V${n(yApex + r)}Q${n(cx - a)} ${n(yApex)} ${n(cx - a + r)} ${n(yApex)}H${n(cx + a - r)}Q${n(cx + a)} ${n(yApex)} ${n(cx + a)} ${n(yApex + r)}V${n(yMouth)}`,
    { stroke: hSty.changed ? PALETTE.change : PALETTE.handle, width: 5, dash: hUnknown ? [7, 5] : null, cap: 'round' },
  ));

  // 本体（台形：上＝袋口幅、下＝底幅）
  items.push(P.path(
    `M${n(cx - halfW)} ${n(yMouth)}H${n(cx + halfW)}L${n(cx + halfB)} ${n(yBottom)}H${n(cx - halfB)}Z`,
    { fill: fillFor(g.order.outerColor), stroke: PALETTE.line, width: 2, dash: bodyUnknown ? [7, 5] : null, join: 'round' },
  ));
  // 袋口の線
  items.push(P.path(`M${n(cx - halfW)} ${n(yMouth + 3)}H${n(cx + halfW)}`, { stroke: PALETTE.line, width: 0.8, dash: [3, 3] }));

  // 寸法線
  hDim(items, cx - halfW, cx + halfW, rowTop + 44, yMouth - 4, yMouth - 4, '袋口幅', ev.mouthWidth, st('mouthWidth'), true);
  hDim(items, cx - halfB, cx + halfB, yBottom + 20, yBottom + 4, yBottom + 4, '底幅', ev.bottomWidth, st('bottomWidth'), false, { auto: true });
  vDim(items, cx - halfW - 22, yMouth, yBottom, cx - halfW - 4, cx - halfB - 4, '本体高さ', ev.height, st('height'), 'left');
  vDim(items, cx + halfW + 22, yApex, yMouth, cx + a + 4, null, '持ち手高さ', ev.handleHeight, st('handleHeight'), 'right');

  // 表地の色（色名を必ず文字で）
  const oc = st('outerColor');
  const sty = styleFor(oc);
  const known = !!colorOf(g.order.outerColor);
  const t = `表地：${colorLabel(g.order.outerColor)}${known ? '' : '（要確認）'}${oc.changed ? '（変更）' : ''}`;
  const sw = 14;
  const tw = textWidth(t, 12.5);
  const lx = cx - (tw + sw + 6) / 2;
  const ly = yBottom + 56;
  items.push(P.rect(n(lx - 4), ly - 11, n(tw + sw + 14), 22, { fill: sty.bg, stroke: sty.border, width: sty.border ? 1 : 0, r: 4 }));
  items.push(P.rect(n(lx), ly - 7, sw, sw, { fill: fillFor(g.order.outerColor), stroke: PALETTE.line, width: 1, dash: known ? null : [2, 2] }));
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
  items.push(P.path(
    `M${n(cx - top)} ${n(yMouth)}H${n(cx + top)}L${n(cx + halfG)} ${n(yBottom)}H${n(cx - halfG)}Z`,
    { fill: fillFor(g.order.outerColor), stroke: PALETTE.line, width: 2, dash: unknown ? [7, 5] : null, join: 'round' },
  ));
  vDim(items, cx - Math.max(halfG, 2) - 22, yMouth, yBottom, cx - top - 4, cx - halfG - 4, '本体高さ', ev.height, st('height'), 'left');
  hDim(items, cx - halfG, cx + halfG, yBottom + 20, yBottom + 4, yBottom + 4, 'マチ', ev.gusset, st('gusset'), false);
}

const INTERIOR_H = 214;

/** 内側の模式図（縮尺なし） */
function drawInterior(items, order, cx, y0, st, x0) {
  items.push(P.text(x0 + 6, y0 + 12, '内側の模式図（縮尺なし）', { size: 13, weight: 700, fill: PALETTE.muted }));
  const pw = 200;
  const ph = 96;
  const px = cx - pw / 2;
  const py = y0 + 56;
  const lsty = styleFor({ changed: st('lining').changed || st('liningColor').changed });
  let lText;
  let fill;
  let dash = null;
  if (order.lining === 'yes') {
    const lc = colorOf(order.liningColor);
    lText = lc ? `裏地：あり（${lc.label}）` : '裏地：あり（色は要確認）';
    fill = lc ? lc.hex : PALETTE.unknownFill;
    if (!lc) dash = [5, 4];
  } else if (order.lining === 'none') {
    lText = '裏地：なし（表地の裏側）';
    fill = fillFor(order.outerColor);
  } else {
    lText = '裏地：未定（要確認）';
    fill = PALETTE.unknownFill;
    dash = [5, 4];
  }
  if (lsty.border) lText += '（変更）';
  label(items, cx, y0 + 36, [{ text: lText, bold: !!lsty.border }], 'middle', lsty);
  items.push(P.rect(px, py, pw, ph, { fill, stroke: lsty.border || PALETTE.line, width: lsty.border ? 2.4 : 1.6, dash }));
  items.push(P.path(`M${px} ${py}H${px + pw}`, { stroke: PALETTE.line, width: 3 }));
  items.push(P.text(px + pw + 6, py, '袋口', { size: 11, fill: PALETTE.muted }));

  const psty = styleFor(st('pocket'));
  const pk = order.pocket;
  const qw = 72;
  const qh = 40;
  const qx = cx - qw / 2;
  const qy = py + ph / 2 - qh / 2;
  if (pk === 'yes' || pk === 'undecided') {
    items.push(P.rect(qx, qy, qw, qh, {
      fill: '#FFFFFF', stroke: psty.border || PALETTE.line, width: psty.border ? 2.4 : 1.4, dash: pk === 'undecided' ? [4, 3] : null,
    }));
    items.push(P.text(cx, qy + qh / 2, pk === 'yes' ? 'ポケット' : '？', { anchor: 'middle', size: 12, fill: psty.border ? PALETTE.change : PALETTE.text, weight: 700 }));
  }
  const ch = psty.border ? '（変更）' : '';
  const lines = pk === 'yes'
    ? [{ text: `内ポケット：あり${ch}`, bold: true }, { text: '片面中央に1個・寸法は指定なし', size: 11.5 }]
    : pk === 'none'
      ? [{ text: `内ポケット：なし${ch}`, bold: !!ch }]
      : [{ text: `内ポケット：未定（要確認）${ch}`, bold: !!ch }];
  label(items, cx, py + ph + 10 + lines.length * 8, lines, 'middle', psty);
}

// ---------- 縮尺 ----------

function fitScale(geoms, frontW, sideW, maxH, cap) {
  let s = cap;
  for (const g of geoms) {
    const { W, G, H, Hh } = g.cm;
    s = Math.min(s, frontW / W, maxH / (H + Hh));
    if (G > 0) s = Math.min(s, sideW / G);
  }
  return s;
}

function stateFn(changes, highlight) {
  const set = new Set(changes);
  return (key) => ({
    changed: set.has(key),
    highlight: highlight === key || (highlight === 'bottomWidth' && key === 'bottomWidth'),
  });
}

/**
 * 1案の図（正面図＋側面図＋内側）。
 * opts.baseline があれば変更箇所をオレンジで示す。opts.highlight で寸法線を強調。
 */
export function buildScene(order, opts = {}) {
  if (opts.narrow) return buildNarrowScene(order, opts);
  const width = 760;
  const frontAreaW = 500;
  const g = geometry(order);
  const s = fitScale([g], frontAreaW - FRONT.left - FRONT.right, 260 - SIDE.left - SIDE.right, 300, 10);
  const changes = opts.baseline ? diffOrders(opts.baseline, order).map((c) => c.key) : [];
  const st = stateFn(changes, opts.highlight);
  const items = [];
  const body = (g.cm.H + g.cm.Hh) * s;
  const rowTop = 0;
  const yBottom = rowTop + FRONT.top + body;
  drawFront(items, g, FRONT.left + (frontAreaW - FRONT.left - FRONT.right) / 2, yBottom, s, st, 0, rowTop);
  drawSide(items, g, frontAreaW + SIDE.left + (260 - SIDE.left - SIDE.right) / 2, yBottom, s, st, frontAreaW, rowTop);
  let y = yBottom + FRONT.bottom;
  if (!opts.compact) {
    items.push(P.path(`M10 ${n(y)}H${width - 10}`, { stroke: '#E2DCCF', width: 1 }));
    drawInterior(items, order, width / 2, y + 8, st, 0);
    y += 8 + INTERIOR_H;
  }
  items.push(P.text(width / 2, y + 4, '正面図と側面図は同じ縮尺の模式図です（寸法は数値を優先してください）', { anchor: 'middle', size: 12, fill: PALETTE.muted }));
  return { width, height: Math.ceil(y + 18), items, scale: s, changes };
}

const NARROW_W = 420;

/** 縦積み（スマートフォン・縦向き用）：正面図→側面図→内側。y0 から描き、終わりの y を返す */
function drawStack(items, g, order, y0, s, st, bodyMax, sideMax, compact) {
  const colW = NARROW_W;
  let rowTop = y0;
  let yBottom = rowTop + FRONT.top + bodyMax;
  drawFront(items, g, FRONT.left + (colW - FRONT.left - FRONT.right) / 2, yBottom, s, st, 0, rowTop);
  rowTop = yBottom + FRONT.bottom;
  yBottom = rowTop + SIDE.top + sideMax;
  drawSide(items, g, SIDE.left + (colW - SIDE.left - SIDE.right) / 2, yBottom, s, st, 0, rowTop);
  let y = yBottom + SIDE.bottom;
  if (!compact) {
    items.push(P.path(`M10 ${n(y)}H${colW - 10}`, { stroke: '#E2DCCF', width: 1 }));
    drawInterior(items, order, colW / 2, y + 8, st, 0);
    y += 8 + INTERIOR_H;
  }
  return y;
}

function narrowScale(geoms) {
  return fitScale(geoms, NARROW_W - FRONT.left - FRONT.right, NARROW_W - SIDE.left - SIDE.right, 260, 8);
}

function buildNarrowScene(order, opts) {
  const g = geometry(order);
  const s = narrowScale([g]);
  const changes = opts.baseline ? diffOrders(opts.baseline, order).map((c) => c.key) : [];
  const items = [];
  let y = drawStack(items, g, order, 0, s, stateFn(changes, opts.highlight), (g.cm.H + g.cm.Hh) * s, g.cm.H * s, opts.compact);
  items.push(P.text(NARROW_W / 2, y + 4, '正面図と側面図は同じ縮尺の模式図です', { anchor: 'middle', size: 12, fill: PALETTE.muted }));
  return { width: NARROW_W, height: Math.ceil(y + 18), items, scale: s, changes };
}

function buildNarrowCompare(before, after, opts) {
  const gb = geometry(before);
  const ga = geometry(after);
  const s = narrowScale([gb, ga]);
  const changes = diffOrders(before, after).map((c) => c.key);
  const bodyMax = Math.max((gb.cm.H + gb.cm.Hh) * s, (ga.cm.H + ga.cm.Hh) * s);
  const sideMax = Math.max(gb.cm.H * s, ga.cm.H * s);
  const items = [];
  let y = 0;
  [[before, gb, stateFn([], null), opts.beforeTitle || '変更前'], [after, ga, stateFn(changes, opts.highlight), opts.afterTitle || '変更後']]
    .forEach(([o, g, st, title], i) => {
      items.push(P.rect(6, y + 2, NARROW_W - 12, 28, { fill: i ? PALETTE.changeBg : '#F1EEE7', stroke: i ? PALETTE.change : '#CFC8BA', width: 1, r: 5 }));
      items.push(P.text(NARROW_W / 2, y + 16, title, { anchor: 'middle', size: 14, weight: 700, fill: i ? PALETTE.change : PALETTE.text }));
      y = drawStack(items, g, o, y + 40, s, st, bodyMax, sideMax, false) + 6;
    });
  items.push(P.text(NARROW_W / 2, y + 4, '変更前と変更後は同じ縮尺の模式図です', { anchor: 'middle', size: 12, fill: PALETTE.muted }));
  return { width: NARROW_W, height: Math.ceil(y + 18), items, scale: s, changes };
}

/** 変更前・変更後を同じ縮尺で並べた図 */
export function buildCompareScene(before, after, opts = {}) {
  if (opts.narrow) return buildNarrowCompare(before, after, opts);
  const colW = 390;
  const width = colW * 2;
  const gb = geometry(before);
  const ga = geometry(after);
  const s = fitScale([gb, ga], colW - FRONT.left - FRONT.right, colW - SIDE.left - SIDE.right - 60, 280, 8);
  const changes = diffOrders(before, after).map((c) => c.key);
  const stBefore = stateFn([], null);
  const stAfter = stateFn(changes, opts.highlight);
  const items = [];

  const headH = 34;
  const heads = [opts.beforeTitle || '変更前', opts.afterTitle || '変更後'];
  heads.forEach((h, i) => {
    items.push(P.rect(i * colW + 6, 2, colW - 12, 28, { fill: i ? PALETTE.changeBg : '#F1EEE7', stroke: i ? PALETTE.change : '#CFC8BA', width: 1, r: 5 }));
    items.push(P.text(i * colW + colW / 2, 16, h, { anchor: 'middle', size: 14, weight: 700, fill: i ? PALETTE.change : PALETTE.text }));
  });
  items.push(P.path(`M${colW} ${headH + 4}V9999`, { stroke: '#E2DCCF', width: 1, id: 'divider' }));

  // 正面図の行
  let rowTop = headH + 6;
  const bodyMax = Math.max((gb.cm.H + gb.cm.Hh) * s, (ga.cm.H + ga.cm.Hh) * s);
  let yBottom = rowTop + FRONT.top + bodyMax;
  const frontCx = FRONT.left + (colW - FRONT.left - FRONT.right) / 2;
  drawFront(items, gb, frontCx, yBottom, s, stBefore, 0, rowTop);
  drawFront(items, ga, colW + frontCx, yBottom, s, stAfter, colW, rowTop);

  // 側面図の行
  rowTop = yBottom + FRONT.bottom;
  const sideMax = Math.max(gb.cm.H * s, ga.cm.H * s);
  yBottom = rowTop + SIDE.top + sideMax;
  const sideCx = SIDE.left + 70;
  drawSide(items, gb, sideCx, yBottom, s, stBefore, 0, rowTop);
  drawSide(items, ga, colW + sideCx, yBottom, s, stAfter, colW, rowTop);

  // 内側
  rowTop = yBottom + SIDE.bottom;
  drawInterior(items, before, colW / 2, rowTop, stBefore, 0);
  drawInterior(items, after, colW + colW / 2, rowTop, stAfter, colW);
  const y = rowTop + INTERIOR_H;
  items.push(P.text(width / 2, y + 4, '変更前と変更後は同じ縮尺の模式図です（寸法は数値を優先してください）', { anchor: 'middle', size: 12, fill: PALETTE.muted }));
  const height = Math.ceil(y + 18);
  const div = items.find((i) => i.id === 'divider');
  div.d = `M${colW} ${headH + 4}V${y - 10}`;
  return { width, height, items, scale: s, changes };
}

// ---------- レンダラー ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sceneToSvg(scene, title) {
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="100%" role="img" aria-label="${esc(title || 'バッグの模式図')}" font-family='${FONT_FAMILY}'>`);
  out.push(`<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${PALETTE.paper}"/>`);
  for (const it of scene.items) {
    const dash = it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : '';
    if (it.t === 'path') {
      out.push(`<path d="${it.d}" fill="${it.fill || 'none'}" stroke="${it.stroke || 'none'}" stroke-width="${it.width || 1}"${dash} stroke-linecap="${it.cap || 'butt'}" stroke-linejoin="${it.join || 'miter'}"/>`);
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

export { POCKET_CONDITION };
