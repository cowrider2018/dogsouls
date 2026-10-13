/* ── src/boot.js ─────────────────────────────────────────────────────
   首頁（/）選模式：讀網址的 `?mode=`，收拾頁面，載入那個模式的主程式。

   一頁幾個模式，而不是幾頁：它們共用同一份版面、面板、走路、鏡頭、手把與
   動物，分成幾頁的話 index.html 就是幾份幾乎一樣的抄本（以前就是這樣，
   兩份 HTML 只差面板裡那幾行字）。

   面板裡只屬於某個模式的東西在 index.html 標了 `data-for="模式"`，不是這個
   模式的就在這裡拿掉——拿掉而不是藏起來，各模式的主程式用 id 找元素
   （#keys 兩個模式各一份），留著會找到別人的那一份。

   沒給模式（`?mode=` 空的也算）、或給了不認得的，就是 DEFAULT。線上（Cloudflare）只有 DEFAULT：
   其他模式是開發用的，表在 dev-modes.js，只在本機的 npm run dev 拿得到。

   錄影不是模式，是完整遊戲的開關（`?record`），線上也開得到，見下面 tape。
   ------------------------------------------------------------------ */

import { installFullscreen } from './fullscreen.js';

/** 遊戲的名字：完整遊戲的分頁標題（index.html 的 <title> 與 manifest 的 name 是同一句）。 */
export const TITLE = 'Dogsouls: Revive the Kingdom from Zombie Invasion';

/** 線上只有這一個模式：完整遊戲——完整流程，但不帶面板、提示字與開發用的鍵，一開始是開始畫面（mode-flow.js 的 GAME）。 */
export const DEFAULT = 'game';
const GAME = { title: TITLE, entry: './mode-flow.js' };

const params = new URLSearchParams(location.search);
const asked = params.get('mode');

/* 其他模式全在 dev-modes.js，那支跟它們的主程式都列在 public/.assetsignore，不上 Cloudflare。
   所以只有網址真的要了別的模式才去拿：線上拿不到（404）就當作沒給，照樣是完整遊戲；
   本機的 npm run dev 不理 .assetsignore，拿得到。沒要的時候一個請求都不多發。 */
const MODES = { [DEFAULT]: GAME };
if (asked && asked !== DEFAULT) {
  try {
    Object.assign(MODES, (await import('./dev-modes.js')).DEV_MODES);
  } catch { /* 線上：沒有開發模式 */ }
}
const mode = Object.hasOwn(MODES, asked) ? asked : DEFAULT;

/* 錄影（`?record`，給了就開，`record=0` 不算）：完整遊戲，同時錄下每一幀吃了什麼（tape.js），國王坐上王位
   之後進轉檔畫面（record.js），可以把每一場轉成影片下載。`?replay` 是轉檔的時候 record.js 藏在 iframe 裡重演的
   那一頁，不是給人開的。兩個都只跟完整遊戲搭：給了別的模式就不算。body 的 data-tape 說是哪一個
   （mode-flow.js 照它），data-for 也認它（轉檔畫面只有 record 有）。 */
const on = (k) => params.has(k) && params.get(k) !== '0';
const tape = mode !== DEFAULT ? null : on('replay') ? 'replay' : on('record') ? 'record' : null;

document.body.dataset.mode = mode;
if (tape) document.body.dataset.tape = tape;
document.title = MODES[mode].title || TITLE;
for (const el of document.querySelectorAll('[data-for]')) {
  const fors = el.dataset.for.split(/\s+/);
  if (!fors.includes(mode) && !fors.includes(tape)) el.remove();
}

installFullscreen();

await import(MODES[mode].entry);
