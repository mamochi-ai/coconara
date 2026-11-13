// 購入者用の配布物を作る。公開体験版（docs/）と同じコードから、版の設定だけを差し替える。
// 出力先 build/ は git の管理対象外（公開リポジトリ・GitHub Pages には含めない）。
//
//   node scripts/build.mjs
//
// 出力:
//   build/katachi-awase/web/            … HTTPSで公開して使う形（index.html, css, js, manual.html）
//   build/katachi-awase/single/         … 1ファイル版（katachi-awase.html）と manual.html
//   build/katachi-awase/README.txt      … 購入者向けのはじめに
//   build/katachi-awase/MANIFEST.txt    … 配布内容一覧（ファイルとSHA-256）
//   build/katachi-awase-buyer-<version>.zip
import { readFile, writeFile, mkdir, rm, readdir, stat, copyFile } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(ROOT, 'docs');
const OUT = join(ROOT, 'build');
const PKG = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const DIST = join(OUT, 'katachi-awase');

// 体験版の設定行を、購入者用の設定に置き換える（ほかのコードは共通）
const EDITION_LINE = 'export const EDITION = TRIAL_EDITION;';
export function toFullEdition(src) {
  if (!src.includes(EDITION_LINE)) throw new Error('edition.js の版の設定行が見つかりません');
  return src.replace(EDITION_LINE, () => 'export const EDITION = FULL_EDITION;');
}

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/** web 版：docs/ を複製し、版の設定だけを差し替える */
async function buildWeb(dest) {
  for (const f of await walk(SRC)) {
    const rel = relative(SRC, f);
    const to = join(dest, rel);
    await mkdir(dirname(to), { recursive: true });
    if (rel === join('js', 'edition.js')) await writeFile(to, toFullEdition(await readFile(f, 'utf8')));
    else await copyFile(f, to);
  }
}

// ---------- 1ファイル版（モジュールを1つのスクリプトにまとめる） ----------
const MODULE_ORDER = ['edition', 'model', 'diagram', 'report', 'export', 'storage', 'app'];

export function bundleModules(sources) {
  const parts = ['const __m = {};'];
  for (const name of MODULE_ORDER) {
    let code = sources[name];
    if (code === undefined) throw new Error(`モジュールがありません: ${name}`);
    code = code.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*'\.\/(\w+)\.js';/gm, (m, names, mod) => {
      if (!MODULE_ORDER.includes(mod) || MODULE_ORDER.indexOf(mod) >= MODULE_ORDER.indexOf(name)) {
        throw new Error(`${name} が読み込む ${mod} の順序が正しくありません`);
      }
      if (/\bas\b/.test(names)) throw new Error(`別名の import には未対応です（${name}）`);
      return `const {${names}} = __m.${mod};`;
    });
    if (/^\s*import\s/m.test(code)) throw new Error(`未処理の import があります（${name}）`);
    const exported = [];
    code = code.replace(/^export\s+((?:async\s+)?function\s*\*?\s*|const\s+|let\s+|class\s+)(\w+)/gm, (m, kw, id) => {
      exported.push(id);
      return `${kw}${id}`;
    });
    if (/^\s*export\s/m.test(code)) throw new Error(`未処理の export があります（${name}）`);
    parts.push(`__m.${name} = (() => {\n${code}\nreturn { ${exported.join(', ')} };\n})();`);
  }
  return `(() => {\n'use strict';\n${parts.join('\n')}\n})();`;
}

async function buildSingle(webDir, dest) {
  const html = await readFile(join(webDir, 'index.html'), 'utf8');
  const css = await readFile(join(webDir, 'css', 'app.css'), 'utf8');
  const sources = {};
  for (const name of MODULE_ORDER) sources[name] = await readFile(join(webDir, 'js', `${name}.js`), 'utf8');
  const js = bundleModules(sources).replace(/<\/script/gi, '<\\/script');
  // 置換文字列の「$$」などが解釈されないよう、関数で差し込む
  let out = html.replace('<link rel="stylesheet" href="./css/app.css">', () => `<style>\n${css}\n</style>`);
  out = out.replace('<script type="module" src="./js/app.js"></script>', () => `<script>\n${js}\n</script>`);
  if (out.includes('./css/app.css') || out.includes('./js/app.js')) throw new Error('1ファイル版の組み立てに失敗しました');
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, 'katachi-awase.html'), out);
  await copyFile(join(webDir, 'manual.html'), join(dest, 'manual.html'));
}

// ---------- ZIP（外部ツールに頼らず作る。ファイル名はUTF-8） ----------
export function makeZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  const dosTime = (() => {
    const d = new Date(2026, 0, 1, 0, 0, 0); // 再現性のため固定
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  })();
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(dosTime.time, 10); head.writeUInt16LE(dosTime.date, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(comp.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28);
    local.push(head, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dosTime.time, 12); c.writeUInt16LE(dosTime.date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += head.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, end]);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  const webDir = join(DIST, 'web');
  await buildWeb(webDir);
  await buildSingle(webDir, join(DIST, 'single'));
  const readme = (await readFile(join(ROOT, 'product', 'buyer-README.txt'), 'utf8')).replaceAll('{{VERSION}}', VERSION);
  await writeFile(join(DIST, 'README.txt'), readme);

  // 配布内容一覧
  const files = (await walk(DIST)).sort();
  const lines = [`かたち合わせ 購入者用 配布内容一覧（バージョン ${VERSION}）`, ''];
  for (const f of files) {
    const buf = await readFile(f);
    lines.push(`${relative(DIST, f).split('\\').join('/')}\t${buf.length} bytes\tsha256:${createHash('sha256').update(buf).digest('hex')}`);
  }
  await writeFile(join(DIST, 'MANIFEST.txt'), `${lines.join('\n')}\n`);

  const entries = [];
  for (const f of (await walk(DIST)).sort()) {
    entries.push({ name: `katachi-awase/${relative(DIST, f).split('\\').join('/')}`, data: await readFile(f) });
  }
  const zipPath = join(OUT, `katachi-awase-buyer-${VERSION}.zip`);
  await writeFile(zipPath, makeZip(entries));
  console.log(`作成しました: ${relative(ROOT, zipPath)}（${entries.length} ファイル）`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
