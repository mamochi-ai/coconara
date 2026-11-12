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

async function makePng(page, mode) {
  await page.tap('#btnExport');
  await page.waitForSelector('#previewImg');
  if (mode) {
    await page.locator(`input[name="pmode"][value="${mode}"]`).locator('..').tap();
    await page.waitForTimeout(100);
    await page.waitForSelector('#previewImg');
  }
  const data = await page.$eval('#previewImg', async (img) => {
    const r = await fetch(img.src);
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { b64: btoa(s), w: img.naturalWidth, h: img.naturalHeight };
  });
  await page.tap('.modal-actions .btn');
  return data;
}

// ---------- iPad 横向き ----------
const page = await newPage(IPAD_L);

await check('1. サンプルの底幅と変更点が正しい', async () => {
  await loadSample(page);
  const bottom = (await page.textContent('#bottomReadout')).trim();
  assert(bottom === '35 cm', `底幅 ${bottom}`);
  const ch = await changesText(page);
  const expect = ['袋口幅：40 → 45cm', '底幅：30 → 35cm（袋口幅の変更に伴う）', '内ポケット：なし → あり'];
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
  const empty = await visibleText(page, '.list-block.changes');
  assert(empty.includes('変更点はありません'), empty);
  assert((await page.textContent('#tab-compare')).trim() === '比較', 'タブの変更件数が消える');
});

await check('4. 40 と 40.0 は同じ値として扱う', async () => {
  await setField(page, '#f-mouthWidth', '40.0');
  const empty = await visibleText(page, '.list-block.changes');
  assert(empty.includes('変更点はありません'), empty);
  await setField(page, '#f-mouthWidth', '４０');
  assert((await visibleText(page, '.list-block.changes')).includes('変更点はありません'), '全角');
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
  assert(svg.includes('マチ ？cm（要確認）'), '図で？表示');
  await page.screenshot({ path: `${OUT}ipad-gusset-empty.png` });
  await setField(page, '#f-gusset', '10');
});

await check('7. 裏地・ポケットの未定／あり／なしが反映される', async () => {
  await page.tap('#tab-diagram');
  const svg = () => page.innerHTML('#diagram');
  const pend = () => visibleText(page, '.list-block.pending');
  await tapRadio(page, 'lining', 'undecided');
  assert((await svg()).includes('裏地：未定（要確認）'), 'lining undecided');
  assert((await pend()).includes('裏地：未定'), 'pending lining');
  assert(await page.isHidden('#liningColorField'), '裏地色は非表示');
  await tapRadio(page, 'lining', 'yes');
  assert(await page.isVisible('#liningColorField'), '裏地色を表示');
  assert((await svg()).includes('裏地：あり（色は要確認）'), 'lining yes no color');
  assert((await pend()).includes('裏地の色：未定'), 'pending lining color');
  await tapRadio(page, 'liningColor', 'navy');
  assert((await svg()).includes('裏地：あり（ネイビー）'), 'lining navy');
  await tapRadio(page, 'pocket', 'undecided');
  assert((await svg()).includes('内ポケット：未定（要確認）'), 'pocket undecided');
  await tapRadio(page, 'pocket', 'yes');
  assert((await svg()).includes('片面中央に1個'), 'pocket yes');
  assert(await page.isVisible('#pocketCondition'), 'ポケット条件の表示');
  const ch = await changesText(page);
  assert(ch.includes('裏地：なし → あり') && ch.includes('裏地の色：—（裏地なし／未定） → ネイビー') && ch.includes('内ポケット：なし → あり'), JSON.stringify(ch));
  await page.screenshot({ path: `${OUT}ipad-lining-pocket.png`, fullPage: false });
  await tapRadio(page, 'lining', 'none');
});

await check('8. PNGに日本語・寸法線・変更点が入り、長いメモも切れない（比較画像・初回画像）', async () => {
  const short = await makePng(page);
  await writeFile(`${OUT}export-compare.png`, Buffer.from(short.b64, 'base64'));
  const longMemo = 'ご希望：肩掛けできる長さの持ち手。'.repeat(25) + '\n改行後の行もあります。\n\n最後の行：ここまで表示されていればOK';
  await page.fill('#f-memo', longMemo);
  const long = await makePng(page);
  await writeFile(`${OUT}export-compare-longmemo.png`, Buffer.from(long.b64, 'base64'));
  assert(long.h > short.h + 100, `長いメモで高さが伸びる ${short.h} → ${long.h}`);
  const single = await makePng(page, 'single');
  await writeFile(`${OUT}export-single.png`, Buffer.from(single.b64, 'base64'));
  assert(single.w === 2000, `幅 ${single.w}`);
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
  assert(json.schema_version === 1 && json.data.baseline && json.data.baseline_version === 1, 'JSONの内容');
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

// ---------- 保存拒否 ----------
await check('11. 保存が拒否された環境でもアプリが停止しない', async () => {
  const p = await newPage(IPAD_L, { denyStorage: true });
  const status = await p.textContent('#saveStatus');
  assert(status.includes('保存できません'), status);
  await loadSample(p);
  await p.fill('#f-height', '31');
  await p.waitForTimeout(500);
  assert((await p.textContent('#saveStatus')).includes('編集と画像作成は続けられます'), '失敗の表示');
  const png = await makePng(p);
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
