// ブラウザでの操作確認（Playwright + Chromium）。ビルド済みの ../docs/hang を配信して確かめる。
//   npm run build && npm run e2e
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('../../docs/hang/', import.meta.url));
const OUT = fileURLToPath(new URL('../e2e-output/', import.meta.url));
await mkdir(OUT, { recursive: true });

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = normalize(join(ROOT, p));
  if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream' }).end(await readFile(f)); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, r));
const URL_ = `http://localhost:${server.address().port}/`;

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`ok   ${name}`); } catch (e) { results.push(false); console.log(`FAIL ${name}\n     ${e.message.split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const browser = await chromium.launch();

// 商品数と、最初に中央に来る服（真ん中）
const N = 9;
const MID = Math.floor(N / 2);
const IPAD_L = { width: 1180, height: 820 };
const IPAD_P = { width: 820, height: 1180 };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function open(vp, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: vp.width < 900, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  if (opts.denyStorage) await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); });
  if (opts.seenHint !== false) await ctx.addInitScript(() => { try { localStorage.setItem('hang:hint-seen', 'true'); } catch { /* 無視 */ } });
  if (opts.breakImage) await ctx.route(`**/garments/${opts.breakImage}`, (r) => r.abort());
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(URL_);
  await p.waitForSelector('.item', { state: 'attached' });
  await settle(p);
  return p;
}
/** 動きが止まるまで待つ（全ての服の transform が変わらなくなるまで） */
async function settle(p, max = 4000) {
  let prev = '';
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const cur = await p.$$eval('.item', (els) => els.map((e) => e.style.transform + e.style.opacity).join('|'));
    if (cur === prev) return;
    prev = cur;
    await p.waitForTimeout(120);
  }
  throw new Error('動きが止まらない');
}
const counter = (p) => p.textContent('.counter-num');
const rects = (p) => p.$$eval('.item .g-hit', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y), w: Math.round(r.width) }; }));
const detailOpen = (p) => p.$eval('.detail', (d) => d.classList.contains('is-open'));
async function drag(p, dx, { steps = 12, dy = 0, startX, startY } = {}) {
  const st = await p.locator('.stage').boundingBox();
  const x = startX ?? st.x + st.width / 2;
  const y = startY ?? st.y + st.height * 0.55;
  await p.mouse.move(x, y);
  await p.mouse.down();
  for (let i = 1; i <= steps; i++) { await p.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps); await p.waitForTimeout(10); }
  await p.mouse.up();
}
async function tapItem(p, id) {
  const b = await p.locator(`.item[data-id="${id}"] .g-hit`).boundingBox();
  await p.mouse.click(b.x + b.width / 2, b.y + b.height * 0.55);
}

await check('1. 初期表示：服がハンガーで1本のレールに並び、フックがレールに掛かる。隣と少し重なる', async () => {
  const p = await open(IPAD_L);
  assert((await p.locator('.item').count()) === N, `${N}着`);
  const rail = await p.locator('.rail').boundingBox();
  const railMid = rail.y + rail.height / 2;
  // コードで描いたフック（写真のハンガーを使う服を除く）は、頂点がレールの上、下端がレールより下
  const hooks = await p.$$eval('.item .hanger-hook', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })));
  assert(hooks.length === N - 1, `コードで描いたフック ${hooks.length}`);
  const center = (await rects(p))[MID];
  const trHook = await p.$eval('.item[data-id="wide-trousers"] .hanger-hook', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  assert(Math.abs(trHook.top - (rail.y - 2)) < 12 && trHook.bottom > railMid, `フックとレール ${JSON.stringify({ trHook, rail })}`);
  // 写真のコート：画像に写っているフックの位置（anchor）がレールに合う
  const coat = await p.$eval('.item[data-id="camel-chester-coat"] .g-img', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, h: r.height }; });
  assert(Math.abs(coat.top + coat.h * 0.0125 - railMid) < 4, `写真のフックとレール ${JSON.stringify({ coat, railMid })}`);
  assert((await p.locator('.item[data-id="camel-chester-coat"] .g-hanger').count()) === 0, '写真のハンガーと二重にしない');
  const r = await rects(p);
  const gap = r[MID + 1].x - r[MID].x;
  const imgW = await p.$eval('.item[data-id="camel-chester-coat"] .g-img', (e) => e.getBoundingClientRect().width);
  assert(gap < imgW, `重なり ${gap} < ${imgW}`);
  assert(center.x > IPAD_L.width * 0.4 && center.x < IPAD_L.width * 0.6, '中央の服');
  const kinds = await p.$$eval('.item', (els) => els.map((e) => e.dataset.id));
  assert(kinds.includes('wide-trousers') && kinds.includes('tailored-jacket') && kinds.includes('cable-knit'), '種類');
  await p.screenshot({ path: `${OUT}ipad-landscape-initial.png` });
  assert(p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();
});

await check('2. 左右ドラッグで移動し、離すと近くの服に収まる。ボタン・端の抵抗', async () => {
  const p = await open(IPAD_L);
  assert((await counter(p)) === `${MID + 1} / ${N}`, await counter(p));
  await drag(p, -300);
  await settle(p);
  const c1 = await counter(p);
  assert(c1 !== `${MID + 1} / ${N}`, `移動 ${c1}`);
  // 収まった位置では、中央の服がちょうど中央
  const st = await p.locator('.stage').boundingBox();
  const r = await rects(p);
  const idx = Number(c1.split(' / ')[0]) - 1;
  assert(Math.abs(r[idx].x - (st.x + st.width / 2)) < 3, `中央に収まる ${r[idx].x}`);
  await p.click('button[aria-label="前の服へ"]');
  await settle(p);
  assert((await counter(p)) === `${idx} / ${N}`, `ボタン ${await counter(p)}`);
  // 端を越えても壊れない（左端で右へ大きく引っ張る）
  for (let i = 0; i < 4; i++) await drag(p, 600);
  await settle(p);
  assert((await counter(p)) === `1 / ${N}`, `端 ${await counter(p)}`);
  assert(await p.locator('button[aria-label="前の服へ"]').isDisabled(), '端で前ボタン無効');
  await p.context().close();
});

await check('3. スワイプは選択にならない（服の上から始めても）。縦の動きではラックが動かない', async () => {
  const p = await open(PHONE);
  const b = await p.locator('.item[data-id="wide-trousers"] .g-hit').boundingBox();
  await drag(p, -140, { startX: b.x + b.width / 2, startY: b.y + b.height / 2 });
  await settle(p);
  assert(!(await detailOpen(p)), 'スワイプで選ばれない');
  const before = await counter(p);
  const b2 = await p.locator('.stage').boundingBox();
  await drag(p, 6, { dy: 160, startX: b2.x + b2.width / 2, startY: b2.y + 200 });
  await settle(p);
  assert((await counter(p)) === before && !(await detailOpen(p)), '縦の動き');
  await p.context().close();
});

await check('3b. 動いている最中のタップは「止める」だけで選ばない', async () => {
  const p = await open(IPAD_L);
  await drag(p, -500, { steps: 4 });
  await p.waitForTimeout(40);
  const st = await p.locator('.stage').boundingBox();
  await p.mouse.click(st.x + st.width / 2, st.y + st.height * 0.5);
  await settle(p);
  assert(!(await detailOpen(p)), '止めただけ');
  await p.context().close();
});

await check('4・5. タップで手前に出る（位置・大きさ・影）、周りが開く。戻すと元の位置・ラックの位置を維持', async () => {
  const p = await open(IPAD_L);
  await drag(p, -260);
  await settle(p);
  const c0 = await counter(p);
  const before = await rects(p);
  const idx = Number(c0.split(' / ')[0]) - 1;
  const ids = await p.$$eval('.item', (els) => els.map((e) => e.dataset.id));
  const target = idx + 1; // 中央の隣の服を選ぶ
  const imgBefore = await p.$eval(`.item[data-id="${ids[target]}"] .g-img`, (e) => e.getBoundingClientRect());
  const shBefore = await p.$eval(`.item[data-id="${ids[target]}"] .g-shadow`, (e) => Number(e.style.opacity));
  await tapItem(p, ids[target]);
  await settle(p);
  assert(await detailOpen(p), '詳細が開く');
  assert((await p.textContent('.detail-name')).length > 0, '商品名');
  const imgAfter = await p.$eval(`.item[data-id="${ids[target]}"] .g-img`, (e) => e.getBoundingClientRect());
  assert(imgAfter.width > imgBefore.width * 1.05, `大きくなる ${imgBefore.width} → ${imgAfter.width}`);
  assert(imgAfter.y > imgBefore.y, '手前に出て（フックがレールから離れて）下がる');
  const z = await p.$$eval('.item', (els) => els.map((e) => Number(e.style.zIndex)));
  assert(z[target] === Math.max(...z), '最前面');
  const shAfter = await p.$eval(`.item[data-id="${ids[target]}"] .g-shadow`, (e) => e.style.transform);
  assert(/scale\(1\.3/.test(shAfter), `影が広がる ${shAfter} (${shBefore})`);
  const during = await rects(p);
  assert(during[target - 1].x < before[target - 1].x - 20 && during[target + 1].x > before[target + 1].x + 20, '左右に開く');
  const op = await p.$$eval('.item', (els) => els.map((e) => Number(e.style.opacity)));
  assert(op[target - 1] < 0.8 && op[target] === 1, '周りは控えめ');
  await p.screenshot({ path: `${OUT}ipad-landscape-selected.png` });
  await p.click('.detail .btn:not(.btn-primary)'); // ラックへ戻す
  await settle(p);
  assert(!(await detailOpen(p)), '閉じる');
  const after = await rects(p);
  assert(JSON.stringify(after) === JSON.stringify(before), '元の位置に戻る');
  assert((await counter(p)) === c0, 'ラックの位置を維持');
  await p.context().close();
});

await check('6. 選択・解除を連続して素早く操作しても位置が壊れない', async () => {
  const p = await open(IPAD_L);
  const before = await rects(p);
  const ids = await p.$$eval('.item', (els) => els.map((e) => e.dataset.id));
  for (let i = 0; i < 6; i++) {
    await tapItem(p, ids[MID + (i % 2)]);
    await p.waitForTimeout(60);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(40);
  }
  await tapItem(p, ids[MID - 1]); // ワイドトラウザー
  await p.waitForTimeout(80);
  await tapItem(p, ids[MID + 1]); // 選んでいる間に別の服 → 切り替え
  await settle(p);
  assert(await detailOpen(p) && (await p.textContent('.detail-name')).replace(/\s/g, '').includes('ワイドトラウザー') === false, '切り替え');
  await p.click('.close-x');
  await settle(p);
  assert(JSON.stringify(await rects(p)) === JSON.stringify(before), '位置が元どおり');
  assert(p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();
});

await check('7. コーデラック：追加・重複防止・上限3着・個別に外す・すべて戻す・再読み込み後も残る', async () => {
  const p = await open(PHONE);
  const ids = await p.$$eval('.item', (els) => els.map((e) => e.dataset.id));
  const addFromRack = async (id) => {
    await tapItem(p, id);
    await settle(p);
    const btn = p.locator('.detail .btn-primary');
    const text = await btn.textContent();
    const disabled = await btn.isDisabled();
    if (!disabled) await btn.click();
    await p.click('.close-x');
    await settle(p);
    return { text, disabled };
  };
  await addFromRack(ids[MID]);
  assert((await p.textContent('.coord-count')) === '1/3', '1/3');
  const dup = await addFromRack(ids[MID]);
  assert(dup.disabled && dup.text.includes('掛けています'), '重複を防ぐ');
  await p.click('button[aria-label="次の服へ"]'); await settle(p);
  await addFromRack(ids[MID + 1]);
  await p.click('button[aria-label="前の服へ"]'); await p.click('button[aria-label="前の服へ"]'); await settle(p);
  await addFromRack(ids[MID - 1]);
  assert((await p.textContent('.coord-count')) === '3/3', '3/3');
  await p.click('button[aria-label="前の服へ"]'); await settle(p);
  const full = await addFromRack(ids[MID - 2]);
  assert(full.disabled && full.text.includes('3着まで'), '上限');
  // 引き出してハンガーで並んでいるか
  await p.click('.coord-tab');
  // 3着ともハンガーに掛かって見える（写真のコートは写真のハンガー、ほかはコードで描いたハンガー）
  assert((await p.locator('.coord-slot:not(.is-empty) .g-img').count()) === 3, 'コーデラックに3着');
  const photoInCoord = [ids[MID], ids[MID + 1], ids[MID - 1]].includes('camel-chester-coat') ? 1 : 0;
  assert((await p.locator('.coord-slot:not(.is-empty) .g-hanger').count()) === 3 - photoInCoord, 'コーデラックでもハンガーに掛かる');
  await p.screenshot({ path: `${OUT}phone-coord-open.png` });
  await p.click('.coord-slot:nth-child(2) .btn');
  assert((await p.textContent('.coord-count')) === '2/3', '個別に外す');
  await p.reload();
  await p.waitForSelector('.item', { state: 'attached' });
  assert((await p.textContent('.coord-count')) === '2/3', '再読み込み後も残る');
  await p.click('.coord-tab');
  await p.click('.coord-foot .btn');
  assert((await p.textContent('.coord-count')) === '0/3', 'すべて戻す');
  assert(p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();
});

await check('7b. 保存できない環境でもコーデラックを使える', async () => {
  const p = await open(IPAD_L, { denyStorage: true });
  await tapItem(p, 'wide-trousers');
  await settle(p);
  await p.click('.detail .btn-primary');
  assert((await p.textContent('.coord-count')) === '1/3', '追加できる');
  await p.click('.close-x');
  await p.click('.coord-tab');
  assert((await p.textContent('.coord-hint')).includes('保存できない'), '案内');
  assert(p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();
});

await check('8. キーボード：←→で移動、Enter で手前に、Escape で戻す', async () => {
  const p = await open(DESKTOP);
  await p.focus('.stage');
  await p.keyboard.press('ArrowRight');
  await settle(p);
  assert((await counter(p)) === `${MID + 2} / ${N}`, await counter(p));
  await p.keyboard.press('Enter');
  await settle(p);
  assert(await detailOpen(p), 'Enter');
  assert(await p.evaluate(() => document.activeElement.classList.contains('detail-name')), '詳細へフォーカス');
  await p.keyboard.press('Escape');
  await settle(p);
  assert(!(await detailOpen(p)), 'Escape');
  assert(await p.evaluate(() => document.activeElement.classList.contains('stage')), 'ラックへフォーカスが戻る');
  await p.screenshot({ path: `${OUT}desktop.png` });
  await p.context().close();
});

await check('9. 画面幅：スマホ・iPad縦横・PCで横スクロールなし、ボタンは44px以上、選択時も主要部分が見える', async () => {
  for (const [vp, name] of [[PHONE, 'phone'], [IPAD_P, 'ipad-portrait'], [IPAD_L, 'ipad-landscape'], [DESKTOP, 'desktop']]) {
    const p = await open(vp);
    const r = await p.evaluate(() => ({
      hs: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
      small: [...document.querySelectorAll('button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent),
    }));
    assert(!r.hs && r.small.length === 0, `${name} ${JSON.stringify(r)}`);
    await p.screenshot({ path: `${OUT}${name}-initial.png` });
    await tapItem(p, 'wide-trousers');
    await settle(p);
    const img = await p.$eval('.item[data-id="wide-trousers"] .g-img', (e) => e.getBoundingClientRect());
    const detail = await p.locator('.detail').boundingBox();
    if (vp === PHONE || vp === IPAD_P) assert(img.bottom <= detail.y + 4, `${name}：服が詳細シートに隠れない ${img.bottom} ${detail.y}`);
    else assert(img.right <= detail.x + 4, `${name}：服が詳細パネルに隠れない ${img.right} ${detail.x}`);
    assert(img.top >= 0 && img.left >= 0 && img.right <= vp.width, `${name}：画面内`);
    await p.screenshot({ path: `${OUT}${name}-selected.png` });
    assert(p.errs.length === 0, p.errs.join(' / '));
    await p.context().close();
  }
});

await check('10. 画像の読み込みに失敗しても画面が壊れない（その服だけ輪郭で表示）', async () => {
  const p = await open(IPAD_L, { breakImage: 'trousers.svg' });
  await p.waitForSelector('.item[data-id="wide-trousers"] .g-fallback');
  assert((await p.locator('.g-fallback').count()) === 1, '代わりの輪郭');
  assert((await p.locator('.g-img').count()) === N - 1, 'ほかは表示');
  await tapItem(p, 'wide-trousers');
  await settle(p);
  assert(await detailOpen(p), '選択もできる');
  await p.screenshot({ path: `${OUT}image-failed.png` });
  assert(p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();
});

await check('11. 動きを減らす設定：揺れを止め、横向きを弱める', async () => {
  const p = await open(IPAD_L, { reduced: true });
  await drag(p, -260);
  await p.waitForTimeout(60);
  const tr = await p.$$eval('.item', (els) => els.map((e) => e.style.transform));
  assert(tr.every((t) => /rotateZ\(-?0(\.0+)?deg\)/.test(t)), `揺れなし ${tr[3]}`);
  await settle(p);
  await p.context().close();
});

await check('12. 初回だけ「左右にスワイプ／服をタップ」の案内', async () => {
  const p = await open(PHONE, { seenHint: false });
  assert(await p.isVisible('.hint'), '初回に表示');
  assert((await p.textContent('.hint')).includes('左右にスワイプ') && (await p.textContent('.hint')).includes('服をタップ'), '文言');
  await p.screenshot({ path: `${OUT}phone-hint.png` });
  await drag(p, -120);
  assert(!(await p.isVisible('.hint')), '操作で消える');
  await p.reload();
  await p.waitForSelector('.item', { state: 'attached' });
  assert(!(await p.isVisible('.hint')), '2回目は出ない');
  await p.context().close();
});

await check('13. 揺れは移動の向きに反応し、止まると収まる', async () => {
  const p = await open(IPAD_L);
  const st = await p.locator('.stage').boundingBox();
  await p.mouse.move(st.x + st.width / 2, st.y + 300);
  await p.mouse.down();
  for (let i = 1; i <= 6; i++) { await p.mouse.move(st.x + st.width / 2 - i * 30, st.y + 300); await p.waitForTimeout(16); }
  const sway = await p.$$eval('.item', (els) => els.map((e) => Number((/rotateZ\((-?[\d.]+)deg/.exec(e.style.transform) || [0, 0])[1])));
  await p.mouse.up();
  const maxAbs = Math.max(...sway.map(Math.abs));
  assert(maxAbs > 0.3 && maxAbs <= 6.01, `揺れの大きさ ${maxAbs}`);
  await settle(p);
  const rest = await p.$$eval('.item', (els) => els.map((e) => Number((/rotateZ\((-?[\d.]+)deg/.exec(e.style.transform) || [0, 0])[1])));
  assert(Math.max(...rest.map(Math.abs)) < 0.05, '止まると収まる');
  await p.context().close();
});

await browser.close();
server.close();
const fail = results.filter((r) => !r).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
