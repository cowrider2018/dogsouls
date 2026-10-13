/* ── tools/serve.mjs ─────────────────────────────────────────────────
   本機開發用的靜態伺服器（npm run dev）：把 public/ 原樣送出去。

   為什麼不是 wrangler dev：wrangler dev 跟 wrangler deploy 一樣讀 public/.assetsignore，
   列在那裡的檔案本機也拿不到——而那幾支正是只在本機用的開發模式（src/dev-modes.js）。
   這一支不讀 .assetsignore，所以 /?mode=terrain、combat、flow 都開得到。
   想看線上實際的樣子（開發模式都退回完整遊戲）就跑 npm run preview，那是 wrangler dev。

   用法：npm run dev            → http://localhost:8787/
         npm run dev -- 3000    → 換一個埠
         HOST=0.0.0.0 npm run dev → 讓同一個網路的手機也連得到
   ------------------------------------------------------------------ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.argv[2]) || 8787;
const HOST = process.env.HOST || 'localhost';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.bin': 'application/octet-stream',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
};

http.createServer((q, r) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT + path.sep)) { r.writeHead(403); r.end(); return; }
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    /* 不快取：改了檔案重新整理就是新的。 */
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    r.end(d);
  });
}).listen(PORT, HOST, () => {
  console.log(`http://${HOST}:${PORT}/   （開發模式：?mode=terrain、combat、flow；錄影：?record；Ctrl+C 結束）`);
});
