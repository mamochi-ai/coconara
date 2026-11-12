// 確認画像（PNG）。内容は report.js の共通データから作り、Canvas 2D に直接描く。
// 図・表の行・文章の行を「ブロック」として扱い、長い場合は区切りのよい位置で複数枚に分ける。
import { analyze, diffOrders } from './model.js';
import { buildReport } from './report.js';
import { buildFigure, stateFn, drawSceneToCanvas, FONT_FAMILY, PALETTE } from './diagram.js';

export const PAGE = {
  width: 1000, // 論理幅（px）。書き出しは2倍の 2000px
  ratio: 2,
  pad: 44,
  singleMax: 2700, // これ以下なら1枚にまとめる（論理px）
  pageMax: 2300, // 複数枚に分けるときの1枚の上限
};
const INNER = PAGE.width - PAGE.pad * 2;
const MAX_PIXELS = 15_000_000; // iOS Safari の Canvas 上限より少なめ

const font = (size, weight = 400) => `${weight} ${size}px ${FONT_FAMILY}`;

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

// ---------- ブロックの組み立て ----------

function blocksFor(ctx, report, doc) {
  const blocks = [];
  const add = (group, h, ops, opts = {}) => blocks.push({ group, h, ops, ...opts });
  const textOp = (x, y, text, size, weight = 400, color = PALETTE.text) => ({ t: 'text', x, y, text, size, weight, color });

  /** 文章を行ごとのブロックにする（行の途中では切らない） */
  const para = (group, text, { size = 17, weight = 400, color = PALETTE.text, lh = 1.65, indent = 0, bullet = null, bulletColor, gapAfter = 0 } = {}) => {
    ctx.font = font(size, weight);
    const left = PAGE.pad + indent + (bullet ? 24 : 0);
    const lines = wrapText(ctx, text, PAGE.pad + INNER - left);
    const lineH = Math.round(size * lh);
    lines.forEach((ln, i) => {
      const ops = [textOp(left, lineH / 2, ln, size, weight, color)];
      if (bullet && i === 0) ops.push({ t: 'bullet', x: PAGE.pad + indent + 7, y: lineH / 2, kind: bullet, color: bulletColor || color });
      add(group, lineH + (i === lines.length - 1 ? gapAfter : 0), ops);
    });
  };
  const heading = (group, text, color = PALETTE.text) => {
    add(group, 58, [{ t: 'rule', y: 16 }, textOp(PAGE.pad, 40, text, 20, 700, color)], { keep: true });
  };
  const figure = (group, scene) => {
    const k = Math.min(INNER / scene.width, 1.25);
    const w = scene.width * k;
    add(group, scene.height * k + 8, [{ t: 'scene', scene, x: PAGE.pad + (INNER - w) / 2, y: 0, k }]);
  };

  const m = report.meta;
  const maker = report.audience === 'maker';

  // 1. 見出しと注文情報（1〜2行に短くまとめる）
  add('main', 46, [textOp(PAGE.pad, 22, report.title, 28, 700)]);
  const metaParts = [
    `注文番号 ${m.orderNo || '未入力'}`,
    report.compare ? `版${m.version}（変更前：版${m.baselineVersion}）` : `版${m.version}`,
    `作成 ${m.date}`,
  ];
  if (maker) metaParts.push('作家用');
  para('main', metaParts.join('　｜　'), { size: 16, color: PALETTE.text, lh: 1.6 });
  if (m.isSample) para('main', '架空のサンプルです', { size: 13, color: PALETTE.change, lh: 1.5 });
  add('main', 10, []);

  const cur = doc.current;
  const base = doc.baseline;
  const changeKeys = report.compare ? diffOrders(base, cur).map((c) => c.key) : [];
  const cols = report.compare
    ? [
      { order: base, title: `変更前（版${m.baselineVersion}）`, st: stateFn([], null) },
      { order: cur, title: `変更後（版${m.version}）`, st: stateFn(changeKeys, null) },
    ]
    : [{ order: cur, st: stateFn([], null) }];

  if (maker) {
    // 作家用：正面・側面・内側の図 → 全項目の表
    figure('main', buildFigure(cols, { front: true, side: true, interior: true, footnote: false }));
    tableBlocks(ctx, report, add, textOp);
  } else {
    // お客様用：正面図 → 変更点 → 必要な追加図 → 仕様 → 未入力・未定 → 確認したいこと
    figure('main', buildFigure(cols, { front: true, side: false, interior: false, footnote: false }));
    if (report.compare) {
      heading('main', '変更点', PALETTE.change);
      if (report.changes.length === 0) {
        para('main', '比較元からの変更はありません', { size: 18 });
      } else {
        for (const c of report.changes) para('main', c.text, { size: 19, weight: 700, color: PALETTE.change, bullet: 'change' });
      }
    }
    // 追加の図（マチ・裏地・ポケットの変更時、または出力設定で追加したとき）
    if (report.parts.side) {
      add('main', 18, [], { keep: true });
      figure('main', buildFigure(cols, { front: false, side: true, interior: false, footnote: false }));
    }
    if (report.parts.interior) {
      add('main', 18, [], { keep: true });
      figure('main', buildFigure(cols, { front: false, side: false, interior: true, footnote: false }));
    }
    if (report.specShort.length) {
      heading('main', report.compare ? 'そのほかの仕様（変更後）' : '仕様');
      for (const sp of report.specShort) {
        para('main', `${sp.label}：${sp.text}${sp.changed ? '［変更］' : ''}`, { size: 17, weight: sp.changed ? 700 : 400, color: sp.changed ? PALETTE.change : PALETTE.text, bullet: 'dot' });
      }
    }
  }

  // 未入力・未定の項目
  const g2 = maker ? 'detail' : 'main';
  heading(g2, '未入力・未定の項目');
  if (report.pending.length === 0) para(g2, 'なし', { size: 17 });
  else for (const p of report.pending) para(g2, p, { size: 17, weight: 700, bullet: 'pending', color: PALETTE.text });

  // お客様に確認したいこと（空欄なら省略。入力文をそのまま掲載）
  if (report.questions) {
    heading(g2, 'お客様に確認したいこと');
    para(g2, report.questions, { size: 18 });
  }

  // 注文メモ
  if (report.memo !== null) {
    heading('detail', `注文メモ${report.memoChanged && maker ? '（比較元から変更あり）' : ''}`);
    para('detail', report.memo || '（なし）', { size: 17, color: report.memo ? PALETTE.text : PALETTE.muted });
  }

  // 注記（末尾の1か所）
  heading('detail', 'ご確認にあたって');
  for (const t of report.notes) para('detail', t, { size: 15, bullet: 'dot', lh: 1.6 });
  return blocks;
}

function tableBlocks(ctx, report, add, textOp) {
  const compare = report.compare;
  const col1 = 190;
  const colW = compare ? (INNER - col1) / 2 : INNER - col1;
  add('main', 58, [{ t: 'rule', y: 16 }, textOp(PAGE.pad, 40, compare ? '全項目の比較（変更前 → 変更後）' : '寸法と仕様', 20, 700)], { keep: true });
  if (compare) {
    add('main', 36, [
      { t: 'box', x: PAGE.pad, y: 0, w: INNER, h: 36, fill: '#F1EEE7' },
      textOp(PAGE.pad + 12, 18, '項目', 15, 700, PALETTE.muted),
      textOp(PAGE.pad + col1 + 10, 18, `変更前（版${report.meta.baselineVersion}）`, 15, 700, PALETTE.muted),
      textOp(PAGE.pad + col1 + colW + 10, 18, `変更後（版${report.meta.version}）`, 15, 700, PALETTE.muted),
    ], { keep: true });
  }
  report.table.forEach((row, i) => {
    const after = row.after + (row.pending ? '（未入力・未定）' : '') + (row.changed ? '［変更］' : '');
    ctx.font = font(16, row.changed ? 700 : 400);
    const aLines = wrapText(ctx, after, colW - 22);
    ctx.font = font(16);
    const bLines = compare ? wrapText(ctx, row.before, colW - 22) : [];
    const h = Math.max(aLines.length, bLines.length, 1) * 26 + 16;
    const ops = [];
    if (row.changed) {
      ops.push({ t: 'box', x: PAGE.pad, y: 0, w: INNER, h, fill: PALETTE.changeBg });
      ops.push({ t: 'box', x: PAGE.pad, y: 0, w: 5, h, fill: PALETTE.change });
    } else if (i % 2 === 0) ops.push({ t: 'box', x: PAGE.pad, y: 0, w: INNER, h, fill: '#FAF8F3' });
    ops.push(textOp(PAGE.pad + 14, 8 + 13, row.label, 16, 700));
    const ax = PAGE.pad + col1 + (compare ? colW : 0) + 10;
    aLines.forEach((ln, j) => ops.push(textOp(ax, 8 + 13 + j * 26, ln, 16, row.changed ? 700 : 400, row.changed ? PALETTE.change : PALETTE.text)));
    bLines.forEach((ln, j) => ops.push(textOp(PAGE.pad + col1 + 10, 8 + 13 + j * 26, ln, 16, 400, PALETTE.muted)));
    ops.push({ t: 'line', x1: PAGE.pad, x2: PAGE.pad + INNER, y: h, color: '#E6E0D4' });
    add('main', h, ops);
  });
  add('main', 8, []);
}

// ---------- ページ分け ----------

function pack(blocks, max) {
  const pages = [];
  let cur = [];
  let h = 0;
  for (const b of blocks) {
    if (cur.length && h + b.h > max) {
      // 見出しなど「次と一緒に置く」ブロックは次のページへ送る
      const carry = [];
      while (cur.length && cur[cur.length - 1].keep) carry.unshift(cur.pop());
      if (cur.length) { pages.push(cur); cur = carry; h = carry.reduce((a, x) => a + x.h, 0); }
    }
    cur.push(b);
    h += b.h;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

/** ブロックを1枚または複数枚に分ける。複数枚のときは「図と変更点」「詳細」で区切る */
export function paginate(blocks) {
  const total = blocks.reduce((a, b) => a + b.h, 0);
  if (total + PAGE.pad * 2 <= PAGE.singleMax) return [{ name: null, blocks }];
  const chrome = PAGE.pad * 2 + 44;
  const section = (list) => {
    const sum = list.reduce((a, b) => a + b.h, 0);
    // 1枚に収まる量ならそのまま1枚。超える場合だけ上限で区切り、短すぎる最後の1枚は前に寄せる
    if (sum + chrome <= PAGE.singleMax) return list.length ? [list] : [];
    const pages = pack(list, PAGE.pageMax - chrome);
    const h = (bl) => bl.reduce((a, b) => a + b.h, 0);
    if (pages.length > 1 && h(pages[pages.length - 1]) < 500 && h(pages[pages.length - 2]) + h(pages[pages.length - 1]) + chrome <= PAGE.singleMax) {
      const last = pages.pop();
      pages[pages.length - 1] = pages[pages.length - 1].concat(last);
    }
    return pages;
  };
  const main = section(blocks.filter((b) => b.group === 'main'));
  const detail = section(blocks.filter((b) => b.group !== 'main'));
  return [
    ...main.map((bl, i) => ({ name: i ? '図と変更点（続き）' : '図と変更点', blocks: bl })),
    ...detail.map((bl, i) => ({ name: i ? '詳細（続き）' : '詳細', blocks: bl })),
  ];
}

// ---------- 描画 ----------

function paint(ctx, ops, oy) {
  for (const op of ops) {
    ctx.setLineDash([]);
    if (op.t === 'text') {
      ctx.font = font(op.size, op.weight);
      ctx.fillStyle = op.color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(op.text, op.x, oy + op.y);
    } else if (op.t === 'box') {
      ctx.fillStyle = op.fill;
      ctx.fillRect(op.x, oy + op.y, op.w, op.h);
    } else if (op.t === 'rule') {
      ctx.fillStyle = '#CFC8BA';
      ctx.fillRect(PAGE.pad, oy + op.y, INNER, 1.5);
    } else if (op.t === 'line') {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x1, oy + op.y - 0.5, op.x2 - op.x1, 1);
    } else if (op.t === 'bullet') {
      ctx.fillStyle = op.color;
      const y = oy + op.y;
      if (op.kind === 'change') ctx.fillRect(op.x - 6, y - 6, 12, 12);
      else if (op.kind === 'pending') {
        ctx.font = font(17, 700);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('？', op.x, y);
      } else { ctx.beginPath(); ctx.arc(op.x, y, 3, 0, Math.PI * 2); ctx.fill(); }
    } else if (op.t === 'scene') {
      drawSceneToCanvas(ctx, op.scene, op.x, oy + op.y, op.k);
    }
  }
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
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
}

/** 出力前のチェック。不正な値があれば理由の一覧を返す。 */
export function exportBlockers(doc) {
  const list = analyze(doc.current).errors.map((e) => `${e.label}：${e.message}`);
  if (doc.baseline) for (const e of analyze(doc.baseline).errors) list.push(`比較元の${e.label}：${e.message}`);
  return list;
}

/** 画像の構成（ページ分けまで）。描画はしない。テスト・プレビューの説明にも使う */
export function layoutPages(doc, settings, now = new Date(), ctx = document.createElement('canvas').getContext('2d')) {
  const report = buildReport(doc, settings, now);
  const blocks = blocksFor(ctx, report, doc);
  return { report, pages: paginate(blocks) };
}

/**
 * PNG を作る。戻り値 {report, images:[{blob, width, height, name, index, total}]}
 */
export async function renderPngs(doc, settings, now = new Date()) {
  const { report, pages } = layoutPages(doc, settings, now);
  const total = pages.length;
  const images = [];
  for (let i = 0; i < total; i++) {
    const pg = pages[i];
    const headerH = total > 1 ? 44 : 0;
    const height = Math.ceil(PAGE.pad + headerH + pg.blocks.reduce((a, b) => a + b.h, 0) + PAGE.pad);
    let ratio = PAGE.ratio;
    if (PAGE.width * ratio * height * ratio > MAX_PIXELS) ratio = Math.max(1, Math.sqrt(MAX_PIXELS / (PAGE.width * height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PAGE.width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(0, 0, PAGE.width, height);
    let y = PAGE.pad;
    if (total > 1) {
      // 複数枚：各画像に注文番号・版番号・ページ番号
      const m = report.meta;
      const t = `注文番号 ${m.orderNo || '未入力'}　｜　版${m.version}　｜　${i + 1}/${total}　${pg.name}`;
      paint(ctx, [{ t: 'text', x: PAGE.pad, y: 14, text: t, size: 15, weight: 700, color: PALETTE.muted }, { t: 'line', x1: PAGE.pad, x2: PAGE.pad + INNER, y: 34, color: '#CFC8BA' }], y);
      y += headerH;
    }
    pg.blocks.forEach((b, j) => {
      // ページ先頭の見出しは、ページ見出しの線と重ならないよう区切り線を省く
      paint(ctx, j === 0 && total > 1 ? b.ops.filter((o) => o.t !== 'rule') : b.ops, y);
      y += b.h;
    });
    const blob = await toBlob(canvas);
    images.push({ blob, width: canvas.width, height: canvas.height, name: pg.name, index: i + 1, total });
  }
  return { report, images };
}
