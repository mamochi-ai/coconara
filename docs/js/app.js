import {
  DIMS, COLORS, TRI, colorOf, rangeText, fmt, emptyDoc, cloneOrder, analyze, diffOrders, changeText,
  fieldValues, sampleDoc, compareOrders, defaultOutput, hasContent, serializeDoc, parseBackup,
} from './model.js';
import { buildScene, buildCompareScene, sceneToSvg } from './diagram.js';
import { renderPngs, exportBlockers, imageFileName, safeFilePart } from './export.js';
import { loadDoc, saveDoc, guideSeen, markGuideSeen } from './storage.js';
import { EDITION } from './edition.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const state = {
  doc: emptyDoc(),
  tab: 'input',
  highlight: null,
  save: { status: 'idle' },
  loadError: null,
};

const wideMQ = window.matchMedia('(min-width: 960px) and (orientation: landscape)');
const isWide = () => wideMQ.matches;
// 別ページの枠内で表示されているときは、ダウンロード・共有が使えないことが多い
const FRAMED = (() => { try { return window.self !== window.top; } catch { return true; } })();
// 表示幅が狭いときは図を縦積みにして文字を読みやすくする
const isNarrow = () => window.innerWidth < 700;

// ---------- 初期化 ----------

function init() {
  const loaded = loadDoc();
  if (loaded.doc) state.doc = loaded.doc;
  else if (EDITION.startWithSample && loaded.error !== 'broken') {
    // 体験版：保存データがなければ架空のサンプルで始める
    state.doc = sampleDoc();
    state.tab = 'compare';
  }
  state.loadError = loaded.error;
  if (loaded.error === 'unavailable') state.save = { status: 'unavailable' };
  if (loaded.error === 'broken') state.save = { status: 'broken' };

  buildDimFields();
  buildChoice($('#outerColorChips'), 'outerColor', colorChoices());
  buildChoice($('#liningColorChips'), 'liningColor', colorChoices());
  buildChoice($('#liningSeg'), 'lining', TRI.map((t) => ({ value: t.key, label: t.label })));
  buildChoice($('#pocketSeg'), 'pocket', TRI.map((t) => ({ value: t.key, label: t.label })));
  bindEvents();
  trackTopbarHeight();
  fillForm();
  if (!hasContent(state.doc) && isWide()) state.tab = 'diagram';
  applyEdition();
  render();
  if (!guideSeen()) openGuide({ first: true });
}

/** 版ごとの表示（体験版の表示・購入ページへの案内） */
function applyEdition() {
  const trial = EDITION.id === 'trial';
  document.documentElement.dataset.edition = EDITION.id;
  $('#editionBadge').hidden = !trial;
  $('#trialBanner').hidden = !trial;
  const link = $('#purchaseLink');
  // 購入ページが未設定なら、購入への案内は表示しない
  if (trial && EDITION.purchaseUrl) {
    link.href = EDITION.purchaseUrl;
    link.hidden = false;
  } else {
    link.hidden = true;
  }
}

// ---------- 使い方（初回案内） ----------

/** 使い方ページの場所（ページの <link rel="help"> に従う。購入者用ページからは ../manual.html） */
function manualHref() {
  const l = document.querySelector('link[rel="help"]');
  return (l && l.getAttribute('href')) || './manual.html';
}

function openGuide({ first = false } = {}) {
  const trial = EDITION.id === 'trial';
  const actions = [];
  if (trial) {
    if (!state.doc.isSample) actions.push({ label: 'サンプルを表示', value: 'sample' });
    actions.push({ label: first ? 'サンプルで試してみる' : '閉じる', value: null, primary: true });
  } else {
    actions.push({ label: '閉じる', value: null });
    actions.push({ label: '架空のサンプルで試す', value: 'sample' });
    actions.push({ label: '新しい注文を始める', value: 'new', primary: true });
  }
  return openModal({
    title: '使い方',
    html: `
      <p class="guide-lead">バッグのサイズや仕様変更を、ひと目で伝わる確認画像に。</p>
      <ol class="guide-steps">
        <li><strong>バッグの寸法と仕様を入力</strong>
          <span>入力した内容は、この端末に自動で保存されます。</span></li>
        <li><strong>お客様に送った内容を「変更前として保存」</strong>
          <span>自動保存とは別のボタンです。押したときの内容が「変更前」として残り、あとで直した箇所と比べられます。</span></li>
        <li><strong>「確認画像を作成」で画像を保存して、お客様に送る</strong>
          <span>変更前があれば、変更前後を並べた画像になります。</span></li>
      </ol>
      ${trial
    ? '<p class="guide-note">これは体験版です。確認画像には「体験版・サンプル」と入ります。実際のお客様の情報は入力しないでください。</p>'
    : '<p class="guide-note">入力はこの端末のブラウザの中に保存されます（ほかの端末とは同期しません）。消えることがあるため、「データ」→「バックアップを書き出す」で定期的に保存してください。</p>'}
      <p class="hint"><a href="${esc(manualHref())}" target="_blank" rel="noopener">詳しい使い方（測る位置・保存のしかた・バックアップ）</a>　この案内は右上の「使い方」でいつでも開けます。</p>`,
    actions,
  }).then((v) => {
    markGuideSeen();
    if (v === 'sample') onSample();
    else if (v === 'new') startNewOrder();
  });
}

/** 上部の帯の高さを CSS 変数に（固定したタブを帯の直下に置くため） */
function trackTopbarHeight() {
  const bar = $('.topbar');
  const set = () => document.documentElement.style.setProperty('--topbar-h', `${getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0}px`);
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(bar);
  window.addEventListener('resize', set);
}

function colorChoices() {
  return [{ value: '', label: '未定', swatch: null }, ...COLORS.map((c) => ({ value: c.key, label: c.label, swatch: c.hex }))];
}

function buildDimFields() {
  const root = $('#dimFields');
  root.innerHTML = DIMS.map((d) => `
    <div class="field dim-field" data-field="${d.key}">
      <label for="f-${d.key}">${d.label}</label>
      <div class="num-wrap">
        <input id="f-${d.key}" name="${d.key}" type="text" inputmode="decimal" enterkeyhint="next"
          autocomplete="off" spellcheck="false" maxlength="12" data-dim="${d.key}"
          aria-describedby="h-${d.key} e-${d.key}" placeholder="未入力">
        <span class="unit">cm</span>
      </div>
      <p class="hint" id="h-${d.key}">${d.hint}（${rangeText(d)}）</p>
      <p class="error" id="e-${d.key}"></p>
      <div class="change-note"></div>
    </div>`).join('');
}

function buildChoice(root, name, choices) {
  root.innerHTML = choices.map((c) => `
    <label class="choice${c.swatch !== undefined ? ' chip' : ' seg-item'}">
      <input type="radio" name="${name}" value="${esc(c.value)}">
      ${c.swatch !== undefined ? `<span class="swatch${c.swatch ? '' : ' swatch-none'}" ${c.swatch ? `style="background:${c.swatch}"` : ''} aria-hidden="true">${c.swatch ? '' : '？'}</span>` : ''}
      <span class="choice-label">${esc(c.label)}</span>
    </label>`).join('');
}

function fillForm() {
  const c = state.doc.current;
  $('#f-orderNo').value = c.orderNo;
  $('#f-memo').value = c.memo;
  $('#f-questions').value = c.questions || '';
  for (const d of DIMS) $(`#f-${d.key}`).value = c.dims[d.key];
  for (const name of ['outerColor', 'liningColor', 'lining', 'pocket']) {
    for (const r of $$(`input[name="${name}"]`)) r.checked = r.value === c[name];
  }
}

function bindEvents() {
  const form = $('#form');
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    const t = e.target;
    const c = state.doc.current;
    if (t.dataset.dim) c.dims[t.dataset.dim] = t.value;
    else if (t.name === 'orderNo') c.orderNo = t.value;
    else if (t.name === 'memo') c.memo = t.value;
    else if (t.name === 'questions') c.questions = t.value;
    else return;
    changed();
  });
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type !== 'radio') return;
    state.doc.current[t.name] = t.value;
    changed();
  });
  form.addEventListener('focusin', (e) => {
    const key = e.target.dataset && e.target.dataset.dim;
    if (key) { state.highlight = key; render(); }
  });
  form.addEventListener('focusout', (e) => {
    if (e.target.dataset && e.target.dataset.dim) {
      state.highlight = null;
      // 次の欄へ移るときのちらつきを避ける
      setTimeout(render, 0);
    }
  });
  // Enter（次へ）で次の入力欄へ
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      const inputs = $$('input[type="text"]', form);
      const i = inputs.indexOf(e.target);
      if (i >= 0 && inputs[i + 1]) inputs[i + 1].focus(); else e.target.blur();
    }
  });

  for (const tab of $$('.tab')) tab.addEventListener('click', () => { state.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); });
  wideMQ.addEventListener ? wideMQ.addEventListener('change', render) : wideMQ.addListener(render);
  let lastNarrow = isNarrow();
  window.addEventListener('resize', () => { if (isNarrow() !== lastNarrow) { lastNarrow = isNarrow(); render(); } });

  $('#btnSample').addEventListener('click', onSample);
  $('#btnBaseline').addEventListener('click', onBaseline);
  $('#btnExport').addEventListener('click', onExport);
  $('#btnData').addEventListener('click', onData);
  $('#btnHelp').addEventListener('click', () => openGuide());
  $('#btnNewFromSample').addEventListener('click', startNewOrder);
  $('#fileInput').addEventListener('change', onFileChosen);
}

function changed() {
  render();
  scheduleSave();
}

// ---------- 保存 ----------

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}
// 画面を離れる・再読み込みする直前にも保存する（入力直後の自動保存待ちで失われないように）
function flushSave() {
  if (saveTimer) saveNow();
}
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const r = saveDoc(state.doc);
  state.save = r.ok ? { status: 'saved', at: r.at } : { status: 'failed', reason: r.reason };
  renderSaveStatus();
}

function renderSaveStatus() {
  const el = $('#saveStatus');
  const s = state.save;
  const time = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  let cls = 'ok';
  let html;
  if (s.status === 'saved') html = `<span class="st-icon" aria-hidden="true">✓</span>この端末に保存しました（${time(s.at)}）`;
  else if (s.status === 'idle') html = '<span class="st-icon" aria-hidden="true">・</span>入力すると、この端末に自動で保存します';
  else if (s.status === 'broken') { cls = 'warn'; html = '<span class="st-icon" aria-hidden="true">！</span>以前の保存データを読み込めませんでした。新しく入力できます'; }
  else {
    cls = 'warn';
    const why = s.reason === 'quota' ? '容量が不足しています' : 'この環境では保存が使えません';
    html = `<span class="st-icon" aria-hidden="true">！</span>端末に保存できません（${why}）。編集と画像作成は続けられます。「データ」からバックアップしてください`;
  }
  el.className = `save-status ${cls}`;
  el.innerHTML = html;
}

// ---------- 描画 ----------

function render() {
  const doc = state.doc;
  const an = analyze(doc.current);
  const changes = doc.baseline ? diffOrders(doc.baseline, doc.current) : [];
  const changedKeys = new Set(changes.map((c) => c.key));
  const baseFields = doc.baseline ? fieldValues(doc.baseline) : null;
  const active = document.activeElement;

  // 表示切り替え
  const app = $('#app');
  const wide = isWide();
  const view = state.tab === 'compare' ? 'compare' : state.tab === 'input' && !wide ? 'input' : 'diagram';
  app.dataset.tab = state.tab;
  app.dataset.view = view;
  app.classList.toggle('is-wide', wide);
  for (const t of $$('.tab')) {
    const sel = wide ? t.dataset.tab === (view === 'compare' ? 'compare' : 'diagram') : t.dataset.tab === state.tab;
    t.setAttribute('aria-selected', String(sel));
    t.classList.toggle('is-active', sel);
  }
  // 件数は仕様変更一覧の行数（文章の変更は数えない）
  const cmp = doc.baseline ? compareOrders(doc.baseline, doc.current) : null;
  const tabCompare = $('#tab-compare');
  tabCompare.innerHTML = !cmp ? '比較'
    : cmp.specCount ? `比較 <span class="tab-badge">仕様変更${cmp.specCount}件</span>`
      : cmp.textNotes.length ? '比較 <span class="tab-badge tab-badge-text">文章の変更</span>' : '比較';

  // ヘッダー
  $('#sampleBanner').hidden = !doc.isSample;
  const no = doc.current.orderNo.trim();
  $('#orderMeta').innerHTML = `
    <span class="meta-item"><span class="meta-k">注文番号</span>${no ? esc(no) : '<span class="pending-text">未入力</span>'}</span>
    <span class="meta-item"><span class="meta-k">版</span>${doc.version}</span>
    <span class="meta-item mode">${doc.baseline ? `変更前：版${doc.baselineVersion}` : '初回確認（変更前の保存なし）'}</span>`;
  $('#versionReadout').textContent = doc.baseline
    ? `版 ${doc.version}（変更前：版 ${doc.baselineVersion}）`
    : `版 ${doc.version}（初回確認）`;
  const bb = $('#btnBaseline');
  bb.textContent = doc.baseline ? '変更前を更新' : '変更前として保存';

  // 寸法欄
  for (const d of DIMS) {
    const ev = an.dims[d.key];
    const field = $(`.field[data-field="${d.key}"]`);
    const input = $(`#f-${d.key}`);
    const focused = active === input;
    let err = ev.status === 'invalid' ? ev.error : '';
    // 入力途中（フォーカス中）の範囲外表示は控え、形式の誤りだけ即時に示す
    if (focused && err && /範囲|小さく/.test(err)) err = '';
    $(`#e-${d.key}`).innerHTML = err ? `<span aria-hidden="true">！</span>${esc(err)}` : '';
    input.setAttribute('aria-invalid', err ? 'true' : 'false');
    field.classList.toggle('has-error', !!err);
    field.classList.toggle('is-pending', ev.status === 'empty');
    field.dataset.pending = '未入力';
    field.classList.toggle('is-highlight', state.highlight === d.key);
  }
  const bw = an.dims.bottomWidth;
  $('#bottomReadout').innerHTML = bw.status === 'ok'
    ? `<strong>${fmt(bw.value)}</strong> cm`
    : bw.status === 'invalid'
      ? '<span class="error-text">！ 袋口幅とマチの値を確認すると計算されます</span>'
      : '<span class="pending-text">？ 袋口幅とマチを入力すると計算されます</span>';

  // 仕様欄
  $('#liningColorField').hidden = doc.current.lining !== 'yes';
  $('#pocketCondition').hidden = doc.current.pocket !== 'yes';
  for (const name of ['outerColor', 'liningColor', 'lining', 'pocket']) {
    const v = doc.current[name];
    const field = $(`.field[data-field="${name}"]`);
    const pend = (name === 'outerColor' && !colorOf(v)) || ((name === 'lining' || name === 'pocket') && v === 'undecided') ||
      (name === 'liningColor' && doc.current.lining === 'yes' && !colorOf(v));
    field.classList.toggle('is-pending', pend);
    field.dataset.pending = '未定';
    for (const r of $$(`input[name="${name}"]`)) r.closest('.choice').classList.toggle('is-checked', r.checked);
  }

  // 変更表示（入力欄の下）
  for (const field of $$('.field[data-field]')) {
    const key = field.dataset.field;
    const note = $('.change-note', field);
    if (!note) continue;
    const isChanged = changedKeys.has(key);
    field.classList.toggle('is-changed', isChanged);
    if (isChanged) {
      const bf = baseFields.find((f) => f.key === key);
      note.innerHTML = key === 'memo' || key === 'questions'
        ? `<span class="badge-change">変更</span>版${doc.baselineVersion}から内容が変わっています`
        : `<span class="badge-change">変更</span>版${doc.baselineVersion}の値：${esc(bf.text)}`;
    } else {
      note.innerHTML = '';
    }
  }

  // 図
  if (view === 'diagram') renderDiagram(an, changes);
  if (view === 'compare') renderCompare(changes);
  const mini = $('#miniDiagram');
  if (!wide && view === 'input') {
    mini.innerHTML = sceneToSvg(buildScene(doc.current, { baseline: doc.baseline, highlight: state.highlight, compact: true, narrow: isNarrow() }), '寸法の図');
  } else {
    mini.innerHTML = '';
  }
  renderSaveStatus();
}

function pendingListHtml(an) {
  if (an.errors.length) {
    return `<div class="list-block errors"><h3><span aria-hidden="true">！</span>値を確認してください</h3><ul class="goto-list">${an.errors.map((e) => `<li><button type="button" class="link-btn" data-goto="${e.key}">${esc(errorText(e))}<span class="goto-arrow">入力欄へ</span></button></li>`).join('')}</ul></div>`;
  }
  return '';
}

function renderDiagram(an, changes) {
  const doc = state.doc;
  $('#diagramSub').textContent = doc.baseline
    ? `版${doc.version}（編集中）。変更前（版${doc.baselineVersion}）からの変更はオレンジ色と「変更」で示します。`
    : `版${doc.version}。初回確認モードです。`;
  $('#diagram').innerHTML = sceneToSvg(buildScene(doc.current, { baseline: doc.baseline, highlight: state.highlight, narrow: isNarrow() }), 'バッグの模式図（正面図・側面図・内側）');
  let html = pendingListHtml(an);
  html += `<div class="list-block pending"><h3><span aria-hidden="true">？</span>未入力・未定の項目</h3>${an.pending.length
    ? `<ul class="goto-list">${an.pending.map((p) => `<li><button type="button" class="link-btn" data-goto="${p.key}">${esc(p.text)}<span class="goto-arrow">入力欄へ</span></button></li>`).join('')}</ul>` : '<p>なし</p>'}</div>`;
  if (doc.baseline) html += changesHtml(changes);
  $('#diagramLists').innerHTML = html;
}

/** 変更前からの変更（仕様変更一覧＋文章の変更）。確認画像と同じ compareOrders の結果を使う */
function changesHtml() {
  const doc = state.doc;
  const cmp = compareOrders(doc.baseline, doc.current);
  const n = cmp.specCount;
  const head = `<h3><span class="sq" aria-hidden="true"></span>変更前（版${doc.baselineVersion}）からの変更　<span class="spec-count" data-spec-count="${n}">${n ? `仕様変更${n}件` : '仕様変更なし'}</span></h3>`;
  if (!cmp.hasAny) {
    return `<div class="list-block changes"><h3><span class="sq" aria-hidden="true"></span>変更前（版${doc.baselineVersion}）からの変更</h3><p class="no-change">変更前からの変更はありません</p></div>`;
  }
  const list = n
    ? `<ul class="spec-changes">${cmp.spec.map((c) => `<li><span class="badge-change">変更</span>${esc(c.text)}</li>`).join('')}</ul>`
    : '';
  const notes = cmp.textNotes.length
    ? `<ul class="text-changes">${cmp.textNotes.map((t) => `<li><span class="badge-text">文章</span>${esc(t)}</li>`).join('')}</ul>`
    : '';
  return `<div class="list-block changes">${head}${list}${notes}</div>`;
}

function renderCompare(changes) {
  const doc = state.doc;
  const body = $('#compareBody');
  if (!doc.baseline) {
    $('#compareSub').textContent = '初回確認モード';
    body.innerHTML = `
      <div class="empty-card">
        <h3>初回確認モードです</h3>
        <p>今の内容をお客様に送ったら「変更前として保存」を押します。その時点の内容が固定され、このあと直した箇所が比べられるようになります。</p>
        <p class="hint">入力内容はふだんから自動で端末に保存されています。このボタンは比べるための記録で、お客様の承認を記録するものではありません。</p>
        <button type="button" class="btn btn-primary" data-act="baseline">今の内容を変更前として保存</button>
      </div>`;
    $('[data-act="baseline"]', body).addEventListener('click', onBaseline);
    return;
  }
  $('#compareSub').textContent = `変更前＝保存した版${doc.baselineVersion}、変更後＝今の内容（版${doc.version}・編集中）。図は同じ縮尺です。`;
  const scene = buildCompareScene(doc.baseline, doc.current, {
    beforeTitle: `変更前（版${doc.baselineVersion}）`,
    afterTitle: `変更後（版${doc.version}）`,
    highlight: state.highlight,
    narrow: isNarrow(),
  });
  body.innerHTML = `
    <div class="lists lists-top">${changesHtml(changes)}</div>
    <div class="next-step">
      <button type="button" class="btn btn-primary" data-act="export">この変更の確認画像を作成</button>
    </div>
    <div class="diagram">${sceneToSvg(scene, '変更前と変更後の模式図')}</div>
    <p class="hint">「変更前」は編集しても変わりません。お客様の承認を示すものではありません。</p>`;
  $('[data-act="export"]', body).addEventListener('click', onExport);
}

/** エラー文：「マチ：マチは…」のような重複を避ける */
function errorText(e) {
  return e.message.startsWith(e.label) ? e.message : `${e.label}：${e.message}`;
}

/** 誤りがあるときのダイアログのボタン：最初の誤りの入力欄へ移動 */
function blockerActions() {
  const err = analyze(state.doc.current).errors[0];
  const acts = [{ label: '閉じる', value: null }];
  if (err) acts.push({ label: `${err.label}の欄へ移動`, value: err.key, primary: true });
  return acts;
}

const FIELD_FOCUS = {
  orderNo: '#f-orderNo', memo: '#f-memo', questions: '#f-questions',
  height: '#f-height', mouthWidth: '#f-mouthWidth', gusset: '#f-gusset', handleHeight: '#f-handleHeight',
  bottomWidth: '#f-mouthWidth',
  outerColor: 'input[name="outerColor"]', lining: 'input[name="lining"]', liningColor: 'input[name="liningColor"]', pocket: 'input[name="pocket"]',
};

/** 入力タブを開き、その項目の入力欄へ移動して選択する */
function gotoField(key) {
  if (!isWide()) state.tab = 'input';
  render();
  const el = $(FIELD_FOCUS[key] || '#f-height');
  if (!el) return;
  const field = el.closest('.field') || el;
  field.scrollIntoView({ block: 'center' });
  try { el.focus({ preventScroll: true }); } catch { /* 無視 */ }
  field.classList.add('flash');
  setTimeout(() => field.classList.remove('flash'), 1600);
}

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) gotoField(g.dataset.goto);
});

// ---------- モーダル ----------

let modalResolve = null;
let lastFocus = null;
function openModal({ title, html, actions = [{ label: '閉じる', value: null }], wide = false, onMount }) {
  const root = $('#modalRoot');
  lastFocus = document.activeElement;
  root.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-head">
        <h2 id="modalTitle">${esc(title)}</h2>
        <button type="button" class="btn modal-x" data-close aria-label="閉じる">閉じる</button>
      </div>
      <div class="modal-body">${html}</div>
      <div class="modal-actions">${actions.map((a, i) => `<button type="button" class="btn${a.primary ? ' btn-primary' : ''}${a.danger ? ' btn-danger' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div>`;
  root.hidden = false;
  document.body.classList.add('modal-open');
  setInert($('#app'), true);
  hideToast();
  return new Promise((resolve) => {
    modalResolve = resolve;
    $$('.modal-actions button', root).forEach((b) => b.addEventListener('click', () => closeModal(actions[+b.dataset.i].value)));
    $('[data-close]', root).addEventListener('click', () => closeModal(null));
    if (onMount) onMount($('.modal', root));
    const first = $('.modal-actions button', root);
    if (first) first.focus({ preventScroll: true });
  });
}
function closeModal(value) {
  const root = $('#modalRoot');
  if (root.hidden) return;
  const cleanup = root._cleanup;
  root._cleanup = null;
  if (cleanup) cleanup();
  root.hidden = true;
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
  setInert($('#app'), false);
  const r = modalResolve;
  modalResolve = null;
  if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch { /* 無視 */ }
  if (r) r(value);
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (zoomState.open) closeZoom(); else closeModal(null);
});

const confirmModal = (title, html, okLabel, danger = false) => openModal({
  title, html,
  actions: [{ label: 'キャンセル', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
});

/** 背景を操作・読み上げの対象から外す（inert 非対応の環境では何もしない） */
function setInert(el, on) {
  if (!el) return;
  if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
  el.setAttribute('aria-hidden', on ? 'true' : 'false');
}
function hideToast() {
  const t = $('#toast');
  if (t) t.classList.remove('show');
}

function toast(text) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function replaceDoc(doc) {
  state.doc = doc;
  state.highlight = null;
  fillForm();
  render();
  saveNow();
}

// ---------- 操作 ----------

/**
 * 今の内容を消す前の確認。サンプルでない内容があるときは、バックアップの書き出しを先に選べる。
 * 戻り値：true＝続ける
 */
async function confirmErase(title, what, okLabel) {
  const doc = state.doc;
  if (!hasContent(doc)) return true;
  const real = !doc.isSample;
  for (;;) {
    const v = await openModal({
      title,
      html: `<p>${what}</p>
        ${real ? '<p><strong>今の内容と変更前の内容は消え、元に戻せません。</strong>残しておく場合は、先にバックアップを書き出してください。</p>' : '<p class="hint">今表示しているのは架空のサンプルです。</p>'}`,
      actions: [
        { label: 'キャンセル', value: false },
        ...(real ? [{ label: '先にバックアップを書き出す', value: 'backup' }] : []),
        { label: okLabel, value: true, danger: true },
      ],
    });
    if (v === 'backup') { await backupForErase(); continue; }
    return v === true;
  }
}

/** 消去の前のバックアップ：ダウンロードできる環境はファイル、できない環境はテキストで */
async function backupForErase() {
  if (!FRAMED) {
    downloadBlob(new Blob([backupText()], { type: 'application/json' }), backupFileName());
    toast('バックアップのダウンロードを開始しました');
    return;
  }
  await openModal({
    title: 'バックアップ（テキスト）',
    html: '<p>この表示ではファイルを保存できません。下のテキストをすべてコピーして、メモなどに保存してください。</p><textarea id="eraseBackup" rows="8" readonly spellcheck="false" aria-label="バックアップのテキスト"></textarea>',
    onMount: (m) => { const ta = $('#eraseBackup', m); ta.value = backupText(); ta.focus(); ta.select(); },
  });
}

async function startNewOrder() {
  const trial = EDITION.id === 'trial';
  const ok = await confirmErase('新しい注文を始める', `今の内容を消して、空の状態から入力を始めます。${trial ? '体験版では、実際のお客様の情報は入力しないでください。' : ''}`, '消去して始める');
  if (!ok) return;
  replaceDoc(emptyDoc());
  state.tab = 'input';
  render();
  window.scrollTo(0, 0);
  toast('新しい注文を始めました。寸法から入力してください');
  const first = $('#f-orderNo');
  if (first) try { first.focus({ preventScroll: true }); } catch { /* 無視 */ }
}

async function onSample() {
  if (!(await confirmErase('サンプルで試す', '今の内容を、架空のサンプルで置き換えます。', 'サンプルに置き換える'))) return;
  replaceDoc(sampleDoc());
  state.tab = 'compare';
  render();
  window.scrollTo(0, 0);
  toast('架空のサンプルを読み込みました。変更前後の比較を表示しています');
}

async function onBaseline() {
  const doc = state.doc;
  const an = analyze(doc.current);
  if (an.errors.length) {
    await openModal({
      title: '変更前として保存できません',
      html: `<p>次の値を直すと保存できます。</p><ul class="err-list">${an.errors.map((e) => `<li>${esc(errorText(e))}</li>`).join('')}</ul>`,
      actions: blockerActions(),
    }).then((v) => v && gotoField(v));
    return;
  }
  const pend = an.pending.length ? `<p class="hint">未入力・未定の項目が ${an.pending.length} 件あります（そのまま記録されます）。</p>` : '';
  const html = doc.baseline
    ? `<p>いまの「変更前」（版${doc.baselineVersion}）を、今の内容（版${doc.version}）で置き換えます。</p>
       <p><strong>版${doc.baselineVersion}との比較は表示できなくなります。</strong>このあとの編集は版${doc.version + 1}として、版${doc.version}と比べます。</p>${pend}
       <p class="hint">入力内容はふだんから自動で保存されています。この操作は比べる基準を変えるもので、お客様の承認を記録するものではありません。</p>`
    : `<p>今の内容（版${doc.version}）を「変更前」として記録します。このあと直した箇所が、版${doc.version + 1}として比べられるようになります。</p>${pend}
       <p class="hint">入力内容はふだんから自動で保存されています。この操作は比べるための記録で、お客様の承認を記録するものではありません。</p>`;
  const ok = await confirmModal(doc.baseline ? '変更前を今の内容に更新' : '変更前として保存', html, doc.baseline ? '置き換える' : '変更前として保存する');
  if (!ok) return;
  doc.baseline = cloneOrder(doc.current);
  doc.baselineVersion = doc.version;
  doc.version += 1;
  render();
  saveNow();
  toast(`版${doc.baselineVersion}を変更前として保存しました。ここからの編集は版${doc.version}です`);
}

let previewUrls = [];
async function onExport() {
  const doc = state.doc;
  const blockers = exportBlockers(doc);
  if (blockers.length) {
    await openModal({
      title: '確認画像を作成できません',
      html: `<p>次の値を直すと作成できます。</p><ul class="err-list">${blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`,
      actions: blockerActions(),
    }).then((v) => v && gotoField(v));
    return;
  }
  if (!doc.output) doc.output = defaultOutput();
  const settings = doc.output; // 出力設定は保存する（変更前・注文内容には影響しない）
  const fileName = (img) => imageFileName({ orderNo: doc.current.orderNo, version: doc.version, audience: settings.audience, index: img.index, total: img.total });
  let images = [];
  let seq = 0;
  const syncControls = (modal) => {
    const maker = settings.audience === 'maker';
    const changed = new Set(doc.baseline ? diffOrders(doc.baseline, doc.current).map((c) => c.key) : []);
    const auto = {
      side: maker ? '作家用では常に含めます' : changed.has('gusset') ? 'マチの変更があるため含めます' : '',
      interior: maker ? '作家用では常に含めます' : ['lining', 'liningColor', 'pocket'].some((k) => changed.has(k)) ? '裏地・ポケットの変更があるため含めます' : '',
      memo: maker ? '作家用では常に含めます' : '',
    };
    for (const k of ['side', 'interior', 'memo']) {
      const cb = $(`#opt-${k}`, modal);
      cb.checked = !!auto[k] || settings[k];
      cb.disabled = !!auto[k];
      $(`#opt-${k}-note`, modal).textContent = auto[k];
      cb.closest('.check').classList.toggle('is-checked', cb.checked);
    }
    for (const r of $$('input[name="paud"]', modal)) {
      r.checked = r.value === settings.audience;
      r.closest('.choice').classList.toggle('is-checked', r.checked);
    }
  };
  const generate = async (modal) => {
    const my = ++seq;
    const box = $('.preview-box', modal);
    box.innerHTML = '<p class="hint">画像を作成しています…</p>';
    let result;
    try {
      result = await renderPngs(doc, settings, new Date(), { watermark: EDITION.watermark });
    } catch (e) {
      if (my !== seq) return;
      box.innerHTML = `<p class="error-text">！ 画像を作成できませんでした（${esc(e.message || '不明なエラー')}）</p>`;
      images = [];
      return;
    }
    if (my !== seq) return; // 設定を続けて変えたときは最後の結果だけを表示
    images = result.images;
    previewUrls.forEach((u) => URL.revokeObjectURL(u));
    previewUrls = images.map((img) => URL.createObjectURL(img.blob));
    const multi = images.length > 1;
    const info = $('#pageInfo', modal);
    info.hidden = !multi;
    info.textContent = multi ? `長いため ${images.length} 枚に分けました。1枚ずつ保存してください。` : '';
    box.innerHTML = images.map((img, i) => `
      <figure class="preview-page" data-page="${i}">
        <figcaption>${multi ? `${img.index}/${img.total}枚目　${esc(img.name)}` : '確認画像'}<span class="file-name">${esc(fileName(img))}（${img.width}×${img.height}）</span></figcaption>
        <div class="preview-actions">
          <button type="button" class="btn btn-primary" data-dl="${i}">画像を保存</button>
          <button type="button" class="btn" data-zoom="${i}">拡大して確認</button>
          <button type="button" class="btn" data-share="${i}" ${FRAMED || !canShareFile(img.blob, fileName(img)) ? 'hidden' : ''}>共有</button>
        </div>
        <img src="${previewUrls[i]}" alt="確認画像のプレビュー ${img.index}/${img.total}（タップで拡大）" class="preview-img" data-zoom="${i}">
      </figure>`).join('');
  };
  const pendingN = analyze(doc.current).pending.length;
  await openModal({
    title: '保存前プレビュー',
    wide: true,
    html: `
      <div class="export-options">
        <div class="seg seg-small" role="radiogroup" aria-label="用途">
          <label class="choice seg-item"><input type="radio" name="paud" value="customer"><span class="choice-label">お客様用（かんたん）</span></label>
          <label class="choice seg-item"><input type="radio" name="paud" value="maker"><span class="choice-label">作家用（詳細）</span></label>
        </div>
        <div class="checks">
          <label class="check"><input type="checkbox" id="opt-side"><span>側面図を含める</span><small id="opt-side-note"></small></label>
          <label class="check"><input type="checkbox" id="opt-interior"><span>内側図を含める</span><small id="opt-interior-note"></small></label>
          <label class="check"><input type="checkbox" id="opt-memo"><span>注文メモを含める</span><small id="opt-memo-note"></small></label>
        </div>
      </div>
      ${EDITION.watermark ? `<p class="trial-note">体験版のため、画像の上下に「${esc(EDITION.watermark)}」と入ります。</p>` : ''}
      ${pendingN ? `<p class="pending-note"><span aria-hidden="true">？</span>未入力・未定の項目が ${pendingN} 件あります。画像にもそのまま記載されます。</p>` : ''}
      <p class="hint" id="pageInfo" hidden></p>
      <p class="hint">${FRAMED ? '画像を長押しして「"写真"に保存」を選ぶと保存できます。' : '「画像を保存」で保存できない場合は、画像を長押しして、出てくるメニューの「"写真"に保存」を選んでください。'}</p>
      <div class="preview-box"></div>`,
    actions: [{ label: '閉じる', value: null }],
    onMount: (modal) => {
      syncControls(modal);
      generate(modal);
      const changedSetting = () => { syncControls(modal); generate(modal); scheduleSave(); };
      for (const r of $$('input[name="paud"]', modal)) {
        r.addEventListener('change', () => { settings.audience = r.value; changedSetting(); });
      }
      for (const k of ['side', 'interior', 'memo']) {
        $(`#opt-${k}`, modal).addEventListener('change', (e) => { settings[k] = e.target.checked; changedSetting(); });
      }
      $('.preview-box', modal).addEventListener('click', async (e) => {
        const dl = e.target.closest('[data-dl]');
        const sh = e.target.closest('[data-share]');
        const zm = e.target.closest('[data-zoom]');
        const imgOf = (el, k) => images[+el.dataset[k]];
        const urlOf = (el, k) => previewUrls[+el.dataset[k]];
        if (dl) {
          const img = imgOf(dl, 'dl');
          if (!img) return;
          if (FRAMED) {
            // この表示ではダウンロードできないため、拡大表示で長押し保存を案内する
            openZoom(urlOf(dl, 'dl'), img, dl, { saveHint: true });
          } else {
            downloadBlob(img.blob, fileName(img));
            toast('ダウンロードを開始しました。iPadでは「ファイル」アプリの「ダウンロード」に入ります。写真に入れる場合は画像を長押ししてください');
          }
        } else if (zm) {
          const img = imgOf(zm, 'zoom');
          // 画像のタップで開いた場合は、閉じたあと同じ画像の「拡大して確認」ボタンへ戻す
          const opener = zm.tagName === 'IMG' ? $(`button[data-zoom="${zm.dataset.zoom}"]`, modal) : zm;
          if (img) openZoom(urlOf(zm, 'zoom'), img, opener);
        } else if (sh) {
          const img = images[+sh.dataset.share];
          if (!img) return;
          try {
            await navigator.share({ files: [new File([img.blob], fileName(img), { type: 'image/png' })], title: '仕様の確認' });
          } catch (err) {
            if (err && err.name === 'AbortError') return;
            toast('共有できませんでした。「画像を保存」か、拡大表示で画像を長押しして保存してください');
          }
        }
      });
    },
  });
}

// ---------- 確認画像の拡大表示 ----------
// プレビューの表示倍率だけを変える。書き出した画像（blob）には一切触れない。

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4]; // 1 = 画面幅に合わせた表示
const zoomState = { open: false, level: 0, opener: null, natural: 0 };

function openZoom(url, img, opener, opts = {}) {
  let root = $('#zoomRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'zoomRoot';
    document.body.appendChild(root);
  }
  zoomState.open = true;
  zoomState.level = 0;
  zoomState.opener = opener || null;
  zoomState.natural = img.width;
  const title = img.total > 1 ? `${img.index}/${img.total}枚目` : '確認画像';
  root.innerHTML = `
    <div class="zoom" role="dialog" aria-modal="true" aria-label="${esc(title)}の拡大表示">
      <div class="zoom-bar">
        <div class="zoom-ctrl">
          <button type="button" class="btn zoom-btn" data-z="out" aria-label="縮小">－</button>
          <output class="zoom-level" id="zoomLevel" aria-live="polite">100%</output>
          <button type="button" class="btn zoom-btn" data-z="in" aria-label="拡大">＋</button>
          <button type="button" class="btn" data-z="fit">表示を戻す</button>
        </div>
        <button type="button" class="btn btn-primary zoom-close" data-z="close">閉じる</button>
      </div>
      <p class="zoom-hint">${opts.saveHint || FRAMED ? '画像を長押しして「"写真"に保存」を選ぶと保存できます。' : '指で上下左右に動かして確認できます。画像の長押しでも保存できます。'}　100%＝画面の幅に合わせた大きさ</p>
      <div class="zoom-scroll" id="zoomScroll" tabindex="0" aria-label="${esc(title)}（スクロールで移動）">
        <img src="${url}" alt="${esc(title)}" class="zoom-img" id="zoomImg">
      </div>
    </div>`;
  root.hidden = false;
  setInert($('#modalRoot'), true);
  hideToast();
  root.querySelector('.zoom-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-z]');
    if (!b) return;
    const z = b.dataset.z;
    if (z === 'close') closeZoom();
    else if (z === 'in') setZoom(zoomState.level + 1);
    else if (z === 'out') setZoom(zoomState.level - 1);
    else if (z === 'fit') setZoom(0, true);
  });
  setZoom(0, true);
  $('[data-z="close"]', root).focus({ preventScroll: true });
}

function fitWidth() {
  const sc = $('#zoomScroll');
  return sc ? Math.max(100, sc.clientWidth - 16) : 300;
}

/** 表示倍率を変える。画面中央の位置を保つ */
function setZoom(level, toTop = false) {
  const sc = $('#zoomScroll');
  const im = $('#zoomImg');
  if (!sc || !im) return;
  const lv = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, level));
  const cx = sc.scrollWidth ? (sc.scrollLeft + sc.clientWidth / 2) / sc.scrollWidth : 0.5;
  const cy = sc.scrollHeight ? (sc.scrollTop + sc.clientHeight / 2) / sc.scrollHeight : 0;
  zoomState.level = lv;
  im.style.width = `${Math.round(fitWidth() * ZOOM_LEVELS[lv])}px`;
  $('#zoomLevel').textContent = `${Math.round(ZOOM_LEVELS[lv] * 100)}%`;
  $('[data-z="out"]').disabled = lv === 0;
  $('[data-z="in"]').disabled = lv === ZOOM_LEVELS.length - 1;
  if (toTop) {
    sc.scrollLeft = 0;
    sc.scrollTop = 0;
  } else {
    sc.scrollLeft = cx * sc.scrollWidth - sc.clientWidth / 2;
    sc.scrollTop = cy * sc.scrollHeight - sc.clientHeight / 2;
  }
}

function closeZoom() {
  const root = $('#zoomRoot');
  if (!root || !zoomState.open) return;
  zoomState.open = false;
  root.hidden = true;
  root.innerHTML = '';
  setInert($('#modalRoot'), false);
  const op = zoomState.opener;
  zoomState.opener = null;
  if (op && document.contains(op)) {
    try { op.focus({ preventScroll: false }); } catch { /* 無視 */ }
  }
}

window.addEventListener('resize', () => { if (zoomState.open) setZoom(zoomState.level); });

function canShareFile(blob, name) {
  try {
    if (!navigator.canShare || !navigator.share || typeof File !== 'function') return false;
    return navigator.canShare({ files: [new File([blob], name, { type: blob.type })] });
  } catch {
    return false;
  }
}

function downloadBlob(blob, name) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    toast('ダウンロードできませんでした。画像を長押しして保存してください');
  }
}

// ---------- データ（バックアップ） ----------

function backupFileName() {
  const doc = state.doc;
  const ed = EDITION.id === 'trial' ? '_trial' : '';
  return `katachi_backup${ed}_${safeFilePart(doc.current.orderNo)}_v${doc.version}.json`;
}

function backupText() {
  // どの版で書き出したかを記録（読み込み時の判定には使わない）
  return JSON.stringify({ ...serializeDoc(state.doc), edition: EDITION.id }, null, 2);
}

async function onData() {
  const doc = state.doc;
  const name = backupFileName();
  await openModal({
    title: 'データ（バックアップと復元）',
    html: `
      <p>今の内容・変更前の内容・版番号をファイルに書き出し、あとで復元できます。</p>
      <p class="hint">ブラウザの保存は、設定や容量の都合で消えることがあります。区切りごとに書き出しておくと安心です。</p>
      <div class="data-actions">
        <button type="button" class="btn btn-primary" id="dExport"${FRAMED ? ' hidden' : ''}>バックアップを書き出す</button>
        <button type="button" class="btn" id="dImport">バックアップから復元</button>
      </div>
      <details class="data-more"${FRAMED ? ' open' : ''}>
        <summary>ファイルが使えない場合（テキストで保存・復元）</summary>
        <p class="hint">下のテキストをコピーしてメモなどに保存できます。復元するときは、保存したテキストを貼り付けて「テキストから復元」を押します。</p>
        <textarea id="dText" rows="6" spellcheck="false" aria-label="バックアップのテキスト"></textarea>
        <div class="data-actions">
          <button type="button" class="btn" id="dCopy">現在の内容をテキストで表示・コピー</button>
          <button type="button" class="btn" id="dPaste">テキストから復元</button>
        </div>
      </details>
      <hr>
      <button type="button" class="btn btn-danger" id="dNew">新しい注文を始める（内容を消去）</button>`,
    actions: [{ label: '閉じる', value: null }],
    onMount: (modal) => {
      $('#dExport', modal).addEventListener('click', async () => {
        const blob = new Blob([backupText()], { type: 'application/json' });
        downloadBlob(blob, name);
        toast('バックアップを書き出しました');
      });
      $('#dImport', modal).addEventListener('click', () => { const fi = $('#fileInput'); fi.value = ''; fi.click(); });
      $('#dCopy', modal).addEventListener('click', async () => {
        const ta = $('#dText', modal);
        ta.value = backupText();
        ta.focus();
        ta.select();
        try { await navigator.clipboard.writeText(ta.value); toast('コピーしました'); } catch { toast('テキストを選択しました。コピーしてください'); }
      });
      $('#dPaste', modal).addEventListener('click', () => {
        const text = $('#dText', modal).value;
        closeModal(null);
        importText(text);
      });
      $('#dNew', modal).addEventListener('click', () => {
        closeModal(null);
        startNewOrder();
      });
    },
  });
}

function onFileChosen(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  closeModal(null);
  if (file.size > 200_000) {
    openModal({ title: '読み込めませんでした', html: '<p>ファイルが大きすぎます。このツールで書き出したバックアップを選んでください。</p><p>現在の内容はそのまま残っています。</p>' });
    return;
  }
  const reader = new FileReader();
  reader.onload = () => importText(String(reader.result || ''));
  reader.onerror = () => openModal({ title: '読み込めませんでした', html: '<p>ファイルを読み取れませんでした。</p><p>現在の内容はそのまま残っています。</p>' });
  reader.readAsText(file);
}

async function importText(text) {
  let doc;
  try {
    doc = parseBackup(text);
  } catch (err) {
    await openModal({
      title: '読み込めませんでした',
      html: `<p class="error-text">！ ${esc(err.message)}</p><p>現在の内容はそのまま残っています。</p>`,
    });
    return;
  }
  const summary = `<ul class="plain">
    <li>注文番号：${esc(doc.current.orderNo || '未入力')}</li>
    <li>版：${doc.version}${doc.baseline ? `（変更前：版${doc.baselineVersion}）` : '（変更前なし）'}</li></ul>`;
  const ok = await confirmModal('バックアップから復元', `<p>次の内容で、現在の内容（変更前を含む）を置き換えます。</p>${summary}`, '置き換える', true);
  if (!ok) return;
  replaceDoc(doc);
  toast('バックアップから復元しました');
}

// テスト用に状態を参照できるようにする（画面には影響しない）
window.__katachi = { state, render, zoomState };

init();
