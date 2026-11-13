// 版の設定。公開体験版と購入者用は、この設定だけが異なる（ほかのコードは共通）。
// どちらの版になるかは、開いたページの HTML にある
//   <meta name="katachi-edition" content="buyer">
// で決まる（購入者用ページ docs/buyer/index.html と配布ZIPの index.html だけに入る）。
// URL パラメーターや画面上の操作で切り替える仕組みはない。
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

/** ページに書かれた版（購入者用ページだけ 'buyer'） */
function pageEdition() {
  try {
    const m = document.querySelector('meta[name="katachi-edition"]');
    return m ? m.getAttribute('content') : null;
  } catch {
    return null;
  }
}

export const EDITION = pageEdition() === 'buyer' ? FULL_EDITION : TRIAL_EDITION;
