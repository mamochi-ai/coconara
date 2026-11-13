// 端末内保存（localStorage）。使えない環境でもアプリは止めない。
//
// 注文一覧は1つのキーにまとめて保存する（1回の書き込みで全件が保存されるか、何も変わらない）。
// 以前の1件だけの保存データ（storageKey）は、注文一覧がまだないときに一度だけ移行する。
// 移行元の1件用データは消さない（新しい保存に失敗しても、以前のデータは残る）。
import { parseLibrary, serializeLibrary, libraryFromLegacy } from './library.js';
import { EDITION } from './edition.js';

function browserStorage() {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * 保存処理。storage と keys を差し替えられる（テスト用）。
 * keys: { orders, legacy }
 */
export function createStore(getStorage = browserStorage, keys = { orders: EDITION.ordersKey, legacy: EDITION.storageKey }) {
  const brokenKey = (k) => `${k}:broken`;

  /** 書き込んで、読み返して一致することまで確かめる */
  function writeVerified(s, key, text) {
    s.setItem(key, text);
    if (s.getItem(key) !== text) throw new Error('verify');
  }
  const failReason = (e) => (e && (e.name === 'QuotaExceededError' || e.code === 22) ? 'quota' : 'denied');

  /**
   * 読み込み。戻り値：
   *  { lib, status }
   *   status: 'ok' | 'fresh'（保存データなし）| 'migrated'（1件用から移行して保存済み）
   *         | 'migrate-unsaved'（移行したが保存に失敗。以前のデータは残っている）
   *         | 'legacy-broken'（以前のデータが読めない。別名で保管）
   *         | 'broken'（注文一覧が読めない。別名で保管）| 'broken-locked'（保管もできないため保存を止める）
   *         | 'unavailable'
   *   reason: 保存失敗の理由（quota / denied）
   */
  function load() {
    const s = getStorage();
    if (!s) return { lib: null, status: 'unavailable' };
    let text;
    let legacy;
    try {
      text = s.getItem(keys.orders);
      legacy = text ? null : s.getItem(keys.legacy);
    } catch {
      return { lib: null, status: 'unavailable' };
    }
    if (text) {
      try {
        return { lib: parseLibrary(text), status: 'ok' };
      } catch {
        // 読めない保存データは別名で保管してから先へ進む。保管できなければ保存を止める（上書きしない）
        try {
          writeVerified(s, brokenKey(keys.orders), text);
          return { lib: null, status: 'broken' };
        } catch {
          return { lib: null, status: 'broken-locked', raw: text };
        }
      }
    }
    if (legacy) {
      let lib;
      try {
        lib = libraryFromLegacy(legacy);
      } catch {
        try { s.setItem(brokenKey(keys.legacy), legacy); } catch { /* 元のキーは残っている */ }
        return { lib: null, status: 'legacy-broken', raw: legacy };
      }
      // 新しい形式で保存できたことを確かめる。失敗しても以前のデータは消さない（次回また移行を試す）
      try {
        writeVerified(s, keys.orders, JSON.stringify(serializeLibrary(lib)));
        return { lib, status: 'migrated' };
      } catch (e) {
        try { if (s.getItem(keys.orders) !== null) s.removeItem(keys.orders); } catch { /* 何もしない */ }
        return { lib, status: 'migrate-unsaved', reason: failReason(e) };
      }
    }
    return { lib: null, status: 'fresh' };
  }

  /** 全件を保存。{ok:true, at} | {ok:false, reason} */
  function save(lib) {
    const s = getStorage();
    if (!s) return { ok: false, reason: 'unavailable' };
    try {
      writeVerified(s, keys.orders, JSON.stringify(serializeLibrary(lib)));
      return { ok: true, at: new Date() };
    } catch (e) {
      return { ok: false, reason: failReason(e) };
    }
  }

  return { load, save, keys };
}

/** 初回案内を閉じたかどうか（保存できない環境では毎回 false） */
export function guideSeen() {
  const s = browserStorage();
  try { return !!(s && s.getItem(EDITION.guideKey)); } catch { return false; }
}
export function markGuideSeen() {
  const s = browserStorage();
  try { if (s) s.setItem(EDITION.guideKey, '1'); } catch { /* 保存できなくても続ける */ }
}
