/* ── tools/verify-tape.mjs ───────────────────────────────────────────
   錄影模式的帶子（public/src/tape.js）與世界的亂數（chance.js），不開瀏覽器：

     1. 亂數       同一顆種子抽出同一串；reseed 之後從頭抽起；不同的種子不一樣。
     2. 錄放       一個假的世界（位置照操作與 dt 積分、偶爾抽籤）錄一遍再放一遍：每一幀的 dt、
                   操作的回答、鏡頭被拖、點書頁、手把的事件都照錄的那樣回來，世界走到同一個地方，
                   指紋全部對得上（drift 是 -1）。
     3. 走歪       放的時候世界被偷偷推了一下：指紋對不上，drift 記下那一段的幀。
     4. 片段       走進第 k 場記開始、打完記結束；倒下重打的話開始換成重打的那一次；
                   sceneEnd 照 dt 多錄 tail 秒、不超過帶子的尾巴；sceneSeconds 是那一段的秒數。
     5. 開始以前   還沒 roll 的時候（開始畫面）問操作是原樣問，不錄。
     6. 書頁蓋住   蓋著的幀記成一段一段（covers）；片段的尾巴與長度都不算蓋著的幀。

   跑法：node tools/verify-tape.mjs
   ------------------------------------------------------------------ */

import { Deck, blankTape, fingerprint, sceneEnd, sceneSeconds, SUM_EVERY } from '../public/src/tape.js';
import { random, reseed } from '../public/src/chance.js';

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok ' : ' FAIL'} ${msg}`);
  if (!cond) fails++;
};

console.log('1. 亂數');
{
  reseed(42);
  const a = Array.from({ length: 5 }, random);
  reseed(42);
  const b = Array.from({ length: 5 }, random);
  reseed(43);
  const c = Array.from({ length: 5 }, random);
  ok(a.every((v, i) => v === b[i]), '同一顆種子抽出同一串');
  ok(a.some((v, i) => v !== c[i]), '不同的種子抽出不一樣的');
  ok(a.every((v) => v >= 0 && v < 1), '都在 0～1 之間');
}

/**
 * 一個假的世界：Controls 那三個問法、鏡頭、劇情、手把，一幀照操作走一步、偶爾抽籤。
 * `input(i)` 是第 i 幀真的按了什麼（只有錄的時候有人在按）。
 */
function makeWorld(input) {
  const w = {
    x: 0, z: 0, hits: 0, i: 0,
    cam: { yaw: 0, pitch: 0.3, dist: 7 },
    story: { _tapped: false },
    taps: 0,
    pad: { log: [], down(...a) { this.log.push(['down', ...a]); }, move(...a) { this.log.push(['move', ...a]); }, up(...a) { this.log.push(['up', ...a]); } },
    controls: {
      axis: () => input(w.i).axis,
      jumpPressed: () => input(w.i).jump,
      jumpDown: () => input(w.i).hold,
    },
  };
  w.step = (dt) => {
    const a = w.controls.axis();
    const yaw = w.cam.yaw;
    w.x += (Math.cos(yaw) * a.ix - Math.sin(yaw) * a.iz) * dt * 4;
    w.z += (Math.sin(yaw) * a.ix + Math.cos(yaw) * a.iz) * dt * 4;
    if (w.controls.jumpPressed() && random() < 0.7) w.hits++;
    if (w.controls.jumpDown()) w.z += random() * 0.01;
    if (w.story._tapped) { w.taps++; w.story._tapped = false; }
    w.cam.yaw += 0.001;                 // 鏡頭自己跟（不是被拖的）
  };
  w.sum = () => [w.x, w.z, w.hits, w.cam.yaw, w.taps];
  return w;
}

/** 照一個 Deck 跑 n 幀；`before(i, w)` 是第 i 幀開始前發生的事件（只有錄的時候）。 */
function run(deck, w, n, dts, before = () => {}) {
  for (let i = 0; i < n; i++) {
    before(i, w);
    w.i = i;
    const dt = deck.begin(dts[i]);
    w.step(dt);
    deck.end();
  }
}

console.log('2. 錄放');
const N = 300;
const dts = Array.from({ length: N }, (_, i) => 1 / 60 + ((i * 7919) % 13) / 4000);
const input = (i) => ({ axis: { ix: Math.sin(i / 17), iz: Math.cos(i / 23), mag: 1 }, jump: i % 11 === 0, hold: i % 37 < 5 });
const events = (i, w) => {
  if (i % 50 === 10) w.cam.yaw -= 0.3;                       // 拖鏡頭
  if (i % 50 === 20) { w.cam.pitch += 0.05; w.cam.dist -= 0.4; }
  if (i % 70 === 33) w.story._tapped = true;                 // 點書頁
  if (i === 40) { w.pad.down('joy', 1, 90, 620); }
  if (i === 41) { w.pad.move(1, 80, 600); w.pad.move(1, 70, 590); }
  if (i === 60) w.pad.up(1);
};
let tape;
{
  const w = makeWorld(input);
  reseed(7);
  tape = blankTape({ seed: 7 });
  const deck = new Deck('record', tape, { cam: w.cam, story: w.story, pad: w.pad, view: () => ({ w: 800, h: 400 }), sum: w.sum });
  deck.wrap(w.controls, ['axis', 'jumpPressed', 'jumpDown']);
  deck.wrapPad(w.pad);
  deck.roll();
  run(deck, w, N, dts, events);
  var recorded = { x: w.x, z: w.z, hits: w.hits, taps: w.taps, cam: { ...w.cam }, pad: w.pad.log.map((e) => e.join()) };
  ok(tape.dt.length === N, `錄了 ${N} 幀`);
  ok(tape.sums.length === Math.floor(N / SUM_EVERY), `每 ${SUM_EVERY} 幀一個指紋（${tape.sums.length} 個）`);
  ok(tape.cams.length > 0 && tape.taps.length > 0 && tape.pads.length === 4, `鏡頭被拖 ${tape.cams.length} 次、點書頁 ${tape.taps.length} 次、手把 ${tape.pads.length} 個事件`);
  ok(!tape.cams.some(([i]) => i % 50 !== 10 && i % 50 !== 20), '鏡頭自己跟的那一點不算被拖');
}
{
  const nobody = () => { throw new Error('放的時候不該問真的操作'); };
  const w = makeWorld(nobody);
  reseed(tape.meta.seed);
  const deck = new Deck('replay', tape, { cam: w.cam, story: w.story, pad: w.pad, view: () => ({ w: 800, h: 400 }), sum: w.sum });
  deck.wrap(w.controls, ['axis', 'jumpPressed', 'jumpDown']);
  deck.roll();
  let threw = false;
  try { run(deck, w, N, dts.map(() => 999)); } catch { threw = true; }
  ok(!threw, '放的時候一次都沒問真的操作');
  ok(w.x === recorded.x && w.z === recorded.z && w.hits === recorded.hits && w.taps === recorded.taps,
    `世界走到同一個地方（x ${w.x.toFixed(6)}、z ${w.z.toFixed(6)}、出手 ${w.hits}、點書頁 ${w.taps}）`);
  ok(w.cam.yaw === recorded.cam.yaw && w.cam.pitch === recorded.cam.pitch && w.cam.dist === recorded.cam.dist, '鏡頭一樣');
  ok(w.pad.log.map((e) => e.join()).join('|') === recorded.pad.join('|'), '手把照錄的那樣按、移動、放開');
  ok(deck.drift === -1, '指紋全部對得上');
}

console.log('3. 走歪');
{
  const w = makeWorld(() => ({}));
  reseed(tape.meta.seed);
  const deck = new Deck('replay', tape, { cam: w.cam, story: w.story, pad: w.pad, view: () => ({ w: 800, h: 400 }), sum: w.sum });
  deck.wrap(w.controls, ['axis', 'jumpPressed', 'jumpDown']);
  deck.roll();
  run(deck, w, N, dts, (i) => { if (i === 100) w.x += 1e-9; });
  ok(deck.drift >= 100 && deck.drift < 100 + SUM_EVERY, `被推了一下之後的第一個指紋就對不上（drift ${deck.drift}）`);
  ok(fingerprint([1, 2, 3]) === fingerprint([1, 2, 3]) && fingerprint([1, 2, 3]) !== fingerprint([1, 2, 3 + 1e-12]), '指紋分得出最後一位的差別');
}

console.log('4. 片段');
{
  const w = makeWorld(input);
  const t = blankTape({});
  const deck = new Deck('record', t, { cam: w.cam, story: w.story, pad: w.pad, view: () => ({ w: 1, h: 1 }), sum: w.sum });
  deck.roll();
  const marks = { 10: () => deck.enter(0), 50: () => deck.enter(0), 90: () => deck.close(0), 120: () => deck.enter(1), 200: () => deck.close(1, 0.25) };
  for (let i = 0; i < 210; i++) {
    deck.begin(1 / 60);
    marks[i]?.();
    deck.end();
  }
  ok(t.scenes.length === 2 && t.scenes[0].start === 50 && t.scenes[0].end === 90, '倒下重打：留下來的是重打的那一次（50～90）');
  ok(t.scenes[1].start === 120 && t.scenes[1].end === 200, '第二場 120～200');
  ok(sceneEnd(t, t.scenes[1]) === 209, 'tail 0.25 秒（15 幀）超過帶子的尾巴：停在最後一幀');
  const tail = sceneEnd(t, t.scenes[0]);
  // 加到「不少於 tail 秒」為止：60 個 1/60 加起來可能差最後一位，多一幀也對。
  ok(Math.abs(tail - 90 - t.scenes[0].tail * 60) <= 1, `tail ${t.scenes[0].tail} 秒：多錄 ${tail - 90} 幀`);
  ok(Math.abs(sceneSeconds(t, t.scenes[1]) - 90 / 60) < 1e-9, '第二場的長度是 90 幀的秒數');
}

console.log('5. 開始以前');
{
  let asked = 0;
  const w = makeWorld(() => { asked++; return { axis: { ix: 0, iz: 0, mag: 0 }, jump: false, hold: false }; });
  const t = blankTape({});
  const deck = new Deck('record', t, { cam: w.cam, story: w.story, pad: w.pad, view: () => ({ w: 1, h: 1 }), sum: w.sum });
  deck.wrap(w.controls, ['axis', 'jumpPressed', 'jumpDown']);
  w.controls.jumpPressed();
  ok(asked === 1 && t.calls.length === 0, '還沒 roll：照樣問，不錄');
}

console.log('6. 書頁蓋住');
{
  const w = makeWorld(input);
  const t = blankTape({});
  const deck = new Deck('record', t, { cam: w.cam, story: w.story, pad: w.pad, view: () => ({ w: 1, h: 1 }), sum: w.sum });
  deck.roll();
  // 第 30～59 幀、第 70 幀書頁蓋著；第 95～399 幀是收片段之後才蓋住的戰後頁（尾巴只數沒蓋著的幀）。
  const covered = (i) => (i >= 30 && i < 60) || i === 70 || (i >= 95 && i < 400);
  const marks = { 10: () => deck.enter(0), 90: () => deck.close(0, 0.25) };
  for (let i = 0; i < 420; i++) {
    deck.begin(1 / 60);
    w.story.covered = covered(i);
    marks[i]?.();
    deck.end();
  }
  ok(JSON.stringify(t.covers) === JSON.stringify([[30, 59], [70, 70], [95, 399]]), `連著的蓋著併成一段：${JSON.stringify(t.covers)}`);
  const sc = t.scenes[0], last = sceneEnd(t, sc);
  // 尾巴 15 幀：91～94 四幀，跳過 95～399，接著 400～410（加到不少於 0.25 秒，多一幀也對）。
  ok(last >= 410 && last <= 411, `尾巴跳過蓋著的幀：收到第 ${last} 幀`);
  const kept = last - sc.start + 1 - 30 - 1 - 305;
  ok(Math.abs(sceneSeconds(t, sc) - kept / 60) < 1e-9, `長度只算沒蓋著的 ${kept} 幀`);
}

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
