/* ── src/dev-modes.js ───────────────────────────────────────────────
   開發用的模式：只在本機（npm run dev）開得到，不上 Cloudflare。

   這支和只有這些模式用得到的主程式都列在 public/.assetsignore，wrangler deploy 不會上傳；
   boot.js 只在網址要了別的模式時才 import 這支，線上拿不到就退回完整遊戲。
   本機的 tools/serve.mjs 不讀 .assetsignore，所以這裡的每一個模式照樣開得到：

     /?mode=terrain  地形：四個城堡遺跡關卡區塊，走上去看看
     /?mode=combat   戰鬥：一塊黑牆圍起來的空地，試打怪物
     /?mode=flow     完整流程：完整遊戲加上面板、提示字與開發用的鍵（R 重玩、1–6 跳場）

   錄影不在這裡：它是完整遊戲的開關（`?record`，boot.js 的 tape），線上也開得到。
   ------------------------------------------------------------------ */

/** 每一個開發模式：分頁標題（沒寫就是遊戲的名字，boot.js 的 TITLE）、主程式。
 *  不 import boot.js 拿 TITLE：boot.js 正卡在 await 這一支，反過來等它就兩邊一起停住。 */
export const DEV_MODES = {
  terrain: { title: '試玩場：城堡遺跡', entry: './mode-terrain.js' },
  combat: { title: '試打場', entry: './mode-combat.js' },
  flow: { title: '完整流程', entry: './mode-flow.js' },
};
