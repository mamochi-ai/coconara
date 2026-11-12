// 確認画像の内容（お客様用・作家用）を、共通のデータから組み立てる。
// 描画はしない。数値・変更判定はすべて model.js の同じ関数から得るため、両モードで食い違わない。
import {
  analyze, compareOrders, fieldValues, liningSummary, pocketSummary, defaultOutput,
} from './model.js';

const CHANGE_SIDE = ['gusset'];
const CHANGE_INTERIOR = ['lining', 'liningColor', 'pocket'];

/** 図に添える縮尺・色の注記（図の種類に合わせて対象を明示） */
export function figureNotes({ compare, side, interior }) {
  const notes = [];
  const scaled = side ? '正面図・側面図' : '正面図';
  if (compare) notes.push(`${scaled}の変更前後は共通縮尺です。${interior ? '内側図は縮尺なしです。' : ''}`);
  else if (side) notes.push(`正面図と側面図は共通縮尺です。${interior ? '内側図は縮尺なしです。' : ''}`);
  else if (interior) notes.push('内側図は縮尺なしです。');
  notes.push(interior ? '持ち手・ポケットの色はこの図では指定していません。' : '持ち手の色はこの図では指定していません。');
  return notes;
}

/**
 * @param doc 保存データ（current, baseline, version, baselineVersion, isSample）
 * @param settings 出力設定 {audience, side, interior, memo}
 */
export function buildReport(doc, settings = defaultOutput(), now = new Date()) {
  const maker = settings.audience === 'maker';
  const cur = doc.current;
  const base = doc.baseline || null;
  const compare = !!base;
  const cmp = compare ? compareOrders(base, cur) : null;
  const changedKeys = new Set(cmp ? cmp.changedKeys : []);
  const an = analyze(cur);

  const sideAuto = compare && CHANGE_SIDE.some((k) => changedKeys.has(k));
  const interiorAuto = compare && CHANGE_INTERIOR.some((k) => changedKeys.has(k));
  const parts = maker
    ? { side: true, interior: true, sideAuto, interiorAuto }
    : { side: sideAuto || !!settings.side, interior: interiorAuto || !!settings.interior, sideAuto, interiorAuto };
  const includeMemo = maker || !!settings.memo;

  const memo = String(cur.memo || '').trim();
  const questions = String(cur.questions || '').trim();

  // 仕様変更一覧（画面と同じデータ。件数＝行数）と、文章の変更の注記
  const changes = cmp ? cmp.spec : null;
  const textNotes = cmp
    ? cmp.textNotes.filter((t) => t !== '注文メモの変更あり' || includeMemo)
    : [];

  // お客様用：図に出ない仕様を短く記載（側面図・内側図を載せない場合）
  const specShort = [];
  if (!maker) {
    const g = fieldValues(cur).find((f) => f.key === 'gusset');
    if (!parts.side) specShort.push({ label: 'マチ', text: g.text, changed: changedKeys.has('gusset') });
    if (!parts.interior) {
      specShort.push({ label: '裏地', text: liningSummary(cur), changed: changedKeys.has('lining') || changedKeys.has('liningColor') });
      specShort.push({ label: '内ポケット', text: pocketSummary(cur), changed: changedKeys.has('pocket') });
    }
  }

  // 作家用：全項目の比較表（変更前後）または仕様表
  let table = null;
  if (maker) {
    const after = fieldValues(cur);
    const before = compare ? fieldValues(base) : null;
    const pendingKeys = new Set(an.pending.map((p) => p.key));
    table = after.filter((f) => !f.memo).map((f) => ({
      key: f.key,
      label: f.label,
      before: before ? cellText(before.find((x) => x.key === f.key), base) : null,
      after: cellText(f, cur),
      changed: changedKeys.has(f.key),
      pending: pendingKeys.has(f.key),
    }));
  }

  const meta = {
    orderNo: String(cur.orderNo || '').trim(),
    version: doc.version,
    baselineVersion: compare ? doc.baselineVersion : null,
    date: formatDate(now),
    isSample: !!doc.isSample,
  };

  const notes = [];
  notes.push('仕様確認用の模式図です。型紙ではありません。寸法は記載値をご確認ください。色は目安です。');
  notes.push(...figureNotes({ compare, side: maker ? true : parts.side, interior: maker ? true : parts.interior }));
  if (compare) {
    notes.push(maker
      ? `「変更前」は作家が比較のために保存した内容（版${doc.baselineVersion}）です。お客様の承認を示すものではありません。`
      : `「変更前」は版${doc.baselineVersion}の内容です。`);
  }
  notes.push('「未入力・未定の項目」は入力項目の状況です。製作の可否や、入れたい物が収まるかを示すものではありません。');
  if (maker) {
    notes.push('底幅は「袋口幅 − マチ」で計算しています（この形のバッグの場合の関係です）。');
    notes.push('内ポケットは、この確認では内側の片面中央に1個として扱い、大きさと色は指定していません。');
  }

  return {
    audience: maker ? 'maker' : 'customer',
    compare,
    title: maker
      ? (compare ? 'バッグ仕様の詳細（変更前後）' : 'バッグ仕様の詳細')
      : (compare ? 'バッグの変更内容' : 'バッグのご注文内容'),
    meta,
    parts,
    changes,
    specCount: changes ? changes.length : 0,
    textNotes,
    changedKeys: [...changedKeys],
    specShort,
    table,
    pending: an.pending.map((p) => p.text),
    questions,
    memo: includeMemo ? memo : null,
    memoChanged: changedKeys.has('memo'),
    notes,
  };
}

function cellText(f, order) {
  if (f.key === 'bottomWidth' && f.num !== null) return `${f.text}（自動計算）`;
  if (f.key === 'pocket') return pocketSummary(order);
  return f.text;
}

function formatDate(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}
