// かたち合わせ: データ定義・数値の正規化・検証・変更判定
// 数値は 0.1cm 単位の整数（tenths）で扱い、浮動小数点の誤差を避ける。

export const SCHEMA_VERSION = 1;

export const DIMS = [
  {
    key: 'height', label: '本体高さ', min: 50, max: 800,
    hint: '完成状態で、本体の底から袋口までの高さ。持ち手は含めません。',
  },
  {
    key: 'mouthWidth', label: '袋口幅', min: 50, max: 1000,
    hint: '袋口を平らにした状態の左右の幅。',
  },
  {
    key: 'gusset', label: 'マチ', min: 0, max: 400,
    hint: '底の奥行き。袋口幅より小さい値にしてください。',
  },
  {
    key: 'handleHeight', label: '持ち手高さ', min: 30, max: 500,
    hint: '袋口から持ち手の頂点までの高さ。テープの全長ではありません。',
  },
];
export const DIM_KEYS = DIMS.map((d) => d.key);
export const dimDef = (key) => DIMS.find((d) => d.key === key);

export const COLORS = [
  { key: 'kinari', label: '生成り', hex: '#EEE6D3' },
  { key: 'beige', label: 'ベージュ', hex: '#D3BC95' },
  { key: 'navy', label: 'ネイビー', hex: '#27365A' },
  { key: 'black', label: 'ブラック', hex: '#1E1E1E' },
  { key: 'dustypink', label: 'くすみピンク', hex: '#D2A3A1' },
  { key: 'olive', label: 'オリーブ', hex: '#6B693C' },
];
export const colorOf = (key) => COLORS.find((c) => c.key === key) || null;
export const colorLabel = (key) => (colorOf(key) ? colorOf(key).label : '未定');

export const TRI = [
  { key: 'undecided', label: '未定' },
  { key: 'none', label: 'なし' },
  { key: 'yes', label: 'あり' },
];
export const triLabel = (key) => (TRI.find((t) => t.key === key) || TRI[0]).label;

export const POCKET_CONDITION = '内側の片面中央に1個（寸法はこの確認では指定しません）';

export const LIMITS = { orderNo: 60, memo: 1000, dimRaw: 12 };

export function emptyOrder() {
  return {
    orderNo: '',
    memo: '',
    dims: { height: '', mouthWidth: '', gusset: '', handleHeight: '' },
    outerColor: '',
    lining: 'undecided',
    liningColor: '',
    pocket: 'undecided',
  };
}

export function emptyDoc() {
  return { current: emptyOrder(), baseline: null, version: 1, baselineVersion: null, isSample: false };
}

export function cloneOrder(o) {
  return {
    orderNo: o.orderNo,
    memo: o.memo,
    dims: { ...o.dims },
    outerColor: o.outerColor,
    lining: o.lining,
    liningColor: o.liningColor,
    pocket: o.pocket,
  };
}

// ---------- 数値 ----------

/**
 * 入力文字列を解釈する。全角数字・全角ピリオドも受け付ける。
 * 戻り値: {status:'empty'} | {status:'invalid', reason} | {status:'ok', value(0.1cm単位の整数)}
 */
export function parseDim(raw) {
  if (raw === null || raw === undefined) return { status: 'empty' };
  const s = String(raw).normalize('NFKC').replace(/[\s,]/g, '').replace(/cm$/i, '');
  if (s === '') return { status: 'empty' };
  if (/^[-−‐ー]/.test(s)) return { status: 'invalid', reason: 'マイナスの値は入力できません' };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return { status: 'invalid', reason: '数字で入力してください' };
  const intPart = m[1] === '' ? '0' : m[1];
  const dec = (m[2] || '').replace(/0+$/, '');
  if (dec.length > 1) return { status: 'invalid', reason: '小数第1位までで入力してください' };
  if (intPart.replace(/^0+/, '').length > 5) return { status: 'invalid', reason: '値が大きすぎます' };
  const value = parseInt(intPart, 10) * 10 + (dec ? parseInt(dec, 10) : 0);
  return { status: 'ok', value };
}

/** 0.1cm単位の整数を表示用文字列に。40.0 → "40", 40.5 → "40.5" */
export function fmt(tenths) {
  const sign = tenths < 0 ? '-' : '';
  const a = Math.abs(tenths);
  const i = Math.floor(a / 10);
  const d = a % 10;
  return sign + (d === 0 ? String(i) : `${i}.${d}`);
}

export const rangeText = (def) => `${fmt(def.min)}〜${fmt(def.max)}cm`;

/**
 * 寸法を検証する。底幅も算出する（袋口幅 − マチ。この形のバッグに限った関係）。
 * 各キー: {status:'ok'|'empty'|'invalid', value?, error?}
 */
export function evaluateDims(dims) {
  const out = {};
  for (const def of DIMS) {
    const p = parseDim(dims ? dims[def.key] : '');
    if (p.status === 'ok' && (p.value < def.min || p.value > def.max)) {
      out[def.key] = { status: 'invalid', error: `${rangeText(def)}の範囲で入力してください` };
    } else if (p.status === 'invalid') {
      out[def.key] = { status: 'invalid', error: p.reason };
    } else {
      out[def.key] = p;
    }
  }
  const mw = out.mouthWidth;
  const g = out.gusset;
  if (mw.status === 'ok' && g.status === 'ok' && g.value >= mw.value) {
    out.gusset = { status: 'invalid', error: `マチは袋口幅（${fmt(mw.value)}cm）より小さくしてください` };
  }
  if (out.mouthWidth.status === 'ok' && out.gusset.status === 'ok') {
    out.bottomWidth = { status: 'ok', value: out.mouthWidth.value - out.gusset.value };
  } else if (out.mouthWidth.status === 'invalid' || out.gusset.status === 'invalid') {
    out.bottomWidth = { status: 'invalid', error: '袋口幅とマチを確認すると計算されます' };
  } else {
    out.bottomWidth = { status: 'empty' };
  }
  return out;
}

// ---------- 解析（要確認・エラー） ----------

export function effectiveLiningColor(o) {
  return o.lining === 'yes' ? o.liningColor || '' : null; // null = 対象外
}

export function analyze(o) {
  const dims = evaluateDims(o.dims);
  const errors = [];
  const pending = [];
  if (!String(o.orderNo || '').trim()) pending.push({ key: 'orderNo', text: '注文番号：未入力' });
  for (const def of DIMS) {
    const d = dims[def.key];
    if (d.status === 'invalid') errors.push({ key: def.key, label: def.label, message: d.error });
    if (d.status === 'empty') pending.push({ key: def.key, text: `${def.label}：未入力` });
  }
  if (!colorOf(o.outerColor)) pending.push({ key: 'outerColor', text: '表地の色：未定' });
  if (o.lining === 'undecided') pending.push({ key: 'lining', text: '裏地：未定' });
  if (o.lining === 'yes' && !colorOf(o.liningColor)) pending.push({ key: 'liningColor', text: '裏地の色：未定' });
  if (o.pocket === 'undecided') pending.push({ key: 'pocket', text: '内ポケット：未定' });
  return { dims, errors, pending };
}

// ---------- 比較 ----------

function dimCompare(d) {
  if (d.status === 'ok') return { cmp: `n:${d.value}`, num: d.value, text: `${fmt(d.value)}cm` };
  if (d.status === 'empty') return { cmp: 'empty', num: null, text: '未入力' };
  return { cmp: 'invalid', num: null, text: '値に誤り' };
}

/** 比較に使う項目一覧（表示順） */
export function fieldValues(o) {
  const dims = evaluateDims(o.dims);
  const list = [];
  const orderNo = String(o.orderNo || '').trim();
  list.push({ key: 'orderNo', label: '注文番号', cmp: orderNo, text: orderNo || '未入力' });
  for (const key of ['height', 'mouthWidth', 'gusset']) {
    list.push({ key, label: dimDef(key).label, unit: 'cm', ...dimCompare(dims[key]) });
  }
  list.push({ key: 'bottomWidth', label: '底幅', unit: 'cm', derived: true, ...dimCompare(dims.bottomWidth) });
  list.push({ key: 'handleHeight', label: '持ち手高さ', unit: 'cm', ...dimCompare(dims.handleHeight) });
  list.push({ key: 'outerColor', label: '表地の色', cmp: o.outerColor || '', text: colorLabel(o.outerColor) });
  list.push({ key: 'lining', label: '裏地', cmp: o.lining, text: triLabel(o.lining) });
  const lc = effectiveLiningColor(o);
  list.push({ key: 'liningColor', label: '裏地の色', cmp: lc === null ? '-' : lc, text: lc === null ? '—（裏地なし／未定）' : colorLabel(lc) });
  list.push({ key: 'pocket', label: '内ポケット', cmp: o.pocket, text: triLabel(o.pocket) });
  const memo = String(o.memo || '').trim();
  list.push({ key: 'memo', label: '注文メモ', cmp: memo, text: memo ? 'あり' : 'なし', memo: true });
  return list;
}

/** before → after の変更点。値は正規化して比較する。 */
export function diffOrders(before, after) {
  const a = fieldValues(before);
  const b = fieldValues(after);
  const changes = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].cmp === b[i].cmp) continue;
    const c = { key: a[i].key, label: a[i].label, from: a[i], to: b[i] };
    if (a[i].key === 'bottomWidth') {
      const causes = [];
      if (changes.some((x) => x.key === 'mouthWidth')) causes.push('袋口幅');
      if (changes.some((x) => x.key === 'gusset')) causes.push('マチ');
      if (causes.length) c.note = `（${causes.join('・')}の変更に伴う）`;
      else c.note = '（自動計算）';
    }
    changes.push(c);
  }
  return changes;
}

export function changeText(c) {
  if (c.from.memo) return '注文メモ：内容を変更';
  let body;
  if (c.from.unit && c.from.num !== null && c.to.num !== null) {
    body = `${fmt(c.from.num)} → ${fmt(c.to.num)}cm`;
  } else {
    body = `${c.from.text} → ${c.to.text}`;
  }
  return `${c.label}：${body}${c.note || ''}`;
}

// ---------- サンプル ----------

export function sampleDoc() {
  const baseline = {
    orderNo: 'SAMPLE-001',
    memo: '架空のサンプルです。普段使い用。A4のクリアファイルが入る大きさを希望。',
    dims: { height: '30', mouthWidth: '40', gusset: '10', handleHeight: '15' },
    outerColor: 'kinari',
    lining: 'none',
    liningColor: '',
    pocket: 'none',
  };
  const current = cloneOrder(baseline);
  current.dims.mouthWidth = '45';
  current.pocket = 'yes';
  return { current, baseline, version: 2, baselineVersion: 1, isSample: true };
}

export function hasContent(doc) {
  if (doc.baseline) return true;
  const e = emptyOrder();
  const c = doc.current;
  return (
    c.orderNo !== e.orderNo || c.memo !== e.memo || c.outerColor !== e.outerColor ||
    c.lining !== e.lining || c.liningColor !== e.liningColor || c.pocket !== e.pocket ||
    DIM_KEYS.some((k) => c.dims[k] !== '')
  );
}

// ---------- JSON（バックアップ） ----------

export function serializeDoc(doc, now = new Date()) {
  return {
    schema_version: SCHEMA_VERSION,
    app: 'katachi-awase',
    exported_at: now.toISOString(),
    data: {
      current: cloneOrder(doc.current),
      baseline: doc.baseline ? cloneOrder(doc.baseline) : null,
      version: doc.version,
      baseline_version: doc.baselineVersion,
      is_sample: !!doc.isSample,
    },
  };
}

function validateOrder(o, where) {
  const fail = (msg) => { throw new Error(`${where}：${msg}`); };
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail('形式が正しくありません');
  if (typeof o.orderNo !== 'string' || o.orderNo.length > LIMITS.orderNo) fail('注文番号の形式が正しくありません');
  if (typeof o.memo !== 'string' || o.memo.length > LIMITS.memo) fail('注文メモの形式が正しくありません');
  if (!o.dims || typeof o.dims !== 'object') fail('寸法がありません');
  const dims = {};
  for (const def of DIMS) {
    const v = o.dims[def.key];
    if (typeof v !== 'string' || v.length > LIMITS.dimRaw) fail(`${def.label}の形式が正しくありません`);
    if (parseDim(v).status === 'invalid') fail(`${def.label}の値が数値ではありません`);
    dims[def.key] = v;
  }
  const colorOk = (c) => c === '' || !!colorOf(c);
  if (typeof o.outerColor !== 'string' || !colorOk(o.outerColor)) fail('表地の色が正しくありません');
  if (typeof o.liningColor !== 'string' || !colorOk(o.liningColor)) fail('裏地の色が正しくありません');
  const triOk = (t) => TRI.some((x) => x.key === t);
  if (!triOk(o.lining)) fail('裏地の値が正しくありません');
  if (!triOk(o.pocket)) fail('内ポケットの値が正しくありません');
  return {
    orderNo: o.orderNo, memo: o.memo, dims, outerColor: o.outerColor,
    lining: o.lining, liningColor: o.liningColor, pocket: o.pocket,
  };
}

/** JSON文字列を検証して doc を返す。不正なら Error を投げる（既存データには触れない）。 */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('JSONとして読み取れませんでした（ファイルが壊れている可能性があります）');
  }
  if (!obj || typeof obj !== 'object') throw new Error('形式が正しくありません');
  if (obj.schema_version !== SCHEMA_VERSION) {
    throw new Error(`対応していない形式です（schema_version: ${String(obj.schema_version)}）`);
  }
  const d = obj.data;
  if (!d || typeof d !== 'object') throw new Error('データ本体がありません');
  const current = validateOrder(d.current, '現在の内容');
  const baseline = d.baseline === null || d.baseline === undefined ? null : validateOrder(d.baseline, '比較元');
  const version = d.version;
  if (!Number.isInteger(version) || version < 1 || version > 9999) throw new Error('版番号が正しくありません');
  let baselineVersion = d.baseline_version === undefined ? null : d.baseline_version;
  if (baseline) {
    if (!Number.isInteger(baselineVersion) || baselineVersion < 1 || baselineVersion >= version) {
      throw new Error('比較元の版番号が正しくありません');
    }
    if (analyze(baseline).errors.length) throw new Error('比較元の寸法に範囲外の値があります');
  } else {
    if (baselineVersion !== null) throw new Error('比較元がないのに比較元の版番号があります');
    baselineVersion = null;
  }
  return { current, baseline, version, baselineVersion, isSample: d.is_sample === true };
}
