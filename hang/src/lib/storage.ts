// localStorage を安全に使う（使えない環境では読み書きを諦め、操作は続ける）

function store(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const s = store();
    const text = s?.getItem(key);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** 保存できたら true */
export function writeJSON(key: string, value: unknown): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const KEYS = {
  coord: 'hang:coord-rack',
  hintSeen: 'hang:hint-seen',
};
