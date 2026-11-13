// 端末内保存（localStorage）。使えない環境でもアプリは止めない。
import { serializeDoc, parseBackup } from './model.js';
import { EDITION } from './edition.js';

// 版ごとに保存場所を分ける（体験版と購入者用のデータが混ざらない）
export const STORAGE_KEY = EDITION.storageKey;

function getStorage() {
  try {
    const s = window.localStorage;
    if (!s) return null;
    return s;
  } catch {
    return null;
  }
}

/** 保存済みデータを読む。{doc|null, error|null} */
export function loadDoc() {
  const s = getStorage();
  if (!s) return { doc: null, error: 'unavailable' };
  let text;
  try {
    text = s.getItem(STORAGE_KEY);
  } catch {
    return { doc: null, error: 'unavailable' };
  }
  if (!text) return { doc: null, error: null };
  try {
    return { doc: parseBackup(text), error: null };
  } catch {
    // 壊れた保存データは別名で残しておき、上書きで失われないようにする
    try { s.setItem(`${STORAGE_KEY}:broken`, text); } catch { /* 何もしない */ }
    return { doc: null, error: 'broken' };
  }
}

/** 保存する。{ok:true, at} | {ok:false, reason} */
export function saveDoc(doc) {
  const s = getStorage();
  if (!s) return { ok: false, reason: 'unavailable' };
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(serializeDoc(doc)));
    return { ok: true, at: new Date() };
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    return { ok: false, reason: quota ? 'quota' : 'denied' };
  }
}

/** 初回案内を閉じたかどうか（保存できない環境では毎回 false） */
export function guideSeen() {
  const s = getStorage();
  try { return !!(s && s.getItem(EDITION.guideKey)); } catch { return false; }
}
export function markGuideSeen() {
  const s = getStorage();
  try { if (s) s.setItem(EDITION.guideKey, '1'); } catch { /* 保存できなくても続ける */ }
}
