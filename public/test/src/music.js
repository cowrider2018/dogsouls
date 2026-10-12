/* ── test/src/music.js ───────────────────────────────────────────────
   背景音樂：探索一首、戰鬥一首（public/assets/music/，tools/make-music.mjs 做的）。

   呼叫端每幀說現在要哪一首（`want`），這裡負責換：
     換曲    正在放的那一首淡出 SWITCH 秒（換的那一幀可以另外給秒數）、要的那一首同時淡入。換回來的時候接著上次
             停下的地方放，不從頭——除非先說了那一首要從頭（`restart`）。
     循環    快放完的時候，同一首從頭再起一份淡入、這一份淡出（LOOP 秒），交叉著接上，
             不是放完停一下再從頭。所以同一首會有兩份播放器疊著放一陣子。
   每一次響起、停下都是淡的，沒有硬切。

   不用 <audio>：媒體元素在手機上會搶走媒體播放（Android 把使用者自己在聽的音樂停掉、
   切到背景還繼續放），所以跟音效一樣整首解碼成 AudioBuffer，用 AudioBufferSourceNode
   放。一首三分鐘，照 AudioContext 的取樣率解成立體聲要 60 MB 上下，所以解碼時降到
   RATE、混成單聲道，一首 20 多 MB。

   跟音效一起由 audio.js 決定能不能出聲（`?sound=0` 全部關掉）；`?music=0` 只關音樂。
   ------------------------------------------------------------------ */

import { audible, onWake } from './audio.js';

/** 檔案在哪（相對這一支）。 */
const BASE = new URL('../../assets/music/', import.meta.url);

/** 有哪幾首（檔名）。 */
export const TRACKS = ['explore', 'fight'];

/**
 * 戰鬥放哪一首（TRACKS 的一個）：開打是 fight；這一場的 BOSS 第一次死掉、還有下一條命（combat.js 的
 * RALLY）的時候音樂淡出，牠站起來的時候 rally 從頭淡入，一直放到這一場打完。現在兩個是同一首；
 * 有第二首戰鬥曲的話放進 public/assets/music/、加進 TRACKS，換掉 rally 就好。
 */
export const BATTLE = { fight: 'fight', rally: 'fight' };

/** 音樂的總音量：墊在底下，比音效小聲很多。 */
const VOLUME = 0.25;
/** 換曲的淡出淡入（秒）。 */
const SWITCH = 2;
/** 同一首循環接回開頭的交叉淡（秒）。 */
const LOOP = 4;

/** 解碼成多少取樣率（Hz）：墊在底下的音樂用不到更高的頻率，省記憶體。 */
const RATE = 32000;

const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;

/** 檔案的位元組 → RATE、單聲道的 AudioBuffer。用離線的 AudioContext 解，不用等使用者碰頁面。 */
async function decode(bytes) {
  const off = new Offline(1, 1, RATE);
  const buf = await off.decodeAudioData(bytes);
  if (buf.numberOfChannels === 1) return buf;
  const out = off.createBuffer(1, buf.length, buf.sampleRate), d = out.getChannelData(0), n = buf.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const s = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] += s[i] / n;
  }
  return out;
}

/** 一份播放器：一首從 offset 秒開始放，接一個自己的音量。停了就丟掉，下一次另起一份。 */
class Voice {
  constructor(ctx, track, buf, bus, offset) {
    this.ctx = ctx;
    this.track = track;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.src = ctx.createBufferSource();
    this.src.buffer = buf;
    this.src.connect(this.gain).connect(bus);
    // 開始與停下都寫明是哪一刻：離線混音的時候不寫就是第 0 秒。
    this.src.start(ctx.currentTime, offset);
    /** 曲子的第 0 秒是 AudioContext 的哪一刻：現在放到第幾秒 = currentTime - t0。 */
    this.t0 = ctx.currentTime - offset;
    /** 淡出完的那一刻（AudioContext 的時間），到了就停；0 = 沒在淡出。 */
    this.until = 0;
    /** 現在這一段淡入淡出：從 a（t0 那一刻）線性走到 b（t1 那一刻）。 */
    this.ramp = { a: 0, b: 0, t0: 0, t1: 0 };
  }

  /**
   * `now` 那一刻的音量。自己算，不讀 gain.value：離線混音還沒算到那裡的時候讀到的不是那一刻的值，
   * 淡到一半換方向就會從錯的音量接下去。
   */
  level(now) {
    const { a, b, t0, t1 } = this.ramp;
    if (now >= t1) return b;
    return a + (b - a) * Math.max(0, (now - t0) / (t1 - t0));
  }

  /**
   * 停在現在這一刻。不拔掉音量那一節：拔線不排時間，離線混音的時候會在算之前就拔掉，整份連淡出都
   * 聽不到；源停了，沒人接的這一節自己會被收掉。
   */
  stop() {
    this.src.stop(this.ctx.currentTime);
  }
}

export class Music {
  constructor() {
    this._ctx = null;
    this._bus = null;
    /** 每一首解好的 AudioBuffer（還沒解好就沒有）。 */
    this._buf = {};
    /** 正在用的播放器（放著，或淡出中還沒停）。 */
    this._live = [];
    /** 現在要的那一首、正在淡入或放著的那一份；每一首上一次用的是哪一份、停在第幾秒（換回來接著放）。 */
    this._track = null;
    this._voice = null;
    this._last = {};
    this._pos = {};
    /** 換到現在這一首的時候說好淡入幾秒（還沒解好、晚幾幀才真的開始放的時候照它）。 */
    this._sec = SWITCH;
    /** 每一首載完、解完（或載不到）的那一刻。 */
    this._loads = [];

    if (!audible || !Offline || new URLSearchParams(location.search).get('music') === '0') return;
    for (const t of TRACKS) {
      this._loads.push(fetch(new URL(`${t}.m4a`, BASE))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then(decode)
        .then((buf) => { this._buf[t] = buf; })
        .catch(() => {}));
    }
    onWake((ctx) => this.attach(ctx));
  }

  /**
   * 接到這一個 AudioContext 上（叫醒的時候是 audio.js 那一個；錄影模式重演的時候是離線混音的那一個），
   * 從安靜開始：沒有正在放的、每一首都從頭。解好的曲子留著，換一個 AudioContext 也照樣用。
   */
  attach(ctx) {
    this._ctx = ctx;
    this._bus = ctx.createGain();
    this._bus.gain.value = VOLUME;
    this._bus.connect(ctx.destination);
    this._live = [];
    this._track = null;
    this._voice = null;
    this._last = {};
    this._pos = {};
    this._sec = SWITCH;
  }

  /** 不放了（want 什麼都不做），直到下一次 attach。 */
  detach() {
    this._ctx = null;
    this._bus = null;
  }

  /** 每一首都載完、解完（載不到的也算完）的時候。 */
  ready() { return Promise.all(this._loads); }

  /** 一份播放器的音量從現在的值線性走到 to，花 sec 秒。走到 0 的那一刻停下來（want 裡停）。 */
  _fade(v, to, sec) {
    const now = this._ctx.currentTime, g = v.gain.gain, from = v.level(now);
    g.cancelScheduledValues(now);
    g.setValueAtTime(from, now);
    g.linearRampToValueAtTime(to, now + sec);
    v.ramp = { a: from, b: to, t0: now, t1: now + sec };
    v.until = to === 0 ? now + sec : 0;
  }

  /** 從 offset 秒起一份新的、淡入 sec 秒。 */
  _start(track, offset, sec) {
    const v = new Voice(this._ctx, track, this._buf[track], this._bus, offset);
    this._live.push(v);
    this._last[track] = v;
    this._fade(v, 1, sec);
    return v;
  }

  /**
   * 這一首下一次響起的時候從頭放：忘掉停在第幾秒，還在淡出的那一份讓它淡完停掉，不淡回來。
   * 正在放的那一首不動（先 want 別的、讓它淡出）。
   */
  restart(track) {
    this._pos[track] = 0;
    if (this._last[track] !== this._voice) this._last[track] = null;
  }

  /**
   * 每幀叫：現在要哪一首（TRACKS 的一個，null = 不要音樂）。還不能出聲、或那一首還沒解好
   * 的時候什麼都不做，好了之後的第一幀就照這一幀要的開始放。`sec`：換曲的那一幀淡出淡入幾秒。
   */
  want(track, sec = SWITCH) {
    const ctx = this._ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // 淡出完的停下來；是那一首最後用的那一份，就記住停在第幾秒（換回來的時候接著放）。
    this._live = this._live.filter((v) => {
      if (!v.until || now < v.until) return true;
      v.stop();
      if (this._last[v.track] === v) { this._pos[v.track] = now - v.t0; this._last[v.track] = null; }
      return false;
    });

    if (track !== this._track) {
      if (this._voice) this._fade(this._voice, 0, sec);
      this._track = track;
      this._voice = null;
      this._sec = sec;
    }
    const buf = track && this._buf[track];
    if (!buf) return;

    if (!this._voice) {
      // 上次用的那一份還在淡出就把它淡回來；停了就從停的地方接著放，快到結尾了就從頭。
      const last = this._last[track];
      if (last) { this._fade(last, 1, this._sec); this._voice = last; return; }
      const at = this._pos[track] || 0;
      this._voice = this._start(track, at < buf.duration - LOOP ? at : 0, this._sec);
      return;
    }

    // 同一首快放完了：另起一份從頭淡入，這一份淡出（放到結尾剛好淡完）。
    const v = this._voice, left = buf.duration - (now - v.t0);
    if (left > LOOP) return;
    this._fade(v, 0, Math.max(left, 0.05));
    this._voice = this._start(track, 0, LOOP);
  }
}
