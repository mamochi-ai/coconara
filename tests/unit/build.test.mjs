import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { buyerHtml, bundleModules, makeZip } from '../../scripts/build.mjs';
import { watermarkBands, layoutPages } from '../../docs/js/export.js';
import { sampleDoc, defaultOutput } from '../../docs/js/model.js';
import { TRIAL_EDITION, FULL_EDITION, EDITION } from '../../docs/js/edition.js';
import { textWidth } from '../../docs/js/diagram.js';

const DOCS = new URL('../../docs/', import.meta.url);
const read = (p) => readFileSync(new URL(p, DOCS), 'utf8');

test('公開フォルダ（docs）は体験版の設定', () => {
  assert.equal(EDITION.id, 'trial');
  assert.equal(EDITION.watermark, '体験版・サンプル');
  assert.equal(EDITION.purchaseUrl, '', '購入先が未設定のまま');
  assert.notEqual(TRIAL_EDITION.storageKey, FULL_EDITION.storageKey, '保存場所を分ける');
  assert.equal(FULL_EDITION.storageKey, 'katachi-awase:doc', '購入者用は以前の保存場所（互換性）');
  assert.equal(FULL_EDITION.watermark, null);
});

test('購入者用ページは体験版の index.html から生成し、版の印と参照先だけが異なる', () => {
  const index = read('index.html');
  const page = read('buyer/index.html');
  assert.equal(page, buyerHtml(index, '../'), 'docs/buyer/index.html が最新（npm run build）');
  assert.match(page, /<meta name="katachi-edition" content="buyer">/);
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /src="\.\.\/js\/app\.js"/);
  assert.match(page, /<link rel="help" href="\.\.\/manual\.html">/);
  assert.doesNotMatch(index, /katachi-edition/, '体験版のページには印がない');
  // 体験版から購入者用ページへのリンクを置かない
  for (const f of ['index.html', 'manual.html']) assert.doesNotMatch(read(f), /href="[^"]*buyer/, f);
  assert.doesNotMatch(read('js/app.js'), /buyer\//, 'app.js');
  // 版を切り替える URL パラメーターはない
  assert.doesNotMatch(read('js/edition.js'), /location|URLSearchParams/);
});

test('公開フォルダに購入者用の配布物（ZIP）を置かない', () => {
  const walk = (u) => readdirSync(u).flatMap((n) => {
    const p = join(u, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const files = walk(new URL(DOCS).pathname);
  assert.ok(!files.some((f) => /\.zip$/i.test(f)), 'zip');
  assert.ok(!read('index.html').includes('FULL_EDITION'));
});

test('1ファイル版：モジュールを1つにまとめても「$$」などが保たれ、構文として正しい', () => {
  const sources = {};
  for (const n of ['edition', 'model', 'library', 'diagram', 'report', 'export', 'storage', 'app']) sources[n] = read(`js/${n}.js`);
  const js = bundleModules(sources);
  assert.ok(js.includes('const $$ = (sel, root = document)'), '$$ が残る');
  assert.ok(!/^\s*(import|export)\s/m.test(js));
  assert.doesNotThrow(() => new vm.Script(js));
  assert.ok(!js.includes('export const EDITION'));
});

test('ZIP：標準的なツールで展開でき、日本語の内容も保たれる', () => {
  const zip = makeZip([
    { name: 'katachi-awase/README.txt', data: Buffer.from('かたち合わせ\n') },
    { name: 'katachi-awase/web/index.html', data: Buffer.from('<!doctype html>'.repeat(50)) },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const f = join(dir, 'a.zip');
  writeFileSync(f, zip);
  let out;
  try {
    out = execFileSync('unzip', ['-p', f, 'katachi-awase/README.txt']).toString();
  } catch (e) {
    if (e.code === 'ENOENT') return; // unzip がない環境では省略
    throw e;
  }
  assert.equal(out, 'かたち合わせ\n');
  execFileSync('unzip', ['-tq', f]);
});

test('体験版の表示：確認画像の上下の帯（購入者用はなし）', () => {
  const b = watermarkBands('体験版・サンプル');
  assert.ok(b.height >= 48, '読める大きさ');
  assert.equal(b.top[0], '体験版・サンプル');
  assert.equal(b.bottom[0], '体験版・サンプル');
  assert.equal(watermarkBands(null), null);
  const ctx = { font: '16px x', measureText(t) { return { width: textWidth(t, 16) }; } };
  assert.ok(layoutPages(sampleDoc(), defaultOutput(), new Date(), ctx, { watermark: '体験版・サンプル' }).bands);
  assert.equal(layoutPages(sampleDoc(), defaultOutput(), new Date(), ctx, {}).bands, null);
});
