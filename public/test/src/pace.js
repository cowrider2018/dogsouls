/* ── test/src/pace.js ────────────────────────────────────────────────
   畫面的成本：畫多細。三個模式（mode-flow／combat／terrain）共用這一份，開始畫面
   （lobby.js）有自己的那一個 renderer，不歸這裡管。

   ── 解析度 ──────────────────────────────────────────────────────
   預設是裝置的像素比、最多 2（再細手機也看不出來，像素卻是四倍）。`?dpr=1`、
   `?dpr=0.75` 之類直接指定——在手機上量 fps 跟解析度有沒有關係用的：降了變快就是
   卡在填像素（GPU），沒變就是卡在別的地方。墨線的寬度是畫布上的像素（controls.js 的
   fitView），所以降解析度的時候線看起來會粗一點，那是對的。
   ------------------------------------------------------------------ */

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

/** `?dpr=` 給的像素比（夾在 0.25～4）；沒給或給錯就是 null。 */
const DPR = (() => {
  const v = Number(Q.get('dpr'));
  return Q.get('dpr') && v > 0 ? Math.min(4, Math.max(0.25, v)) : null;
})();

/** renderer 的像素比：`?dpr=` 指定的，不然裝置的、最多 2。 */
export function pixelRatio() {
  if (DPR) return DPR;
  return Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
}
