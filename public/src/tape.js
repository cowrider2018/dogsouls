/* ── src/tape.js ─────────────────────────────────────────────────────
   錄影（?record）的那一捲帶子：玩的時候不錄畫面，只錄「世界每一幀吃了什麼」，
   打完才照著它把整場重演一遍、錄成影片（record.js、replay.js）。

   ── 為什麼錄輸入就夠 ────────────────────────────────────────────
   世界一幀的結果只看這幾樣：這一幀過了多久（真實時間 `real`）、操作（搖桿、按鍵）、鏡頭被
   拖成什麼樣子、有沒有點書頁，以及亂數（chance.js——種子記下來，抽法跟著世界走，就抽得
   一樣）。同一台機器、同一份程式，餵同樣的東西就走出一模一樣的浮點數。所以每幀只記十幾個
   位元組，玩的時候幾乎不花力氣；畫面、編碼全部留到打完、玩家說要的時候。

   每一幀記：
     dt      這一幀的 real（已經夾過的那個數）。
     calls   這一幀問了操作幾次、每次回答什麼（Controls 的 axis／jumpPressed／jumpDown，
             wrap 包起來的那幾個）。重演的時候照順序回答同樣的數，不問鍵盤、不問手把。
     cams    鏡頭被拖、被縮放（指標事件改的，不是鏡頭自己跟的）：這一幀開始的時候跟上一幀
             結束的時候不一樣，就記下新的 yaw、pitch、dist。
     taps    點了書頁（story.js 的 _tapped，DOM 的 pointerdown 記的）。
     pads    螢幕手把的按下、移動、放開，記在下一幀開始之前。重演的時候照樣按給它看——
             影片裡的搖桿與跳躍鍵跟真的一樣動。世界不讀手把（讀的是 calls），所以這一條只管畫面。
     views   畫面大小變了（手機轉向）。
     sums    每 SUM_EVERY 幀一個指紋（主角、怪物、鏡頭、劇情的狀態）：重演的時候比，對不上就是
             走歪了（drift），影片照錄，但會告訴玩家。

   ── 每一場的片段 ────────────────────────────────────────────────
   走進第 k 場（mode-flow.js 的 engage）記下開始的那一幀；這一場打完、戰後的漫畫翻完那一刻記下
   結束的那一幀，再多錄 TAIL 秒。倒下重打的話，開始的那一幀換成重打的那一次——留下來的是打過的
   那一次。最後一場（王座廳）的結束是國王坐上王位，多錄 END_TAIL 秒，整場就結束了。

   帶子是普通的物件與陣列：postMessage 原樣傳得過去（重演在另一個 iframe 裡）。
   ------------------------------------------------------------------ */

/** 帶子的格式版本：重演的那一頁看到不認得的就不演。 */
export const TAPE_VERSION = 1;
/** 幾幀一個指紋。 */
export const SUM_EVERY = 30;
/** 一場打完（戰後漫畫翻完）之後多錄幾秒；最後一場國王坐好之後多錄幾秒。 */
export const TAIL = 1.5, END_TAIL = 2.5;

/** 操作的那幾個問法，以及每一個怎麼記（數字陣列）、怎麼讀回來。 */
const ASKS = {
  axis: { code: 1, put: (o, v) => o.push(v.ix, v.iz, v.mag), take: (a, i) => [{ ix: a[i], iz: a[i + 1], mag: a[i + 2] }, 3] },
  jumpPressed: { code: 2, put: (o, v) => o.push(v ? 1 : 0), take: (a, i) => [a[i] === 1, 1] },
  jumpDown: { code: 3, put: (o, v) => o.push(v ? 1 : 0), take: (a, i) => [a[i] === 1, 1] },
};

/** 一串數字的指紋（FNV-1a 吃每個數的 8 個位元組）。 */
export function fingerprint(values) {
  const f = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) f[i] = +values[i] || 0;
  const b = new Uint8Array(f.buffer);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 一捲空帶子。 */
export function blankTape(meta) {
  return {
    version: TAPE_VERSION, meta,
    dt: [], calls: [], cams: [], taps: [], pads: [], views: [], sums: [],
    /** 每一場留下來的那一段：{ k, start, end, tail }（end 是戰後漫畫翻完的那一幀）。 */
    scenes: [],
    /** 正在打的那一場是從哪一幀開始的（k → 幀）。 */
    open: {},
    /** 整場結束（國王坐好、尾巴也錄完）。 */
    over: false,
  };
}

/**
 * 錄或放一捲帶子。`mode` 是 'record' 或 'replay'。主程式在世界的每一幀前後叫 begin／end，
 * 操作用 wrap 包起來，手把的事件用 wrapPad 包起來。
 */
export class Deck {
  /**
   * @param {'record'|'replay'} mode
   * @param {object} tape blankTape 的那一種
   * @param {object} hooks { cam, story, pad, view(), sum() }：鏡頭狀態、劇情、手把、現在的畫面大小、這一幀的指紋要吃哪些數
   */
  constructor(mode, tape, hooks) {
    this.mode = mode;
    this.tape = tape;
    this.h = hooks;
    /** 現在是第幾幀（begin 之後就是這一幀）；還沒開始是 -1。 */
    this.i = -1;
    /** 錄：開始了沒有（開始畫面的那幾幀不錄）。放：讀到 calls 的哪裡、各條稀疏紀錄讀到第幾筆。 */
    this.rolling = false;
    this._at = { calls: 0, cams: 0, taps: 0, pads: 0, views: 0, sums: 0 };
    /** 鏡頭上一幀結束時的樣子（錄：跟這一幀開始時比）。 */
    this._cam = null;
    this._view = null;
    /** 重演的時候第一個對不上的指紋在哪一幀；-1 = 都對得上。 */
    this.drift = -1;
  }

  /** 開始錄（或放）：從下一幀起算第 0 幀。 */
  roll() {
    this.rolling = true;
    this.i = -1;
    this._cam = this._camNow();
    this._view = this.h.view();
  }

  /** 錄的那一捲有幾幀。 */
  get frames() { return this.tape.dt.length; }

  _camNow() {
    const c = this.h.cam;
    return [c.yaw, c.pitch, c.dist];
  }

  /**
   * 包起來：`obj` 的這幾個方法（ASKS 的鍵）每叫一次，錄的時候記下回答，放的時候照帶子回答。
   * 沒在錄、沒在放（開始畫面）的時候原樣叫。
   */
  wrap(obj, names) {
    for (const name of names) {
      const own = obj[name].bind(obj), ask = ASKS[name];
      obj[name] = (...args) => {
        if (!this.rolling || this.i < 0) return own(...args);
        const calls = this.tape.calls;
        if (this.mode === 'record') {
          const v = own(...args);
          calls.push(ask.code);
          ask.put(calls, v);
          return v;
        }
        let at = this._at.calls;
        if (calls[at] !== ask.code) {
          // 問法跟錄的時候不一樣：世界已經走歪了。照真的問（反正沒人在按），記下來。
          this._drifted();
          return own(...args);
        }
        const [v, n] = ask.take(calls, at + 1);
        this._at.calls = at + 1 + n;
        return v;
      };
    }
  }

  /** 手把的按下、移動、放開：錄的時候記下來（下一幀之前發生的），放的時候由 begin 照樣按。 */
  wrapPad(pad) {
    if (this.mode !== 'record') return;
    for (const op of ['down', 'move', 'up']) {
      const own = pad[op].bind(pad);
      pad[op] = (...args) => {
        if (this.rolling) this.tape.pads.push([this.i + 1, op, ...args]);
        return own(...args);
      };
    }
  }

  /** 世界的一幀開始（real 秒）。放的時候回傳這一幀的 real。 */
  begin(real) {
    if (!this.rolling) return real;
    const t = this.tape, i = ++this.i, c = this.h.cam;
    if (this.mode === 'record') {
      t.dt.push(real);
      const now = this._camNow();
      if (now.some((v, k) => v !== this._cam[k])) t.cams.push([i, ...now]);
      if (this.h.story._tapped) t.taps.push(i);
      const view = this.h.view();
      if (view.w !== this._view.w || view.h !== this._view.h) { t.views.push([i, view]); this._view = view; }
      return real;
    }
    const at = this._at;
    while (at.pads < t.pads.length && t.pads[at.pads][0] <= i) {
      const [, op, ...args] = t.pads[at.pads++];
      this.h.pad[op](...args);
    }
    while (at.cams < t.cams.length && t.cams[at.cams][0] <= i) {
      const [, yaw, pitch, dist] = t.cams[at.cams++];
      c.yaw = yaw; c.pitch = pitch; c.dist = dist;
    }
    let tapped = false;
    while (at.taps < t.taps.length && t.taps[at.taps] <= i) tapped = t.taps[at.taps++] === i || tapped;
    this.h.story._tapped = tapped;
    while (at.views < t.views.length && t.views[at.views][0] <= i) this.h.resize?.(t.views[at.views++][1]);
    return t.dt[i];
  }

  /** 世界的一幀結束：記下鏡頭這一幀之後的樣子；每 SUM_EVERY 幀錄（或比）一個指紋。 */
  end() {
    if (!this.rolling) return;
    this._cam = this._camNow();
    if (this.i % SUM_EVERY !== SUM_EVERY - 1) return;
    const sum = fingerprint(this.h.sum());
    const t = this.tape;
    if (this.mode === 'record') { t.sums.push([this.i, sum]); return; }
    const at = this._at;
    while (at.sums < t.sums.length && t.sums[at.sums][0] < this.i) at.sums++;
    const want = t.sums[at.sums];
    if (want && want[0] === this.i && want[1] !== sum) this._drifted();
  }

  _drifted() {
    if (this.drift < 0) this.drift = this.i;
  }

  /* ── 片段（只有錄的時候記）──────────────────────────────────── */

  /** 走進第 k 場：從這一幀開始（倒下重打的話換成這一次）。 */
  enter(k) {
    if (this.mode === 'record' && this.rolling) this.tape.open[k] = this.i;
  }

  /** 第 k 場打完、戰後的漫畫翻完：這一段到這一幀，再多錄 tail 秒。 */
  close(k, tail = TAIL) {
    if (this.mode !== 'record' || !this.rolling) return;
    const t = this.tape, start = t.open[k];
    if (start === undefined) return;
    delete t.open[k];
    t.scenes = t.scenes.filter((s) => s.k !== k);
    t.scenes.push({ k, start, end: this.i, tail });
    t.scenes.sort((a, b) => a.k - b.k);
  }
}

/**
 * 一段實際要錄到哪一幀：結束的那一幀再往後 tail 秒（照每一幀的 dt 加），不超過帶子的尾巴。
 * 回傳最後一幀（含）。
 */
export function sceneEnd(tape, scene) {
  let i = scene.end, t = 0;
  while (i + 1 < tape.dt.length && t < scene.tail) t += tape.dt[++i];
  return i;
}

/** 一段的長度（秒）：從開始那一幀到最後一幀（含）的 dt 加起來。 */
export function sceneSeconds(tape, scene) {
  const last = sceneEnd(tape, scene);
  let t = 0;
  for (let i = scene.start; i <= last; i++) t += tape.dt[i];
  return t;
}
