/* ── tools/verify-ship.mjs ───────────────────────────────────────────
   上線的那一份拼不拼得起來：public/.assetsignore 列的檔案不上 Cloudflare，
   這一支檢查少了它們，剩下的照樣跑得動。

     1. .assetsignore 的每一行都對得到 public/ 底下的檔案或資料夾
        （改名或刪檔之後忘了改這裡，那一行就默默失效，該藏的又上線了）
     2. 上線的每一支 JS 的每一個靜態 import 都指到上線的檔案
        （一支上線的檔案直接 import 了被排除的檔案，線上整頁就載不起來，
        而本機的 npm run dev 什麼都送，看不出來）
     3. index.html 載的 script、manifest、圖示都是上線的檔案
     4. 開發模式的表（src/dev-modes.js）沒有上線，boot.js 只動態 import 它
     5. 怪物描線變色（`?tell`）只在拿得到 dev-modes.js 的時候開，線上開不了

   動態 import（`import('./x.js')`）可以指到被排除的檔案：那是開發模式才走得到的路
   （boot.js 拿 dev-modes.js），線上拿不到會退回。

   跑法：node tools/verify-ship.mjs
   ------------------------------------------------------------------ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failed++; };

/* public/ 底下的每一個檔案，路徑寫成 /src/boot.js 這樣。 */
const all = fs.readdirSync(ROOT, { recursive: true })
  .map((f) => '/' + f.split(path.sep).join('/'))
  .filter((f) => fs.statSync(path.join(ROOT, f)).isFile());

const rules = fs.readFileSync(path.join(ROOT, '.assetsignore'), 'utf8').split(/\r?\n/)
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

console.log('\n.assetsignore');
for (const r of rules) {
  ok(r.startsWith('/'), `${r} 從 public/ 的根寫起`);
  ok(all.some((f) => (r.endsWith('/') ? f.startsWith(r) : f === r)), `${r} 對得到檔案`);
}
const hidden = (f) => f === '/.assetsignore' || rules.some((r) => (r.endsWith('/') ? f.startsWith(r) : f === r));
const shipped = new Set(all.filter((f) => !hidden(f)));
console.log(`  （上線 ${shipped.size} 個檔案，不上線 ${all.length - shipped.size} 個）`);

console.log('\n上線的 JS 的靜態 import');
const STATIC = /(?:^|[;\s])(?:import|export)\s[^'"();]*?from\s*['"]([^'"]+)['"]|(?:^|[;\s])import\s+['"]([^'"]+)['"]/g;
let edges = 0;
for (const f of [...shipped].filter((x) => /\.m?js$/.test(x))) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(STATIC)) {
    const spec = m[1] || m[2];
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
    const to = spec.startsWith('/') ? spec : path.posix.join(path.posix.dirname(f), spec);
    edges++;
    if (!shipped.has(to)) ok(false, `${f} import ${spec}：${hidden(to) ? '被 .assetsignore 排除了' : '沒有這支檔案'}`);
  }
}
ok(edges > 0, `${edges} 個靜態 import 全部指到上線的檔案`);

console.log('\nindex.html');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
ok(refs.length > 0, `載了 ${refs.length} 個檔案`);
for (const ref of refs) ok(shipped.has(path.posix.join('/', ref)), `${ref} 上線`);

console.log('\n開發模式');
ok(!shipped.has('/src/dev-modes.js'), 'src/dev-modes.js 不上線');
const boot = fs.readFileSync(path.join(ROOT, 'src/boot.js'), 'utf8');
ok(/await import\('\.\/dev-modes\.js'\)/.test(boot) && /catch/.test(boot), 'boot.js 動態 import dev-modes.js，拿不到就退回完整遊戲');
ok(/const tell = on\('tell'\) && await import\('\.\/dev-modes\.js'\)\.then\(\(\) => true, \(\) => false\)/.test(boot),
  '?tell 只在拿得到 dev-modes.js 的時候算數（線上怪物描線不變色）');
const fight = fs.readFileSync(path.join(ROOT, 'src/fight.js'), 'utf8');
ok(/critter\.setInkColor\(!TELL \? null :/.test(fight), 'fight.js 的怪物描線變色只看 TELL');

console.log(failed ? `\n${failed} 項沒過` : '\n全部通過');
process.exit(failed ? 1 : 0);
