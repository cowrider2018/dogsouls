/* ── test/src/record.js ──────────────────────────────────────────────
   錄影模式（?mode=record）的轉檔畫面：國王坐上王位之後，遊戲停下來，出現這一張。

   每一場留下來的那一段（打過的那一次）一列、預設全勾，加上 30／60 fps 與轉檔鈕；不寫說明。按了
   才轉，只轉勾的那幾場；不按就什麼都不做——轉檔要重演、一張一張畫、編碼，不要的人不該付這個錢。

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
 * 畫面上只有每一場一列（預設全勾）、30／60 fps、轉檔鈕；按了之後是進度。
 */
export function showReel({ tape, stages, release }) {
  const root = document.getElementById('reel');
  const list = root.querySelector('.scenes'), go = root.querySelector('.go');
  const bar = root.querySelector('.bar i'), say = root.querySelector('.say');
  document.body.classList.add('reel');

  const rows = new Map();
  for (const sc of tape.scenes) {
    const li = document.createElement('li');
    li.innerHTML = '<input type="checkbox" checked /><b></b><span class="len"></span><span class="state"></span>';
    li.querySelector('b').textContent = `第 ${sc.k + 1} 場　${stages[sc.k]}`;
    li.querySelector('.len').textContent = clockOf(sceneSeconds(tape, sc));
    li.addEventListener('click', (e) => {
      if (root.classList.contains('busy') || root.classList.contains('over')) return;
      const box = li.querySelector('input');
      if (e.target !== box) box.checked = !box.checked;
      go.disabled = !picked().length;
    });
    list.append(li);
    rows.set(sc.k, li);
  }
  const picked = () => [...rows].filter(([, li]) => li.querySelector('input').checked).map(([k]) => k);
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
    const fps = Number(root.querySelector('input[name="fps"]:checked').value);
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
