/* ── src/boot.js ─────────────────────────────────────────────────────
   首頁（/）選模式：讀網址的 `?mode=`，收拾頁面，載入那個模式的主程式。

   一頁幾個模式，而不是幾頁：它們共用同一份版面、面板、走路、鏡頭、手把與
   動物，分成幾頁的話 index.html 就是幾份幾乎一樣的抄本（以前就是這樣，
   兩份 HTML 只差面板裡那幾行字）。

   面板裡只屬於某個模式的東西在 index.html 標了 `data-for="模式"`，不是這個
   模式的就在這裡拿掉——拿掉而不是藏起來，各模式的主程式用 id 找元素
   （#keys 兩個模式各一份），留著會找到別人的那一份。

   沒給模式（`?mode=` 空的也算）、或給了不認得的，就是 DEFAULT。

   錄影模式（record）就是完整遊戲，只是同時錄下每一幀吃了什麼、打完可以轉成影片（tape.js、
   record.js）；replay 是轉檔的時候藏在 iframe 裡重演的那一頁，不是給人開的。這兩個借完整遊戲的
   版面（`page`）：body 的 data-mode 與 data-for 照 game 算，另外帶 data-tape 說是哪一個；
   data-for 也認模式自己的名字（轉檔畫面只有 record 有）。
   ------------------------------------------------------------------ */

import { installFullscreen } from './fullscreen.js';

/** 每一個模式：分頁標題、主程式。 */
export const MODES = {
  terrain: { title: '試玩場：城堡遺跡', entry: './mode-terrain.js' },
  combat: { title: '試打場', entry: './mode-combat.js' },
  flow: { title: '完整流程', entry: './mode-flow.js' },
  /* 完整遊戲：就是完整流程，但不帶面板、提示字與開發用的鍵，一開始是開始畫面（mode-flow.js 的 GAME）。 */
  game: { title: 'Coparkour', entry: './mode-flow.js' },
  /* 錄影：完整遊戲，國王坐上王位之後進轉檔畫面。 */
  record: { title: 'Coparkour', entry: './mode-flow.js', page: 'game' },
  /* 轉檔的時候重演的那一頁（record.js 開在 iframe 裡）。 */
  replay: { title: 'Coparkour', entry: './mode-flow.js', page: 'game' },
};

/** 沒給模式的時候：完整遊戲——其他幾個是它的零件或開發版，各自拿出來試。 */
export const DEFAULT = 'game';

const asked = new URLSearchParams(location.search).get('mode');
const mode = Object.hasOwn(MODES, asked) ? asked : DEFAULT;

const page = MODES[mode].page || mode;
document.body.dataset.mode = page;
if (page !== mode) document.body.dataset.tape = mode;
document.title = MODES[mode].title;
for (const el of document.querySelectorAll('[data-for]')) {
  const fors = el.dataset.for.split(/\s+/);
  if (!fors.includes(page) && !fors.includes(mode)) el.remove();
}

installFullscreen();

await import(MODES[mode].entry);
