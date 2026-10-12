/* ── test/src/replay.js ──────────────────────────────────────────────
   轉檔：重演的那一頁（?mode=replay，record.js 開在一個藏起來的 iframe 裡）。

   iframe 跟玩家當時的畫面一樣大（CSS 像素），所以書頁、操作列、手把的版面都跟當時一模一樣。
   這一頁載好之後跟上一層說 ready，收到帶子（tape.js）就回到按下開始的那一刻（mode-flow.js
   的 rewind），照帶子一幀一幀推世界：
     片段外      只算不畫（快轉）。世界照樣每一幀都走——少走一幀，後面就全歪了。
     片段前一點  WARM 秒開始畫但不錄：光影、霧、後製有些東西是一幀一幀累積的，先讓它們跟上。
     片段裡      畫，最多每秒 FPS 張交給 film.js 拍下來、reel.js 編進影片；音效與音樂接到這一段
                 自己的離線混音上（時鐘換成影片的時間）。最後一幀之後混音、裝箱，整支交給上一層下載。
   每一段一支 mp4，打完一段就交一段。帶子的指紋對不上（重演走歪了）也照錄，最後跟上一層說。

   跟上一層講話都用 postMessage（同源）：
     → { type: 'ready' }
     ← { type: 'tape', tape }
     → { type: 'progress', done, total, scene }    done／total 是幀數（快轉的幀與錄的幀權重不同）
     → { type: 'file', k, name, blob }
     → { type: 'done', drift }                     drift：第一個對不上的幀，-1 是都對得上
     → { type: 'error', message }
   ------------------------------------------------------------------ */

import { Film } from './film.js';
import { Reel, pickFormat, canReel, clockedContext, offlineMix } from './reel.js';
import { sceneEnd, sceneSeconds, TAPE_VERSION } from './tape.js';
import { PAGES } from './comic.js';

/** 影片的長邊、短邊最多幾個畫素；一秒最多幾張。 */
export const SIZE = { long: 1280, short: 720 }, FPS = 60;
/** 片段開始前幾秒先畫起來（不錄）。 */
const WARM = 0.5;
/** 錄的一幀當作快轉的幾幀（進度條的權重：畫、拍、編比只算貴很多）。 */
const SHOT_COST = 6;

const post = (msg) => parent.postMessage(msg, location.origin);
const nap = () => new Promise((r) => setTimeout(r, 0));

/** 影片的大小：照畫面的比例，長邊不超過 SIZE.long、短邊不超過 SIZE.short，寬高都是偶數。 */
export function videoSize(w, h) {
  const s = Math.min(SIZE.long / Math.max(w, h), SIZE.short / Math.min(w, h));
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return { s, width: even(w * s), height: even(h * s) };
}

/** 漫畫的每一張圖都載好（書頁要畫進影片，圖還沒到就是空的一格）。 */
async function comicLoaded() {
  const srcs = new Set();
  for (const page of PAGES) for (const p of page.panels) for (const src of [p.src, ...(p.strips || []).map((st) => st.src)]) if (src) srcs.add(src);
  await Promise.all([...srcs].map((src) => {
    const img = new Image();
    img.src = src;
    return img.decode().catch(() => {});
  }));
}

/**
 * 等帶子來，演完、交完。`game` 是 mode-flow.js 給的那幾樣：step、rewind、deck、story、pad、
 * renderer、sound、music、stages（每一場的名字）。
 */
export async function serve(game) {
  const tape = await new Promise((resolve) => {
    addEventListener('message', function take(e) {
      if (e.origin !== location.origin || e.data?.type !== 'tape') return;
      removeEventListener('message', take);
      resolve(e.data.tape);
    });
    post({ type: 'ready' });
  });
  try {
    await replay(game, tape);
  } catch (e) {
    post({ type: 'error', message: String(e?.message || e) });
  }
}

/** 畫面換成帶子上那一刻的大小與安全區：請上一層把 iframe 調成那樣，操作列、相機照它重擺。 */
function fitTo(game, view, s) {
  const st = document.documentElement.style;
  for (const k of ['l', 'r', 't', 'b']) st.setProperty(`--sa-${k}`, `${view.safe?.[k] || 0}px`);
  const frame = window.frameElement;
  if (frame) {
    frame.style.width = `${view.w}px`;
    frame.style.height = `${view.h}px`;
    frame.getBoundingClientRect();
  }
  game.renderer.setPixelRatio(s);
  dispatchEvent(new Event('resize'));
}

async function replay(game, tape) {
  if (tape?.version !== TAPE_VERSION) throw new Error('帶子的格式不對');
  if (!canReel()) throw new Error('這個瀏覽器不能轉檔（沒有 WebCodecs）');
  const { meta } = tape;
  const { s, width, height } = videoSize(meta.view.w, meta.view.h);
  const format = await pickFormat(width, height, FPS);
  if (!format.video) throw new Error('這個瀏覽器編不了任何一種影片格式');

  fitTo(game, meta.view, s);
  game.deck.tape = tape;
  game.deck.h.resize = (view) => fitTo(game, view, s);

  // 聲音的檔先解好：音樂自己解；音效要接到一個 AudioContext 才解得了，先接一個用完就丟的。
  await game.music.ready();
  game.sound.attach(offlineMix(0.1));
  await game.sound.ready();
  game.sound.detach();
  await comicLoaded();

  game.rewind(meta);
  const film = new Film(width, height);
  const scenes = tape.scenes.map((sc) => ({ ...sc, last: sceneEnd(tape, sc), seconds: sceneSeconds(tape, sc) }));
  const N = tape.dt.length;
  const shots = scenes.reduce((n, sc) => n + (sc.last - sc.start + 1), 0);
  const total = N + shots * SHOT_COST;
  let done = 0, told = 0;

  let k = 0;                    // 下一段（或正在錄的那一段）
  let cut = null;               // 正在錄的這一段：{ sc, reel, mix, t, next }
  // 每一段開始前 WARM 秒的那一幀
  const warmFrom = scenes.map((sc) => {
    let i = sc.start, t = 0;
    while (i > 0 && t < WARM) t += tape.dt[--i];
    return i;
  });

  for (let i = 0; i < N; i++) {
    const sc = scenes[k];
    if (sc && i === sc.start) {
      const mix = offlineMix(sc.seconds);
      cut = { sc, reel: new Reel({ width, height, fps: FPS, format }), mix, t: 0, next: 0 };
      const clock = clockedContext(mix, () => cut.t);
      game.sound.attach(clock);
      game.music.attach(clock);
    }
    const real = tape.dt[i];
    // 這一幀要不要畫：片段裡到了下一張的時間才畫；片段前 WARM 秒畫但不錄；其他的不畫。
    const shoot = !!cut && cut.t >= cut.next - 1e-6;
    const draw = shoot || (!!sc && i >= warmFrom[k] && i < sc.start);
    game.step(real, draw);
    done++;
    if (shoot) {
      const pic = film.shoot(cut.t);
      await cut.reel.frame(pic, cut.t);
      cut.next = Math.max(cut.next + 1 / FPS, cut.t);
      done += SHOT_COST;
    } else if (cut) done += SHOT_COST;
    if (cut) cut.t += real;

    if (cut && i === cut.sc.last) {
      game.sound.detach();
      game.music.detach();
      post({ type: 'progress', done, total, scene: cut.sc.k, mixing: true });
      const buffer = await cut.mix.startRendering();
      await cut.reel.sound(buffer);
      const blob = await cut.reel.finish();
      post({ type: 'file', k: cut.sc.k, name: game.stages[cut.sc.k], blob });
      cut = null;
      k++;
    }
    if (done - told > total / 400 || i === N - 1) {
      told = done;
      post({ type: 'progress', done, total, scene: cut ? cut.sc.k : null });
      await nap();
    }
    if (k >= scenes.length && !cut) break;
  }
  post({ type: 'done', drift: game.deck.drift });
}
