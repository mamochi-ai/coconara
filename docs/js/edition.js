// 版の設定。公開体験版と購入者用は、この設定だけが異なる（ほかのコードは共通）。
// 購入者用は scripts/build.mjs が、この内容を FULL_EDITION に置き換えて作る。
//
// 注意：これは表示と保存場所を切り替えるための設定で、購入者の認証やコピー防止の仕組みではない。
// 静的ファイルは誰でも取得・改変できる。

export const TRIAL_EDITION = {
  id: 'trial',
  label: '体験版',
  // 保存領域は購入者用と分ける（同じドメインで開いても混ざらない）
  storageKey: 'katachi-awase:trial:doc',
  guideKey: 'katachi-awase:trial:guide-seen',
  // 確認画像に入れる表示（null で表示しない）
  watermark: '体験版・サンプル',
  // 保存データがないときは架空のサンプルを表示して始める
  startWithSample: true,
  // 購入ページのURL。空のままなら購入への案内（リンク・ボタン）は表示しない
  purchaseUrl: '',
};

export const FULL_EDITION = {
  id: 'full',
  label: '',
  // 以前からの保存データと同じ場所（互換性のため変更しない）
  storageKey: 'katachi-awase:doc',
  guideKey: 'katachi-awase:guide-seen',
  watermark: null,
  startWithSample: false,
  purchaseUrl: '',
};

export const EDITION = TRIAL_EDITION;
