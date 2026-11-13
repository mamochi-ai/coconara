// 複数の注文（注文一覧）のデータ。画面や保存処理から独立した、検証できる関数だけを置く。
//
// 端末内の保存形式（1つのキーにまとめて保存。書き込みは1回で全件が成功するか、何も変わらないか）:
//   { format: 'katachi-awase/library', schema_version: 3, active_id, orders: [OrderEntry...] }
// OrderEntry:
//   { id, created_at, updated_at, data: <serializeDoc(doc).data と同じ形> }
// バックアップ:
//   1件用 { format: 'katachi-awase/order',  schema_version: 3, app, exported_at, edition, order: OrderEntry }
//   全件用 { format: 'katachi-awase/orders', schema_version: 3, app, exported_at, edition, orders: [OrderEntry...] }
//   旧形式（schema 1・2）の1件用バックアップも読み込める。
import {
  serializeDoc, parseDocData, parseBackup, cloneOrder, emptyOrder, emptyDoc, defaultOutput,
  colorLabel, evaluateDims, fmt, SUPPORTED_SCHEMAS,
} from './model.js';

export const LIBRARY_SCHEMA = 3;
export const FORMAT = {
  library: 'katachi-awase/library',
  order: 'katachi-awase/order',
  orders: 'katachi-awase/orders',
};
export const MAX_ORDERS = 500;

/** 内部ID（注文番号とは別。注文番号が同じ・空・変更されても別の注文として扱う） */
export function newId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch { /* 下の方法で作る */ }
  const r = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${r()}-${r().slice(0, 4)}-${r().slice(0, 4)}-${r().slice(0, 4)}-${r()}${r().slice(0, 4)}`;
}

const isoOr = (v, fallback) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback);

export function makeEntry(doc, now = new Date(), id = newId()) {
  const t = now.toISOString();
  return { id, createdAt: t, updatedAt: t, doc };
}

export function emptyLibrary() {
  return { activeId: null, orders: [] };
}

// ---------- 保存形式 ----------

function entryToJson(e) {
  return { id: e.id, created_at: e.createdAt, updated_at: e.updatedAt, data: serializeDoc(e.doc).data };
}

/** 1件分を検証。id は呼び出し側で扱う（読み込み時は新しいIDにする） */
function entryFromJson(o, where) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`${where}：形式が正しくありません`);
  let doc;
  try {
    doc = parseDocData(o.data);
  } catch (err) {
    throw new Error(`${where}：${err.message}`);
  }
  const now = new Date().toISOString();
  return {
    id: typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 80 ? o.id : null,
    createdAt: isoOr(o.created_at, now),
    updatedAt: isoOr(o.updated_at, isoOr(o.created_at, now)),
    doc,
  };
}

export function serializeLibrary(lib) {
  return {
    format: FORMAT.library,
    schema_version: LIBRARY_SCHEMA,
    active_id: lib.activeId,
    orders: lib.orders.map(entryToJson),
  };
}

/** 端末内の保存データを読む。不正なら Error（呼び出し側で元データを保管する） */
export function parseLibrary(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('保存データを読み取れませんでした'); }
  if (!obj || obj.format !== FORMAT.library) throw new Error('注文一覧の保存データではありません');
  if (obj.schema_version !== LIBRARY_SCHEMA) throw new Error(`対応していない保存形式です（schema_version: ${String(obj.schema_version)}）`);
  if (!Array.isArray(obj.orders)) throw new Error('注文がありません');
  const seen = new Set();
  const orders = obj.orders.map((o, i) => {
    const e = entryFromJson(o, `${i + 1}件目`);
    if (!e.id || seen.has(e.id)) e.id = newId(); // 壊れたIDは振り直す（ほかの注文を上書きしない）
    seen.add(e.id);
    return e;
  });
  const activeId = orders.some((o) => o.id === obj.active_id) ? obj.active_id : null;
  return { activeId, orders };
}

// ---------- 既存データ（1件だけの保存）の移行 ----------

/**
 * 以前の1件用の保存データ（schema 1・2）から、注文一覧を作る。
 * 注文内容・変更前・版番号・メモ・確認文・出力設定・サンプルかどうかをそのまま引き継ぐ。
 */
export function libraryFromLegacy(text, now = new Date()) {
  const doc = parseBackup(text); // 不正なら Error
  let created = now.toISOString();
  try {
    const t = JSON.parse(text).exported_at;
    created = isoOr(t, created);
  } catch { /* 現在時刻を使う */ }
  const entry = { id: newId(), createdAt: created, updatedAt: created, doc };
  return { activeId: entry.id, orders: [entry] };
}

// ---------- 一覧の表示用 ----------

export function sortedByUpdated(orders) {
  return [...orders].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

const norm = (t) => String(t || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** 注文番号で検索（全角・半角、大文字・小文字、空白の違いを無視） */
export function searchOrders(orders, query) {
  const q = norm(query);
  if (!q) return orders;
  return orders.filter((o) => norm(o.doc.current.orderNo).includes(q));
}

export function orderLabel(doc) {
  const no = String(doc.current.orderNo || '').trim();
  return no || '注文番号なし';
}

/** 主な寸法と表地の色の短い要約（例：高さ30・袋口40・マチ10・持ち手15cm／表地 ネイビー） */
export function orderSummary(doc) {
  const ev = evaluateDims(doc.current.dims);
  const v = (k) => (ev[k].status === 'ok' ? fmt(ev[k].value) : '？');
  return `高さ${v('height')}・袋口${v('mouthWidth')}・マチ${v('gusset')}・持ち手${v('handleHeight')}cm／表地 ${colorLabel(doc.current.outerColor)}`;
}

export function formatDateTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  const md = `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

// ---------- 複製 ----------

export const DUPLICATE_NOTE = '寸法と仕様をコピーします。注文番号・メモ・比較履歴は引き継ぎません';

/** 寸法・表地・裏地と色・内ポケットだけを引き継ぎ、版1・変更前なしの新しい注文にする */
export function duplicateDoc(src) {
  const c = emptyOrder();
  c.dims = { ...src.current.dims };
  c.outerColor = src.current.outerColor;
  c.lining = src.current.lining;
  c.liningColor = src.current.liningColor;
  c.pocket = src.current.pocket;
  return { current: c, baseline: null, version: 1, baselineVersion: null, isSample: false, output: defaultOutput() };
}

export function newOrderDoc() {
  return emptyDoc();
}

// ---------- バックアップ ----------

const header = (format, edition, now) => ({
  format, schema_version: LIBRARY_SCHEMA, app: 'katachi-awase', exported_at: now.toISOString(), edition,
});

export function exportOrder(entry, edition, now = new Date()) {
  return { ...header(FORMAT.order, edition, now), order: entryToJson(entry) };
}

export function exportAll(lib, edition, now = new Date()) {
  return { ...header(FORMAT.orders, edition, now), orders: sortedByUpdated(lib.orders).map(entryToJson) };
}

/**
 * 読み込むファイル全体を検証する（1件でも不正なら全体を読み込まない）。
 * 戻り値：{ kind: 'order'|'orders'|'legacy', entries:[{sourceId, createdAt, updatedAt, doc}], duplicateIds, sameOrderNos }
 */
export function parseImport(text, existingOrders = []) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('JSONとして読み取れませんでした（ファイルが壊れている可能性があります）'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('形式が正しくありません');
  let kind;
  let raw;
  if (obj.format === FORMAT.order || obj.format === FORMAT.orders || obj.format === FORMAT.library) {
    if (typeof obj.schema_version !== 'number') throw new Error('形式の版がありません');
    if (obj.schema_version > LIBRARY_SCHEMA) throw new Error(`このファイルは新しいバージョンで作られています（schema_version: ${obj.schema_version}）。ツールを最新にしてから読み込んでください`);
    if (obj.schema_version !== LIBRARY_SCHEMA) throw new Error(`対応していない形式です（schema_version: ${String(obj.schema_version)}）`);
    if (obj.format === FORMAT.order) {
      kind = 'order';
      raw = [obj.order];
    } else {
      kind = 'orders';
      if (!Array.isArray(obj.orders)) throw new Error('注文がありません');
      raw = obj.orders;
    }
  } else if (SUPPORTED_SCHEMAS.includes(obj.schema_version) && obj.data) {
    kind = 'legacy';
    raw = [{ data: obj.data, created_at: obj.exported_at, updated_at: obj.exported_at }];
  } else if (typeof obj.schema_version === 'number' && obj.schema_version > LIBRARY_SCHEMA) {
    throw new Error(`このファイルは新しいバージョンで作られています（schema_version: ${obj.schema_version}）。ツールを最新にしてから読み込んでください`);
  } else {
    throw new Error(`対応していない形式です（schema_version: ${String(obj.schema_version)}）`);
  }
  if (raw.length === 0) throw new Error('読み込める注文がありません');
  if (raw.length > MAX_ORDERS) throw new Error(`注文が多すぎます（${MAX_ORDERS}件まで）`);
  const entries = raw.map((o, i) => {
    const e = entryFromJson(o, raw.length > 1 ? `${i + 1}件目` : '注文');
    return { sourceId: e.id, createdAt: e.createdAt, updatedAt: e.updatedAt, doc: e.doc };
  });
  const existingIds = new Set(existingOrders.map((o) => o.id));
  const existingNos = new Set(existingOrders.map((o) => String(o.doc.current.orderNo || '').trim()).filter(Boolean));
  return {
    kind,
    entries,
    duplicateIds: entries.filter((e) => e.sourceId && existingIds.has(e.sourceId)).length,
    sameOrderNos: entries.filter((e) => existingNos.has(String(e.doc.current.orderNo || '').trim())).length,
  };
}

/**
 * 読み込んだ注文を「新しい注文として追加」した注文一覧を作る（元の一覧は変更しない）。
 * 新しい内部IDを振り、変更前・版番号は維持。更新日時は読み込んだ時刻（一覧の上に表示するため）。
 */
export function libraryWithImported(lib, parsed, now = new Date()) {
  if (lib.orders.length + parsed.entries.length > MAX_ORDERS) throw new Error(`注文は${MAX_ORDERS}件まで保存できます`);
  const t = now.toISOString();
  const added = parsed.entries.map((e) => ({
    id: newId(), createdAt: e.createdAt, updatedAt: t, doc: { ...e.doc, current: cloneOrder(e.doc.current), baseline: e.doc.baseline ? cloneOrder(e.doc.baseline) : null },
  }));
  return { lib: { activeId: lib.activeId, orders: [...lib.orders, ...added] }, added };
}
