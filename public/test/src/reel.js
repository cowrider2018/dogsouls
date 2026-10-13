/* ── test/src/reel.js ────────────────────────────────────────────────
   把一段重演編成一支 mp4（錄影模式的轉檔，replay.js 用）：畫面一張一張交給 WebCodecs 的
   VideoEncoder，聲音是整段離線混好的一個 AudioBuffer，交給 AudioEncoder；兩條都裝進
   vendor/mp4-muxer.mjs，邊編邊收成一串 Blob（見下），最後是一支 mp4。全部在玩家的瀏覽器裡，
   不經過伺服器。

   ── 格式 ────────────────────────────────────────────────────────
   畫面先試 H.264（手機、相簿、通訊軟體都放得了；大多有硬體編碼），High → Main → Baseline，
   都不行才 VP9、AV1。聲音先試 AAC，不行才 Opus（有的播放器不放 mp4 裡的 Opus，但總比沒聲音好）；
   連 AudioEncoder 都沒有的瀏覽器就是沒有聲音的影片。

   碼率照畫面大小與幀率算（BPP 每像素每幀幾個位元）：1280×640、60 幀大約 7.4 Mbps，最多 MAX_RATE。
   低於 0.1 的時候地上的紋理、遠處的磚縫會被抹平（量過：0.07 的銳利度掉一成，0.15 跟原圖一樣）。

   ── 邊編邊放 ──────────────────────────────────────────────────
   一段幾分鐘、十幾 Mbps 就是幾百 MB，整支放在 JS 的記憶體裡做（再加上裝箱時的一份）手機撐不住。
   所以 moov 放在檔尾（fastStart: false）：mdat 照順序往後寫，寫出來的每一塊馬上包成一個 Blob
   （瀏覽器自己收著，必要時放到磁碟），JS 這邊不留。只有檔頭 HEAD 個位元組留著——收尾的時候
   muxer 會回頭改 mdat 的大小，那幾個位元組在最前面。

   ── 聲音的時鐘 ──────────────────────────────────────────────────
   重演不是即時的（可能比真的快，也可能比真的慢），所以聲音不能邊演邊錄：每一段開一個
   OfflineAudioContext，音效與音樂照樣接上去（sound.js、music.js 的 attach），但它們讀到的
   currentTime 換成影片的時間（clockedContext）——它們在第 t 秒說要放，就排在混音的第 t 秒。
   整段演完再一口氣混出來。
   ------------------------------------------------------------------ */

import { Muxer, StreamTarget } from '../vendor/mp4-muxer.mjs';

/** 聲音的取樣率與聲道。 */
export const RATE = 48000, CHANNELS = 2;
/** 每像素每幀幾個位元（碼率 = 寬 × 高 × 幀率 × BPP），最多幾 bps。 */
const BPP = 0.15, MAX_RATE = 20e6;
/** 檔頭留在記憶體裡的位元組數（見檔頭）。 */
const HEAD = 1 << 16;
/** 幾秒一個關鍵幀。 */
const KEY_EVERY = 2;

/** 畫面的候選：[mp4-muxer 的名字, WebCodecs 的 codec 字串]。 */
const VIDEO = [
  ['avc', 'avc1.64002a'], ['avc', 'avc1.4d002a'], ['avc', 'avc1.42002a'],
  ['vp9', 'vp09.00.40.08'], ['av1', 'av01.0.08M.08'],
];
/** 聲音的候選。 */
const AUDIO = [['aac', 'mp4a.40.2'], ['opus', 'opus']];

/** 這個瀏覽器轉得了檔沒有（至少要有 VideoEncoder 與離線混音）。 */
export const canReel = () => typeof VideoEncoder === 'function' && typeof VideoFrame === 'function'
  && !!(globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext);

/**
 * 挑這個瀏覽器編得了的格式。回傳 { video: {mux, config}, audio: {mux, config} | null }；
 * 畫面一個都不行的話 video 是 null。
 */
export async function pickFormat(width, height, fps) {
  let video = null, audio = null;
  for (const [mux, codec] of VIDEO) {
    const config = {
      codec, width, height, framerate: fps, bitrate: Math.round(Math.min(MAX_RATE, width * height * fps * BPP)),
      latencyMode: 'quality', ...(mux === 'avc' ? { avc: { format: 'avc' } } : {}),
    };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) { video = { mux, config: r.config }; break; }
    } catch { /* 這個瀏覽器不認得這個字串：下一個 */ }
  }
  if (typeof AudioEncoder === 'function') {
    for (const [mux, codec] of AUDIO) {
      const config = { codec, sampleRate: RATE, numberOfChannels: CHANNELS, bitrate: 128000 };
      try {
        const r = await AudioEncoder.isConfigSupported(config);
        if (r.supported) { audio = { mux, config: r.config }; break; }
      } catch { /* 下一個 */ }
    }
  }
  return { video, audio };
}

/**
 * 一個 AudioContext 的替身：什麼都照轉給 `ctx`，只有 currentTime 是 `now()`（影片的時間），
 * state 永遠是 running（離線的那一個開始混之前是 suspended，音效與音樂看到就不出聲了）。
 */
export function clockedContext(ctx, now) {
  return new Proxy(ctx, {
    get(target, key) {
      if (key === 'currentTime') return now();
      if (key === 'state') return 'running';
      const v = Reflect.get(target, key, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/** 一個離線混音：`seconds` 秒、RATE、CHANNELS。 */
export function offlineMix(seconds) {
  const Off = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  return new Off(CHANNELS, Math.max(1, Math.ceil(seconds * RATE)), RATE);
}

/** 等編碼器的佇列短一點（不然一直塞，記憶體會漲上去）。 */
function drained(enc, max) {
  if (enc.encodeQueueSize <= max) return null;
  return new Promise((resolve) => {
    const check = () => (enc.encodeQueueSize <= max ? resolve() : setTimeout(check, 4));
    if ('ondequeue' in enc) enc.addEventListener('dequeue', check, { once: true });
    else setTimeout(check, 4);
  });
}

/**
 * muxer 寫出來的位元組 → 一串 Blob（見檔頭）。檔頭 HEAD 個位元組留在記憶體裡、可以回頭改；
 * 之後的只能照順序接在後面。
 */
class Sink {
  constructor() {
    this.head = new Uint8Array(HEAD);
    this.headLen = 0;
    this.parts = [];
    this.end = HEAD;
  }

  write(data, pos) {
    if (pos < HEAD) {
      const n = Math.min(data.byteLength, HEAD - pos);
      this.head.set(data.subarray(0, n), pos);
      this.headLen = Math.max(this.headLen, pos + n);
      data = data.subarray(n);
      pos += n;
      if (!data.byteLength) return;
    }
    if (pos !== this.end) throw new Error(`影片的位元組沒有照順序寫（${pos}，應該是 ${this.end}）`);
    this.parts.push(new Blob([data]));
    this.end += data.byteLength;
  }

  blob(type) {
    return new Blob([this.head.subarray(0, this.headLen), ...this.parts], { type });
  }
}

/** 一支影片：先一張一張 frame()，再一次 sound()（可以不給），最後 finish() 拿到 Blob。 */
export class Reel {
  /** @param {{width: number, height: number, fps: number, format: {video: object, audio: object|null}}} o */
  constructor({ width, height, fps, format }) {
    this.format = format;
    this.error = null;
    this.sink = new Sink();
    this.muxer = new Muxer({
      target: new StreamTarget({ onData: (data, pos) => this.sink.write(data, pos), chunked: true, chunkSize: 1 << 21 }),
      video: { codec: format.video.mux, width, height, frameRate: fps },
      ...(format.audio ? { audio: { codec: format.audio.mux, numberOfChannels: CHANNELS, sampleRate: RATE } } : {}),
      fastStart: false,
      firstTimestampBehavior: 'offset',
    });
    this.video = new VideoEncoder({
      output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta),
      error: (e) => { this.error = e; },
    });
    this.video.configure(format.video.config);
    this._key = -Infinity;
  }

  _check() {
    if (this.error) throw this.error;
  }

  /** 第 t 秒的那一張：`source` 是畫好的畫布。 */
  async frame(source, t) {
    this._check();
    await drained(this.video, 4);
    const frame = new VideoFrame(source, { timestamp: Math.round(t * 1e6) });
    const key = t - this._key >= KEY_EVERY;
    if (key) this._key = t;
    this.video.encode(frame, { keyFrame: key });
    frame.close();
  }

  /** 整段的聲音（離線混好的 AudioBuffer）。這個瀏覽器編不了聲音的話什麼都不做。 */
  async sound(buffer) {
    this._check();
    if (!this.format.audio) return;
    const enc = new AudioEncoder({
      output: (chunk, meta) => this.muxer.addAudioChunk(chunk, meta),
      error: (e) => { this.error = e; },
    });
    enc.configure(this.format.audio.config);
    const chans = Array.from({ length: CHANNELS }, (_, c) => buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)));
    const STEP = RATE / 10;
    for (let a = 0; a < buffer.length; a += STEP) {
      const n = Math.min(STEP, buffer.length - a), data = new Float32Array(n * CHANNELS);
      chans.forEach((ch, c) => data.set(ch.subarray(a, a + n), c * n));
      const piece = new AudioData({
        format: 'f32-planar', sampleRate: RATE, numberOfFrames: n, numberOfChannels: CHANNELS,
        timestamp: Math.round((a / RATE) * 1e6), data,
      });
      await drained(enc, 8);
      enc.encode(piece);
      piece.close();
    }
    await enc.flush();
    enc.close();
    this._check();
  }

  /** 收尾：等畫面編完、裝箱，回傳 mp4 的 Blob。 */
  async finish() {
    this._check();
    await this.video.flush();
    this.video.close();
    this._check();
    this.muxer.finalize();
    return this.sink.blob('video/mp4');
  }

  /** 不要了（出錯、玩家走了）：編碼器關掉。 */
  drop() {
    try { this.video.close(); } catch { /* 已經關了 */ }
  }
}
