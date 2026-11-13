import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  sampleDoc, emptyDoc, cloneOrder, serializeDoc, compareOrders, defaultOutput,
} from '../../docs/js/model.js';
import {
  makeEntry, emptyLibrary, serializeLibrary, parseLibrary, libraryFromLegacy, duplicateDoc, sortedByUpdated,
  searchOrders, orderLabel, orderSummary, exportOrder, exportAll, parseImport, libraryWithImported, FORMAT, LIBRARY_SCHEMA,
} from '../../docs/js/library.js';
import { createStore } from '../../docs/js/storage.js';
import { TRIAL_EDITION, FULL_EDITION } from '../../docs/js/edition.js';

const fixture = (n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');

/** localStorage の代わり。quota を指定すると、それを超える書き込みで QuotaExceededError */
function fakeStorage(init = {}, quota = Infinity) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const size = [...m.entries()].filter(([kk]) => kk !== k).reduce((a, [, vv]) => a + vv.length, 0) + v.length;
      if (size > quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
  };
}
const keysFull = { orders: FULL_EDITION.ordersKey, legacy: FULL_EDITION.storageKey };
const keysTrial = { orders: TRIAL_EDITION.ordersKey, legacy: TRIAL_EDITION.storageKey };

function orderDoc(no, dims = {}) {
  const d = emptyDoc();
  d.current.orderNo = no;
  d.current.dims = { height: '30', mouthWidth: '40', gusset: '10', handleHeight: '15', ...dims };
  d.current.outerColor = 'navy';
  d.current.lining = 'none';
  d.current.pocket = 'none';
  return d;
}

test('1・2. 旧形式の1件を、変更前・版番号・メモ・確認文ごと移行。再読み込みしても増えない', () => {
  const legacyText = fixture('backup-v1.json');
  const old = JSON.parse(legacyText);
  const s = fakeStorage({ [keysFull.legacy]: legacyText });
  const store = createStore(() => s, keysFull);
  const r1 = store.load();
  assert.equal(r1.status, 'migrated');
  assert.equal(r1.lib.orders.length, 1);
  const d = r1.lib.orders[0].doc;
  assert.equal(d.current.orderNo, old.data.current.orderNo);
  assert.equal(d.current.memo, old.data.current.memo);
  assert.deepEqual(d.baseline.dims, old.data.baseline.dims);
  assert.equal(d.version, old.data.version);
  assert.equal(d.baselineVersion, old.data.baseline_version);
  assert.equal(r1.lib.activeId, r1.lib.orders[0].id);
  assert.equal(s.getItem(keysFull.legacy), legacyText, '旧データは消さない');
  // 再読み込み：新形式があるので移行しない（増えない）。旧データで上書きもしない
  const r2 = store.load();
  assert.equal(r2.status, 'ok');
  assert.equal(r2.lib.orders.length, 1);
  assert.equal(r2.lib.orders[0].id, r1.lib.orders[0].id);
  // 新形式で編集→保存した後に読み直しても、旧データで上書きされない
  r2.lib.orders[0].doc.current.orderNo = 'EDITED';
  assert.ok(store.save(r2.lib).ok);
  assert.equal(store.load().lib.orders[0].doc.current.orderNo, 'EDITED');
});

test('確認文を含む schema 2 の1件も移行できる', () => {
  const doc = sampleDoc();
  doc.current.questions = '内ポケットの大きさは、お任せでよろしいですか？';
  const text = JSON.stringify(serializeDoc(doc));
  const store = createStore(() => fakeStorage({ [keysFull.legacy]: text }), keysFull);
  const r = store.load();
  assert.equal(r.lib.orders[0].doc.current.questions, doc.current.questions);
  assert.deepEqual(r.lib.orders[0].doc.output, doc.output);
  assert.equal(r.lib.orders[0].doc.isSample, true);
});

test('移行の保存に失敗しても旧データを残し、次回もう一度移行する', () => {
  const legacyText = fixture('backup-v1.json');
  const s = fakeStorage({ [keysFull.legacy]: legacyText }, legacyText.length + 100); // 新形式を書く余裕がない
  const store = createStore(() => s, keysFull);
  const r = store.load();
  assert.equal(r.status, 'migrate-unsaved');
  assert.equal(r.reason, 'quota');
  assert.equal(r.lib.orders.length, 1, '画面では使える');
  assert.equal(s.getItem(keysFull.orders), null, '途中の保存を残さない');
  assert.equal(s.getItem(keysFull.legacy), legacyText, '旧データは残る');
  const s2 = fakeStorage(Object.fromEntries(s.m));
  assert.equal(createStore(() => s2, keysFull).load().status, 'migrated', '容量が空けば移行できる');
});

test('読めない旧データ・読めない注文一覧は別名で保管し、元を消さない', () => {
  const s = fakeStorage({ [keysFull.legacy]: '{"schema_version":2,"data":' });
  const r = createStore(() => s, keysFull).load();
  assert.equal(r.status, 'legacy-broken');
  assert.equal(s.getItem(keysFull.legacy), '{"schema_version":2,"data":');
  const s2 = fakeStorage({ [keysFull.orders]: '{broken' });
  const r2 = createStore(() => s2, keysFull).load();
  assert.equal(r2.status, 'broken');
  assert.equal(s2.getItem(`${keysFull.orders}:broken`), '{broken');
  // 保管もできないときは保存を止める（broken-locked）
  const s3 = fakeStorage({ [keysFull.orders]: '{broken' }, 8);
  assert.equal(createStore(() => s3, keysFull).load().status, 'broken-locked');
});

test('11. 体験版と購入者用は、それぞれ独立して移行・保存する', () => {
  const full = JSON.stringify(serializeDoc(orderDoc('FULL-1')));
  const trial = JSON.stringify(serializeDoc(orderDoc('TRIAL-1')));
  const s = fakeStorage({ [keysFull.legacy]: full, [keysTrial.legacy]: trial });
  const rf = createStore(() => s, keysFull).load();
  const rt = createStore(() => s, keysTrial).load();
  assert.equal(rf.lib.orders[0].doc.current.orderNo, 'FULL-1');
  assert.equal(rt.lib.orders[0].doc.current.orderNo, 'TRIAL-1');
  assert.notEqual(keysFull.orders, keysTrial.orders);
  assert.equal(parseLibrary(s.getItem(keysFull.orders)).orders.length, 1);
  assert.equal(parseLibrary(s.getItem(keysTrial.orders)).orders.length, 1);
});

test('保存に失敗したら保存内容は変わらない（全件が保存されるか、何も変わらないか）', () => {
  const lib = emptyLibrary();
  lib.orders.push(makeEntry(orderDoc('A')));
  const s = fakeStorage();
  const store = createStore(() => s, keysFull);
  assert.ok(store.save(lib).ok);
  const before = s.getItem(keysFull.orders);
  const big = { ...lib, orders: [...lib.orders, makeEntry({ ...orderDoc('B'), current: { ...orderDoc('B').current, memo: 'x'.repeat(1000) } })] };
  const s2 = fakeStorage({ [keysFull.orders]: before }, before.length + 200);
  const r = createStore(() => s2, keysFull).save(big);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'quota');
  assert.equal(s2.getItem(keysFull.orders), before);
});

test('3・5. 注文ごとに独立。注文番号が同じでも内部IDが別で、上書きしない', () => {
  const lib = emptyLibrary();
  const a = makeEntry(orderDoc('SAME', { mouthWidth: '40' }));
  const b = makeEntry(orderDoc('SAME', { mouthWidth: '50' }));
  const c = makeEntry(orderDoc(''));
  lib.orders.push(a, b, c);
  assert.notEqual(a.id, b.id);
  const back = parseLibrary(JSON.stringify(serializeLibrary(lib)));
  assert.equal(back.orders.length, 3);
  assert.deepEqual(back.orders.map((o) => o.doc.current.dims.mouthWidth), ['40', '50', '40']);
  assert.equal(orderLabel(c.doc), '注文番号なし');
  // 壊れた・重複したIDは振り直す（ほかの注文を上書きしない）
  const raw = serializeLibrary(lib);
  raw.orders[1].id = raw.orders[0].id;
  const fixed = parseLibrary(JSON.stringify(raw));
  assert.equal(new Set(fixed.orders.map((o) => o.id)).size, 3);
});

test('6. 複製：寸法・表地・裏地と色・ポケットだけ。版1・変更前なし。元は変えない', () => {
  const src = sampleDoc();
  src.current.lining = 'yes';
  src.current.liningColor = 'navy';
  const before = JSON.stringify(src);
  const d = duplicateDoc(src);
  assert.deepEqual(d.current.dims, src.current.dims);
  assert.equal(d.current.outerColor, src.current.outerColor);
  assert.equal(d.current.lining, 'yes');
  assert.equal(d.current.liningColor, 'navy');
  assert.equal(d.current.pocket, src.current.pocket);
  assert.equal(d.current.orderNo, '');
  assert.equal(d.current.memo, '');
  assert.equal(d.current.questions, '');
  assert.equal(d.baseline, null);
  assert.equal(d.version, 1);
  assert.equal(d.baselineVersion, null);
  assert.equal(d.isSample, false);
  d.current.dims.height = '99';
  assert.equal(JSON.stringify(src), before, '複製元は変わらない');
});

test('一覧：更新の新しい順、注文番号で検索、要約', () => {
  const a = { ...makeEntry(orderDoc('A-100')), updatedAt: '2026-11-01T00:00:00.000Z' };
  const b = { ...makeEntry(orderDoc('b-200')), updatedAt: '2026-11-03T00:00:00.000Z' };
  const c = { ...makeEntry(orderDoc('')), updatedAt: '2026-11-02T00:00:00.000Z' };
  assert.deepEqual(sortedByUpdated([a, b, c]).map((o) => o.doc.current.orderNo), ['b-200', '', 'A-100']);
  assert.deepEqual(searchOrders([a, b, c], 'ｂ－２').map((o) => o.doc.current.orderNo), ['b-200']);
  assert.deepEqual(searchOrders([a, b, c], 'a-1').map((o) => o.doc.current.orderNo), ['A-100']);
  assert.equal(searchOrders([a, b, c], '').length, 3);
  assert.equal(orderSummary(a.doc), '高さ30・袋口40・マチ10・持ち手15cm／表地 ネイビー');
  const d = orderDoc('X', { gusset: '' });
  d.current.outerColor = '';
  assert.equal(orderSummary(d), '高さ30・袋口40・マチ？・持ち手15cm／表地 未定');
});

test('8. 1件用・全件用・旧形式のバックアップを読み込み、新しい注文として追加する', () => {
  const lib = emptyLibrary();
  const a = makeEntry(sampleDoc());
  const b = makeEntry(orderDoc('B-1'));
  lib.orders.push(a, b);
  // 1件用
  const one = exportOrder(a, 'full');
  assert.equal(one.format, FORMAT.order);
  assert.equal(one.schema_version, LIBRARY_SCHEMA);
  const p1 = parseImport(JSON.stringify(one), lib.orders);
  assert.equal(p1.kind, 'order');
  assert.equal(p1.entries.length, 1);
  assert.equal(p1.duplicateIds, 1, '同じ注文から書き出したもの');
  const { lib: lib2, added } = libraryWithImported(lib, p1);
  assert.equal(lib2.orders.length, 3);
  assert.notEqual(added[0].id, a.id, '新しい内部ID');
  assert.equal(added[0].doc.version, a.doc.version, '版番号を維持');
  assert.deepEqual(added[0].doc.baseline, a.doc.baseline, '変更前を維持');
  assert.equal(lib.orders.length, 2, '元の一覧は変えない');
  // 全件用
  const all = exportAll(lib, 'full');
  assert.equal(all.format, FORMAT.orders);
  const p2 = parseImport(JSON.stringify(all), []);
  assert.equal(p2.kind, 'orders');
  assert.equal(p2.entries.length, 2);
  assert.equal(p2.duplicateIds, 0);
  // 旧形式（schema 1）
  const p3 = parseImport(fixture('backup-v1.json'), lib.orders);
  assert.equal(p3.kind, 'legacy');
  assert.equal(p3.entries[0].doc.version, 2);
  assert.equal(p3.sameOrderNos, 1, '同じ注文番号がある（上書きしない）');
  // 10. 全件復元後も各注文の比較が正しい
  const { lib: lib3 } = libraryWithImported(emptyLibrary(), p2);
  const restoredA = lib3.orders.find((o) => o.doc.current.orderNo === 'SAMPLE-001');
  assert.deepEqual(compareOrders(restoredA.doc.baseline, restoredA.doc.current).spec.map((c) => c.text),
    compareOrders(a.doc.baseline, a.doc.current).spec.map((c) => c.text));
});

test('9. 不正なファイル・未対応の将来バージョンは読み込まない（1件でも不正なら全体を読み込まない）', () => {
  const lib = emptyLibrary();
  lib.orders.push(makeEntry(orderDoc('A')), makeEntry(orderDoc('B')));
  assert.throws(() => parseImport('{"format":', []), /JSON/);
  assert.throws(() => parseImport(JSON.stringify({ ...exportAll(lib, 'full'), schema_version: 4 }), []), /新しいバージョン/);
  assert.throws(() => parseImport(JSON.stringify({ schema_version: 9, data: {} }), []), /新しいバージョン/);
  const bad = exportAll(lib, 'full');
  bad.orders[1].data.current.dims.height = 'abc';
  assert.throws(() => parseImport(JSON.stringify(bad), []), /2件目/);
  assert.throws(() => parseImport(JSON.stringify({ ...exportAll(lib, 'full'), orders: [] }), []), /ありません/);
  assert.throws(() => parseImport('[]', []), /形式/);
});

test('読み込んだメモは文字として保持する（HTMLとして解釈しない前提のデータ）', () => {
  const d = orderDoc('<img src=x onerror=alert(1)>');
  d.current.memo = '<script>alert(1)</script>';
  const p = parseImport(JSON.stringify(exportOrder(makeEntry(d), 'full')), []);
  assert.equal(p.entries[0].doc.current.memo, '<script>alert(1)</script>');
  assert.equal(orderLabel(p.entries[0].doc), '<img src=x onerror=alert(1)>');
});

test('出力設定は注文ごとに保存される', () => {
  const lib = emptyLibrary();
  const a = makeEntry(orderDoc('A'));
  a.doc.output = { ...defaultOutput(), audience: 'maker' };
  const b = makeEntry(orderDoc('B'));
  lib.orders.push(a, b);
  const back = parseLibrary(JSON.stringify(serializeLibrary(lib)));
  assert.equal(back.orders[0].doc.output.audience, 'maker');
  assert.equal(back.orders[1].doc.output.audience, 'customer');
});

test('移行で作成日時は以前の書き出し時刻を使う', () => {
  const lib = libraryFromLegacy(fixture('backup-v1.json'));
  assert.equal(lib.orders[0].createdAt, '2026-11-12T01:00:00.000Z');
  const x = cloneOrder(lib.orders[0].doc.current);
  assert.ok(x);
});
