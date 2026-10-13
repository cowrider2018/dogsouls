/* ── src/pace.js ─────────────────────────────────────────────────────
   畫面的成本：畫多細、一秒畫幾次、一幀的 CPU 花在哪，以及是不是觸控裝置（手機省著畫的
   那幾樣照它挑）。三個模式（mode-flow／combat／terrain）共用這一份；開始畫面（lobby.js）
   的 renderer 是它自己的，解析度不歸這裡管，但它跟著完整流程的迴圈走，一秒幾次是一樣的。

   ── 解析度 ──────────────────────────────────────────────────────
   預設是裝置的像素比、最多 2（再細手機也看不出來，像素卻是四倍）。`?dpr=1`、
   `?dpr=0.75` 之類直接指定——在手機上量 fps 跟解析度有沒有關係用的：降了變快就是
   卡在填像素（GPU），沒變就是卡在別的地方。墨線的寬度是畫布上的像素（controls.js 的
   fitView），所以降解析度的時候線看起來會粗一點，那是對的。

   ── 觸控裝置一秒最多 60 幀 ────────────────────────────────────────
   很多手機的螢幕是 90／120 Hz，requestAnimationFrame 就跟著一秒叫 90／120 次：整個世界
   算兩倍、畫兩倍，看起來差不多，手機卻熱起來、降頻，最後反而掉到 60 以下。所以觸控裝置
   上一秒最多算、畫 60 次（`Pace`）；桌機不設上限，跟以前一樣。

   不能用「離上一次不到 16.7 毫秒就跳過」：rAF 的時間戳會抖，60 Hz 的螢幕上一幀早到半
   毫秒就被跳掉，變成三不五時頓一下。這裡是一條 60 Hz 的時間格：到了格子（容許早到 SLACK）
   才算一幀，下一格排在這一格再過一個間隔——所以 120 Hz 剛好兩幀畫一幀、90 Hz 三幀畫兩幀、
   144 Hz 平均也在 60 上下。格子跟著實際的時間戳走：最多排到這一幀之後一個間隔再多 LEAD
   （螢幕比 60 Hz 快一點點的時候，格子不會越走越前面、最後一口氣跳掉一幀），最少是之後一個
   間隔再少 DEBT（卡了一下之後不會為了追上連畫好幾幀）。三個數都是間隔的幾分之幾，換了上
   限一樣成立；是拿 59.94～240 Hz、時間戳抖 ±1～3 毫秒模擬挑出來的：60 Hz 一幀都不跳，
   61、62 Hz 一分鐘最多一次。

   跳過的那一次什麼都不做：模式的迴圈一進來就問 `due(now)`，不是就排下一次、return，連
   `last` 都不動——下一次真的算的時候 dt 是整段真實的時間。

   `?fps=0` 不設上限（觸控裝置也是），`?fps=N` 上限 N（桌機也是）。
   ------------------------------------------------------------------ */

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

/** 觸控裝置（主要的指標是手指）：手機、平板。比較省的那幾樣（陰影圖小一號……）照這個挑。 */
export const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** 一秒最多幾幀：`?fps=` 給的（0 是不設上限），不然觸控裝置 60、桌機不設。 */
const FPS = (() => {
  const v = Number(Q.get('fps'));
  return Q.get('fps') && v >= 0 ? v : TOUCH ? 60 : 0;
})();
/** 時間格的三個寬容，都是間隔的幾分之幾（見檔頭）。 */
const SLACK = 0.36, LEAD = 0.21, DEBT = 0.48;

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

/** 一秒最多算、畫幾次（見檔頭）。每個模式的迴圈一份。 */
export class Pace {
  constructor(fps = FPS) {
    this.fps = fps;
    this._iv = fps > 0 ? 1000 / fps : 0;
    this._next = -Infinity;           // 下一格的時間（rAF 的時間戳，毫秒）
  }

  /** 這一次 rAF（時間戳 `now`）要不要算、畫。要的話順便排好下一格。 */
  due(now) {
    const iv = this._iv;
    if (!iv) return true;
    if (now < this._next - SLACK * iv) return false;
    const grid = this._next === -Infinity ? now + iv : this._next + iv;
    this._next = Math.min(now + iv * (1 + LEAD), Math.max(now + iv * (1 - DEBT), grid));
    return true;
  }
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
