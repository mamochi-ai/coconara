// 確認画像（PNG）の作成。Canvas 2D に直接描くため、外部フォントや
// SVG→画像変換に頼らず、線・日本語・色が欠けにくい。
import { analyze, diffOrders, changeText, fieldValues, POCKET_CONDITION } from './model.js';
import { buildScene, buildCompareScene, drawSceneToCanvas, FONT_FAMILY, PALETTE } from './diagram.js';

const W = 1000; // 論理幅（px）
const PAD = 40;
const INNER = W - PAD * 2;
const MAX_PIXELS = 15_000_000; // iOS Safari の Canvas 上限より少なめ

function font(size, weight = 400) {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

/** 日本語を含む文章を幅に合わせて折り返す（1文字単位、改行を保持） */
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split(/\r?\n/)) {
    if (para === '') { lines.push(''); continue; }
    let line = '';
    for (const ch of para) {
      const next = line + ch;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

function formatDate(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

/**
 * 画像の内容（描画命令の列）を組み立てる。高さは内容に応じて可変。
 * mode: 'single'（初回確認）| 'compare'（変更前後）
 */
function compose(ctx, doc, mode, now) {
  const ops = [];
  let y = PAD;
  const cur = doc.current;
  const base = doc.baseline;
  const compare = mode === 'compare' && base;
  const textBlock = (text, { size = 17, weight = 400, color = PALETTE.text, indent = 0, lh = 1.6, bullet = null, bulletColor } = {}) => {
    ctx.font = font(size, weight);
    const lines = wrapText(ctx, text, INNER - indent - (bullet ? 22 : 0));
    lines.forEach((ln, i) => {
      const line = ln;
      const yy = y + (size * lh) / 2;
      if (bullet && i === 0) ops.push({ t: 'bullet', x: PAD + indent + 6, y: yy, kind: bullet, color: bulletColor || color });
      ops.push({ t: 'text', x: PAD + indent + (bullet ? 22 : 0), y: yy, text: line, size, weight, color });
      y += size * lh;
    });
  };
  const heading = (text, color = PALETTE.text) => {
    y += 18;
    ops.push({ t: 'rule', y });
    y += 14;
    textBlock(text, { size: 20, weight: 700, color });
    y += 4;
  };

  // ヘッダー
  textBlock('バッグ仕様の確認', { size: 30, weight: 700 });
  y += 6;
  const orderNo = String(cur.orderNo || '').trim() || '（未入力・要確認）';
  textBlock(`注文番号：${orderNo}`, { size: 19, weight: 700 });
  const versionText = compare
    ? `版：${doc.version}（変更前 版${doc.baselineVersion} → 変更後 版${doc.version}）`
    : `版：${doc.version}`;
  textBlock(versionText, { size: 17 });
  textBlock(compare ? '確認の種類：変更点の確認（変更前と変更後の比較）' : '確認の種類：仕様の確認', { size: 17 });
  textBlock(`作成日：${formatDate(now)}`, { size: 15, color: PALETTE.muted });
  if (doc.isSample) {
    y += 4;
    textBlock('※ 架空のサンプルデータです（実在の注文ではありません）', { size: 16, weight: 700, color: PALETTE.change });
  }
  y += 10;
  // 注記ボックス
  {
    ctx.font = font(15);
    const note = '仕様確認用の模式図です。型紙・裁断図ではありません。色は目安です。';
    const lines = wrapText(ctx, note, INNER - 28);
    const h = lines.length * 24 + 18;
    ops.push({ t: 'box', x: PAD, y, w: INNER, h, fill: '#F5F1E8', stroke: '#D8D0BF' });
    lines.forEach((ln, i) => ops.push({ t: 'text', x: PAD + 14, y: y + 9 + 12 + i * 24, text: ln, size: 15, weight: 700, color: PALETTE.text }));
    y += h + 16;
  }

  // 図
  const scene = compare
    ? buildCompareScene(base, cur, { beforeTitle: `変更前（版${doc.baselineVersion}）`, afterTitle: `変更後（版${doc.version}）` })
    : buildScene(cur);
  const k = INNER / scene.width;
  ops.push({ t: 'scene', scene, x: PAD, y, k });
  y += scene.height * k;

  // 変更点
  if (compare) {
    const changes = diffOrders(base, cur);
    heading(`前回（版${doc.baselineVersion}）からの変更点`, PALETTE.change);
    if (changes.length === 0) {
      textBlock('変更点はありません', { size: 17 });
    } else {
      for (const c of changes) {
        textBlock(changeText(c), { size: 18, weight: 700, color: PALETTE.change, bullet: 'change' });
      }
      y += 2;
      textBlock('オレンジ色・「変更」の表示が変更箇所です。', { size: 14, color: PALETTE.muted });
    }
  }

  // 要確認
  const an = analyze(cur);
  heading('要確認の項目');
  if (an.pending.length === 0) {
    textBlock('なし', { size: 17 });
  } else {
    textBlock('以下は未定・未入力のため、確認が必要です。', { size: 15, color: PALETTE.muted });
    for (const p of an.pending) textBlock(`${p.text}（要確認）`, { size: 17, weight: 700, bullet: 'pending' });
  }

  // 寸法と仕様の一覧
  heading('寸法と仕様');
  const rows = fieldValues(cur).filter((f) => !f.memo && f.key !== 'orderNo');
  const baseRows = compare ? fieldValues(base) : null;
  const changedKeys = compare ? new Set(diffOrders(base, cur).map((c) => c.key)) : new Set();
  const pendingKeys = new Set(an.pending.map((p) => p.key));
  const col1 = 170;
  const colW = compare ? (INNER - col1) / 2 : INNER - col1;
  // 表ヘッダー
  if (compare) {
    ops.push({ t: 'box', x: PAD, y, w: INNER, h: 34, fill: '#F1EEE7', stroke: null });
    ops.push({ t: 'text', x: PAD + 10, y: y + 17, text: '項目', size: 15, weight: 700, color: PALETTE.muted });
    ops.push({ t: 'text', x: PAD + col1 + 10, y: y + 17, text: `変更前（版${doc.baselineVersion}）`, size: 15, weight: 700, color: PALETTE.muted });
    ops.push({ t: 'text', x: PAD + col1 + colW + 10, y: y + 17, text: `変更後（版${doc.version}）`, size: 15, weight: 700, color: PALETTE.muted });
    y += 34;
  }
  const valueOf = (f, order) => {
    let t = f.text;
    if (f.key === 'bottomWidth' && f.num !== null) t += '（袋口幅−マチで自動計算）';
    if (f.key === 'pocket' && order.pocket === 'yes') t += `：${POCKET_CONDITION}`;
    return t;
  };
  rows.forEach((f, i) => {
    const changed = changedKeys.has(f.key);
    const pend = pendingKeys.has(f.key) || (f.unit && f.cmp === 'empty');
    const after = valueOf(f, cur) + (pend ? '（要確認）' : '') + (changed ? '［変更］' : '');
    ctx.font = font(16, changed ? 700 : 400);
    const afterLines = wrapText(ctx, after, colW - 20);
    let beforeLines = [];
    if (compare) {
      const bf = baseRows.find((x) => x.key === f.key);
      ctx.font = font(16);
      beforeLines = wrapText(ctx, valueOf(bf, base), colW - 20);
    }
    const h = Math.max(afterLines.length, beforeLines.length, 1) * 26 + 14;
    if (changed) ops.push({ t: 'box', x: PAD, y, w: INNER, h, fill: PALETTE.changeBg, stroke: null });
    else if (i % 2 === 0) ops.push({ t: 'box', x: PAD, y, w: INNER, h, fill: '#FAF8F3', stroke: null });
    if (changed) ops.push({ t: 'box', x: PAD, y, w: 5, h, fill: PALETTE.change, stroke: null });
    ops.push({ t: 'text', x: PAD + 12, y: y + 7 + 13, text: f.label, size: 16, weight: 700, color: PALETTE.text });
    const ax = PAD + col1 + (compare ? colW : 0) + 10;
    afterLines.forEach((ln, j) => ops.push({ t: 'text', x: ax, y: y + 7 + 13 + j * 26, text: ln, size: 16, weight: changed ? 700 : 400, color: changed ? PALETTE.change : PALETTE.text }));
    beforeLines.forEach((ln, j) => ops.push({ t: 'text', x: PAD + col1 + 10, y: y + 7 + 13 + j * 26, text: ln, size: 16, weight: 400, color: PALETTE.muted }));
    y += h;
    ops.push({ t: 'line', x1: PAD, x2: PAD + INNER, y, color: '#E6E0D4' });
  });
  y += 6;
  textBlock('寸法はすべて完成状態の目安（cm）。底幅は「袋口幅 − マチ」で計算しています（この形のバッグの場合の関係です）。', { size: 14, color: PALETTE.muted });

  // 注文メモ
  heading('注文メモ');
  const memo = String(cur.memo || '').trim();
  textBlock(memo || '（なし）', { size: 17, color: memo ? PALETTE.text : PALETTE.muted });

  // 注記
  heading('ご確認にあたって');
  const notes = [
    '仕様確認用の模式図です。型紙・裁断図ではありません。',
    '色は目安です。画面や印刷により実際の生地の色とは異なります。',
    '図の形は模式的なものです。寸法は数値の記載を優先してください。',
  ];
  if (compare) notes.push('「変更前」は作家が比較のために保存した内容です。お客様の承認を示すものではありません。');
  if (an.pending.length) notes.push('「要確認」の項目は、まだ決まっていない内容です。');
  for (const t of notes) textBlock(t, { size: 15, bullet: 'dot', color: PALETTE.text });
  y += PAD;
  return { ops, height: Math.ceil(y) };
}

function paint(ctx, ops) {
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, W, 100000);
  for (const op of ops) {
    ctx.setLineDash([]);
    if (op.t === 'text') {
      ctx.font = font(op.size, op.weight);
      ctx.fillStyle = op.color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(op.text, op.x, op.y);
    } else if (op.t === 'box') {
      ctx.fillStyle = op.fill;
      ctx.fillRect(op.x, op.y, op.w, op.h);
      if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = 1; ctx.strokeRect(op.x + 0.5, op.y + 0.5, op.w - 1, op.h - 1); }
    } else if (op.t === 'rule') {
      ctx.fillStyle = '#CFC8BA';
      ctx.fillRect(PAD, op.y, INNER, 1.5);
    } else if (op.t === 'line') {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x1, op.y - 0.5, op.x2 - op.x1, 1);
    } else if (op.t === 'bullet') {
      ctx.fillStyle = op.color;
      if (op.kind === 'change') {
        ctx.fillRect(op.x - 6, op.y - 6, 12, 12); // 四角＝変更
      } else if (op.kind === 'pending') {
        ctx.font = font(17, 700);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('？', op.x, op.y);
      } else {
        ctx.beginPath(); ctx.arc(op.x, op.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    } else if (op.t === 'scene') {
      drawSceneToCanvas(ctx, op.scene, op.x, op.y, op.k);
    }
  }
}

/** 出力前のチェック。不正な値があれば理由の一覧を返す。 */
export function exportBlockers(doc, mode) {
  const list = analyze(doc.current).errors.map((e) => `${e.label}：${e.message}`);
  if (mode === 'compare' && doc.baseline) {
    for (const e of analyze(doc.baseline).errors) list.push(`比較元の${e.label}：${e.message}`);
  }
  return list;
}

/** PNG を作る。戻り値 {blob, width, height} */
export async function renderPng(doc, mode, now = new Date()) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const { ops, height } = compose(ctx, doc, mode, now);
  let ratio = 2;
  if (W * ratio * height * ratio > MAX_PIXELS) ratio = Math.max(1, Math.sqrt(MAX_PIXELS / (W * height)));
  canvas.width = Math.round(W * ratio);
  canvas.height = Math.round(height * ratio);
  const c2 = canvas.getContext('2d');
  c2.scale(ratio, ratio);
  paint(c2, ops);
  const blob = await new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作成できませんでした'))), 'image/png');
    } else {
      try {
        const data = atob(canvas.toDataURL('image/png').split(',')[1]);
        const arr = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) arr[i] = data.charCodeAt(i);
        resolve(new Blob([arr], { type: 'image/png' }));
      } catch (e) { reject(e); }
    }
  });
  return { blob, width: canvas.width, height: canvas.height, logicalHeight: height };
}
