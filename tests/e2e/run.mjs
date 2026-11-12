// ブラウザでの動作確認（Playwright + Chromium）。
// 実行: npm run test:e2e   （playwright が利用できる環境が必要）
// 画面写真と書き出したPNGは test-output/ に保存する。
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../scripts/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = fileURLToPath(new URL('../../test-output/', import.meta.url));

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`FAIL ${name}\n     ${e.message.split('\n')[0]}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const server = createServer();
await new Promise((r) => server.listen(0, r));
const URL_ = `http://localhost:${server.address().port}/`;
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

async function newPage(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: viewport.width < 900, deviceScaleFactor: 1, acceptDownloads: true });
  if (opts.denyStorage) {
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
    });
  }
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(URL_);
  return page;
}
const IPAD_L = { width: 1180, height: 820 };
const IPAD_P = { width: 820, height: 1180 };
const PHONE = { width: 390, height: 844 };

async function loadSample(page) {
  await page.tap('#btnSample');
  const modal = page.locator('.modal');
  if (await modal.count()) await page.tap('.modal-actions .btn-danger');
  await page.waitForFunction(() => window.__katachi.state.doc.isSample);
}
const changesText = (page) => page.$$eval('.list-block.changes li', (els) => els
  .filter((e) => e.offsetParent !== null).map((e) => e.textContent.replace(/^変更/, '').trim()));
const visibleText = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.textContent).join('\n'));
const setField = async (page, sel, value) => { await page.fill(sel, value); await page.locator(sel).blur(); };
const tapRadio = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"]`).locator('..').tap();
const ensureInputVisible = async (page) => { if (!(await page.locator('#f-height').isVisible())) await page.tap('#tab-input'); };

/** 保存前プレビューで設定を選び、表示された画像（1枚以上）を取り出す */
async function makePngs(page, opts = {}) {
  await page.tap('#btnExport');
  await page.waitForSelector('.preview-img');
  if (opts.audience) {
    const r = page.locator(`input[name="paud"][value="${opts.audience}"]`);
    if (!(await r.isChecked())) { await r.locator('..').tap(); await page.waitForSelector('.preview-img'); }
  }
  for (const k of ['side', 'interior', 'memo']) {
    if (opts[k] === undefined) continue;
    const cb = page.locator(`#opt-${k}`);
    if ((await cb.isChecked()) !== opts[k] && !(await cb.isDisabled())) {
      await cb.locator('..').tap();
      await page.waitForSelector('.preview-img');
    }
  }
  const imgs = await page.$$eval('.preview-img', (els) => Promise.all(els.map(async (img) => {
    const r = await fetch(img.src);
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { b64: btoa(s), w: img.naturalWidth, h: img.naturalHeight };
  })));
  const text = await page.textContent('.modal');
  const controls = await page.evaluate(() => ['side', 'interior', 'memo'].map((k) => ({ k, checked: document.getElementById(`opt-${k}`).checked, disabled: document.getElementById(`opt-${k}`).disabled })));
  if (opts.screenshot) await page.screenshot({ path: opts.screenshot });
  await page.tap('.modal-actions .btn');
  return { imgs, text, controls };
}
async function savePngs(name, res) {
  for (let i = 0; i < res.imgs.length; i++) {
    await writeFile(`${OUT}${name}${res.imgs.length > 1 ? `-${i + 1}` : ''}.png`, Buffer.from(res.imgs[i].b64, 'base64'));
  }
}

// ---------- iPad 横向き ----------
const page = await newPage(IPAD_L);

await check('1. サンプルの底幅と変更点が正しい', async () => {
  await loadSample(page);
  const bottom = (await page.textContent('#bottomReadout')).trim();
  assert(bottom === '35 cm', `底幅 ${bottom}`);
  const ch = await changesText(page);
  const expect = ['袋口幅：40 → 45cm', '底幅：30 → 35cm（袋口幅変更に伴う）', '内ポケット：なし → あり', 'お客様に確認したいこと：内容を変更'];
  assert(JSON.stringify(ch) === JSON.stringify(expect), JSON.stringify(ch));
  assert(await page.isVisible('#sampleBanner'), 'サンプル表示');
  const svg = await page.innerHTML('#compareBody');
  assert(svg.includes('袋口幅 40cm<') && svg.includes('袋口幅 45cm（変更）'), '比較図の寸法');
  await page.screenshot({ path: `${OUT}ipad-landscape-compare.png` });
});

await check('5. 編集しても比較元は変わらない', async () => {
  await setField(page, '#f-height', '33');
  const base = await page.evaluate(() => window.__katachi.state.doc.baseline.dims.height);
  assert(base === '30', `比較元 ${base}`);
  const ch = await changesText(page);
  assert(ch.includes('本体高さ：30 → 33cm'), JSON.stringify(ch));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('katachi-awase:doc')).data.baseline.dims.height);
  assert(stored === '30', '自動保存でも比較元は不変');
});

await check('6. 元の値に戻すと変更表示が消える', async () => {
  await setField(page, '#f-height', '30');
  const ch = await changesText(page);
  assert(!ch.some((t) => t.startsWith('本体高さ')), JSON.stringify(ch));
  const cls = await page.getAttribute('.field[data-field="height"]', 'class');
  assert(!cls.includes('is-changed'), '入力欄の変更表示');
  await setField(page, '#f-mouthWidth', '40');
  await tapRadio(page, 'pocket', 'none');
  await setField(page, '#f-questions', '');
  const empty = await visibleText(page, '.list-block.changes');
  assert(empty.includes('比較元からの変更はありません'), empty);
  assert((await page.textContent('#tab-compare')).trim() === '比較', 'タブの変更件数が消える');
});

await check('4. 40 と 40.0 は同じ値として扱う', async () => {
  await setField(page, '#f-mouthWidth', '40.0');
  const empty = await visibleText(page, '.list-block.changes');
  assert(empty.includes('比較元からの変更はありません'), empty);
  await setField(page, '#f-mouthWidth', '４０');
  assert((await visibleText(page, '.list-block.changes')).includes('比較元からの変更はありません'), '全角');
});

await check('2. マチが袋口幅以上でエラー、画像出力も止まる', async () => {
  await setField(page, '#f-gusset', '40');
  const err = await page.textContent('#e-gusset');
  assert(err.includes('マチは袋口幅（40cm）より小さく'), err);
  assert((await page.getAttribute('#f-gusset', 'aria-invalid')) === 'true', 'aria-invalid');
  assert((await page.textContent('#bottomReadout')).includes('確認すると計算'), '底幅を計算しない');
  await page.tap('#btnExport');
  const t = await page.textContent('.modal');
  assert(t.includes('確認画像を作成できません') && t.includes('マチ'), t);
  await page.screenshot({ path: `${OUT}ipad-export-blocked.png` });
  await page.tap('.modal-actions .btn');
  await page.tap('#btnBaseline');
  assert((await page.textContent('.modal')).includes('比較元として保存できません'), '比較元の更新も止まる');
  await page.tap('.modal-actions .btn');
  await setField(page, '#f-gusset', '10');
});

await check('3. 未入力と0を混同しない', async () => {
  await setField(page, '#f-gusset', '0');
  assert((await page.textContent('#bottomReadout')).trim() === '40 cm', '0なら底幅=袋口幅');
  await page.tap('#tab-diagram');
  let pend = await visibleText(page, '.list-block.pending');
  assert(!pend.includes('マチ'), pend);
  await setField(page, '#f-gusset', '');
  pend = await visibleText(page, '.list-block.pending');
  assert(pend.includes('マチ：未入力'), pend);
  assert((await page.textContent('#bottomReadout')).includes('入力すると計算'), '空欄なら底幅は未計算');
  const svg = await page.innerHTML('#diagram');
  assert(svg.includes('マチ ？cm（未入力）'), '図で？表示');
  await page.screenshot({ path: `${OUT}ipad-gusset-empty.png` });
  await setField(page, '#f-gusset', '10');
});

await check('7. 裏地・ポケットの未定／あり／なしが反映される', async () => {
  await page.tap('#tab-diagram');
  const svg = () => page.innerHTML('#diagram');
  const pend = () => visibleText(page, '.list-block.pending');
  await tapRadio(page, 'lining', 'undecided');
  assert((await svg()).includes('裏地：未定'), 'lining undecided');
  assert((await pend()).includes('裏地：未定'), 'pending lining');
  assert(await page.isHidden('#liningColorField'), '裏地色は非表示');
  await tapRadio(page, 'lining', 'yes');
  assert(await page.isVisible('#liningColorField'), '裏地色を表示');
  assert((await svg()).includes('裏地：あり〈色は未定〉'), 'lining yes no color');
  assert((await pend()).includes('裏地の色：未定'), 'pending lining color');
  await tapRadio(page, 'liningColor', 'navy');
  assert((await svg()).includes('裏地：あり〈ネイビー〉'), 'lining navy');
  await tapRadio(page, 'pocket', 'undecided');
  assert((await svg()).includes('内ポケット：未定'), 'pocket undecided');
  await tapRadio(page, 'pocket', 'yes');
  assert((await svg()).includes('片面中央に1個'), 'pocket yes');
  assert(await page.isVisible('#pocketCondition'), 'ポケット条件の表示');
  const ch = await changesText(page);
  assert(ch.includes('裏地：なし → あり〈ネイビー〉') && !ch.some((t) => t.startsWith('裏地の色')) && ch.includes('内ポケット：なし → あり'), JSON.stringify(ch));
  await page.screenshot({ path: `${OUT}ipad-lining-pocket.png`, fullPage: false });
  await tapRadio(page, 'lining', 'none');
});

await check('8. お客様用／作家用のPNG（日本語・寸法線・変更点）と出力設定', async () => {
  // 現在：裏地あり〈ネイビー〉・ポケットあり（比較元は裏地なし・ポケットなし）
  const cu = await makePngs(page, { audience: 'customer', side: false, interior: false, memo: false, screenshot: `${OUT}ipad-preview-customer.png` });
  await savePngs('export-customer', cu);
  assert(cu.imgs.length === 1 && cu.imgs[0].w === 2000, `お客様用 ${cu.imgs.length}枚 幅${cu.imgs[0].w}`);
  const interior = cu.controls.find((c) => c.k === 'interior');
  assert(interior.checked && interior.disabled, '裏地・ポケット変更で内側図は自動で含める');
  assert(cu.text.includes('裏地・ポケットの変更があるため含めます'), '理由の表示');
  const mk = await makePngs(page, { audience: 'maker' });
  await savePngs('export-maker', mk);
  assert(mk.controls.every((c) => c.checked && c.disabled), '作家用は全部含める');
  assert(mk.imgs.reduce((a, x) => a + x.h, 0) > cu.imgs.reduce((a, x) => a + x.h, 0), '作家用の方が詳しい');
  // 設定は保存され、比較元は変わらない
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('katachi-awase:doc')).data);
  assert(saved.output.audience === 'maker', '出力設定の保存');
  assert(saved.baseline.lining === 'none', '比較元は不変');
  await makePngs(page, { audience: 'customer' });
});

await check('7b. 長い注文メモ・確認事項は複数枚に分け、各画像に番号を入れる', async () => {
  // 入力上限（各1000文字）いっぱいの文章
  const tail = '\n改行後の行もあります。\n\n最後の行：ここまで表示されていればOK';
  const longMemo = 'ご希望：肩掛けできる長さの持ち手。A4のクリアファイルが入る大きさを希望。'.repeat(30).slice(0, 1000 - tail.length) + tail;
  await page.fill('#f-memo', longMemo);
  const qTail = '確認事項の最後の行';
  await page.fill('#f-questions', ('内ポケットの大きさは、お任せでよろしいですか？\n'.repeat(40)).slice(0, 1000 - qTail.length) + qTail);
  assert((await page.inputValue('#f-memo')).endsWith('ここまで表示されていればOK'), 'メモ入力');
  const cu = await makePngs(page, { audience: 'customer', memo: true, screenshot: `${OUT}ipad-preview-multi.png` });
  await savePngs('export-customer-long', cu);
  assert(cu.imgs.length >= 2, `${cu.imgs.length}枚`);
  assert(cu.text.includes(`${cu.imgs.length} 枚に分けました`), '枚数の案内');
  assert(cu.imgs.every((x) => x.w === 2000), '幅は一定');
  const mk = await makePngs(page, { audience: 'maker' });
  await savePngs('export-maker-long', mk);
  assert(mk.imgs.length >= 2, `作家用 ${mk.imgs.length}枚`);
  await makePngs(page, { audience: 'customer', memo: false });
});

let backupPath;
await check('9. JSONで比較元を含めて復元できる', async () => {
  await setField(page, '#f-orderNo', 'TEST-77');
  const before = await page.evaluate(() => JSON.stringify(window.__katachi.state.doc));
  await page.tap('#btnData');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.tap('#dExport')]);
  backupPath = `${OUT}backup.json`;
  await dl.saveAs(backupPath);
  await page.tap('.modal-actions .btn');
  const json = JSON.parse(await readFile(backupPath, 'utf8'));
  assert(json.schema_version === 2 && json.data.output && json.data.baseline && json.data.baseline_version === 1, 'JSONの内容');
  // 消去してから復元
  await page.tap('#btnData');
  await page.tap('#dNew');
  await page.tap('.modal-actions .btn-danger');
  assert(await page.evaluate(() => window.__katachi.state.doc.baseline === null), '消去された');
  await page.tap('#btnData');
  await page.setInputFiles('#fileInput', backupPath);
  await page.waitForSelector('.modal h2:text("バックアップから復元")');
  await page.tap('.modal-actions .btn-danger');
  const after = await page.evaluate(() => JSON.stringify(window.__katachi.state.doc));
  assert(after === before, '復元後の内容が一致');
  assert((await page.inputValue('#f-orderNo')) === 'TEST-77', '入力欄に反映');
});

await check('10. 壊れたJSONを読み込んでも既存内容が消えない', async () => {
  const before = await page.evaluate(() => JSON.stringify(window.__katachi.state.doc));
  const broken = `${OUT}broken.json`;
  await writeFile(broken, '{"schema_version":1,"data":{"current":');
  await page.setInputFiles('#fileInput', broken);
  await page.waitForSelector('.modal h2:text("読み込めませんでした")');
  const t = await page.textContent('.modal');
  assert(t.includes('現在の内容はそのまま'), t);
  await page.tap('.modal-actions .btn');
  const wrong = `${OUT}wrong-values.json`;
  const j = JSON.parse(await readFile(backupPath, 'utf8'));
  j.data.current.dims.height = 'abc';
  await writeFile(wrong, JSON.stringify(j));
  await page.setInputFiles('#fileInput', wrong);
  await page.waitForSelector('.modal h2:text("読み込めませんでした")');
  await page.tap('.modal-actions .btn');
  const after = await page.evaluate(() => JSON.stringify(window.__katachi.state.doc));
  assert(after === before, '内容が保持されている');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('katachi-awase:doc')).data.current.orderNo);
  assert(stored === 'TEST-77', '保存データも保持');
});

await check('再読み込みで端末内保存から復元される', async () => {
  await page.reload();
  assert((await page.inputValue('#f-orderNo')) === 'TEST-77', '注文番号');
  assert(await page.evaluate(() => window.__katachi.state.doc.baselineVersion === 1), '比較元');
});

await check('11. 旧形式（schema 1）のJSONを読み込める', async () => {
  const fixture = fileURLToPath(new URL('../fixtures/backup-v1.json', import.meta.url));
  const old = JSON.parse(await readFile(fixture, 'utf8'));
  await page.setInputFiles('#fileInput', fixture);
  await page.waitForSelector('.modal h2:text("バックアップから復元")');
  await page.tap('.modal-actions .btn-danger');
  const doc = await page.evaluate(() => window.__katachi.state.doc);
  assert(JSON.stringify(doc.baseline.dims) === JSON.stringify(old.data.baseline.dims), '比較元の寸法');
  assert(doc.baseline.lining === old.data.baseline.lining && doc.current.liningColor === 'navy', '仕様');
  assert(doc.current.questions === '' && doc.output.audience === 'customer', '新項目は初期値');
  assert((await page.inputValue('#f-mouthWidth')) === '45', '入力欄');
});

await check('ケース1・8・9：大きな変更・黒い表地（お客様用PNG）', async () => {
  await setField(page, '#f-height', '40');
  await setField(page, '#f-gusset', '1');
  await setField(page, '#f-handleHeight', '10');
  await setField(page, '#f-mouthWidth', '40');
  await tapRadio(page, 'outerColor', 'black');
  await page.fill('#f-memo', 'A4のクリアファイルが入る大きさを希望。');
  await page.fill('#f-questions', '内ポケットの大きさは、お任せでよろしいですか？');
  await page.tap('#tab-compare');
  const ch = await changesText(page);
  for (const t of ['本体高さ：30 → 40cm', 'マチ：10 → 1cm', '底幅：30 → 39cm（マチ変更に伴う）', '持ち手高さ：15 → 10cm', '表地：生成り → ブラック', '裏地：なし → あり〈ネイビー〉', '内ポケット：なし → あり']) {
    assert(ch.includes(t), `${t} / ${JSON.stringify(ch)}`);
  }
  await page.screenshot({ path: `${OUT}ipad-compare-black.png` });
  const cu = await makePngs(page, { audience: 'customer', memo: false });
  await savePngs('case1-customer', cu);
  assert(cu.controls.find((c) => c.k === 'side').checked, 'マチ変更で側面図');
  const mk = await makePngs(page, { audience: 'maker' });
  await savePngs('case1-maker', mk);
  await makePngs(page, { audience: 'customer' });
});

await check('ケース2・5：袋口幅だけの変更／比較元なしの初回', async () => {
  // 比較元に合わせてから袋口幅だけ変える
  const p2 = await newPage(IPAD_L);
  await loadSample(p2);
  await setField(p2, '#f-questions', '');
  await tapRadio(p2, 'pocket', 'none');
  const cu = await makePngs(p2, { audience: 'customer' });
  await savePngs('case2-customer', cu);
  assert(!cu.controls.find((c) => c.k === 'side').disabled && !cu.controls.find((c) => c.k === 'side').checked, '側面図は省略');
  await p2.tap('#btnData'); await p2.tap('#dNew'); await p2.tap('.modal-actions .btn-danger');
  for (const [k, v] of [['orderNo', 'NEW-01'], ['height', '28'], ['mouthWidth', '36'], ['gusset', '8'], ['handleHeight', '14']]) await p2.fill(`#f-${k}`, v);
  await tapRadio(p2, 'outerColor', 'navy');
  await tapRadio(p2, 'lining', 'undecided');
  const init = await makePngs(p2, { audience: 'customer' });
  await savePngs('case5-initial-customer', init);
  assert(p2.errors.length === 0, p2.errors.join(' / '));
  await p2.context().close();
});

// ---------- 保存拒否 ----------
await check('11. 保存が拒否された環境でもアプリが停止しない', async () => {
  const p = await newPage(IPAD_L, { denyStorage: true });
  const status = await p.textContent('#saveStatus');
  assert(status.includes('保存できません'), status);
  await loadSample(p);
  await p.fill('#f-height', '31');
  await p.waitForTimeout(500);
  assert((await p.textContent('#saveStatus')).includes('編集と画像作成は続けられます'), '失敗の表示');
  const png = (await makePngs(p)).imgs[0];
  assert(png.w > 0 && png.h > 0, 'PNG出力');
  await p.screenshot({ path: `${OUT}storage-denied.png` });
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
});

// ---------- 画面サイズ ----------
async function layoutCheck(viewport, label) {
  const p = await newPage(viewport);
  const noHScroll = async () => {
    const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
    assert(r.sw <= r.w + 1, `横スクロール発生 ${r.sw} > ${r.w}`);
  };
  await loadSample(p);
  await noHScroll();
  await p.screenshot({ path: `${OUT}${label}-compare.png`, fullPage: true });
  if (viewport.width < 960 || viewport.height > viewport.width) {
    await p.tap('#tab-input');
    assert(await p.isVisible('#f-height'), '入力タブ');
    assert(await p.isVisible('#miniDiagram svg'), '入力中の図');
    await p.tap('#f-mouthWidth');
    assert((await p.innerHTML('#miniDiagram')).includes('#1F5FBF'), '選んだ寸法を図で強調');
    await noHScroll();
    await p.screenshot({ path: `${OUT}${label}-input.png` });
    await p.tap('#tab-diagram');
    assert(await p.isVisible('#diagram svg'), '図タブ');
    await noHScroll();
    await p.screenshot({ path: `${OUT}${label}-diagram.png`, fullPage: true });
  }
  const small = await p.$$eval('button:visible, .choice', (els) => els
    .map((e) => ({ t: e.textContent.trim().slice(0, 12), h: e.getBoundingClientRect().height }))
    .filter((x) => x.h > 0 && x.h < 40));
  assert(small.length === 0, `小さすぎるボタン ${JSON.stringify(small)}`);
  // 入力欄の文字サイズ（16px未満だと iOS で自動ズーム）
  const fs = await p.$eval('#f-height', (e) => parseFloat(getComputedStyle(e).fontSize));
  assert(fs >= 16, `入力欄の文字 ${fs}px`);
  assert((await p.getAttribute('#f-height', 'inputmode')) === 'decimal', '数値キーボード');
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
}
await check('12a. iPad縦（820×1180）で操作できる', () => layoutCheck(IPAD_P, 'ipad-portrait'));
await check('12b. スマートフォン幅（390×844）で操作できる', () => layoutCheck(PHONE, 'phone'));
await check('12c. iPad横（1180×820）は左に入力・右に図', async () => {
  const p = await newPage(IPAD_L);
  const a = await p.locator('#pane-input').boundingBox();
  const b = await p.locator('#pane-diagram').boundingBox();
  assert(a && b && a.x < b.x && Math.abs(a.y - b.y) < 80, `位置 ${JSON.stringify([a, b])}`);
  await p.screenshot({ path: `${OUT}ipad-landscape-empty.png` });
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
});

await check('サンプル上書き前に確認が出る', async () => {
  const p = await newPage(PHONE);
  await p.tap('#tab-input');
  await p.fill('#f-height', '20');
  await p.tap('#btnSample');
  assert(await p.isVisible('.modal'), '確認ダイアログ');
  await p.tap('.modal-actions .btn:not(.btn-danger)');
  assert((await p.inputValue('#f-height')) === '20', 'キャンセルで保持');
  await p.context().close();
});

assert(page.errors.length === 0, page.errors.join(' / '));
await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
