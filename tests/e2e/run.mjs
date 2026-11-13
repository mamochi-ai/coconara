// ブラウザでの動作確認（Playwright + Chromium）。
// 実行: npm run test:e2e   （playwright が利用できる環境が必要）
// 画面写真と書き出したPNGは test-output/ に保存する。
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
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

// 購入者用を作ってから確認する（既存機能の確認は購入者用、体験版は /trial/ で確認）
execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/build.mjs', import.meta.url))], { stdio: 'inherit' });
// 公開と同じ配置：docs/ を '/'（体験版）、docs/buyer/ を '/buyer/'（購入者用）。配布ZIPの web/ は '/zip/'
const ZIP_WEB_DIR = fileURLToPath(new URL('../../build/katachi-awase/web/', import.meta.url));
const TRIAL_DIR = fileURLToPath(new URL('../../docs/', import.meta.url));
const SINGLE_FILE = fileURLToPath(new URL('../../build/katachi-awase/single/katachi-awase.html', import.meta.url));
const server = createServer({ '/': TRIAL_DIR, '/zip/': ZIP_WEB_DIR });
await new Promise((r) => server.listen(0, r));
const ORIGIN = `http://localhost:${server.address().port}/`;
const TRIAL_URL = ORIGIN;
const URL_ = `${ORIGIN}buyer/`; // 既存の確認は購入者用で行う
const ZIP_URL = `${ORIGIN}zip/`;
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
  await page.goto(opts.url || URL_);
  // 初回の「使い方」を閉じてから操作する（画面の「閉じる」を押す）
  if (!opts.keepGuide) await closeGuide(page);
  return page;
}
async function closeGuide(page) {
  const g = page.locator('.modal h2', { hasText: '使い方' });
  if (await g.count()) await page.locator('.modal [data-close]').tap();
}
const IPAD_L = { width: 1180, height: 820 };
const IPAD_P = { width: 820, height: 1180 };
const PHONE = { width: 390, height: 844 };

/** 注文一覧の「架空のサンプルを追加」で、サンプルの注文を追加して開く（既存の注文は残る） */
async function loadSample(page) {
  await page.tap('#btnOrders');
  await page.tap('#olSample');
  await page.waitForFunction(() => window.__katachi.state.doc.isSample);
}
/** 注文一覧の「新しい注文を作る」 */
async function newOrderFromList(page) {
  await page.tap('#btnOrders');
  await page.tap('#olNew');
  await page.waitForFunction(() => window.__katachi.state.entry && !window.__katachi.state.doc.isSample && window.__katachi.state.doc.current.orderNo === '');
}
/** 端末に保存された注文一覧 */
const storedLib = (page, key = 'katachi-awase:orders') => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const storedActive = async (page, key) => { const l = await storedLib(page, key); return l.orders.find((o) => o.id === l.active_id).data; };
const changesText = (page) => page.$$eval('.list-block.changes .spec-changes li', (els) => els
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
  const expect = ['袋口幅：40 → 45cm', '底幅：30 → 35cm（袋口幅変更に伴う）', '内ポケット：なし → あり'];
  assert(JSON.stringify(ch) === JSON.stringify(expect), JSON.stringify(ch));
  // 件数＝仕様変更一覧の行数。確認文の変更は件数に含めない
  const tab = (await page.textContent('#tab-compare')).replace(/\s+/g, '');
  assert(tab === '比較仕様変更3件', `タブ ${tab}`);
  const head = await visibleText(page, '.list-block.changes .spec-count');
  assert(head.includes('仕様変更3件'), head);
  const notes = await visibleText(page, '.list-block.changes .text-changes');
  assert(notes.includes('確認文の変更あり'), notes);
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
  const stored = (await storedActive(page)).baseline.dims.height;
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
  assert(empty.includes('変更前からの変更はありません'), empty);
  assert((await page.textContent('#tab-compare')).trim() === '比較', 'タブの変更件数が消える');
});

await check('4. 40 と 40.0 は同じ値として扱う', async () => {
  await setField(page, '#f-mouthWidth', '40.0');
  const empty = await visibleText(page, '.list-block.changes');
  assert(empty.includes('変更前からの変更はありません'), empty);
  await setField(page, '#f-mouthWidth', '４０');
  assert((await visibleText(page, '.list-block.changes')).includes('変更前からの変更はありません'), '全角');
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
  assert((await page.textContent('.modal')).includes('変更前として保存できません'), '比較元の更新も止まる');
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
  // 描画の直後に読むと取りこぼすことがあるため、表示されるまで待つ（最大3秒）
  await page.waitForFunction(() => [...document.querySelectorAll('.list-block.pending')].some((e) => e.offsetParent && e.textContent.includes('マチ：未入力')), null, { timeout: 3000 }).catch(() => {});
  pend = await visibleText(page, '.list-block.pending');
  assert(pend.includes('マチ：未入力'), `${pend} / ${await page.evaluate(() => [document.getElementById('app').dataset.view, document.getElementById('app').hasAttribute('inert'), !!document.querySelector('.modal'), document.getElementById('diagramLists').textContent.slice(0, 80)].join(' | '))}`);
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
  const saved = await storedActive(page);
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
await check('9. この注文を書き出し、新しい注文として追加で復元できる（変更前・版番号を維持）', async () => {
  await setField(page, '#f-orderNo', 'TEST-77');
  const pick = (d) => JSON.stringify({ current: d.current, baseline: d.baseline, version: d.version, baselineVersion: d.baselineVersion });
  const before = await page.evaluate(() => JSON.stringify(window.__katachi.state.doc));
  const n0 = await page.evaluate(() => window.__katachi.state.lib.orders.length);
  await page.tap('#btnData');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.tap('#dExportOne')]);
  assert(/^katachi_order_TEST-77_v2_\d{8}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  backupPath = `${OUT}backup.json`;
  await dl.saveAs(backupPath);
  await page.tap('.modal [data-close]');
  const json = JSON.parse(await readFile(backupPath, 'utf8'));
  assert(json.format === 'katachi-awase/order' && json.schema_version === 3 && json.order.data.baseline && json.order.data.baseline_version === 1, 'JSONの内容');
  // 読み込み：内容の確認が出て、キャンセルすると何も変わらない
  await page.tap('#btnData');
  await page.setInputFiles('#fileInput', backupPath);
  await page.waitForSelector('.modal h2:text("バックアップから追加")');
  let t = await page.textContent('.modal');
  assert(t.includes('1件用のバックアップ') && t.includes('1件') && t.includes('新しい注文として追加') && t.includes('同じ内容の注文が2件'), t);
  await page.tap('.modal-actions .btn:not(.btn-primary)');
  assert((await page.evaluate(() => window.__katachi.state.lib.orders.length)) === n0, 'キャンセルで変化なし');
  // 追加
  await page.tap('#btnData');
  await page.setInputFiles('#fileInput', backupPath);
  await page.waitForSelector('.modal h2:text("バックアップから追加")');
  await page.tap('.modal-actions .btn-primary');
  const after = await page.evaluate(() => JSON.stringify(window.__katachi.state.doc));
  assert(pick(JSON.parse(after)) === pick(JSON.parse(before)), '追加した注文の内容が一致');
  const ids = await page.evaluate(() => window.__katachi.state.lib.orders.map((o) => o.id));
  assert(ids.length === n0 + 1 && new Set(ids).size === ids.length, '新しい内部IDで追加');
  assert((await page.inputValue('#f-orderNo')) === 'TEST-77', '入力欄に反映');
});

await check('10. 壊れたJSONを読み込んでも既存内容が消えない', async () => {
  const before = await page.evaluate(() => JSON.stringify(window.__katachi.state.doc));
  const broken = `${OUT}broken.json`;
  await writeFile(broken, '{"schema_version":1,"data":{"current":');
  await page.setInputFiles('#fileInput', broken);
  await page.waitForSelector('.modal h2:text("読み込めませんでした")');
  const t = await page.textContent('.modal');
  assert(t.includes('今ある注文はそのまま'), t);
  await page.tap('.modal-actions .btn');
  const wrong = `${OUT}wrong-values.json`;
  const j = JSON.parse(await readFile(backupPath, 'utf8'));
  j.order.data.current.dims.height = 'abc';
  await writeFile(wrong, JSON.stringify(j));
  await page.setInputFiles('#fileInput', wrong);
  await page.waitForSelector('.modal h2:text("読み込めませんでした")');
  await page.tap('.modal-actions .btn');
  const after = await page.evaluate(() => JSON.stringify(window.__katachi.state.doc));
  assert(after === before, '内容が保持されている');
  const stored = (await storedActive(page)).current.orderNo;
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
  await page.waitForSelector('.modal h2:text("バックアップから追加")');
  assert((await page.textContent('.modal')).includes('以前のバージョンのバックアップ'), '旧形式と表示');
  await page.tap('.modal-actions .btn-primary');
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
  await newOrderFromList(p2);
  for (const [k, v] of [['orderNo', 'NEW-01'], ['height', '28'], ['mouthWidth', '36'], ['gusset', '8'], ['handleHeight', '14']]) await p2.fill(`#f-${k}`, v);
  await tapRadio(p2, 'outerColor', 'navy');
  await tapRadio(p2, 'lining', 'undecided');
  const init = await makePngs(p2, { audience: 'customer' });
  await savePngs('case5-initial-customer', init);
  assert(p2.errors.length === 0, p2.errors.join(' / '));
  await p2.context().close();
});

// ---------- 仕様変更と文章の変更 ----------
await check('V1-5. 仕様変更の件数と一覧・文章の変更・元に戻す', async () => {
  const p = await newPage(IPAD_L);
  await loadSample(p);
  const tabText = async () => (await p.textContent('#tab-compare')).replace(/\s+/g, '');
  const rows = () => changesText(p);
  const notes = () => visibleText(p, '.list-block.changes .text-changes');
  const changesBox = () => visibleText(p, '.list-block.changes');
  assert((await rows()).length === 3 && (await tabText()) === '比較仕様変更3件', 'サンプル3件');
  // 仕様を元に戻すと、確認文の変更だけが残る
  await setField(p, '#f-mouthWidth', '40');
  await tapRadio(p, 'pocket', 'none');
  assert((await rows()).length === 0, '仕様変更0行');
  assert((await changesBox()).includes('仕様変更なし') && (await notes()).includes('確認文の変更あり'), await changesBox());
  assert((await tabText()) === '比較文章の変更', await tabText());
  // メモだけ変更
  await setField(p, '#f-questions', '');
  await setField(p, '#f-memo', '肩掛けできる長さを希望');
  assert((await changesBox()).includes('仕様変更なし'), 'メモだけ');
  assert((await notes()).includes('注文メモの変更あり') && !(await notes()).includes('確認文'), await notes());
  // メモも戻すと「変更はありません」
  await setField(p, '#f-memo', '架空のサンプルです。普段使い用。A4のクリアファイルが入る大きさを希望。');
  assert((await changesBox()).includes('変更前からの変更はありません'), await changesBox());
  assert((await tabText()) === '比較', await tabText());
  // 裏地の追加＋色指定 → 1行＝1件
  await tapRadio(p, 'lining', 'yes');
  await tapRadio(p, 'liningColor', 'navy');
  const r = await rows();
  assert(JSON.stringify(r) === JSON.stringify(['裏地：なし → あり〈ネイビー〉']), JSON.stringify(r));
  assert((await tabText()) === '比較仕様変更1件', await tabText());
  // 確認画像（お客様用）の見出しも同じ件数
  const img = await p.evaluate(async (src) => {
    const { buildReport } = await import(src);
    const d = window.__katachi.state.doc;
    const r1 = buildReport(d, { audience: 'customer', side: false, interior: false, memo: false });
    const r2 = buildReport(d, { audience: 'maker' });
    return [r1.specCount, r1.changes.map((c) => c.text), r2.specCount];
  }, `${ORIGIN}js/report.js`);
  assert(img[0] === 1 && img[2] === 1 && img[1][0] === '裏地：なし → あり〈ネイビー〉', JSON.stringify(img));
  await p.screenshot({ path: `${OUT}v-lining-count.png` });
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
});

// ---------- 拡大表示・保存 ----------
async function openPreview(p) {
  await p.tap('#btnExport');
  await p.waitForSelector('.preview-img');
}
const blobDigest = (p, i = 0) => p.$eval(`.preview-page[data-page="${i}"] .preview-img`, async (img) => {
  const buf = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
  const h = await crypto.subtle.digest('SHA-256', buf);
  return { size: buf.length, hash: Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join(''), w: img.naturalWidth, h: img.naturalHeight };
});

async function zoomCheck(viewport, label) {
  const p = await newPage(viewport);
  await loadSample(p);
  if (await p.locator('#f-memo').isVisible() === false) await p.tap('#tab-input');
  await p.fill('#f-questions', '内ポケットの大きさは、お任せでよろしいですか？');
  await openPreview(p);
  // 作家用に切り替え（出力設定が保持されるかも確認）
  await p.locator('input[name="paud"][value="maker"]').locator('..').tap();
  await p.waitForSelector('.preview-img');
  const before = await blobDigest(p);
  // プレビューを少しスクロールしてから拡大
  await p.$eval('.modal', (m) => { m.scrollTop = 120; });
  const modalScroll = await p.$eval('.modal', (m) => m.scrollTop);
  const opener = p.locator('.preview-page[data-page="0"] button[data-zoom]');
  await opener.tap();
  await p.waitForSelector('.zoom');
  const vp = p.viewportSize();
  const inView = async (sel) => {
    const b = await p.locator(sel).boundingBox();
    return b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5 && b.height >= 40;
  };
  assert((await p.textContent('#zoomLevel')) === '100%', '最初は画面幅に合わせる');
  const fit = await p.evaluate(() => ({ img: document.getElementById('zoomImg').getBoundingClientRect().width, box: document.getElementById('zoomScroll').clientWidth }));
  assert(fit.img <= fit.box && fit.img > fit.box - 40, `幅に合わせる ${JSON.stringify(fit)}`);
  for (let i = 0; i < 4; i++) await p.tap('[data-z="in"]');
  assert((await p.textContent('#zoomLevel')) === '400%', '拡大');
  assert(await p.locator('[data-z="in"]').isDisabled(), '最大で＋は無効');
  for (const sel of ['[data-z="close"]', '[data-z="in"]', '[data-z="out"]', '[data-z="fit"]']) assert(await inView(sel), `${sel} が画面内`);
  // 四隅まで移動できる
  const corners = await p.evaluate(() => {
    const sc = document.getElementById('zoomScroll');
    const im = document.getElementById('zoomImg');
    const res = [];
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      sc.scrollLeft = x ? sc.scrollWidth : 0;
      sc.scrollTop = y ? sc.scrollHeight : 0;
      const a = im.getBoundingClientRect();
      const b = sc.getBoundingClientRect();
      // その隅が表示領域の内側に入っているか
      const cx = x ? a.right : a.left;
      const cy = y ? a.bottom : a.top;
      res.push(cx >= b.left - 0.5 && cx <= b.right + 0.5 && cy >= b.top - 0.5 && cy <= b.bottom + 0.5);
    }
    return { res, overflow: sc.scrollWidth > sc.clientWidth && sc.scrollHeight > sc.clientHeight };
  });
  assert(corners.overflow && corners.res.every(Boolean), `四隅 ${JSON.stringify(corners)}`);
  await p.screenshot({ path: `${OUT}${label}-zoom-400.png` });
  await p.tap('[data-z="out"]');
  assert((await p.textContent('#zoomLevel')) === '300%', '縮小');
  await p.tap('[data-z="fit"]');
  assert((await p.textContent('#zoomLevel')) === '100%', '表示を戻す');
  await p.screenshot({ path: `${OUT}${label}-zoom-fit.png` });
  // ブラウザ標準のピンチズームを禁止していない
  const meta = await p.getAttribute('meta[name="viewport"]', 'content');
  assert(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\D|$)/.test(meta), meta);
  await p.tap('[data-z="close"]');
  assert(await p.locator('.zoom').count() === 0, '閉じた');
  assert(await p.isVisible('.modal'), 'プレビューに戻る');
  const focusOk = await p.evaluate(() => document.activeElement && document.activeElement.matches('.preview-page[data-page="0"] button[data-zoom]'));
  assert(focusOk, 'フォーカスが起点のボタンへ戻る');
  const modalScroll2 = await p.$eval('.modal', (m) => m.scrollTop);
  assert(Math.abs(modalScroll2 - modalScroll) < 60, `プレビューの位置 ${modalScroll} → ${modalScroll2}`);
  // 画像のタップでも開く。Escape で拡大表示だけ閉じる
  await p.locator('.preview-page[data-page="0"] .preview-img').tap();
  await p.waitForSelector('.zoom');
  await p.keyboard.press('Escape');
  assert(await p.locator('.zoom').count() === 0 && await p.isVisible('.modal'), 'Escapeは拡大表示だけ閉じる');
  // 書き出し画像は変わらない
  const after = await blobDigest(p);
  assert(JSON.stringify(before) === JSON.stringify(after), `画像が変わった ${JSON.stringify([before, after])}`);
  // 共有は非対応なら非表示、保存ボタンは表示
  const shareShown = await p.locator('.preview-page[data-page="0"] [data-share]').isVisible();
  const canShare = await p.evaluate(() => !!navigator.canShare);
  assert(canShare || !shareShown, '共有非対応なら非表示');
  assert(await p.locator('.preview-page[data-page="0"] [data-dl]').isVisible(), '画像を保存');
  const small = await p.$$eval('.modal button:not([hidden])', (els) => els.filter((e) => e.offsetParent).map((e) => ({ t: e.textContent.trim(), h: e.getBoundingClientRect().height, r: e.getBoundingClientRect().right })));
  const tooSmall = small.filter((b) => b.h < 40);
  assert(tooSmall.length === 0, `小さいボタン ${JSON.stringify(tooSmall)}`);
  const outside = small.filter((b) => b.r > vp.width + 1);
  assert(outside.length === 0, `画面外のボタン ${JSON.stringify(outside)}`);
  await p.tap('.modal-actions .btn');
  // 入力内容・出力設定が保持されている
  assert((await p.evaluate(() => window.__katachi.state.doc.output.audience)) === 'maker', '出力設定');
  assert((await p.evaluate(() => window.__katachi.state.doc.current.questions)) === '内ポケットの大きさは、お任せでよろしいですか？', '入力内容');
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
}
await check('V6-8. 拡大表示（iPad横）：四隅・倍率・閉じる・フォーカス・画像不変', () => zoomCheck(IPAD_L, 'ipad-landscape'));
await check('V6-8・12. 拡大表示（iPad縦）', () => zoomCheck(IPAD_P, 'ipad-portrait'));
await check('V6-8・12. 拡大表示（スマートフォン幅）', () => zoomCheck(PHONE, 'phone'));

await check('V9-11. PNGを実際にダウンロードして画像として開ける（共有非対応環境）', async () => {
  const ctx = await browser.newContext({ viewport: IPAD_L, hasTouch: true, acceptDownloads: true });
  await ctx.addInitScript(() => { try { delete Navigator.prototype.canShare; delete Navigator.prototype.share; } catch { /* 無視 */ } navigator.canShare = undefined; navigator.share = undefined; });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(URL_);
  await closeGuide(p);
  await loadSample(p);
  await openPreview(p);
  assert(!(await p.locator('[data-share]').first().isVisible()), '共有ボタンは非表示');
  const digest = await blobDigest(p);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('.preview-page[data-page="0"] [data-dl]').tap()]);
  const name = dl.suggestedFilename();
  assert(name === 'katachi_SAMPLE-001_v2_customer.png', name);
  const path = `${OUT}downloaded-${name}`;
  await dl.saveAs(path);
  const buf = await readFile(path);
  assert(buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNGの署名');
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  assert(w === 2000 && w === digest.w && h === digest.h, `寸法 ${w}×${h}`);
  assert(buf.length === digest.size, 'プレビューと同じ画像');
  // 画像として開ける（ブラウザで読み込んで描画）
  const decoded = await p.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, buf.toString('base64'));
  assert(decoded[0] === w && decoded[1] === h, 'デコード');
  const toastText = await p.textContent('#toast');
  assert(toastText.includes('ダウンロードを開始しました') && !toastText.includes('写真に保存しました'), toastText);
  // 複数枚：各画像を個別に保存でき、ファイル名にページ番号
  await p.tap('.modal-actions .btn');
  await p.fill('#f-questions', ('内ポケットの大きさは、お任せでよろしいですか？\n'.repeat(40)).slice(0, 1000));
  await p.fill('#f-memo', 'ご希望：肩掛けできる長さの持ち手。'.repeat(60).slice(0, 1000));
  await openPreview(p);
  await p.locator('#opt-memo').locator('..').tap();
  await p.waitForSelector('.preview-img');
  const n = await p.locator('.preview-page').count();
  assert(n >= 2, `${n}枚`);
  for (let i = 0; i < n; i++) {
    const [d] = await Promise.all([p.waitForEvent('download'), p.locator(`.preview-page[data-page="${i}"] [data-dl]`).tap()]);
    assert(d.suggestedFilename() === `katachi_SAMPLE-001_v2_customer_p${i + 1}of${n}.png`, d.suggestedFilename());
    await d.saveAs(`${OUT}downloaded-${d.suggestedFilename()}`);
  }
  assert(p.errors.length === 0, p.errors.join(' / '));
  await ctx.close();
});

await check('共有をキャンセルしてもエラー表示にしない', async () => {
  const ctx = await browser.newContext({ viewport: IPAD_L, hasTouch: true });
  await ctx.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = () => Promise.reject(new DOMException('cancel', 'AbortError'));
  });
  const p = await ctx.newPage();
  await p.goto(URL_);
  await closeGuide(p);
  await loadSample(p);
  await openPreview(p);
  const sh = p.locator('.preview-page[data-page="0"] [data-share]');
  assert(await sh.isVisible(), '対応環境では共有を表示');
  await sh.tap();
  await p.waitForTimeout(300);
  const t = await p.$eval('#toast', (e) => e.classList.contains('show') ? e.textContent : '').catch(() => '');
  assert(!t.includes('共有できませんでした'), t);
  await ctx.close();
});

// ---------- 初めて使う人の導線（ユーザビリティ改善の回帰確認） ----------
async function guideCheck(viewport) {
  const p = await newPage(viewport);
  const vp = p.viewportSize();
  const onScreen = async (loc) => { const b = await loc.boundingBox(); return !!b && b.y >= 0 && b.y + b.height <= vp.height && b.x >= 0 && b.x + b.width <= vp.width; };
  // 新しい注文（空の状態）：未入力一覧から入力欄へ移動できる
  await newOrderFromList(p);
  await p.tap('#tab-diagram');
  await p.locator('#pane-diagram [data-goto="height"]').tap();
  await p.waitForTimeout(200);
  assert(await p.evaluate(() => document.activeElement && document.activeElement.id === 'f-height'), '一覧から本体高さの欄へ');
  assert(await onScreen(p.locator('#f-height')), '本体高さの欄が画面内');
  // 入力後、スクロールせずに比較タブを押せる（狭い画面）
  await loadSample(p);
  if (!(await p.locator('#f-handleHeight').isVisible())) await p.tap('#tab-input');
  await p.locator('#f-handleHeight').scrollIntoViewIfNeeded();
  await p.fill('#f-handleHeight', '20');
  assert(await onScreen(p.locator('#tab-compare')), '入力後も比較タブが画面内');
  await p.tap('#tab-compare');
  // 比較タブ：変更一覧が最初の画面に入る
  await p.waitForTimeout(150);
  const lb = await p.locator('#pane-compare .list-block.changes').boundingBox();
  const sy = await p.evaluate(() => [scrollY, document.querySelector('.pane-view:not([hidden])') && document.getElementById('pane-compare').scrollTop]);
  assert(lb && lb.y < vp.height, `変更一覧が最初の画面内 ${JSON.stringify(lb)} ${JSON.stringify(sy)}`);
  assert(await p.locator('#pane-compare [data-act="export"]').isVisible(), '比較から確認画像へ進むボタン');
  // 確認画像のプレビュー：上部の「閉じる」は下までスクロールしても画面内
  await p.locator('#pane-compare [data-act="export"]').tap();
  await p.waitForSelector('.preview-img');
  await p.$eval('.modal', (m) => { m.scrollTop = m.scrollHeight; });
  assert(await onScreen(p.locator('.modal [data-close]')), '閉じるが画面内');
  // 拡大表示中は背景の「閉じる」等を操作対象から外す（閉じるボタンは1つだけ）
  await p.locator('.preview-page[data-page="0"] button[data-zoom]').tap();
  await p.waitForSelector('.zoom');
  assert((await p.getByRole('button', { name: '閉じる', exact: true }).count()) === 1, '閉じるが1つ');
  await p.locator('.zoom [data-z="close"]').tap();
  assert((await p.getByRole('button', { name: '閉じる', exact: true }).count()) >= 1 && await p.isVisible('.modal'), 'プレビューに戻る');
  await p.tap('.modal [data-close]');
  // 不正な値：ダイアログから入力欄へ移動。他の入力は残る
  if (!(await p.locator('#f-gusset').isVisible())) await p.tap('#tab-input');
  await p.fill('#f-mouthWidth', '40');
  await p.fill('#f-gusset', '40');
  await p.locator('#f-gusset').blur();
  await p.tap('#btnExport');
  const t = await p.textContent('.modal');
  assert(!t.includes('マチ：マチは'), `重複した表記 ${t}`);
  await p.getByRole('button', { name: 'マチの欄へ移動' }).tap();
  await p.waitForTimeout(200);
  assert(await p.evaluate(() => document.activeElement && document.activeElement.id === 'f-gusset'), 'マチの欄へ移動');
  assert((await p.inputValue('#f-handleHeight')) === '20', '他の入力は残る');
  await p.fill('#f-gusset', '10');
  // 変更前の更新：置き換わることを操作前に示す。承認とは書かない
  await p.tap('#btnBaseline');
  const u = await p.textContent('.modal');
  assert(u.includes('版1との比較は表示できなくなります') && u.includes('自動で保存') && u.includes('承認を記録するものではありません'), u);
  await p.tap('.modal-actions .btn:not(.btn-primary):not(.btn-danger)');
  assert((await p.textContent('#btnBaseline')).trim() === '変更前を更新', 'ボタン名');
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
}
await check('U. 初めて使う人の導線（iPad縦 768×1024）', () => guideCheck({ width: 768, height: 1024 }));
await check('U. 初めて使う人の導線（iPad横 1024×768）', () => guideCheck({ width: 1024, height: 768 }));
await check('U. 初めて使う人の導線（スマートフォン 390×844）', () => guideCheck({ width: 390, height: 844 }));

// ---------- 体験版と購入者用 ----------
/** 確認画像の上端・下端の色（体験版は濃い帯、購入者用は紙の色） */
const edgeColors = (p) => p.$eval('.preview-page[data-page="0"] .preview-img', async (img) => {
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const px = (yy) => Array.from(x.getImageData(20, yy, 1, 1).data.slice(0, 3));
  return { top: px(20), bottom: px(img.naturalHeight - 20), w: img.naturalWidth, h: img.naturalHeight };
});
const isDark = (rgb) => rgb.every((v) => v < 90);

await check('P1. 体験版：初回の使い方・サンプル・体験版の表示・購入リンクなし', async () => {
  const p = await newPage(IPAD_P, { url: TRIAL_URL, keepGuide: true });
  const g = await p.textContent('.modal');
  assert(g.includes('バッグの寸法と仕様を入力') && g.includes('変更前として保存') && g.includes('自動で保存') && g.includes('体験版'), g);
  await p.screenshot({ path: `${OUT}trial-guide.png` });
  await p.locator('.modal-actions .btn-primary').tap(); // 「サンプルで試してみる」
  assert(await p.locator('.modal').count() === 0, '案内を閉じられる');
  assert(await p.isVisible('#trialBanner') && await p.isVisible('#editionBadge'), '体験版の表示');
  assert(await p.isVisible('#sampleBanner'), 'サンプルを表示');
  assert(await p.isHidden('#purchaseLink'), '購入先が未設定なら購入リンクを出さない');
  assert(!(await p.content()).includes('.zip'), 'ZIPへのリンクなし');
  assert((await p.textContent('#tab-compare')).includes('仕様変更3件'), 'サンプルの比較');
  // 案内を閉じても操作できる
  await p.tap('#tab-input');
  await p.fill('#f-height', '35');
  await p.tap('#tab-compare');
  assert((await p.textContent('#tab-compare')).includes('仕様変更4件'), '操作を続けられる');
  // 「使い方」で再表示
  await p.tap('#btnHelp');
  assert((await p.textContent('.modal h2')) === '使い方', '再表示');
  await p.tap('.modal [data-close]');
  // 再読み込みでは案内を出さない
  await p.reload();
  assert(await p.locator('.modal').count() === 0, '2回目は案内なし');
  // 体験版の画像：上下に体験版の帯
  await p.tap('#btnExport');
  await p.waitForSelector('.preview-img');
  assert((await p.textContent('.modal')).includes('体験版・サンプル'), 'プレビューの案内');
  const e = await edgeColors(p);
  assert(isDark(e.top) && isDark(e.bottom), `体験版の帯 ${JSON.stringify(e)}`);
  const png = await p.$eval('.preview-page[data-page="0"] .preview-img', async (img) => {
    const b = new Uint8Array(await (await fetch(img.src)).arrayBuffer()); let s = ''; for (const c of b) s += String.fromCharCode(c); return btoa(s);
  });
  await writeFile(`${OUT}trial-customer.png`, Buffer.from(png, 'base64'));
  await p.tap('.modal [data-close]');
  // 保存場所は体験版用
  const keys = await p.evaluate(() => Object.keys(localStorage));
  assert(keys.includes('katachi-awase:trial:orders') && !keys.includes('katachi-awase:orders'), JSON.stringify(keys));
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
});

await check('P2. 同じドメインでも体験版と購入者用のデータが混ざらない', async () => {
  const ctx = await browser.newContext({ viewport: IPAD_L, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  // 購入者用で実際の注文を入力
  await p.goto(URL_);
  await closeGuide(p);
  assert(await p.isHidden('#trialBanner') && await p.isHidden('#editionBadge'), '購入者用に体験版表示なし');
  assert(await p.isHidden('#sampleBanner'), '購入者用は空の状態から');
  assert(await p.isVisible('#emptyOrder'), '注文がないときの案内');
  await p.tap('#emptyNew');
  await p.fill('#f-orderNo', 'REAL-100');
  await p.fill('#f-height', '28');
  await p.waitForTimeout(500);
  // 体験版を開く：購入者用の内容は出ない
  await p.goto(TRIAL_URL);
  await closeGuide(p);
  if (!(await p.locator('#f-orderNo').isVisible())) await p.tap('#tab-input');
  assert((await p.inputValue('#f-orderNo')) === 'SAMPLE-001', '体験版はサンプル');
  await p.fill('#f-height', '33');
  await p.waitForTimeout(500);
  // 購入者用に戻る：体験版の編集は入らない
  await p.goto(URL_);
  assert((await p.inputValue('#f-orderNo')) === 'REAL-100' && (await p.inputValue('#f-height')) === '28', '購入者用の内容が保たれる');
  // 購入者用の画像には体験版の帯がない
  await p.fill('#f-mouthWidth', '40'); await p.fill('#f-gusset', '10'); await p.fill('#f-handleHeight', '15');
  await p.tap('#btnExport');
  await p.waitForSelector('.preview-img');
  assert(!(await p.textContent('.modal')).includes('体験版'), 'プレビューに体験版の案内なし');
  const e = await edgeColors(p);
  assert(!isDark(e.top) && !isDark(e.bottom), `購入者用に帯なし ${JSON.stringify(e)}`);
  await p.tap('.modal [data-close]');
  const keys = await p.evaluate(() => Object.keys(localStorage).sort());
  assert(JSON.stringify(keys.filter((k) => k.endsWith(':orders'))) === JSON.stringify(['katachi-awase:orders', 'katachi-awase:trial:orders']), JSON.stringify(keys));
  assert(p.errors.length === 0, p.errors.join(' / '));
  await ctx.close();
});

await check('P3. 購入者用：初回は注文なし→使い方から新しい注文・サンプル。サンプルを試しても既存の注文を消さない', async () => {
  const p = await newPage(PHONE, { keepGuide: true });
  const acts = await p.$$eval('.modal-actions button', (els) => els.map((e) => e.textContent.trim()));
  assert(acts.includes('架空のサンプルで試す') && acts.includes('新しい注文を作る'), JSON.stringify(acts));
  const gt = await p.textContent('.modal');
  assert(gt.includes('この端末のブラウザの中に保存') && gt.includes('全注文をまとめて書き出す') && gt.includes('注文一覧'), '保存・バックアップ・注文一覧の案内');
  await p.getByRole('button', { name: '新しい注文を作る', exact: true }).tap();
  await p.fill('#f-orderNo', 'REAL-200');
  await p.fill('#f-height', '27');
  // 「架空のサンプルで試す」は新しい注文として追加される
  await p.tap('#btnHelp');
  await p.getByRole('button', { name: '架空のサンプルで試す', exact: true }).tap();
  await p.waitForSelector('#sampleBanner:not([hidden])');
  const lib = await storedLib(p);
  assert(lib.orders.length === 2 && lib.orders.some((o) => o.data.current.orderNo === 'REAL-200' && o.data.current.dims.height === '27'), '既存の注文は残る');
  // サンプル表示中の「新しい注文を作る」もサンプルを消さない
  await p.getByRole('button', { name: '新しい注文を作る', exact: true }).tap();
  assert((await storedLib(p)).orders.length === 3, '3件');
  // 書き出し：1件用と全件用はファイル名で区別
  await p.tap('#btnData');
  const [d1] = await Promise.all([p.waitForEvent('download'), p.tap('#dExportAll')]);
  assert(/^katachi_all-orders_3_\d{8}\.json$/.test(d1.suggestedFilename()), d1.suggestedFilename());
  const all = JSON.parse(await readFile(await d1.path(), 'utf8'));
  assert(all.format === 'katachi-awase/orders' && all.schema_version === 3 && all.edition === 'full' && all.orders.length === 3, '全件用の中身');
  const [d2] = await Promise.all([p.waitForEvent('download'), p.tap('#dExportOne')]);
  assert(/^katachi_order_no-number_v1_\d{8}\.json$/.test(d2.suggestedFilename()), d2.suggestedFilename());
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
});

await check('P4. 旧形式のバックアップを購入者用・体験版の両方で読み込める', async () => {
  const fixture = fileURLToPath(new URL('../fixtures/backup-v1.json', import.meta.url));
  for (const url of [URL_, TRIAL_URL]) {
    const p = await newPage(IPAD_L, { url });
    await p.tap('#btnData');
    await p.setInputFiles('#fileInput', fixture);
    await p.waitForSelector('.modal h2:text("バックアップから追加")');
    await p.locator('.modal-actions .btn-primary').tap();
    assert((await p.inputValue('#f-mouthWidth')) === '45', url);
    assert((await p.textContent('#orderMeta')).includes('変更前：版1'), 'meta');
    await p.context().close();
  }
});

await check('P5. 1ファイル版を直接開いて動く（パソコン用ブラウザ Chromium、file://）', async () => {
  const ctx = await browser.newContext({ viewport: IPAD_L, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`file://${SINGLE_FILE}`);
  await closeGuide(p);
  assert(await p.isHidden('#trialBanner'), '購入者用');
  await loadSample(p);
  assert((await p.textContent('#tab-compare')).includes('仕様変更3件'), '比較');
  await p.tap('#btnExport');
  await p.waitForSelector('.preview-img');
  const e = await edgeColors(p);
  assert(e.w === 2000 && !isDark(e.top), JSON.stringify(e));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('.preview-page[data-page="0"] [data-dl]').tap()]);
  assert(dl.suggestedFilename().endsWith('.png'), dl.suggestedFilename());
  assert(errs.length === 0, errs.join(' / '));
  await ctx.close();
});

await check('P7. 配布ZIPの web 版（index.html）も購入者用として動く', async () => {
  const p = await newPage(IPAD_L, { url: ZIP_URL });
  assert(await p.isHidden('#trialBanner'), '購入者用');
  await loadSample(p);
  await p.tap('#btnExport');
  await p.waitForSelector('.preview-img');
  assert(!isDark((await edgeColors(p)).top), '帯なし');
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
});

await check('P8. 購入者用から使い方を開ける（/buyer/ → /manual.html）', async () => {
  const p = await newPage(IPAD_P, { keepGuide: true });
  const href = await p.$eval('.modal a[href*="manual"]', (a) => a.href);
  assert(href === `${ORIGIN}manual.html`, href);
  const [m] = await Promise.all([p.context().waitForEvent('page'), p.locator('.modal a[href*="manual"]').tap()]);
  await m.waitForLoadState();
  assert((await m.title()) === 'かたち合わせ 使い方', await m.title());
  await p.context().close();
});

await check('P9・M1. 以前の1件の保存データを移行（変更前・版番号つき）。再読み込みで増えず、サンプルを試しても消えない', async () => {
  const ctx = await browser.newContext({ viewport: IPAD_P, hasTouch: true, isMobile: true });
  const fixture = await readFile(fileURLToPath(new URL('../fixtures/backup-v1.json', import.meta.url)), 'utf8');
  const raw = JSON.parse(fixture);
  raw.data.current.orderNo = 'KEEP-ME';
  raw.data.current.memo = 'メモ<b>太字ではなく文字</b>';
  raw.data.is_sample = false; // 実際の注文として保存されている状態
  // 以前の版で、購入者用の保存場所に1件だけ保存されていた状態（案内はまだ見ていない）
  await ctx.addInitScript((t) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('katachi-awase:doc', t); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(raw));
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(URL_);
  assert((await p.textContent('.modal h2')) === '使い方', '案内は出る');
  await p.locator('.modal [data-close]').tap();
  if (!(await p.locator('#f-orderNo').isVisible())) await p.tap('#tab-input');
  assert((await p.inputValue('#f-orderNo')) === 'KEEP-ME', '移行した注文が開く');
  assert((await p.inputValue('#f-memo')) === 'メモ<b>太字ではなく文字</b>', 'メモは文字のまま');
  assert((await p.textContent('#orderMeta')).includes('変更前：版1') && (await p.textContent('#orderMeta')).includes('版2'), '変更前と版番号');
  assert(await p.isHidden('#sampleBanner'), 'サンプルにしない');
  let lib = await storedLib(p);
  assert(lib.orders.length === 1, '1件として移行');
  assert((await p.evaluate(() => localStorage.getItem('katachi-awase:doc'))) !== null, '旧データは消さない');
  // サンプルを試しても既存の注文は消えない
  await loadSample(p);
  await p.reload();
  lib = await storedLib(p);
  assert(lib.orders.length === 2 && lib.orders.filter((o) => o.data.current.orderNo === 'KEEP-ME').length === 1, `再読み込みで増えない ${lib.orders.length}`);
  assert(await p.locator('.modal').count() === 0, '2回目は案内なし');
  // 注文一覧に移行した注文がある
  await p.tap('#btnOrders');
  const items = await p.$$eval('.ol-item .ol-no', (els) => els.map((e) => e.textContent));
  assert(items.includes('KEEP-ME') && items.includes('SAMPLE-001'), JSON.stringify(items));
  assert(p.errors.length === 0, p.errors.join(' / '));
  await ctx.close();
});

await check('P6. 使い方ページ（iPad縦・スマートフォン幅で横スクロールなし）', async () => {
  for (const vp of [IPAD_P, PHONE]) {
    const p = await newPage(vp, { url: `${TRIAL_URL}manual.html`, keepGuide: true });
    const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, h2: [...document.querySelectorAll('h2')].map((h) => h.textContent) }));
    assert(r.sw <= r.w + 1, `横スクロール ${r.sw}>${r.w}`);
    for (const h of ['できること', '対応するバッグの形', '寸法を測る位置', '画像を保存する', '注文一覧（切り替え・複製・削除）', 'バックアップと追加', '保存できないとき', 'データの保存場所について']) assert(r.h2.includes(h), h);
    const body = await p.textContent('body');
    assert(!body.includes('扱える注文は1件'), '古い説明が残っていない');
    await p.screenshot({ path: `${OUT}manual-${vp.width}.png`, fullPage: false });
    await p.context().close();
  }
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
  await loadSample(p);
  await p.tap('#tab-diagram');
  const a = await p.locator('#pane-input').boundingBox();
  const b = await p.locator('#pane-diagram').boundingBox();
  assert(a && b && a.x < b.x && Math.abs(a.y - b.y) < 80, `位置 ${JSON.stringify([a, b])}`);
  await p.screenshot({ path: `${OUT}ipad-landscape-empty.png` });
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
});

// ---------- 複数の注文 ----------
async function listItems(p) {
  return p.$$eval('.ol-item', (els) => els.map((e) => ({
    no: e.querySelector('.ol-no').textContent, cur: e.classList.contains('is-current'), sum: e.querySelector('.ol-sum').textContent, time: e.querySelector('.ol-time').textContent,
  })));
}
async function openFromList(p, label, nth = 0) {
  await p.tap('#btnOrders');
  const btns = p.locator('.ol-open', { has: p.locator('.ol-no', { hasText: new RegExp(`^${label}$`) }) });
  await btns.nth(nth).tap();
  await p.waitForSelector('.modal', { state: 'detached' }).catch(() => {});
}
async function fillOrder(p, vals) {
  if (!(await p.locator('#f-orderNo').isVisible())) await p.tap('#tab-input');
  for (const [k, v] of Object.entries(vals)) await p.fill(`#f-${k}`, v);
}

await check('M3・M4・M5. 注文の切り替えで内容が混ざらない／入力直後に切り替えても残る／同じ注文番号でも別', async () => {
  const p = await newPage(IPAD_P);
  await newOrderFromList(p);
  await fillOrder(p, { orderNo: 'A-1', height: '30', mouthWidth: '40', gusset: '10', handleHeight: '15', memo: 'Aのメモ' });
  await tapRadio(p, 'outerColor', 'navy');
  await p.tap('#btnBaseline'); await p.tap('.modal-actions .btn-primary');
  await fillOrder(p, { mouthWidth: '45' });
  await newOrderFromList(p);
  await fillOrder(p, { orderNo: 'A-1', height: '22', mouthWidth: '30', gusset: '6', handleHeight: '12', memo: 'Bのメモ' });
  // 入力直後（自動保存の待ち時間内）に切り替える
  await p.fill('#f-handleHeight', '13');
  await openFromList(p, 'A-1', 1); // 古い方（A）
  if (!(await p.locator('#f-orderNo').isVisible())) await p.tap('#tab-input');
  assert((await p.inputValue('#f-mouthWidth')) === '45' && (await p.inputValue('#f-memo')) === 'Aのメモ', 'Aの内容');
  assert((await p.textContent('#orderMeta')).includes('版2'), 'Aは版2');
  await p.tap('#tab-compare');
  assert((await p.textContent('#tab-compare')).includes('仕様変更2件'), 'Aの比較');
  await openFromList(p, 'A-1', 0); // 新しい方（B）
  if (!(await p.locator('#f-orderNo').isVisible())) await p.tap('#tab-input');
  assert((await p.inputValue('#f-handleHeight')) === '13', '入力直後に切り替えても最後の入力が残る');
  assert((await p.inputValue('#f-memo')) === 'Bのメモ' && (await p.textContent('#orderMeta')).includes('版1'), 'Bの内容');
  assert((await p.textContent('#tab-compare')).trim() === '比較', 'Bに比較はない');
  const lib = await storedLib(p);
  const both = lib.orders.filter((o) => o.data.current.orderNo === 'A-1');
  assert(both.length === 2 && both[0].id !== both[1].id, '同じ注文番号でも別の注文');
  // 切り替えだけでは更新日時が変わらない
  const t0 = JSON.stringify(lib.orders.map((o) => [o.id, o.updated_at]));
  await openFromList(p, 'A-1', 1);
  await openFromList(p, 'A-1', 0);
  const t1 = JSON.stringify((await storedLib(p)).orders.map((o) => [o.id, o.updated_at]));
  assert(t0 === t1, '更新日時が変わらない');
  // 再読み込みで、最後に開いていた注文が開く
  await p.reload();
  if (!(await p.locator('#f-orderNo').isVisible())) await p.tap('#tab-input');
  assert((await p.inputValue('#f-memo')) === 'Bのメモ', '最後に開いた注文');
  await p.screenshot({ path: `${OUT}multi-switch.png` });
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
});

await check('M6. 複製：寸法と仕様だけを引き継ぎ、版1・変更前なし。元の注文は変わらない', async () => {
  const p = await newPage(IPAD_L);
  await loadSample(p);
  await tapRadio(p, 'lining', 'yes');
  await tapRadio(p, 'liningColor', 'navy');
  const before = await p.evaluate(() => JSON.stringify(window.__katachi.state.entry));
  await p.tap('#btnOrders');
  const t = await p.textContent('.modal');
  assert(t.includes('寸法と仕様をコピーします。注文番号・メモ・比較履歴は引き継ぎません'), '複製の説明');
  await p.locator('.ol-item.is-current [data-more]').tap();
  await p.locator('.ol-item.is-current [data-dup]').tap();
  await p.waitForFunction(() => !window.__katachi.state.doc.isSample);
  const d = await p.evaluate(() => window.__katachi.state.doc);
  assert(d.current.orderNo === '' && d.current.memo === '' && d.current.questions === '', '注文番号・メモ・確認文は空');
  assert(d.current.dims.mouthWidth === '45' && d.current.lining === 'yes' && d.current.liningColor === 'navy' && d.current.pocket === 'yes' && d.current.outerColor === 'kinari', '仕様を引き継ぐ');
  assert(d.baseline === null && d.version === 1, '版1・変更前なし');
  assert((await p.textContent('#orderMeta')).includes('初回確認'), '画面も版1');
  const lib = await storedLib(p);
  const orig = lib.orders.find((o) => o.id === JSON.parse(before).id);
  assert(JSON.stringify(orig.data.current) === JSON.stringify(JSON.parse(before).doc.current) && orig.data.version === 2, '元の注文は変わらない');
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
});

await check('M7. 削除：番号を表示して確認、キャンセル、元に戻す、編集中の削除は一覧へ、最後の1件の後は空の案内', async () => {
  const p = await newPage(PHONE);
  await newOrderFromList(p);
  await fillOrder(p, { orderNo: 'DEL-1', height: '30' });
  await newOrderFromList(p);
  await fillOrder(p, { orderNo: 'DEL-2', height: '31' });
  await p.tap('#btnOrders');
  // キャンセル
  await p.locator('.ol-item', { hasText: 'DEL-1' }).locator('[data-more]').tap();
  await p.locator('.ol-item', { hasText: 'DEL-1' }).locator('[data-del]').tap();
  let t = await p.textContent('.modal');
  assert(t.includes('DEL-1') && t.includes('元に戻す'), t);
  await p.tap('.modal-actions .btn:not(.btn-danger)');
  assert((await p.textContent('.modal h2')) === '注文一覧', 'キャンセル後は一覧');
  assert((await storedLib(p)).orders.length === 2, 'キャンセルで残る');
  // 削除→元に戻す
  await p.locator('.ol-item', { hasText: 'DEL-1' }).locator('[data-more]').tap();
  await p.locator('.ol-item', { hasText: 'DEL-1' }).locator('[data-del]').tap();
  await p.tap('.modal-actions .btn-danger');
  assert((await storedLib(p)).orders.length === 1, '削除');
  assert((await p.textContent('#olUndo')).includes('DEL-1'), '一覧に元に戻す');
  await p.locator('#olUndo [data-undo]').tap();
  const l2 = await storedLib(p);
  assert(l2.orders.length === 2 && l2.orders.some((o) => o.data.current.orderNo === 'DEL-1' && o.data.current.dims.height === '30'), '元に戻す');
  // 編集中（DEL-2）を削除 → 一覧へ
  await p.locator('.ol-item.is-current [data-more]').tap();
  await p.locator('.ol-item.is-current [data-del]').tap();
  await p.tap('.modal-actions .btn-danger');
  assert((await p.textContent('.modal h2')) === '注文一覧', '一覧へ戻る');
  assert(await p.isVisible('#undoBar'), '画面下にも元に戻す');
  // 最後の1件（DEL-1）も削除 → 空の案内から新規作成
  await p.locator('.ol-item', { hasText: 'DEL-1' }).locator('[data-more]').tap();
  await p.locator('.ol-item', { hasText: 'DEL-1' }).locator('[data-del]').tap();
  await p.tap('.modal-actions .btn-danger');
  assert((await p.textContent('.ol-empty')).includes('まだ注文がありません'), '空の案内');
  await p.screenshot({ path: `${OUT}multi-empty-list.png` });
  await p.locator('.ol-empty [data-empty-new]').tap();
  assert((await storedLib(p)).orders.length === 1 && await p.isVisible('#f-orderNo'), '新規作成できる');
  // 再読み込みすると「元に戻す」は消える（取り消せない状態でボタンを残さない）
  await p.reload();
  await closeGuide(p);
  assert(await p.isHidden('#undoBar'), '再読み込み後は元に戻すなし');
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
});

await check('M8・M9. 全件バックアップの追加、キャンセル、保存失敗で既存の注文が失われない。全件復元後の比較画像', async () => {
  const p = await newPage(IPAD_L);
  await loadSample(p);
  await newOrderFromList(p);
  await fillOrder(p, { orderNo: 'ALL-2', height: '25', mouthWidth: '35', gusset: '8', handleHeight: '12' });
  await p.tap('#btnOrders');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.tap('#olBackupAll')]);
  const allPath = `${OUT}all-orders.json`;
  await dl.saveAs(allPath);
  await p.tap('.modal [data-close]');
  // 別の環境：既存の注文がある状態で全件を追加
  const q = await newPage(IPAD_L);
  await newOrderFromList(q);
  await fillOrder(q, { orderNo: 'EXIST-1', height: '20' });
  await q.tap('#btnData');
  await q.setInputFiles('#fileInput', allPath);
  await q.waitForSelector('.modal h2:text("バックアップから追加")');
  const t = await q.textContent('.modal');
  assert(t.includes('全注文のバックアップ') && t.includes('2件'), t);
  await q.tap('.modal-actions .btn:not(.btn-primary)');
  assert((await storedLib(q)).orders.length === 1, 'キャンセルで変化なし');
  // 保存失敗（容量不足を再現）→ 何も追加しない
  await q.evaluate(() => {
    window.__origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
  });
  await q.tap('#btnData');
  await q.setInputFiles('#fileInput', allPath);
  await q.waitForSelector('.modal h2:text("バックアップから追加")');
  await q.tap('.modal-actions .btn-primary');
  await q.waitForSelector('.modal h2:text("追加できませんでした")');
  assert((await q.textContent('.modal')).includes('何も追加していません'), '保存失敗の表示');
  await q.tap('.modal [data-close]');
  assert((await q.evaluate(() => window.__katachi.state.lib.orders.length)) === 1, '画面上も追加しない');
  await q.evaluate(() => { Storage.prototype.setItem = window.__origSet; });
  // 追加
  await q.tap('#btnData');
  await q.setInputFiles('#fileInput', allPath);
  await q.waitForSelector('.modal h2:text("バックアップから追加")');
  await q.tap('.modal-actions .btn-primary');
  await q.waitForSelector('.modal h2:text("注文一覧")');
  const items = await listItems(q);
  assert(items.length === 3 && items.some((i) => i.no === 'EXIST-1') && items.some((i) => i.no === 'SAMPLE-001') && items.some((i) => i.no === 'ALL-2'), JSON.stringify(items));
  // 全件復元後のサンプル注文の比較・画像
  await q.locator('.ol-open', { hasText: 'SAMPLE-001' }).tap();
  await q.tap('#tab-compare');
  assert((await q.textContent('#tab-compare')).includes('仕様変更3件'), '復元後の比較');
  const cu = await makePngs(q, { audience: 'customer' });
  await savePngs('restored-sample-customer', cu);
  assert(cu.imgs.length === 1 && cu.imgs[0].w === 2000, '画像');
  // 保存失敗中に注文を切り替えると、成功したように見せず案内する
  await q.evaluate(() => {
    Storage.prototype.setItem = function () { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
  });
  await fillOrder(q, { height: '31' });
  await q.tap('#btnOrders');
  await q.locator('.ol-open', { hasText: 'EXIST-1' }).tap();
  await q.waitForSelector('.modal h2:text("端末に保存できていません")');
  assert((await q.textContent('.modal')).includes('全注文をまとめて書き出す'), '回復方法の案内');
  await q.tap('.modal-actions .btn:not(.btn-primary)');
  assert((await q.inputValue('#f-height')) === '31', '入力中の内容を保つ');
  assert((await q.textContent('#saveStatus')).includes('保存できません'), '失敗の表示');
  await q.evaluate(() => { Storage.prototype.setItem = window.__origSet; });
  assert(p.errors.length === 0 && q.errors.length === 0, [...p.errors, ...q.errors].join(' / '));
  await p.context().close();
  await q.context().close();
});

await check('M11. 体験版でも注文一覧・切り替え・複製を試せる。購入者用とは混ざらない。再訪でサンプルを増やさない', async () => {
  const p = await newPage(IPAD_P, { url: TRIAL_URL });
  await p.tap('#btnOrders');
  assert((await listItems(p)).length === 1, '体験版の初回はサンプル1件');
  await p.locator('.ol-item.is-current [data-more]').tap();
  await p.locator('.ol-item.is-current [data-dup]').tap();
  await p.waitForFunction(() => !window.__katachi.state.doc.isSample);
  await p.reload();
  await p.tap('#btnOrders');
  assert((await listItems(p)).length === 2, '再訪でサンプルが増えない');
  await p.tap('.modal [data-close]');
  await p.goto(URL_);
  await closeGuide(p);
  assert(await p.evaluate(() => window.__katachi.state.lib.orders.length) === 0, '購入者用には体験版の注文がない');
  assert(p.errors.length === 0, p.errors.join(' / '));
  await p.context().close();
});

await check('M13. 注文一覧：iPad縦横・スマートフォンで横スクロールなし、操作は44px以上、閉じるが見える', async () => {
  for (const vp of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, PHONE]) {
    const p = await newPage(vp);
    await loadSample(p);
    await newOrderFromList(p);
    await fillOrder(p, { orderNo: 'とても長い注文番号ABCDEFGHIJKLMNOP-1234567890', height: '30' });
    await p.tap('#btnOrders');
    await p.locator('.ol-item.is-current [data-more]').tap();
    const r = await p.evaluate(() => {
      const m = document.querySelector('.modal');
      const btns = [...m.querySelectorAll('button, input')].filter((e) => e.offsetParent && !e.closest('[hidden]'));
      return {
        hs: document.documentElement.scrollWidth > innerWidth || m.scrollWidth > m.clientWidth + 1,
        small: btns.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim().slice(0, 10) || e.id),
        out: btns.filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.textContent.trim().slice(0, 10)),
        close: (() => { const b = m.querySelector('[data-close]').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })(),
      };
    });
    assert(!r.hs && r.small.length === 0 && r.out.length === 0 && r.close, `${vp.width}: ${JSON.stringify(r)}`);
    await p.screenshot({ path: `${OUT}order-list-${vp.width}x${vp.height}.png` });
    assert(p.errors.length === 0, p.errors.join(' / '));
    await p.context().close();
  }
});

assert(page.errors.length === 0, page.errors.join(' / '));
await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
