/* ── src/dev-modes.js ───────────────────────────────────────────────
   開發用的模式：只在本機（npm run dev）開得到，不上 Cloudflare。

   這支和只有這些模式用得到的主程式都列在 public/.assetsignore，wrangler deploy 不會上傳；
   boot.js 只在網址要了別的模式時才 import 這支，線上拿不到就退回完整遊戲。
   本機的 tools/serve.mjs 不讀 .assetsignore，所以這裡的每一個模式照樣開得到：

     /?mode=terrain  地形：四個城堡遺跡關卡區塊，走上去看看
     /?mode=combat   戰鬥：一塊黑牆圍起來的空地，試打怪物
     /?mode=flow     完整流程：完整遊戲加上面板、提示字與開發用的鍵（R 重玩、1–6 跳場）
     /?mode=record   錄影：完整遊戲，打完可以把每一場轉成影片下載（tape.js、record.js）

   錄影模式（record）就是完整遊戲，只是同時錄下每一幀吃了什麼、打完可以轉成影片；replay 是轉檔的
   時候藏在 iframe 裡重演的那一頁，不是給人開的。這兩個借完整遊戲的版面（`page`）：body 的
   data-mode 與 data-for 照 game 算，另外帶 data-tape 說是哪一個；data-for 也認模式自己的名字
   （轉檔畫面只有 record 有）。
   ------------------------------------------------------------------ */

/** 每一個開發模式：分頁標題（沒寫就是遊戲的名字，boot.js 的 TITLE）、主程式、（借別人的版面的話）page。
 *  不 import boot.js 拿 TITLE：boot.js 正卡在 await 這一支，反過來等它就兩邊一起停住。 */
export const DEV_MODES = {
  terrain: { title: '試玩場：城堡遺跡', entry: './mode-terrain.js' },
  combat: { title: '試打場', entry: './mode-combat.js' },
  flow: { title: '完整流程', entry: './mode-flow.js' },
  /* 錄影：完整遊戲，國王坐上王位之後進轉檔畫面。 */
  record: { entry: './mode-flow.js', page: 'game' },
  /* 轉檔的時候重演的那一頁（record.js 開在 iframe 裡）。 */
  replay: { entry: './mode-flow.js', page: 'game' },
};
