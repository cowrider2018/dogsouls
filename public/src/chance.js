/* ── src/chance.js ───────────────────────────────────────────────────
   世界的亂數：怪物出哪一招、血噴到哪、火舌往哪甩、人民撒在哪……世界裡會抽籤的
   地方全部抽這一條，不抽 Math.random。

   為什麼要自己一條：錄影模式（record.js）打完才把整場重演一遍、錄成影片。重演只餵
   當時的輸入，世界得自己走出一模一樣的結果——那就要每一次抽籤都抽到一樣的數。
   這一條有種子：同一顆種子、同一串抽法，抽出來的就是同一串數。

   一開始的種子是網址的 `?seed=`，沒給就隨便挑一顆（BOOT_SEED）：載入的時候砌城堡
   也會抽（旗子的相位），重演的那一頁照同一顆砌，才會跟錄的那一頁一樣。開始玩的那一刻
   錄影模式再換一顆（reseed）記下來——開始畫面停多久都不影響後面抽到什麼。

   螢幕手把（pad.js）的水花不抽這一條：它在指標事件裡抽，跟世界的幀沒有對齊，
   抽了就會把世界後面的籤全部錯開一格。
   ------------------------------------------------------------------ */

import { mulberry32 } from './rng.js';

/** 隨便一顆 32 位元的種子。 */
export const freshSeed = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0];

/** 載入的時候用的那一顆：`?seed=` 給的，不然隨便挑。 */
export const BOOT_SEED = (() => {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('seed') : null;
  return q !== null && /^\d+$/.test(q) ? Number(q) >>> 0 : freshSeed();
})();

let draw = mulberry32(BOOT_SEED);

/** 0（含）～1（不含）的一個數，跟 Math.random 一樣用。 */
export const random = () => draw();

/** 從這一顆種子重新抽起（沒給就隨便挑一顆）。回傳用的那一顆。 */
export function reseed(seed = freshSeed()) {
  draw = mulberry32(seed);
  return seed >>> 0;
}
