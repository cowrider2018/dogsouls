/* ── test/src/record.js ──────────────────────────────────────────────
   錄影模式（?mode=record）的轉檔畫面：國王坐上王位之後，遊戲停下來，出現這一張。

   每一場留下來的那一段（打過的那一次）一列、預設全勾，加上 30／60 fps（預設 30）與轉檔鈕；不寫說明。按了
   才轉，只轉勾的那幾場；不按就什麼都不做——轉檔要重演、一張一張畫、編碼，不要的人不該付這個錢。

   按下去之後：
     1. 這一頁的 GL 還掉（mode-flow.js 的 release）：重演的那一頁要自己的，手機上兩份放不下。
     2. 開一個藏起來的 iframe（?mode=replay，replay.js），大小跟開始玩的時候的畫面一樣，
        把帶子（tape.js）交給它。
     3. 它每轉好一段就交一支 mp4 回來，這裡馬上存到瀏覽器的下載資料夾（<a download>）。
   全部在玩家的瀏覽器裡做，不上傳、不經過伺服器。轉的時候盡量不讓螢幕睡著（Wake Lock）；
   切到別的 App，瀏覽器會把這一頁停下來，轉檔就停住，回來再接著走。

   ── 墨水 ──────────────────────────────────────────────────────
   勾選與 fps 不用瀏覽器的方格、圓鈕：卡片是一頁紙，選起來就該像拿筆在上面畫。
     勾     畫在那一行左邊，沒有格子。兩筆不是一條弧：短的一筆往下壓到底、在那裡硬轉，長的一筆往右上
            甩出去——下筆輕、壓到轉角最重、甩出去的尾巴收成一根細毛。
     圈     把選的那一個 fps 圈起來：從左上下筆，繞一圈多一點，越繞越往外，收筆的地方跟下筆的地方錯開，
            不是一個封起來的橢圓；頭尾輕、中間重，整個圈微微歪著。
   都是有筆壓的線（pen：中線每一點各自的粗細 → 填滿的外框），墨色跟字一樣（index.html）。每畫一次
   都有一點不一樣，像真的手畫；畫上去的那一下沿著筆順顯現（遮罩上一條跟著中線的線跑過去）。
   ------------------------------------------------------------------ */

import { sceneSeconds } from './tape.js';

/** 秒 → 「m:ss」。 */
const clockOf = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

const SVG = 'http://www.w3.org/2000/svg';
const jitter = (a) => (Math.random() * 2 - 1) * a;
/** 二次貝茲曲線上的第 t 點。 */
const quad = ([x0, y0], [cx, cy], [x1, y1], t) => [
  (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1,
  (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1,
];

/** 一筆有筆壓的線：中線 `pts` 每一點的粗細 `ws` → 填滿的外框（SVG path 的 d）。 */
function pen(pts, ws) {
  const left = [], right = [];
  pts.forEach(([x, y], i) => {
    const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len, h = ws[i] / 2;
    left.push([x + nx * h, y + ny * h]);
    right.push([x - nx * h, y - ny * h]);
  });
  const xy = ([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  return `M${[...left, ...right.reverse()].map(xy).join('L')}Z`;
}

/** 筆壓沿著一筆走：從 `a` 漲到 `peak`（在 `at` 那裡最重）再收到 `b`。 */
const press = (n, a, peak, b, at) => Array.from({ length: n }, (_, i) => {
  const t = i / (n - 1);
  return t < at ? a + (peak - a) * Math.sin((t / at) * Math.PI / 2) : peak + (b - peak) * ((t - at) / (1 - at)) ** 1.6;
});

/**
 * 把一筆（或幾筆）畫進 `svg`：`strokes` 是 [{ pts, ws }]，`dots` 是轉角補的墨點 [x, y, r]。顯現的遮罩
 * 是一條跟著全部中線（照筆順接起來）的粗線，dash 從整條長度跑到 0。
 */
function ink(svg, strokes, dots = []) {
  svg.textContent = '';
  const id = `ink${Math.random().toString(36).slice(2)}`;
  const route = strokes.flatMap((st) => st.pts);
  let length = 0;
  for (let i = 1; i < route.length; i++) length += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
  const widest = Math.max(...strokes.flatMap((st) => st.ws));
  const mask = document.createElementNS(SVG, 'mask'), line = document.createElementNS(SVG, 'polyline');
  mask.id = id;
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  line.setAttribute('points', route.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#fff');
  line.setAttribute('stroke-width', String(widest + 3));
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  line.style.strokeDasharray = `${length + 1}`;
  line.style.strokeDashoffset = `${length + 1}`;
  line.classList.add('ink-in');
  mask.append(line);
  const g = document.createElementNS(SVG, 'g');
  g.setAttribute('mask', `url(#${id})`);
  for (const st of strokes) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', pen(st.pts, st.ws));
    g.append(p);
  }
  for (const [x, y, r] of dots) {
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', x.toFixed(2));
    c.setAttribute('cy', y.toFixed(2));
    c.setAttribute('r', r.toFixed(2));
    g.append(c);
  }
  svg.append(mask, g);
}

/** 一個勾（24×24 的框裡）：短的一筆往下壓到轉角、硬轉，長的一筆往右上甩出去。 */
function tick(svg) {
  const N = 14;
  const start = [3 + jitter(0.8), 12 + jitter(1)], corner = [9 + jitter(0.7), 19.5 + jitter(0.6)];
  const end = [21.5 + jitter(1), 3 + jitter(1.2)];
  const bend1 = [5.6 + jitter(0.6), 16 + jitter(0.6)], bend2 = [12.5 + jitter(1), 10.5 + jitter(1.2)];
  const down = Array.from({ length: N }, (_, i) => quad(start, bend1, corner, i / (N - 1)));
  const up = Array.from({ length: N * 2 }, (_, i) => quad(corner, bend2, end, i / (N * 2 - 1)));
  const heavy = 2.7 + jitter(0.3);
  ink(svg, [
    { pts: down, ws: press(N, 0.9, heavy, heavy, 0.99) },
    { pts: up, ws: press(N * 2, heavy, heavy * 0.85, 0.25, 0.18) },
  ], [[corner[0], corner[1], heavy / 2]]);
}

/** 把 w×h 的一塊圈起來：繞一圈多一點、越繞越往外，頭尾錯開，頭尾輕、中間重，整個圈微微歪著。 */
function ring(svg, w, h) {
  // 貼著按鈕的框繞（按鈕自己的內距就是字與圈之間的空隙），最外圈只比框大幾個百分點——
  // 外面那一列留的邊距（index.html 的 .fps）裝得下，不會被卡片裁掉。
  const N = 72, cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2;
  const from = -2.5 + jitter(0.2), turn = Math.PI * 2 + 0.75 + jitter(0.15);
  const tilt = (-3 + jitter(1.5)) * Math.PI / 180, grow = 0.09 + jitter(0.02), wob = Math.random() * 6;
  const pts = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1), a = from + turn * t, k = 0.94 + grow * t + 0.015 * Math.sin(a * 3 + wob);
    const x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k;
    return [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)];
  });
  ink(svg, [{ pts, ws: press(N, 1.0, 2.1 + jitter(0.2), 0.4, 0.15) }]);
}

/** 存到下載資料夾。 */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/**
 * 出現轉檔畫面。`tape` 是錄好的帶子，`stages` 是每一場的名字，`release` 把這一頁的 GL 還掉。
 * 畫面上只有每一場一列（預設全勾）、30／60 fps、轉檔鈕；按了之後是進度。
 */
export function showReel({ tape, stages, release }) {
  const root = document.getElementById('reel');
  const list = root.querySelector('.scenes'), go = root.querySelector('.go');
  const bar = root.querySelector('.bar i'), say = root.querySelector('.say');
  document.body.classList.add('reel');

  // 每一場一列：左邊是勾（預設全勾），點整列切換。
  const rows = new Map();
  const setTick = (li, on) => {
    li.setAttribute('aria-checked', String(on));
    const svg = li.querySelector('svg');
    if (on) tick(svg);
    else svg.textContent = '';
  };
  for (const sc of tape.scenes) {
    const li = document.createElement('li');
    li.setAttribute('role', 'checkbox');
    li.tabIndex = 0;
    li.innerHTML = '<span class="tick"><svg viewBox="0 0 24 24" width="22" height="22"></svg></span>'
      + '<b></b><span class="len"></span><span class="state"></span>';
    li.querySelector('b').textContent = `第 ${sc.k + 1} 場　${stages[sc.k]}`;
    li.querySelector('.len').textContent = clockOf(sceneSeconds(tape, sc));
    const flip = () => {
      if (root.classList.contains('busy') || root.classList.contains('over')) return;
      setTick(li, li.getAttribute('aria-checked') !== 'true');
      go.disabled = !picked().length;
    };
    li.addEventListener('click', flip);
    li.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      flip();
    });
    list.append(li);
    rows.set(sc.k, li);
    setTick(li, true);
  }
  const picked = () => [...rows].filter(([, li]) => li.getAttribute('aria-checked') === 'true').map(([k]) => k);

  // fps：選的那一個圈起來（預設 30）。
  const fpsButtons = [...root.querySelectorAll('.fps button')];
  let fps = 30;
  const choose = (v) => {
    fps = v;
    for (const b of fpsButtons) {
      const on = Number(b.dataset.fps) === v;
      b.setAttribute('aria-checked', String(on));
      let svg = b.querySelector('svg');
      if (!on) {
        svg?.remove();
        continue;
      }
      if (svg) continue;
      svg = document.createElementNS(SVG, 'svg');
      const w = b.offsetWidth, h = b.offsetHeight;
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      b.append(svg);
      ring(svg, w, h);
    }
  };
  for (const b of fpsButtons) b.addEventListener('click', () => choose(Number(b.dataset.fps)));
  choose(fps);
  const mark = (k, text, cls) => {
    const li = rows.get(k);
    if (!li) return;
    li.querySelector('.state').textContent = text;
    li.classList.remove('now', 'saved');
    if (cls) li.classList.add(cls);
  };
  go.disabled = !tape.scenes.length;

  go.addEventListener('click', async () => {
    const pick = picked();
    if (!pick.length) return;
    go.disabled = true;
    root.classList.add('busy');
    say.textContent = '準備中';
    for (const k of pick) mark(k, '等待');
    release();
    let lock = null;
    try { lock = await navigator.wakeLock?.request('screen'); } catch { /* 不給就算了 */ }

    const q = new URLSearchParams(location.search);
    q.set('mode', 'replay');
    q.set('seed', String(tape.meta.bootSeed));
    const frame = document.createElement('iframe');
    frame.className = 'replay';
    frame.style.width = `${tape.meta.view.w}px`;
    frame.style.height = `${tape.meta.view.h}px`;
    frame.src = `${location.pathname}?${q}`;

    const end = (text) => {
      say.textContent = text;
      root.classList.remove('busy');
      root.classList.add('over');
      removeEventListener('message', listen);
      frame.remove();
      lock?.release().catch(() => {});
    };
    const listen = (e) => {
      if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
      const m = e.data;
      if (m.type === 'ready') {
        frame.contentWindow.postMessage({ type: 'tape', tape, pick, fps }, location.origin);
      } else if (m.type === 'progress') {
        const pct = 100 * m.done / m.total;
        bar.style.width = `${pct.toFixed(1)}%`;
        say.textContent = `${Math.floor(pct)}%`;
        if (m.scene !== null) mark(m.scene, m.mixing ? '裝箱' : '轉檔中', 'now');
      } else if (m.type === 'file') {
        download(m.blob, `coparkour-${m.k + 1}-${m.name}.mp4`);
        mark(m.k, '已下載', 'saved');
      } else if (m.type === 'done') {
        bar.style.width = '100%';
        console.info('轉檔', m.size, m.cost);
        end(m.drift >= 0 ? '完成（重演有偏差）' : '完成');
      } else if (m.type === 'error') {
        end(`失敗：${m.message}`);
      }
    };
    addEventListener('message', listen);
    document.body.append(frame);
  });
}
