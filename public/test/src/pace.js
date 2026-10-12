/* ── test/src/pace.js ────────────────────────────────────────────────
   畫面的成本：畫多細、一幀的 CPU 花在哪。三個模式（mode-flow／combat／terrain）
   共用這一份，開始畫面（lobby.js）有自己的那一個 renderer，不歸這裡管。

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

/* ── 一幀的 CPU 花在哪 ─────────────────────────────────────────────
   fps 那一行（各模式右上的統計）後面接「算 x ＋ 畫 y ms」：這一段時間裡平均每幀
   CPU 花在更新（操控、怪物、動畫、光影的 update）與畫（light.render——three 走一遍
   場景、把指令送進 GPU）各幾毫秒。GPU 自己畫多久量不到（它是非同步的）：fps 低而這
   兩個數加起來遠小於一幀的時間，就是卡在 GPU（再拿 `?dpr=` 試）；加起來接近一幀，
   就是卡在 CPU。

   每幀三次 performance.now() 與幾個加法，不配置；字只在統計那一行要更新的時候組。 */
export class Cost {
  constructor() {
    this._t0 = 0;
    this._t1 = 0;
    this._upd = 0;
    this._ren = 0;
    this._n = 0;
  }

  /** 一幀開始。 */
  begin() { this._t0 = performance.now(); }

  /** 算完了、要畫了（light.render 之前）。 */
  split() { this._t1 = performance.now(); }

  /** 畫完了（light.render 之後）。沒走到這裡的那一幀（書頁蓋著、開始畫面）不算。 */
  end() {
    const t = performance.now();
    this._upd += this._t1 - this._t0;
    this._ren += t - this._t1;
    this._n++;
  }

  /** 上一次讀到現在的平均，接在 fps 後面的那一小段字；讀完重算。 */
  text() {
    const n = this._n;
    const s = n ? `（算 ${(this._upd / n).toFixed(1)} ＋ 畫 ${(this._ren / n).toFixed(1)} ms）` : '';
    this._upd = this._ren = 0;
    this._n = 0;
    return s;
  }
}
