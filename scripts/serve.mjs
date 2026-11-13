// 開発・確認用の簡易静的サーバー（依存パッケージなし）。標準では docs/（公開体験版）を配信する。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../docs/', import.meta.url));
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

/**
 * mounts: { '/': '/abs/dir/' } のように、URLの先頭とフォルダの対応を渡す（省略時は docs/ を '/' に）。
 * 同じオリジンに体験版と購入者用を並べて、保存データが混ざらないことを確かめるのに使う。
 */
export function createServer(mounts = { '/': DEFAULT_ROOT }) {
  const list = Object.entries(mounts).sort((a, b) => b[0].length - a[0].length);
  return http.createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const hit = list.find(([prefix]) => path.startsWith(prefix));
    if (!hit) { res.writeHead(404).end('not found'); return; }
    const root = normalize(hit[1].endsWith('/') ? hit[1] : `${hit[1]}/`);
    path = path.slice(hit[0].length - (hit[0].endsWith('/') ? 1 : 0));
    if (path === '' || path.endsWith('/')) path += path === '' ? '/index.html' : 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer().listen(port, () => console.log(`http://localhost:${port}/`));
}
