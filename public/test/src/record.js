/* ── test/src/record.js ──────────────────────────────────────────────
   錄影模式（?mode=record）的轉檔畫面：國王坐上王位之後，遊戲停下來，出現這一張。

   上面列出每一場留下來的那一段（打過的那一次）與長度。玩家按「轉檔並下載」才轉；不按就什麼都
   不做——轉檔要把整場重演一遍、一張一張畫、編碼，手機上很花電，不要的人不該付這個錢。

   按下去之後：
     1. 這一頁的 GL 還掉（mode-flow.js 的 release）：重演的那一頁要自己的，手機上兩份放不下。
     2. 開一個藏起來的 iframe（?mode=replay，replay.js），大小跟開始玩的時候的畫面一樣，
        把帶子（tape.js）交給它。
     3. 它每轉好一段就交一支 mp4 回來，這裡馬上存到瀏覽器的下載資料夾（<a download>）。
   全部在玩家的瀏覽器裡做，不上傳、不經過伺服器。轉的時候盡量不讓螢幕睡著（Wake Lock）；
   切到別的 App，瀏覽器會把這一頁停下來，轉檔就停住，回來再接著走。
   ------------------------------------------------------------------ */

import { sceneSeconds } from './tape.js';

/** 秒 → 「m:ss」。 */
const clockOf = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

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
 */
export function showReel({ tape, stages, release }) {
  const root = document.getElementById('reel');
  const list = root.querySelector('.scenes'), go = root.querySelector('.go');
  const bar = root.querySelector('.bar i'), say = root.querySelector('.say');
  document.body.classList.add('reel');

  const rows = new Map();
  for (const sc of tape.scenes) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b><span class="len"></span><span class="state"></span>';
    li.querySelector('b').textContent = `第 ${sc.k + 1} 場　${stages[sc.k]}`;
    li.querySelector('.len').textContent = clockOf(sceneSeconds(tape, sc));
    list.append(li);
    rows.set(sc.k, li);
  }
  const mark = (k, text, cls) => {
    const li = rows.get(k);
    if (!li) return;
    li.querySelector('.state').textContent = text;
    li.className = cls || '';
  };
  if (!tape.scenes.length) {
    go.disabled = true;
    say.textContent = '這一輪沒有留下可以轉的片段。';
    return;
  }

  go.addEventListener('click', async () => {
    go.disabled = true;
    root.classList.add('busy');
    say.textContent = '準備中……';
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

    let current = null;
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
        say.textContent = '重演中……';
        frame.contentWindow.postMessage({ type: 'tape', tape }, location.origin);
      } else if (m.type === 'progress') {
        bar.style.width = `${(100 * m.done / m.total).toFixed(1)}%`;
        if (m.scene !== null && m.scene !== current) {
          current = m.scene;
          mark(current, '轉檔中', 'now');
        }
        if (m.scene !== null) say.textContent = m.mixing ? `第 ${m.scene + 1} 場：混音、裝箱……` : `第 ${m.scene + 1} 場：轉檔中……`;
        else say.textContent = '快轉到下一段……';
      } else if (m.type === 'file') {
        download(m.blob, `coparkour-${m.k + 1}-${m.name}.mp4`);
        mark(m.k, '已下載', 'saved');
        current = null;
      } else if (m.type === 'done') {
        bar.style.width = '100%';
        console.info('轉檔', m.size, m.cost);
        end(m.drift >= 0
          ? '轉好了，但重演到一半跟你玩的那一次對不上，後面的影片可能跟當時不一樣。'
          : '全部轉好了，影片在瀏覽器的下載資料夾裡。');
      } else if (m.type === 'error') {
        end(`轉檔失敗：${m.message}`);
      }
    };
    addEventListener('message', listen);
    document.body.append(frame);
  });
}
