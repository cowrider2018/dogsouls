/* ── src/replay.js ───────────────────────────────────────────────────
   轉檔：重演的那一頁（?replay，record.js 開在一個藏起來的 iframe 裡）。

   iframe 跟玩家當時的畫面一樣大（CSS 像素），所以書頁、操作列、手把的版面都跟當時一模一樣。
   這一頁載好之後跟上一層說 ready，收到帶子（tape.js）就回到按下開始的那一刻（mode-flow.js
   的 rewind），照帶子一幀一幀推世界：
     片段外      只算不畫（快轉）。世界照樣每一幀都走——少走一幀，後面就全歪了。
     片段前一點  WARM 秒開始畫但不錄：光影、霧、後製有些東西是一幀一幀累積的，先讓它們跟上。
     片段裡      畫，最多每秒 fps 張（玩家選的 30 或 60）交給 film.js 拍下來、reel.js 編進影片；音效與音樂接到這一段
                 自己的離線混音上（時鐘換成影片的時間）。最後一幀之後混音、裝箱，整支交給上一層下載。
                 書頁蓋住的那幾幀（tape.js 的 covers）只算不畫，影片的時間也不走：那時候世界停著，
                 跳過去前後接得上。書頁本身不拍（Film 的 story 關掉），影片裡只有戰鬥。
   只轉玩家勾的那幾場：最後一場勾的錄完就停，後面不再快轉。每一段一支 mp4，打完一段就交一段。帶子的指紋對不上（重演走歪了）也照錄，最後跟上一層說。

   跟上一層講話都用 postMessage（同源）：
     → { type: 'ready' }
     ← { type: 'tape', tape, pick, fps }        pick：要轉的那幾場（k）；fps：30 或 60
     → { type: 'progress', done, total, scene }    done／total 是幀數（快轉的幀與錄的幀權重不同）
     → { type: 'file', k, name, blob }
     → { type: 'done', drift }                     drift：第一個對不上的幀，-1 是都對得上
     → { type: 'error', message }
   ------------------------------------------------------------------ */

import { Film } from './film.js';
import { Reel, pickFormat, canReel, clockedContext, offlineMix } from './reel.js';
import { sceneEnd, sceneSeconds, coverMask, TAPE_VERSION } from './tape.js';

/**
 * 影片的大小：照玩家當時畫面的實際解析度（CSS 像素 × renderer 的像素比），像素量超過 MAX_PIXELS
 * （1080p）才等比縮小；寬高都取 16 的倍數（見 videoSize）。一秒幾張是玩家選的（FPS 的一個）。
 */
export const MAX_PIXELS = 1920 * 1088, FPS = [30, 60];
/** 片段開始前幾秒先畫起來（不錄）。 */
const WARM = 0.5;
/** 錄的一幀當作快轉的幾幀（進度條的權重：畫、拍、編比只算貴很多）。 */
const SHOT_COST = 6;

const post = (msg) => parent.postMessage(msg, location.origin);
/** 用不用存檔點（mode-flow.js 的 restore）：還在試，網址給 `?snap=1` 才用；上一層說 `nosnap` 的那一次不用（放不回去，從頭再來）。 */
const SNAP_ON = (() => { const q = new URLSearchParams(location.search); return q.get('snap') === '1' && !q.has('nosnap'); })();
const nap = () => new Promise((r) => setTimeout(r, 0));

/**
 * 影片的大小與畫的像素比：`view` 是當時的畫面（CSS 像素），`dpr` 是當時 renderer 的像素比，
 * `shrink` 是再縮多少（這個大小編不了的時候往下試）。
 *
 * 寬高都取最接近的 16 的倍數：寬不是 4 的倍數的時候，畫布轉成 YUV 那一步整張錯開（量過：幾乎無損地
 * 編一次只剩 17 dB），不是 16 的倍數的時候硬體 H.264 補邊又掉到 40 dB 上下；16 的倍數是 47 dB 以上。
 * GL 直接畫成這個大小（fitTo），一個像素對一個像素貼進影片，不再縮放。寬高各自取整，所以兩個方向
 * 的比例差不到 1%，看不出來。
 */
export function videoSize(view, dpr = 2, shrink = 1) {
  let s = dpr * shrink;
  const px = view.w * view.h * s * s;
  if (px > MAX_PIXELS) s *= Math.sqrt(MAX_PIXELS / px);
  const x16 = (v) => Math.max(16, Math.round(v / 16) * 16);
  return { s, width: x16(view.w * s), height: x16(view.h * s) };
}

/** 挑一個這個瀏覽器編得了的大小：當時的解析度先試，不行就縮成 3/4、1/2。 */
async function pickVideo(view, dpr, fps) {
  for (const shrink of [1, 0.75, 0.5]) {
    const size = videoSize(view, dpr, shrink);
    const format = await pickFormat(size.width, size.height, fps);
    if (format.video) return { ...size, format };
  }
  return null;
}

/**
 * 等帶子來，演完、交完。`game` 是 mode-flow.js 給的那幾樣：step、rewind、deck、story、pad、
 * renderer、sound、music、stages（每一場的名字）。
 */
export async function serve(game) {
  const ears = hear(game);
  const { tape, pick, fps } = await new Promise((resolve) => {
    addEventListener('message', function take(e) {
      if (e.origin !== location.origin || e.data?.type !== 'tape') return;
      removeEventListener('message', take);
      resolve(e.data);
    });
    post({ type: 'ready' });
  });
  try {
    await replay(game, tape, new Set(pick), FPS.includes(fps) ? fps : FPS[FPS.length - 1], ears);
  } catch (e) {
    console.error(e);
    post({ type: 'error', message: String(e?.message || e) });
  }
}

/**
 * 聲音的檔解好：音樂自己解；音效要接到一個 AudioContext 才解得了，先接一個用完就丟的離線混音。
 * 一進這一頁就開始解，不等帶子——等帶子、挑格式、快轉到第一段的時候它在背景解，錄第一段之前才等它。
 * 解的時候音效接著的那一個還沒開始混（state 是 suspended），sound.js 的 play 一句都不放、什麼都不記，
 * 跟沒接一樣。
 */
async function hear(game) {
  game.sound.attach(offlineMix(0.1));
  await Promise.all([game.music.ready(), game.sound.ready()]);
  game.sound.detach();
}

/**
 * 畫面換成帶子上那一刻的大小與安全區：請上一層把 iframe 調成那樣，操作列、相機照它重擺。
 * `size` 給了的話 GL 的畫布剛好是影片的大小（videoSize），一個像素對一個像素；沒給就照 `s` 畫，
 * film.js 等比縮進影片的框、置中、留黑邊。
 */
function fitTo(game, view, s, size = null) {
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
  // 畫布照 CSS 大小 × 像素比取整，跟 16 的倍數差幾個像素：直接釘成影片的大小（多 0.5 免得取整少一個）。
  if (size) game.renderer.setDrawingBufferSize((size.width + 0.5) / s, (size.height + 0.5) / s, s);
}

/** `ears` 是 hear 解聲音的那一份（錄第一段之前要解完）。 */
async function replay(game, tape, pick, fps, ears) {
  if (tape?.version !== TAPE_VERSION) throw new Error('帶子的格式不對');
  if (!canReel()) throw new Error('這個瀏覽器不能轉檔（沒有 WebCodecs）');
  const { meta } = tape;
  const dpr = meta.dpr || Math.min(devicePixelRatio || 1, 2);
  const keyOf = (v) => `${v.w}x${v.h}`;

  /* 每一場一支影片，每一支照那一場自己的畫面定大小與方向：按下開始的那一刻畫面不一定是玩的時候的樣子
     （開始畫面直拿、玩的時候才轉橫；按開始的那一下才進全螢幕，畫面過幾幀才變大）。一段裡畫面變過的話
     照佔最久的那一個，其他的那幾段等比縮進來、留黑邊。
     蓋著的幀（mask）不畫也不算時間：開場頁蓋住的那一刻開始的一段，從書頁一掀開的那一幀錄起，暖身也只數沒蓋著的幀。 */
  const mask = coverMask(tape);
  const scenes = tape.scenes.filter((sc) => pick.has(sc.k)).map((sc) => {
    const last = sceneEnd(tape, sc, mask);
    let start = sc.start;
    while (start < last && mask[start]) start++;
    let from = start, t = 0;
    while (from > 0 && t < WARM) if (!mask[--from]) t += tape.dt[from];
    return { ...sc, start, last, from, seconds: sceneSeconds(tape, sc, mask) };
  });
  scenes.forEach((sc, n) => {
    if (n) sc.from = Math.max(sc.from, scenes[n - 1].last + 1);        // 暖身不伸進上一段
    const time = new Map();
    let view = meta.view, at = 0;
    for (; at < tape.views.length && tape.views[at][0] <= sc.from; at++) view = tape.views[at][1];
    for (let i = sc.from; i <= sc.last; i++) {
      for (; at < tape.views.length && tape.views[at][0] <= i; at++) view = tape.views[at][1];
      const key = keyOf(view), slot = time.get(key) || { view, t: 0 };
      if (!mask[i]) slot.t += tape.dt[i];
      time.set(key, slot);
    }
    sc.view = [...time.values()].sort((a, b) => b.t - a.t)[0].view;
  });
  // 每一種畫面大小各挑一次格式，幾種一起問。
  const sizes = new Map();
  for (const sc of scenes) if (!sizes.has(keyOf(sc.view))) sizes.set(keyOf(sc.view), pickVideo(sc.view, dpr, fps));
  for (const sc of scenes) {
    sc.size = await sizes.get(keyOf(sc.view));
    if (!sc.size) throw new Error('這個瀏覽器編不了任何一種影片格式');
  }

  /* 現在的畫面（帶子說的）與正在畫的那一場（暖身或錄）：那一場用的畫面就讓 GL 剛好是影片的大小，
     不是的話等比縮進那一場的框；不在任何一場裡就照當時的解析度畫（反正不錄）。 */
  let view = meta.view, filming = null;
  const apply = () => {
    if (!filming) return fitTo(game, view, videoSize(view, dpr).s);
    const { s, width, height } = filming.size;
    if (keyOf(view) === keyOf(filming.view)) fitTo(game, view, s, { width, height });
    else fitTo(game, view, Math.min(width / view.w, height / view.h));
  };
  game.deck.tape = tape;
  game.deck.h.resize = (v) => { view = v; apply(); };
  apply();

  game.rewind(meta);
  /* 存檔點（tape.js 的 snaps、mode-flow.js 的 restore）：第一場要轉的暖身開始之前、離它最近的那一份放回去，
     從那一幀接著走，前面不推。放不回去（有對不上的）或之後指紋對不上，就請上一層從頭再開一次、不用存檔點
     （'again'）——這一頁的世界已經被動過，不能就地改回從頭推。 */
  let i0 = 0, snapped = false;
  const snap = SNAP_ON && scenes.length ? (tape.snaps || []).filter((s) => s.at <= scenes[0].from).pop() : null;
  if (snap) {
    let r;
    try { r = game.restore(snap.data); } catch (e) { r = { bad: [String(e?.message || e)] }; }
    if (r.bad.length) { post({ type: 'again', why: r.bad.slice(0, 4).join('；') }); return; }
    await r.ready;
    view = game.deck.seek(snap) || meta.view;
    apply();
    i0 = snap.at;
    snapped = true;
  }
  let film = null;
  // 最後一場要轉的錄完就停：之後的不必再快轉。
  const N = scenes.length ? scenes[scenes.length - 1].last + 1 : 0;
  const shots = scenes.reduce((n, sc) => n + mask.subarray(sc.start, sc.last + 1).reduce((m, v) => m + 1 - v, 0), 0);
  const total = N - i0 + shots * SHOT_COST;
  let done = 0, told = 0;
  /** 時間花在哪（毫秒）：快轉的幀、畫的幀（世界＋GL）、拍（疊圖層）、等編碼器、混音裝箱；各幾幀。 */
  const cost = { fast: 0, draw: 0, shoot: 0, encode: 0, mix: 0, fastN: 0, drawN: 0, from: i0, wall: performance.now() };
  const clockIn = () => performance.now();

  let k = 0;                    // 下一段（或正在錄的那一段）
  let cut = null;               // 正在錄的這一段：{ sc, reel, mix, t, next }

  for (let i = i0; i < N; i++) {
    const sc = scenes[k];
    // 暖身開始（片段開始前 WARM 秒）：畫面換成這一場的大小。
    if (sc && i === sc.from) {
      filming = sc;
      film = new Film(sc.size.width, sc.size.height, { story: false });
      apply();
    }
    if (sc && i === sc.start) {
      await ears;                 // 聲音的檔解完了才接（hear 解完會放開它借的那一個）
      const mix = offlineMix(sc.seconds), { width, height, format } = sc.size;
      cut = { sc, reel: new Reel({ width, height, fps, format }), mix, t: 0, next: 0 };
      const clock = clockedContext(mix, () => cut.t);
      game.sound.attach(clock);
      game.music.attach(clock);
    }
    const real = tape.dt[i], hidden = mask[i] === 1;
    // 這一幀要不要畫：片段裡到了下一張的時間才畫；片段前 WARM 秒畫但不錄；書頁蓋著的、其他的不畫。
    const shoot = !!cut && !hidden && cut.t >= cut.next - 1e-6;
    const draw = shoot || (!!sc && !hidden && i >= sc.from && i < sc.start);
    let t0 = clockIn();
    game.step(real, draw);
    if (snapped && game.deck.drift >= 0) { post({ type: 'again', why: `第 ${game.deck.drift} 幀的指紋對不上` }); return; }
    const t1 = clockIn();
    if (draw) { cost.draw += t1 - t0; cost.drawN++; } else { cost.fast += t1 - t0; cost.fastN++; }
    done++;
    if (shoot) {
      const pic = film.shoot(cut.t);
      const t2 = clockIn();
      cost.shoot += t2 - t1;
      await cut.reel.frame(pic, cut.t);
      cost.encode += clockIn() - t2;
      cut.next = Math.max(cut.next + 1 / fps, cut.t);
      done += SHOT_COST;
    } else if (cut && !hidden) done += SHOT_COST;
    if (cut && !hidden) cut.t += real;

    if (cut && i === cut.sc.last) {
      game.sound.detach();
      game.music.detach();
      post({ type: 'progress', done, total, scene: cut.sc.k, mixing: true });
      t0 = clockIn();
      const buffer = await cut.mix.startRendering();
      await cut.reel.sound(buffer);
      const blob = await cut.reel.finish();
      cost.mix += clockIn() - t0;
      post({ type: 'file', k: cut.sc.k, name: game.stages[cut.sc.k], blob });
      cut = null;
      filming = null;
      apply();
      k++;
    }
    if (done - told > total / 400 || i === N - 1) {
      told = done;
      post({ type: 'progress', done, total, scene: cut ? cut.sc.k : null });
      await nap();
    }
    if (k >= scenes.length && !cut) break;
  }
  cost.wall = performance.now() - cost.wall;
  post({ type: 'done', drift: game.deck.drift, cost, size: scenes.map((sc) => [sc.size.width, sc.size.height]) });
}
