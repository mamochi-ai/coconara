// かたち合わせ: データ定義・数値の正規化・検証・変更判定
// 数値は 0.1cm 単位の整数（tenths）で扱い、浮動小数点の誤差を避ける。

export const SCHEMA_VERSION = 2;
/** 読み込める形式（1 = 最初の試作。確認事項・出力設定がない） */
export const SUPPORTED_SCHEMAS = [1, 2];

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
export const POCKET_SHORT = 'あり（内側の片面中央に1個・大きさと色は未指定）';

export const LIMITS = { orderNo: 60, memo: 1000, questions: 1000, dimRaw: 12 };

export function emptyOrder() {
  return {
    orderNo: '',
    memo: '',
    questions: '',
    dims: { height: '', mouthWidth: '', gusset: '', handleHeight: '' },
    outerColor: '',
    lining: 'undecided',
    liningColor: '',
    pocket: 'undecided',
  };
}

/** 確認画像の出力設定（初期値）。お客様用が標準。注文メモは初期状態では載せない */
export function defaultOutput() {
  return { audience: 'customer', side: false, interior: false, memo: false };
}

export function emptyDoc() {
  return { current: emptyOrder(), baseline: null, version: 1, baselineVersion: null, isSample: false, output: defaultOutput() };
}

export function cloneOrder(o) {
  return {
    orderNo: o.orderNo,
    memo: o.memo,
    questions: o.questions || '',
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
  return o.lining === 'yes' ? o.liningColor || '' : null; // null = 対象外または裏地未定
}

/**
 * 裏地の色の表示。まとめた「なし／未定」表示は使わない。
 * 裏地なし → 対象外、裏地未定 → 未定（確定扱いにしない）、裏地あり・色未選択 → 未定
 */
export function liningColorValue(o) {
  if (o.lining === 'none') return { cmp: 'na', text: '対象外' };
  if (o.lining === 'yes' && colorOf(o.liningColor)) return { cmp: o.liningColor, text: colorOf(o.liningColor).label };
  return { cmp: 'undecided', text: '未定' };
}

/** 裏地のまとめ表示：「あり〈ネイビー〉」「あり〈色は未定〉」「なし」「未定」 */
export function liningSummary(o) {
  if (o.lining === 'yes') return `あり〈${colorOf(o.liningColor) ? colorOf(o.liningColor).label : '色は未定'}〉`;
  return triLabel(o.lining);
}
export function pocketSummary(o) {
  return o.pocket === 'yes' ? POCKET_SHORT : triLabel(o.pocket);
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
  list.push({ key: 'liningColor', label: '裏地の色', ...liningColorValue(o) });
  list.push({ key: 'pocket', label: '内ポケット', cmp: o.pocket, text: triLabel(o.pocket) });
  const memo = String(o.memo || '').trim();
  list.push({ key: 'memo', label: '注文メモ', cmp: memo, text: memo ? 'あり' : 'なし', memo: true });
  const q = String(o.questions || '').trim();
  list.push({ key: 'questions', label: 'お客様に確認したいこと', cmp: q, text: q ? 'あり' : 'なし', memo: true });
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
      if (causes.length) c.note = `（${causes.join('・')}変更に伴う）`;
      else c.note = '（自動計算）';
    }
    changes.push(c);
  }
  return changes;
}

export function changeText(c) {
  if (c.from.memo) return `${c.label}：内容を変更`;
  let body;
  if (c.from.unit && c.from.num !== null && c.to.num !== null) {
    body = `${fmt(c.from.num)} → ${fmt(c.to.num)}cm`;
  } else {
    body = `${c.from.text} → ${c.to.text}`;
  }
  return `${c.label}：${body}${c.note || ''}`;
}

/** 文章の項目（仕様変更には数えない） */
export const TEXT_KEYS = ['orderNo', 'memo', 'questions'];

/**
 * 仕様変更の一覧（バッグの仕様だけ）。画面の件数・一覧と確認画像はすべてこの結果を使う。
 * 件数＝この一覧の行数。自動計算の底幅も理由を添えて1行。
 * 裏地の有無が変わった場合は色も含めて1行にまとめ、裏地ありのまま色だけ変えた場合は
 * 「裏地の色：A → B」の1行にする。
 */
export function summarizeChanges(before, after) {
  const diff = diffOrders(before, after);
  const keys = new Set(diff.map((c) => c.key));
  const out = [];
  for (const c of diff) {
    if (TEXT_KEYS.includes(c.key)) continue;
    if (c.key === 'lining') {
      out.push({ keys: ['lining', 'liningColor'], text: `裏地：${liningSummary(before)} → ${liningSummary(after)}` });
    } else if (c.key === 'liningColor') {
      if (!keys.has('lining')) out.push({ keys: ['liningColor'], text: changeText(c) });
    } else if (c.key === 'outerColor') {
      out.push({ keys: ['outerColor'], text: `表地：${c.from.text} → ${c.to.text}` });
    } else {
      out.push({ keys: [c.key], text: changeText(c) });
    }
  }
  return out;
}

/**
 * 比較の結果を「仕様変更」と「文章の変更」に分けて返す。
 * spec: 仕様変更一覧（件数＝行数）、text: 文章の変更（注文番号・注文メモ・確認文）
 */
export function compareOrders(before, after) {
  const diff = diffOrders(before, after);
  const keys = new Set(diff.map((c) => c.key));
  const spec = summarizeChanges(before, after);
  const text = {
    orderNo: keys.has('orderNo'),
    memo: keys.has('memo'),
    questions: keys.has('questions'),
  };
  const textNotes = [];
  if (text.questions) textNotes.push('確認文の変更あり');
  if (text.memo) textNotes.push('注文メモの変更あり');
  if (text.orderNo) textNotes.push('注文番号の変更あり');
  return {
    spec,
    specCount: spec.length,
    text,
    textNotes,
    hasAny: spec.length > 0 || textNotes.length > 0,
    changedKeys: [...keys],
  };
}

// ---------- サンプル ----------

export function sampleDoc() {
  const baseline = {
    orderNo: 'SAMPLE-001',
    memo: '架空のサンプルです。普段使い用。A4のクリアファイルが入る大きさを希望。',
    questions: '',
    dims: { height: '30', mouthWidth: '40', gusset: '10', handleHeight: '15' },
    outerColor: 'kinari',
    lining: 'none',
    liningColor: '',
    pocket: 'none',
  };
  const current = cloneOrder(baseline);
  current.dims.mouthWidth = '45';
  current.pocket = 'yes';
  current.questions = '内ポケットの大きさは、お任せでよろしいですか？';
  return { current, baseline, version: 2, baselineVersion: 1, isSample: true, output: defaultOutput() };
}

export function hasContent(doc) {
  if (doc.baseline) return true;
  const e = emptyOrder();
  const c = doc.current;
  return (
    c.orderNo !== e.orderNo || c.memo !== e.memo || (c.questions || '') !== '' || c.outerColor !== e.outerColor ||
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
      output: { ...defaultOutput(), ...(doc.output || {}) },
    },
  };
}

function validateOrder(o, where) {
  const fail = (msg) => { throw new Error(`${where}：${msg}`); };
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail('形式が正しくありません');
  if (typeof o.orderNo !== 'string' || o.orderNo.length > LIMITS.orderNo) fail('注文番号の形式が正しくありません');
  if (typeof o.memo !== 'string' || o.memo.length > LIMITS.memo) fail('注文メモの形式が正しくありません');
  // 旧形式（schema 1）には確認事項がない。ない場合だけ空欄とし、ほかの項目は補完しない
  if (o.questions !== undefined && (typeof o.questions !== 'string' || o.questions.length > LIMITS.questions)) {
    fail('お客様に確認したいことの形式が正しくありません');
  }
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
    orderNo: o.orderNo, memo: o.memo, questions: o.questions === undefined ? '' : o.questions, dims, outerColor: o.outerColor,
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
  if (!SUPPORTED_SCHEMAS.includes(obj.schema_version)) {
    throw new Error(`対応していない形式です（schema_version: ${String(obj.schema_version)}）`);
  }
  return parseDocData(obj.data);
}

/**
 * 注文1件分のデータ（serializeDoc の data 部分）を検証して doc にする。
 * 旧形式（schema 1・2）のバックアップ、注文一覧の保存データ、新形式のバックアップで共通に使う。
 */
export function parseDocData(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('データ本体がありません');
  const current = validateOrder(d.current, '現在の内容');
  const baseline = d.baseline === null || d.baseline === undefined ? null : validateOrder(d.baseline, '変更前の内容');
  const version = d.version;
  if (!Number.isInteger(version) || version < 1 || version > 9999) throw new Error('版番号が正しくありません');
  let baselineVersion = d.baseline_version === undefined ? null : d.baseline_version;
  if (baseline) {
    if (!Number.isInteger(baselineVersion) || baselineVersion < 1 || baselineVersion >= version) {
      throw new Error('変更前の版番号が正しくありません');
    }
    if (analyze(baseline).errors.length) throw new Error('変更前の寸法に範囲外の値があります');
  } else {
    if (baselineVersion !== null) throw new Error('変更前の内容がないのに、変更前の版番号があります');
    baselineVersion = null;
  }
  return { current, baseline, version, baselineVersion, isSample: d.is_sample === true, output: parseOutput(d.output) };
}

/** 出力設定は注文内容ではないため、不正・欠落の場合は初期値に戻す */
export function parseOutput(v) {
  const o = defaultOutput();
  if (!v || typeof v !== 'object') return o;
  if (v.audience === 'customer' || v.audience === 'maker') o.audience = v.audience;
  for (const k of ['side', 'interior', 'memo']) if (typeof v[k] === 'boolean') o[k] = v[k];
  return o;
}
