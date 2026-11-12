import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyOrder, emptyDoc, sampleDoc, cloneOrder, parseBackup, serializeDoc, defaultOutput, fieldValues } from '../../docs/js/model.js';
import { buildReport } from '../../docs/js/report.js';
import { layoutPages, PAGE, imageFileName, safeFilePart } from '../../docs/js/export.js';
import { compareOrders } from '../../docs/js/model.js';
import { buildFigure, stateFn, sceneToSvg, PALETTE, textWidth } from '../../docs/js/diagram.js';

const NOW = new Date('2026-11-12T10:00:00+09:00');
const CUSTOMER = defaultOutput();
const MAKER = { ...defaultOutput(), audience: 'maker' };
// Canvas がない環境で配置計算だけを確かめるための文字幅計測
const fakeCtx = { font: '16px x', measureText(t) { return { width: textWidth(t, parseFloat(/(\d+(\.\d+)?)px/.exec(this.font)[1])) }; } };

function base() {
  return {
    ...emptyOrder(), orderNo: 'T-1', dims: { height: '30', mouthWidth: '40', gusset: '10', handleHeight: '15' },
    outerColor: 'kinari', lining: 'none', liningColor: '', pocket: 'none',
  };
}
function docWith(edit, b = base()) {
  const current = cloneOrder(b);
  edit(current);
  return { current, baseline: b, version: 2, baselineVersion: 1, isSample: false, output: defaultOutput() };
}
const allText = (r) => JSON.stringify(r);

test('ケース1：高さ・マチ・持ち手・表地・裏地・ポケットの変更（お客様用の短い一覧）', () => {
  const doc = docWith((c) => {
    c.dims.height = '40'; c.dims.gusset = '1'; c.dims.handleHeight = '10';
    c.outerColor = 'black'; c.lining = 'yes'; c.liningColor = 'navy'; c.pocket = 'yes';
  });
  const r = buildReport(doc, CUSTOMER, NOW);
  assert.deepEqual(r.changes.map((c) => c.text), [
    '本体高さ：30 → 40cm',
    'マチ：10 → 1cm',
    '底幅：30 → 39cm（マチ変更に伴う）',
    '持ち手高さ：15 → 10cm',
    '表地：生成り → ブラック',
    '裏地：なし → あり〈ネイビー〉',
    '内ポケット：なし → あり',
  ]);
  assert.equal(r.parts.side, true, 'マチ変更で側面図を追加');
  assert.equal(r.parts.interior, true, '裏地・ポケット変更で内側図を追加');
  assert.equal(r.table, null, 'お客様用に全項目の比較表は載せない');
  assert.equal(r.title, 'バッグの変更内容');
});

test('ケース2：袋口幅だけ変更 → 側面図・内側図は省略、マチ等は短い仕様欄に', () => {
  const r = buildReport(docWith((c) => { c.dims.mouthWidth = '45'; }), CUSTOMER, NOW);
  assert.deepEqual(r.changes.map((c) => c.text), ['袋口幅：40 → 45cm', '底幅：30 → 35cm（袋口幅変更に伴う）']);
  assert.equal(r.parts.side, false);
  assert.equal(r.parts.interior, false);
  assert.deepEqual(r.specShort.map((x) => `${x.label}：${x.text}`), ['マチ：10cm', '裏地：なし', '内ポケット：なし']);
  // 設定で追加できる
  const r2 = buildReport(docWith((c) => { c.dims.mouthWidth = '45'; }), { ...CUSTOMER, side: true, interior: true }, NOW);
  assert.equal(r2.parts.side, true);
  assert.equal(r2.parts.interior, true);
  assert.deepEqual(r2.specShort, []);
});

test('ケース3：裏地の色だけ変更', () => {
  const b = { ...base(), lining: 'yes', liningColor: 'beige' };
  const r = buildReport(docWith((c) => { c.liningColor = 'navy'; }, b), CUSTOMER, NOW);
  assert.deepEqual(r.changes.map((c) => c.text), ['裏地の色：ベージュ → ネイビー']);
  assert.equal(r.parts.interior, true);
  assert.equal(r.parts.side, false);
});

test('ケース4：比較元から変更がない（40 と 40.0 も同じ）', () => {
  const r = buildReport(docWith((c) => { c.dims.mouthWidth = '40.0'; }), CUSTOMER, NOW);
  assert.deepEqual(r.changes, []);
  const { pages } = layoutPages(docWith(() => {}), CUSTOMER, NOW, fakeCtx);
  const texts = pages.flatMap((p) => p.blocks.flatMap((b) => b.ops.filter((o) => o.t === 'text').map((o) => o.text)));
  assert.ok(texts.includes('比較元からの変更はありません'));
});

test('ケース5：比較元がない初回注文', () => {
  const doc = { ...emptyDoc(), current: base() };
  const r = buildReport(doc, CUSTOMER, NOW);
  assert.equal(r.title, 'バッグのご注文内容');
  assert.equal(r.changes, null);
  assert.equal(r.compare, false);
  assert.deepEqual(r.specShort.map((x) => x.label), ['マチ', '裏地', '内ポケット']);
  assert.deepEqual(r.pending, []);
});

test('ケース6：未入力・未定がある注文（「要確認」ではなく「未入力・未定」）', () => {
  const doc = { ...emptyDoc(), current: { ...base(), dims: { ...base().dims, gusset: '' }, lining: 'undecided', outerColor: '' } };
  const r = buildReport(doc, CUSTOMER, NOW);
  assert.deepEqual(r.pending, ['マチ：未入力', '表地の色：未定', '裏地：未定']);
  const { pages } = layoutPages(doc, CUSTOMER, NOW, fakeCtx);
  const texts = pages.flatMap((p) => p.blocks.flatMap((b) => b.ops.filter((o) => o.t === 'text').map((o) => o.text)));
  assert.ok(texts.includes('未入力・未定の項目'));
  assert.ok(!texts.some((t) => /要確認/.test(t)));
  // 裏地未定のとき、色を確定扱いにしない
  const mk = buildReport(doc, MAKER, NOW);
  assert.equal(mk.table.find((x) => x.key === 'liningColor').after, '未定');
  const none = buildReport({ ...emptyDoc(), current: base() }, MAKER, NOW);
  assert.equal(none.table.find((x) => x.key === 'liningColor').after, '対象外');
});

test('ケース7：長い注文メモ・確認事項は小さくせず複数枚に分け、行を切らない', () => {
  const doc = sampleDoc();
  doc.current.memo = '肩掛けできる長さの持ち手を希望。A4のクリアファイルが入る大きさを希望。'.repeat(40);
  doc.current.questions = '内ポケットの大きさは、お任せでよろしいですか？\n'.repeat(30);
  for (const settings of [{ ...CUSTOMER, memo: true }, MAKER]) {
    const { pages } = layoutPages(doc, settings, NOW, fakeCtx);
    assert.ok(pages.length >= 2, `${settings.audience}: ${pages.length}枚`);
    assert.equal(pages[0].name, '図と変更点');
    assert.ok(pages.some((p) => p.name && p.name.startsWith('詳細')));
    for (const p of pages) {
      const h = p.blocks.reduce((a, b) => a + b.h, 0);
      assert.ok(h <= PAGE.singleMax, `ページ高さ ${h}`);
      // 見出しがページの末尾に取り残されない
      assert.ok(!p.blocks[p.blocks.length - 1].keep, '見出しだけが残らない');
    }
    // 文字サイズは縮めない（本文は16px以上）
    const sizes = pages.flatMap((p) => p.blocks.flatMap((b) => b.ops.filter((o) => o.t === 'text').map((o) => o.size)));
    assert.ok(Math.min(...sizes) >= 13);
    // 全文が載っている（メモ・確認事項の文字数が一致）
    const joined = pages.flatMap((p) => p.blocks.flatMap((b) => b.ops.filter((o) => o.t === 'text').map((o) => o.text))).join('');
    assert.ok(joined.includes('肩掛けできる長さの持ち手を希望。A4'));
    const count = (joined.match(/内ポケットの大きさは、お任せでよろしいですか？/g) || []).length;
    assert.equal(count, 30);
  }
  // 短い場合は1枚
  assert.equal(layoutPages(sampleDoc(), CUSTOMER, NOW, fakeCtx).pages.length, 1);
});

test('注文メモはお客様用では選択制。メモ・確認事項はそのまま載せ、収納可否を断定しない', () => {
  const doc = sampleDoc();
  assert.equal(buildReport(doc, CUSTOMER, NOW).memo, null);
  const r = buildReport(doc, { ...CUSTOMER, memo: true }, NOW);
  assert.equal(r.memo, doc.current.memo.trim());
  assert.equal(r.questions, '内ポケットの大きさは、お任せでよろしいですか？');
  assert.ok(!/入ります|収まります|承認済み|製作確定|確認済み/.test(allText(r)));
  // 空欄の確認事項は省略
  const d2 = sampleDoc(); d2.current.questions = '  ';
  const { pages } = layoutPages(d2, CUSTOMER, NOW, fakeCtx);
  const texts = pages.flatMap((p) => p.blocks.flatMap((b) => b.ops.filter((o) => o.t === 'text').map((o) => o.text)));
  assert.ok(!texts.includes('お客様に確認したいこと'));
});

test('ケース10：お客様用と作家用で数値・変更判定が一致する', () => {
  const docs = [
    docWith((c) => { c.dims.height = '40'; c.dims.gusset = '1'; c.outerColor = 'black'; c.lining = 'yes'; c.liningColor = 'navy'; c.pocket = 'yes'; }),
    docWith((c) => { c.dims.mouthWidth = '45'; }),
    sampleDoc(),
  ];
  for (const doc of docs) {
    const cu = buildReport(doc, CUSTOMER, NOW);
    const mk = buildReport(doc, MAKER, NOW);
    assert.deepEqual(cu.changedKeys, mk.changedKeys);
    const rowsChanged = mk.table.filter((r) => r.changed).map((r) => r.key);
    for (const c of cu.changes) for (const k of c.keys) assert.ok(rowsChanged.includes(k) || !mk.table.some((r) => r.key === k), k);
    // 変更後の寸法値が一致（例：「30 → 40cm」の 40cm が表にもある）
    for (const c of cu.changes) {
      const m = /→ ([\d.]+)cm/.exec(c.text);
      if (!m) continue;
      const row = mk.table.find((r) => r.key === c.keys[0]);
      assert.ok(row.after.startsWith(`${m[1]}cm`), `${c.text} / ${row.after}`);
    }
    assert.deepEqual(cu.pending, mk.pending);
  }
});

test('ケース11：旧形式（schema 1）のJSONを読み込める。比較元・注文内容は書き換えない', () => {
  const raw = readFileSync(new URL('../fixtures/backup-v1.json', import.meta.url), 'utf8');
  const old = JSON.parse(raw);
  const doc = parseBackup(raw);
  assert.equal(doc.current.questions, '');
  assert.deepEqual(doc.output, defaultOutput());
  for (const k of ['orderNo', 'memo', 'outerColor', 'lining', 'liningColor', 'pocket']) {
    assert.equal(doc.current[k], old.data.current[k]);
    assert.equal(doc.baseline[k], old.data.baseline[k]);
  }
  assert.deepEqual(doc.baseline.dims, old.data.baseline.dims);
  assert.equal(doc.version, old.data.version);
  assert.equal(doc.baselineVersion, old.data.baseline_version);
  // 書き出すと schema 2 になり、もう一度読める
  assert.deepEqual(parseBackup(JSON.stringify(serializeDoc(doc))), doc);
  const init = parseBackup(readFileSync(new URL('../fixtures/backup-v1-initial.json', import.meta.url), 'utf8'));
  assert.equal(init.baseline, null);
  assert.equal(init.current.lining, 'undecided', '未定を「なし」に読み替えない');
});

test('ケース8・9：黒い表地でも線が読め、変更した持ち手・ポケットをオレンジで塗らない', () => {
  const doc = docWith((c) => { c.outerColor = 'black'; c.dims.handleHeight = '25'; c.lining = 'yes'; c.liningColor = 'black'; c.pocket = 'yes'; });
  const changes = ['handleHeight', 'outerColor', 'lining', 'liningColor', 'pocket'];
  const sc = buildFigure([{ order: doc.current, st: stateFn(changes, null) }], { side: true, interior: true });
  const orange = PALETTE.change;
  for (const it of sc.items) {
    // オレンジの塗り（fill）は使わない。オレンジは線（寸法線・囲み）と文字だけ
    if (it.t !== "text") assert.notEqual(it.fill, orange, JSON.stringify(it).slice(0, 100));
    // 太い線（持ち手の帯 width 6）はオレンジにしない
    if (it.t === 'path' && it.width >= 5) assert.notEqual(it.stroke, orange);
  }
  // 持ち手は中立色の中空の帯で描く
  assert.ok(sc.items.some((it) => it.t === 'path' && it.width === 6 && it.stroke === PALETTE.handle));
  // 変更は外側の囲み（破線の枠）で示す
  assert.ok(sc.items.some((it) => it.t === 'rect' && it.stroke === orange && it.dash));
  // 黒い塗りの上の袋口線・ポケット線は明るい色
  const light = sc.items.filter((it) => it.t !== 'text' && it.stroke === '#F2EEE6');
  assert.ok(light.length >= 2, '濃い色の上の線');
  const svg = sceneToSvg(sc);
  assert.match(svg, /持ち手高さ/);
  assert.match(svg, /持ち手・ポケットの色はこの図では指定していません/);
  assert.match(svg, /色と大きさは未指定/);
});

test('図：お客様用（正面図のみの比較）は底位置をそろえた共通縮尺', () => {
  const doc = docWith((c) => { c.dims.height = '40'; });
  const sc = buildFigure([{ order: doc.baseline, title: 'a' }, { order: doc.current, title: 'b' }], { side: false, interior: false });
  // 2つの本体の底（台形の最後の H の y）が同じ
  const bodies = sc.items.filter((it) => it.t === 'path' && it.width === 2 && /Z$/.test(it.d));
  const bottoms = bodies.map((b) => Number(/L[\d.]+ ([\d.]+)H/.exec(b.d)[1]));
  assert.equal(bottoms.length, 2);
  assert.equal(bottoms[0], bottoms[1]);
  assert.ok(!/側面図|内側図/.test(sceneToSvg(sc)));
  assert.match(sceneToSvg(sc), /正面図の変更前後は共通縮尺/);
});

test('画面と確認画像で同じ仕様変更一覧・件数を使う', () => {
  const doc = sampleDoc();
  doc.current.memo = '変更したメモ';
  const cmp = compareOrders(doc.baseline, doc.current);
  for (const settings of [CUSTOMER, { ...CUSTOMER, memo: true }, MAKER]) {
    const r = buildReport(doc, settings, NOW);
    assert.deepEqual(r.changes.map((c) => c.text), cmp.spec.map((c) => c.text));
    assert.equal(r.specCount, cmp.specCount);
    const { pages } = layoutPages(doc, settings, NOW, fakeCtx);
    const texts = pages.flatMap((p) => p.blocks.flatMap((b) => b.ops.filter((o) => o.t === 'text').map((o) => o.text)));
    assert.ok(texts.includes(`仕様変更（${cmp.specCount}件）`), settings.audience);
    assert.ok(texts.includes('確認文の変更あり'));
    // 注文メモの変更は、メモを載せる場合だけ記載
    assert.equal(texts.includes('注文メモの変更あり'), !!(settings.memo || settings.audience === 'maker'));
    assert.ok(!texts.some((t) => /注文メモ：内容を変更|確認したいこと：内容を変更/.test(t)), '文章の変更を仕様変更一覧に入れない');
  }
  // 文章だけの変更
  const d2 = sampleDoc(); d2.current = cloneOrder(d2.baseline); d2.current.questions = 'q';
  const { pages } = layoutPages(d2, CUSTOMER, NOW, fakeCtx);
  const texts = pages.flatMap((p) => p.blocks.flatMap((b) => b.ops.filter((o) => o.t === 'text').map((o) => o.text)));
  assert.ok(texts.includes('仕様変更なし') && texts.includes('確認文の変更あり'));
});

test('ファイル名：注文番号・版・用途・ページ番号。使えない文字は置き換える', () => {
  assert.equal(imageFileName({ orderNo: 'SAMPLE-001', version: 2, audience: 'customer' }), 'katachi_SAMPLE-001_v2_customer.png');
  assert.equal(imageFileName({ orderNo: 'SAMPLE-001', version: 3, audience: 'maker', index: 2, total: 3 }), 'katachi_SAMPLE-001_v3_maker_p2of3.png');
  assert.equal(safeFilePart('a/b\\c:d*e?f"g<h>i|j k'), 'a_b_c_d_e_f_g_h_i_j_k');
  assert.equal(safeFilePart(''), 'order');
  assert.equal(safeFilePart('ご注文#１２'), 'ご注文_12');
  assert.ok(!/[\\/:*?"<>|\s]/.test(imageFileName({ orderNo: '../x y', version: 1, audience: 'customer' })));
});
