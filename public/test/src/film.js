/* ── test/src/film.js ────────────────────────────────────────────────
   轉檔的時候，把重演那一頁的畫面拍成一張圖（replay.js 每一幀交給 reel.js 編進影片）：
   玩家當時在螢幕上看到的每一層都要在，就像螢幕錄影。

   畫面不只 GL 那一張畫布。由下往上（照 index.html 的 z-index 與 DOM 的順序）：
     #view       GL。倒下醒來的那一段 death.js 會給它 CSS 的 blur，這裡照樣糊。
     #signpost   路標（2D 畫布）。
     #bossbar    BOSS 的血條（2D 畫布，在頁面上的那一塊）。
     #fade       黑幕（transit.js、death.js 寫的 opacity）。
     #dream      倒下醒來浮出來的字（death.js 寫的字、opacity、blur）。
     .rail       兩側（直向是上下）操作列底下那一層往中間淡掉的陰影（完整遊戲的版面）。
     #pad        搖桿與跳躍鍵（2D 畫布）：重演的時候照帶子按，跟真的一樣動（tape.js 的 pads）。
     #story      漫畫的書頁——這一層是 DOM，畫布拍不到，見下。

   ── 書頁 ────────────────────────────────────────────────────────
   瀏覽器沒有把 DOM 畫進畫布的辦法，所以照 DOM 排好的版面自己畫一次：重演的 iframe 跟玩家
   當時的畫面一樣大，書頁的版面（vw、vmin、直向橫向）就跟當時一模一樣，只要量。
     量     暫時把書頁與分格的 transform 拿掉，量每一塊在頁面上的位置、每一個字的位置
            （Range 一個字一個字量，換行、字距都是瀏覽器排好的），量完放回去。重演的那一頁
            藏著，沒有人看得到它被動過。
     畫     紙（index.html 的 #story .page：底色、兩團暈、細直紋、四邊壓暗、左緣那一條紙邊）、
            標題、頁碼畫成一張；每一格自己一張（框、底色、圖照 object-fit: cover 裁、字）。
            同一頁、同一格只畫一次，之後每一幀照當時的 transform 貼上去——書頁斜著滑進來、
            分格一格一格落下來，跟畫面上一樣。
   紙的花樣是照 CSS 抄的（PAPER），改了 index.html 的紙要一起改這裡。
   ------------------------------------------------------------------ */

/** 書頁的紙：index.html 的 #story .page 與它的 ::before，用 vmin／vmax 與 0～1 寫。 */
const PAPER = {
  color: '#efe3c6',
  glows: [
    // radial-gradient(ellipse rx ry at cx cy, color, transparent stop)，由上往下疊（CSS 的第一層在最上面）
    { rx: 0.70, ry: 0.60, cx: 0.35, cy: 0.30, color: 'rgba(255, 250, 235, 0.55)', stop: 0.7 },
    { rx: 0.60, ry: 0.50, cx: 0.80, cy: 0.85, color: 'rgba(150, 110, 60, 0.16)', stop: 0.7 },
  ],
  /** repeating-linear-gradient(90deg, color 0 1px, transparent 1px 4px)。 */
  lines: { color: 'rgba(110, 85, 50, 0.035)', width: 1, every: 4 },
  /** ::before：左緣 3vmax 寬的紙邊。 */
  edge: { width: 3, stops: [[0, 'rgba(255, 252, 240, 0.9)'], [0.18, 'rgba(255, 252, 240, 0)'], [0.55, 'rgba(120, 88, 45, 0.22)'], [1, 'rgba(120, 88, 45, 0)']] },
};
/** 回憶那一格（.panel-cell.memory）：底色暈開、圖的邊緣暈進紙裡。 */
const MEMORY = {
  back: { rx: 0.72, ry: 0.68, stops: [[0.55, '#f2e0bb'], [1, 'rgba(242, 224, 187, 0)']] },
  mask: { rx: 0.72, ry: 0.68, stops: [[0.62, 'rgba(0, 0, 0, 1)'], [1, 'rgba(0, 0, 0, 0)']] },
};
/** 「點一下翻頁」那一行：.ready 之後 0.3 秒淡到 0.75，接著每 1.6 秒在 0.75 與 0.3 之間呼吸。 */
const NEXT = { fadeIn: 0.3, peak: 0.75, low: 0.3, period: 1.6 };

const FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));

/** CSS 的 blur(Npx) → N；沒有是 0。 */
const blurOf = (filter) => {
  const m = /blur\(([\d.]+)px\)/.exec(filter || '');
  return m ? +m[1] : 0;
};

/** 一個 CSS 顏色是不是透明的。 */
const clear = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);

/** 計算後的 box-shadow → [{ x, y, blur, color, inset }]。 */
function shadowsOf(css) {
  if (!css || css === 'none') return [];
  const out = [];
  for (const part of css.split(/,(?![^(]*\))/)) {
    const color = (/(rgba?\([^)]*\)|#[0-9a-f]+)/i.exec(part) || [])[1] || 'rgba(0,0,0,0)';
    const nums = part.replace(color, '').match(/-?[\d.]+px/g)?.map(parseFloat) || [];
    out.push({ x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, color, inset: /inset/.test(part) });
  }
  return out;
}

/** 計算後的 transform（matrix(...) 或 none）→ DOMMatrix。 */
const matrixOf = (css) => (css && css !== 'none' ? new DOMMatrix(css) : new DOMMatrix());

/** object-position 的一軸 → 0～1（百分比、關鍵字；px 照可動的距離換）。 */
function placeOf(token, free) {
  if (!token) return 0.5;
  if (token.endsWith('%')) return parseFloat(token) / 100;
  if (token.endsWith('px')) return free ? parseFloat(token) / free : 0;
  return { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 }[token] ?? 0.5;
}

/** 一個橢圓的放射漸層（CSS 的 radial-gradient(ellipse rx ry at cx cy, …)），塗滿 (0,0,w,h)。 */
function ellipseFill(g, w, h, { rx, ry, cx = 0.5, cy = 0.5, stops }) {
  g.save();
  g.translate(cx * w, cy * h);
  g.scale(rx * w, ry * h);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, c] of stops) grad.addColorStop(at, c);
  g.fillStyle = grad;
  g.fillRect(-cx / rx, -cy / ry, 1 / rx, 1 / ry);
  g.restore();
}

/** 一張 w×h（CSS 像素）、每個 CSS 像素 s 個畫素的畫布，座標已經換成 CSS 像素。 */
function sheetOf(w, h, s) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w * s));
  cv.height = Math.max(1, Math.ceil(h * s));
  const g = cv.getContext('2d');
  g.scale(s, s);
  return { cv, g, w, h };
}

export class Film {
  /**
   * @param {number} width 影片的寬（畫素）
   * @param {number} height 影片的高
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.g = this.canvas.getContext('2d');
    /** 疊字要先畫在一張空白的上面再整張淡進來（字與它的影子一起透明）。 */
    this.scratch = document.createElement('canvas');
    this.scratch.width = width;
    this.scratch.height = height;
    const $ = (id) => document.getElementById(id);
    this.el = {
      view: $('view'), signpost: $('signpost'), bossbar: $('bossbar'), fade: $('fade'), dream: $('dream'),
      pad: $('pad'), story: $('story'), rails: [...document.querySelectorAll('.rail')],
    };
    /** 書頁 → { key, sheet }（紙＋標題＋頁碼）；「點一下翻頁」那一行；分格 → sheet。 */
    this._pages = new WeakMap();
    this._next = new WeakMap();
    this._cells = new WeakMap();
    /** 書頁 → 它變成 .ready 的那一刻（影片的時間）。 */
    this._ready = new WeakMap();
  }

  /** 每個 CSS 像素幾個畫素、畫面在影片裡的位置（畫面大小變了就置中、留黑邊）。 */
  _fit() {
    const w = innerWidth, h = innerHeight;
    const s = Math.min(this.width / w, this.height / h);
    return { w, h, s, ox: (this.width - w * s) / 2, oy: (this.height - h * s) / 2 };
  }

  /** 拍這一刻。`t` 是影片的時間（秒），「點一下翻頁」那一行的呼吸照它走。 */
  shoot(t) {
    const g = this.g, el = this.el, f = this._fit();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.width, this.height);
    g.setTransform(f.s, 0, 0, f.s, f.ox, f.oy);

    // GL（倒下醒來那一段是糊的）
    const blur = blurOf(el.view.style.filter);
    if (blur > 0.01 && FILTER) g.filter = `blur(${blur * f.s}px)`;
    g.drawImage(el.view, 0, 0, f.w, f.h);
    g.filter = 'none';

    g.drawImage(el.signpost, 0, 0, f.w, f.h);
    if (el.bossbar) {
      const r = el.bossbar.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) g.drawImage(el.bossbar, r.left, r.top, r.width, r.height);
    }
    if (el.fade.style.visibility === 'visible') {
      g.globalAlpha = +el.fade.style.opacity || 0;
      g.fillRect(0, 0, f.w, f.h);
      g.globalAlpha = 1;
    }
    if (el.dream && el.dream.style.visibility === 'visible') this._dream(f);
    this._rails(f);
    g.drawImage(el.pad, 0, 0, f.w, f.h);
    if (el.story && el.story.classList.contains('on')) this._story(f, t);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return this.canvas;
  }

  /** 倒下醒來的字：置中、字距、兩層影子，整行一起淡、一起糊（index.html 的 #dream）。 */
  _dream(f) {
    const d = this.el.dream, text = d.textContent;
    const a = +d.style.opacity || 0;
    if (!text || a <= 0) return;
    const cs = getComputedStyle(d);
    const sg = this.scratch.getContext('2d');
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, this.width, this.height);
    sg.setTransform(f.s, 0, 0, f.s, f.ox, f.oy);
    sg.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    sg.textBaseline = 'middle';
    sg.fillStyle = cs.color;
    const ls = parseFloat(cs.letterSpacing) || 0, indent = parseFloat(cs.textIndent) || 0;
    const chars = [...text], widths = chars.map((c) => sg.measureText(c).width);
    let x = (f.w - (indent + widths.reduce((s, v) => s + v + ls, 0))) / 2 + indent;
    for (const shadow of [{ blur: 18, y: 0, color: 'rgba(0, 0, 0, 0.55)' }, { blur: 4, y: 2, color: 'rgba(0, 0, 0, 0.5)' }, null]) {
      sg.shadowColor = shadow ? shadow.color : 'transparent';
      sg.shadowBlur = shadow ? shadow.blur * f.s : 0;
      sg.shadowOffsetY = shadow ? shadow.y * f.s : 0;
      let cx = x;
      chars.forEach((c, i) => { sg.fillText(c, cx, f.h / 2); cx += widths[i] + ls; });
    }
    sg.shadowColor = 'transparent';
    const g = this.g;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = a;
    const b = blurOf(d.style.filter);
    if (b > 0.01 && FILTER) g.filter = `blur(${b * f.s}px)`;
    g.drawImage(this.scratch, 0, 0);
    g.restore();
  }

  /** 操作列底下的陰影：從螢幕邊往中間淡掉（index.html 的 body[data-mode="game"] .rail::before）。 */
  _rails(f) {
    const g = this.g, port = document.body.classList.contains('pad-port');
    this.el.rails.forEach((rail, k) => {
      const r = rail.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      // 橫向：A 在左、B 在右；直向：A 在上、B 在下。都是螢幕邊那一頭最暗。
      const [x0, y0, x1, y1] = port
        ? (k === 0 ? [0, r.top, 0, r.bottom] : [0, r.bottom, 0, r.top])
        : (k === 0 ? [r.left, 0, r.right, 0] : [r.right, 0, r.left, 0]);
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = grad;
      g.fillRect(r.left, r.top, r.width, r.height);
    });
  }

  /* ── 書頁 ─────────────────────────────────────────────────────── */

  /** 兩張書頁照 z-index 由下往上貼。 */
  _story(f, t) {
    const pages = [...this.el.story.querySelectorAll('.page')]
      .filter((p) => p.style.visibility !== 'hidden')
      .sort((a, b) => (+a.style.zIndex || 0) - (+b.style.zIndex || 0));
    for (const page of pages) this._page(f, page, t);
  }

  /** 一張書頁：照它現在的 transform 貼紙，再貼每一格（各自的 transform）與「點一下翻頁」。 */
  _page(f, page, t) {
    const g = this.g;
    const art = this._art(page, f.s);
    const cs = getComputedStyle(page);
    const box = { x: page.offsetLeft, y: page.offsetTop, w: page.offsetWidth, h: page.offsetHeight };
    g.save();
    this._transform(g, box, cs);
    // 書頁往左投的影子（外面的 box-shadow）
    for (const sh of shadowsOf(cs.boxShadow)) {
      if (sh.inset) continue;
      g.save();
      g.shadowColor = sh.color;
      g.shadowBlur = sh.blur * f.s;
      g.shadowOffsetX = sh.x * f.s;
      g.shadowOffsetY = sh.y * f.s;
      g.fillStyle = PAPER.color;
      g.fillRect(0, 0, box.w, box.h);
      g.restore();
    }
    g.drawImage(art.paper.cv, 0, 0, box.w, box.h);
    for (const cell of art.cells) {
      const sheet = this._cells.get(cell.el);
      if (!sheet) continue;
      const ccs = getComputedStyle(cell.el);
      g.save();
      this._transform(g, cell, ccs);
      for (const sh of shadowsOf(ccs.boxShadow)) {
        if (sh.inset || sh.blur <= 0) continue;
        g.save();
        g.shadowColor = sh.color;
        g.shadowBlur = sh.blur * f.s;
        g.shadowOffsetX = sh.x * f.s;
        g.shadowOffsetY = sh.y * f.s;
        g.fillStyle = '#000';
        g.fillRect(0, 0, cell.w, cell.h);
        g.restore();
      }
      g.drawImage(sheet.cv, 0, 0, cell.w, cell.h);
      g.restore();
    }
    // 「點一下翻頁」：.ready 之後才浮出來、呼吸（CSS 的 transition 與 animation 照影片的時間算）
    const next = art.next;
    if (next) {
      if (!page.classList.contains('ready')) this._ready.delete(page);
      else {
        if (!this._ready.has(page)) this._ready.set(page, t);
        const u = t - this._ready.get(page);
        let a;
        if (u < NEXT.fadeIn) a = NEXT.peak * (1 - (1 - u / NEXT.fadeIn) ** 3);
        else {
          const p = ((u - NEXT.fadeIn) % NEXT.period) / NEXT.period;
          a = p < 0.5 ? NEXT.peak + (NEXT.low - NEXT.peak) * easeInOut(p * 2)
            : NEXT.low + (NEXT.peak - NEXT.low) * easeInOut((p - 0.5) * 2);
        }
        g.globalAlpha = a;
        g.drawImage(next.sheet.cv, next.x, next.y, next.sheet.w, next.sheet.h);
        g.globalAlpha = 1;
      }
    }
    g.restore();
  }

  /** 在 `box`（父層座標的左上角與大小）上套一個元素計算後的 transform（含 transform-origin）。 */
  _transform(g, box, cs) {
    const [ox, oy] = (cs.transformOrigin || '0px 0px').split(' ').map(parseFloat);
    g.translate(box.x + ox, box.y + oy);
    const m = matrixOf(cs.transform);
    g.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    g.translate(-ox, -oy);
  }

  /**
   * 一張書頁畫好的樣子：紙（含標題、頁碼）、「點一下翻頁」、每一格在頁面上的位置。換了內容
   * （標題、頁碼、分格）或畫面大小才重量重畫；每一格各自只畫一次。
   */
  _art(page, s) {
    const title = page.querySelector('.title'), folio = page.querySelector('.folio'), next = page.querySelector('.next');
    const cells = [...page.querySelectorAll('.panel-cell')];
    const key = [title.textContent, folio.textContent, next.textContent, page.offsetWidth, page.offsetHeight, s].join('|');
    let art = this._pages.get(page);
    if (art && art.key === key && cells.every((c) => this._cells.has(c)) && art.cells.length === cells.length
      && art.cells.every((c, i) => c.el === cells[i])) return art;

    // 量：暫時把書頁與分格的 transform 拿掉，量完放回去（這一頁藏著，沒有人看得到）。
    const saved = [page, ...cells].map((e) => [e, e.style.transform]);
    for (const [e] of saved) e.style.transform = 'none';
    try {
      const pr = page.getBoundingClientRect();
      const local = (r) => ({ x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height });
      const paper = sheetOf(pr.width, pr.height, s);
      this._paper(paper.g, pr.width, pr.height, getComputedStyle(page));
      for (const e of [title, folio]) this._paint(paper.g, e, pr.left, pr.top);
      const nr = next.getBoundingClientRect();
      const nextSheet = sheetOf(nr.width, nr.height, s);
      this._paint(nextSheet.g, next, nr.left, nr.top, true);
      const placed = cells.map((c) => ({ el: c, ...local(c.getBoundingClientRect()) }));
      for (const c of placed) {
        if (this._cells.has(c.el)) continue;
        const r = c.el.getBoundingClientRect();
        const sheet = sheetOf(r.width, r.height, s);
        if (this._paint(sheet.g, c.el, r.left, r.top)) this._cells.set(c.el, sheet);
      }
      art = { key, paper, cells: placed, next: { sheet: nextSheet, ...local(nr) } };
      this._pages.set(page, art);
    } finally {
      for (const [e, v] of saved) e.style.transform = v;
    }
    return art;
  }

  /** 紙：底色、細直紋、兩團暈、四邊壓暗（裡面的 box-shadow）、左緣的紙邊。 */
  _paper(g, w, h, cs) {
    const vmax = Math.max(innerWidth, innerHeight) / 100;
    g.fillStyle = PAPER.color;
    g.fillRect(0, 0, w, h);
    const L = PAPER.lines;
    g.fillStyle = L.color;
    for (let x = 0; x < w; x += L.every) g.fillRect(x, 0, L.width, h);
    for (const glow of [...PAPER.glows].reverse()) {
      ellipseFill(g, w, h, { ...glow, stops: [[0, glow.color], [glow.stop, 'rgba(0, 0, 0, 0)'], [1, 'rgba(0, 0, 0, 0)']] });
    }
    for (const sh of shadowsOf(cs.boxShadow)) {
      if (!sh.inset) continue;
      // 裡面的影子：在紙外面圍一圈，只讓它的影子落進紙裡。
      g.save();
      g.beginPath();
      g.rect(0, 0, w, h);
      g.clip();
      g.beginPath();
      g.rect(-w, -h, w * 3, h * 3);
      g.rect(0, 0, w, h);
      const k = g.getTransform().a;
      g.shadowColor = sh.color;
      g.shadowBlur = sh.blur * k;
      g.fillStyle = '#000';
      g.fill('evenodd');
      g.restore();
    }
    const E = PAPER.edge, ew = E.width * vmax;
    const grad = g.createLinearGradient(0, 0, ew, 0);
    for (const [at, c] of E.stops) grad.addColorStop(at, c);
    g.fillStyle = grad;
    g.fillRect(0, 0, ew, h);
  }

  /**
   * 照 DOM 把 `root` 這一塊畫進 g（g 的原點是 root 在畫面上的左上角 (ox, oy)）：每一個元素的底色、
   * 框、圖，每一個字。`bare` 是不管 root 自己的透明度（「點一下翻頁」那一行：CSS 平常讓它透明，
   * 透明度由 _page 照影片的時間另外給）。
   * 有圖還沒載好就回傳 false（這一格下一幀再畫）。
   */
  _paint(g, root, ox, oy, bare = false) {
    let done = true;
    const walk = (el, alpha) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const a = alpha * (el === root && bare ? 1 : +cs.opacity);
      const rects = cs.display === 'inline' ? [...el.getClientRects()] : [el.getBoundingClientRect()];
      g.save();
      g.globalAlpha = a;
      for (const r of rects) this._box(g, el, cs, { x: r.left - ox, y: r.top - oy, w: r.width, h: r.height });
      if (el.tagName === 'IMG') done = this._img(g, el, cs, rects[0], ox, oy) && done;
      if (cs.overflow === 'hidden' && rects[0]) {
        const r = rects[0], bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
        const br = parseFloat(cs.borderRightWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0;
        g.beginPath();
        g.rect(r.left - ox + bl, r.top - oy + bt, r.width - bl - br, r.height - bt - bb);
        g.clip();
      }
      for (const node of el.childNodes) {
        if (node.nodeType === 3) this._text(g, node, el, cs, ox, oy);
        else if (node.nodeType === 1) walk(node, a);
      }
      if (el.tagName === 'Q' && cs.quotes !== 'none') this._quotes(g, el, cs, ox, oy);
      g.restore();
    };
    walk(root, 1);
    return done;
  }

  /** 一個元素的底色與框（回憶那一格的底是暈開的）。 */
  _box(g, el, cs, r) {
    if (el.classList.contains('memory') && el.classList.contains('panel-cell')) {
      g.save();
      g.translate(r.x, r.y);
      ellipseFill(g, r.w, r.h, MEMORY.back);
      g.restore();
    } else if (!clear(cs.backgroundColor)) {
      g.fillStyle = cs.backgroundColor;
      g.fillRect(r.x, r.y, r.w, r.h);
    }
    const sides = [
      [cs.borderTopWidth, cs.borderTopColor, (b) => [r.x, r.y, r.w, b]],
      [cs.borderBottomWidth, cs.borderBottomColor, (b) => [r.x, r.y + r.h - b, r.w, b]],
      [cs.borderLeftWidth, cs.borderLeftColor, (b) => [r.x, r.y, b, r.h]],
      [cs.borderRightWidth, cs.borderRightColor, (b) => [r.x + r.w - b, r.y, b, r.h]],
    ];
    for (const [width, color, at] of sides) {
      const b = parseFloat(width) || 0;
      if (b <= 0 || clear(color)) continue;
      g.fillStyle = color;
      g.fillRect(...at(b));
    }
  }

  /** 一張圖：object-fit: cover、object-position，CSS 的 filter；回憶那一格的圖邊緣暈掉。 */
  _img(g, img, cs, r, ox, oy) {
    if (!r || !img.complete || !img.naturalWidth) return false;
    const x = r.left - ox, y = r.top - oy, w = r.width, h = r.height;
    const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
    const [px, py] = (cs.objectPosition || '50% 50%').split(/\s+/);
    const dx = x + (w - dw) * placeOf(px, w - dw), dy = y + (h - dh) * placeOf(py, h - dh);
    const memory = !!img.closest('.memory');
    if (!memory && (!FILTER || cs.filter === 'none')) {
      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();
      g.drawImage(img, dx, dy, dw, dh);
      g.restore();
      return true;
    }
    // 有 filter 或要暈邊：先畫在一張自己的上面，再整張貼過去。
    const s = g.getTransform().a;
    const tmp = sheetOf(w, h, s);
    if (FILTER && cs.filter !== 'none') tmp.g.filter = cs.filter;
    tmp.g.drawImage(img, dx - x, dy - y, dw, dh);
    tmp.g.filter = 'none';
    if (memory) {
      tmp.g.globalCompositeOperation = 'destination-in';
      ellipseFill(tmp.g, w, h, MEMORY.mask);
    }
    g.drawImage(tmp.cv, x, y, w, h);
    return true;
  }

  /** 字型的 CSS 縮寫。 */
  _font(cs) {
    return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  }

  /** 字的影子（text-shadow 的每一層）：分格裡的字壓在圖上，靠一圈紙色的描邊讀得到。 */
  _shadow(cs) {
    const sh = cs.textShadow && cs.textShadow !== 'none' ? shadowsOf(cs.textShadow) : [];
    return sh.length ? sh : null;
  }

  /** 一個文字節點：一個字一個字量出排好的位置，照那裡寫。 */
  _text(g, node, el, cs, ox, oy) {
    const text = node.data;
    if (!text.trim()) return;
    g.font = this._font(cs);
    g.fillStyle = cs.color;
    g.textBaseline = 'alphabetic';
    const shadows = this._shadow(cs);
    const range = document.createRange();
    for (let i = 0; i < text.length;) {
      const ch = String.fromCodePoint(text.codePointAt(i)), n = ch.length;
      if (ch.trim()) {
        range.setStart(node, i);
        range.setEnd(node, i + n);
        const r = range.getClientRects()[0];
        if (r) this._glyph(g, ch, r.left - ox, r.top - oy, r.height, shadows);
      }
      i += n;
    }
  }

  /** 一個字寫在那一格裡：字身（ascent + descent）在格子裡置中。 */
  _glyph(g, ch, x, top, height, shadows) {
    const m = g.measureText(ch);
    const asc = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent, desc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
    const y = top + (height + asc - desc) / 2;
    if (shadows) {
      const k = g.getTransform().a;
      g.save();
      for (const sh of shadows) {
        g.shadowColor = sh.color;
        g.shadowBlur = sh.blur * k;
        g.shadowOffsetX = sh.x * k;
        g.shadowOffsetY = sh.y * k;
        g.fillText(ch, x, y);
      }
      g.restore();
    }
    g.fillText(ch, x, y);
  }

  /** <q> 的引號（CSS 的 quotes，產生的字不在文字節點裡）：寫在第一個字前面、最後一個字後面。 */
  _quotes(g, el, cs, ox, oy) {
    const q = cs.quotes.match(/"([^"]*)"/g)?.map((v) => v.slice(1, -1));
    if (!q || q.length < 2) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    if (!rects.length) return;
    g.font = this._font(cs);
    g.fillStyle = cs.color;
    g.textBaseline = 'alphabetic';
    const ls = parseFloat(cs.letterSpacing) || 0, shadows = this._shadow(cs);
    const first = rects[0], last = rects[rects.length - 1];
    const ow = g.measureText(q[0]).width + ls;
    this._glyph(g, q[0], first.left - ox - ow, first.top - oy, first.height, shadows);
    this._glyph(g, q[1], last.right - ox, last.top - oy, last.height, shadows);
  }
}
