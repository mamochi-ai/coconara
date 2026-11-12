import {
  DIMS, COLORS, TRI, colorOf, rangeText, fmt, emptyDoc, cloneOrder, analyze, diffOrders, changeText,
  fieldValues, sampleDoc, summarizeChanges, defaultOutput, hasContent, serializeDoc, parseBackup,
} from './model.js';
import { buildScene, buildCompareScene, sceneToSvg } from './diagram.js';
import { renderPngs, exportBlockers } from './export.js';
import { loadDoc, saveDoc } from './storage.js';

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
  state.loadError = loaded.error;
  if (loaded.error === 'unavailable') state.save = { status: 'unavailable' };
  if (loaded.error === 'broken') state.save = { status: 'broken' };

  buildDimFields();
  buildChoice($('#outerColorChips'), 'outerColor', colorChoices());
  buildChoice($('#liningColorChips'), 'liningColor', colorChoices());
  buildChoice($('#liningSeg'), 'lining', TRI.map((t) => ({ value: t.key, label: t.label })));
  buildChoice($('#pocketSeg'), 'pocket', TRI.map((t) => ({ value: t.key, label: t.label })));
  bindEvents();
  fillForm();
  if (!hasContent(state.doc) && isWide()) state.tab = 'diagram';
  render();
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
function saveNow() {
  clearTimeout(saveTimer);
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
  const tabCompare = $('#tab-compare');
  tabCompare.innerHTML = changes.length ? `比較 <span class="tab-badge">変更 ${changes.length}</span>` : '比較';

  // ヘッダー
  $('#sampleBanner').hidden = !doc.isSample;
  const no = doc.current.orderNo.trim();
  $('#orderMeta').innerHTML = `
    <span class="meta-item"><span class="meta-k">注文番号</span>${no ? esc(no) : '<span class="pending-text">未入力</span>'}</span>
    <span class="meta-item"><span class="meta-k">版</span>${doc.version}</span>
    <span class="meta-item mode">${doc.baseline ? `比較元：版${doc.baselineVersion}` : '初回確認モード（比較元なし）'}</span>`;
  $('#versionReadout').textContent = doc.baseline
    ? `版 ${doc.version}（比較元：版 ${doc.baselineVersion}）`
    : `版 ${doc.version}（初回確認）`;
  const bb = $('#btnBaseline');
  bb.textContent = doc.baseline ? '比較元を更新' : '比較元として保存';

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
        ? '<span class="badge-change">変更</span>比較元から内容が変わっています'
        : `<span class="badge-change">変更</span>比較元（版${doc.baselineVersion}）：${esc(bf.text)}`;
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
    return `<div class="list-block errors"><h3><span aria-hidden="true">！</span>値を確認してください</h3><ul>${an.errors.map((e) => `<li>${esc(e.label)}：${esc(e.message)}</li>`).join('')}</ul></div>`;
  }
  return '';
}

function renderDiagram(an, changes) {
  const doc = state.doc;
  $('#diagramSub').textContent = doc.baseline
    ? `版${doc.version}（編集中）。比較元（版${doc.baselineVersion}）からの変更はオレンジ色と「変更」で示します。`
    : `版${doc.version}。初回確認モードです。`;
  $('#diagram').innerHTML = sceneToSvg(buildScene(doc.current, { baseline: doc.baseline, highlight: state.highlight, narrow: isNarrow() }), 'バッグの模式図（正面図・側面図・内側）');
  let html = pendingListHtml(an);
  html += `<div class="list-block pending"><h3><span aria-hidden="true">？</span>未入力・未定の項目</h3>${an.pending.length
    ? `<ul>${an.pending.map((p) => `<li>${esc(p.text)}</li>`).join('')}</ul>` : '<p>なし</p>'}</div>`;
  if (doc.baseline) html += changesHtml(changes);
  $('#diagramLists').innerHTML = html;
}

function changesHtml() {
  const doc = state.doc;
  // 画面では作家向けに、注文メモ・確認事項の変更も含めてまとめて表示する
  const list = summarizeChanges(doc.baseline, doc.current, { memo: true, questions: true });
  return `<div class="list-block changes"><h3><span class="sq" aria-hidden="true"></span>比較元（版${doc.baselineVersion}）からの変更点</h3>${list.length
    ? `<ul>${list.map((c) => `<li><span class="badge-change">変更</span>${esc(c.text)}</li>`).join('')}</ul>`
    : '<p>比較元からの変更はありません</p>'}</div>`;
}

function renderCompare(changes) {
  const doc = state.doc;
  const body = $('#compareBody');
  if (!doc.baseline) {
    $('#compareSub').textContent = '初回確認モード';
    body.innerHTML = `
      <div class="empty-card">
        <h3>初回確認モードです</h3>
        <p>まだ比較元がありません。現在の内容をお客様に確認したら「比較元として保存」を押すと、その時点の内容を固定し、以降の変更点を比べられます。</p>
        <p class="hint">比較元として保存しても、お客様の承認を記録するものではありません。</p>
        <button type="button" class="btn btn-primary" data-act="baseline">現在の内容を比較元として保存</button>
      </div>`;
    $('[data-act="baseline"]', body).addEventListener('click', onBaseline);
    return;
  }
  $('#compareSub').textContent = `変更前＝比較元（版${doc.baselineVersion}）、変更後＝現在の内容（版${doc.version}・編集中）。同じ縮尺で表示しています。`;
  const scene = buildCompareScene(doc.baseline, doc.current, {
    beforeTitle: `変更前（版${doc.baselineVersion}）`,
    afterTitle: `変更後（版${doc.version}）`,
    highlight: state.highlight,
    narrow: isNarrow(),
  });
  body.innerHTML = `
    <div class="diagram">${sceneToSvg(scene, '変更前と変更後の模式図')}</div>
    <div class="lists">${changesHtml(changes)}
      <p class="hint">比較元は、比較のために作家が保存した内容です。お客様の承認を示すものではありません。比較元は編集では変わりません。更新するときは「比較元を更新」を押してください。</p>
    </div>`;
}

// ---------- モーダル ----------

let modalResolve = null;
let lastFocus = null;
function openModal({ title, html, actions = [{ label: '閉じる', value: null }], wide = false, onMount }) {
  const root = $('#modalRoot');
  lastFocus = document.activeElement;
  root.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <h2 id="modalTitle">${esc(title)}</h2>
      <div class="modal-body">${html}</div>
      <div class="modal-actions">${actions.map((a, i) => `<button type="button" class="btn${a.primary ? ' btn-primary' : ''}${a.danger ? ' btn-danger' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div>`;
  root.hidden = false;
  document.body.classList.add('modal-open');
  return new Promise((resolve) => {
    modalResolve = resolve;
    $$('.modal-actions button', root).forEach((b) => b.addEventListener('click', () => closeModal(actions[+b.dataset.i].value)));
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
  const r = modalResolve;
  modalResolve = null;
  if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch { /* 無視 */ }
  if (r) r(value);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(null); });

const confirmModal = (title, html, okLabel, danger = false) => openModal({
  title, html,
  actions: [{ label: 'キャンセル', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
});

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
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function replaceDoc(doc) {
  state.doc = doc;
  state.highlight = null;
  fillForm();
  render();
  saveNow();
}

// ---------- 操作 ----------

async function onSample() {
  if (hasContent(state.doc)) {
    const ok = await confirmModal('サンプルで試す', '<p>現在の内容（比較元を含む）を、架空のサンプルで置き換えます。</p><p class="hint">必要な場合は、先に「データ」からバックアップを書き出してください。</p>', 'サンプルに置き換える', true);
    if (!ok) return;
  }
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
      title: '比較元として保存できません',
      html: `<p>次の値を確認してください。</p><ul class="err-list">${an.errors.map((e) => `<li>${esc(e.label)}：${esc(e.message)}</li>`).join('')}</ul>`,
    });
    return;
  }
  const pend = an.pending.length ? `<p class="hint">未入力・未定の項目が ${an.pending.length} 件あります（そのまま固定されます）。</p>` : '';
  const html = doc.baseline
    ? `<p>比較元（版${doc.baselineVersion}）を、現在の内容（版${doc.version}）で置き換えます。以降の編集は版${doc.version + 1}として比べます。</p>${pend}<p class="hint">お客様の承認を記録するものではありません。</p>`
    : `<p>現在の内容（版${doc.version}）を比較元として固定します。以降の編集は版${doc.version + 1}として、変更点を比べられます。</p>${pend}<p class="hint">お客様の承認を記録するものではありません。</p>`;
  const ok = await confirmModal(doc.baseline ? '比較元を更新' : '比較元として保存', html, doc.baseline ? '比較元を更新する' : '比較元として保存する');
  if (!ok) return;
  doc.baseline = cloneOrder(doc.current);
  doc.baselineVersion = doc.version;
  doc.version += 1;
  render();
  saveNow();
  toast(`版${doc.baselineVersion}を比較元にしました。以降の編集は版${doc.version}です`);
}

let previewUrls = [];
async function onExport() {
  const doc = state.doc;
  const blockers = exportBlockers(doc);
  if (blockers.length) {
    await openModal({
      title: '確認画像を作成できません',
      html: `<p>次の値に誤りがあるため、画像を作成できません。入力欄を直してから、もう一度お試しください。</p><ul class="err-list">${blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`,
    });
    return;
  }
  if (!doc.output) doc.output = defaultOutput();
  const settings = doc.output; // 出力設定は保存する（比較元・注文内容には影響しない）
  const fileName = (img) => {
    const base = (doc.current.orderNo.trim() || 'order').replace(/[^\w.-]+/g, '_').slice(0, 40);
    const kind = settings.audience === 'maker' ? 'detail' : 'customer';
    return `katachi_${base}_v${doc.version}_${kind}${img.total > 1 ? `_${img.index}of${img.total}` : ''}.png`;
  };
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
      result = await renderPngs(doc, settings);
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
    $('#pageInfo', modal).textContent = multi
      ? `長いため ${images.length} 枚に分けました。1枚ずつ保存してください。`
      : '1枚の画像です。';
    box.innerHTML = images.map((img, i) => `
      <figure class="preview-page" data-page="${i}">
        ${multi ? `<figcaption>${img.index}/${img.total}　${esc(img.name)}</figcaption>` : ''}
        <div class="preview-actions">
          <button type="button" class="btn btn-primary" data-share="${i}" ${FRAMED || !canShareFile(img.blob, fileName(img)) ? 'hidden' : ''}>共有・保存…</button>
          <button type="button" class="btn" data-dl="${i}" ${FRAMED ? 'hidden' : ''}>${multi ? `${img.index}枚目をダウンロード` : '画像をダウンロード'}</button>
        </div>
        <img src="${previewUrls[i]}" alt="確認画像のプレビュー ${img.index}/${img.total}" class="preview-img">
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
      ${pendingN ? `<p class="pending-note"><span aria-hidden="true">？</span>未入力・未定の項目が ${pendingN} 件あります。画像にもそのまま記載されます。</p>` : ''}
      <p class="hint" id="pageInfo"></p>
      <p class="hint">${FRAMED ? '画像を長押しして「"写真"に保存」を選ぶと保存できます。' : '保存できない場合は、画像を長押しして「"写真"に保存」または「画像を保存」を選んでください。'}</p>
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
        if (dl) {
          const img = images[+dl.dataset.dl];
          if (img) downloadBlob(img.blob, fileName(img));
        } else if (sh) {
          const img = images[+sh.dataset.share];
          if (!img) return;
          try {
            await navigator.share({ files: [new File([img.blob], fileName(img), { type: 'image/png' })], title: '仕様の確認' });
          } catch (err) {
            if (err && err.name === 'AbortError') return;
            toast('共有できませんでした。ダウンロードか、画像の長押しで保存してください');
          }
        }
      });
    },
  });
}

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

function backupText() {
  return JSON.stringify(serializeDoc(state.doc), null, 2);
}

async function onData() {
  const doc = state.doc;
  const name = `katachi_backup_${(doc.current.orderNo.trim() || 'order').replace(/[^\w.-]+/g, '_').slice(0, 40)}_v${doc.version}.json`;
  await openModal({
    title: 'データ（バックアップと復元）',
    html: `
      <p>現在の内容・比較元・版番号をファイルに書き出し、あとで復元できます。</p>
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
      $('#dNew', modal).addEventListener('click', async () => {
        closeModal(null);
        const ok = await confirmModal('新しい注文を始める', '<p>現在の内容と比較元を消去し、空の状態から始めます。この操作は取り消せません。</p><p class="hint">必要な場合は、先にバックアップを書き出してください。</p>', '消去して始める', true);
        if (!ok) return;
        replaceDoc(emptyDoc());
        state.tab = 'input';
        render();
        toast('新しい注文を始めました');
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
    <li>版：${doc.version}${doc.baseline ? `（比較元：版${doc.baselineVersion}）` : '（比較元なし）'}</li></ul>`;
  const ok = await confirmModal('バックアップから復元', `<p>次の内容で、現在の内容（比較元を含む）を置き換えます。</p>${summary}`, '置き換える', true);
  if (!ok) return;
  replaceDoc(doc);
  toast('バックアップから復元しました');
}

// テスト用に状態を参照できるようにする（画面には影響しない）
window.__katachi = { state, render };

init();
