/* ── test/src/pad.js ────────────────────────────────────────────
   螢幕手把，照搬遊戲的那一套。

   來源是 `public/src/pad.js`：橫向的時候兩側各一根直欄，上半段是儀表板、
   下半段是操作元件，中間那一整片永遠留給遊戲——那個功能的全部意義就在
   那片乾淨。這一頁照搬的是同一件事：

     幾何   `layout()` 的每一個數字都是那邊的：
            rail = clamp(min(W·0.155, H·0.44), 96, 190)、
            iw = min(rail − 18, 168)、
            直向的 barT / barB、觸控區從 min(cy − boxH/2 − 28, H·0.5) 開始。
            算好的 rail / barT / barB / ctrl / zone 由 controls.js 寫進 CSS
            變數，DOM 的面板與畫布上的操作元件因此永遠對齊在同一條列裡。
     外觀   「靜如儀器、動如水」：沒被碰的時候只有幾條薄荷細線和一個空心
            旋鈕；手指一按上去就液化成水球，用的是 `touch.js` 的
            `waveAt()` 與 `tint()`。`blobPath`、`fillLiquid`、水花與所有
            彈簧常數都是那邊的原文——那些數字就是這個操作介面的長相，
            重新調一次只會調出一個像的東西。
     手感   旋鈕固定不浮動，軸值是「手指相對搖桿中心」而不是相對按下的
            那一點，所以按在觸控區的哪裡就已經在推了，不必先滑到旋鈕上。
            死區 0.12、推到可動範圍的 0.86 就滿速，都照抄。

   ── 唯一的差別：軸從一維變二維 ────────────────────────────────────
   跑酷是橫向的，所以那邊的搖桿是一條橫躺的膠囊軌道，軸只有 x。這一頁
   是 3D，要八個方向，所以軌道改成圓的：

     · 軌道是一個圓（同樣的深底 + 薄荷細線），端點靶標從兩個變四個，
       靜止時的中線刻度變成一個十字。
     · 旋鈕可動範圍是「圓心到軌道內緣」，軸夾在單位圓裡——夾方的話對角
       線長 1.41，斜著跑會比直著跑快 41%。
     · 推桿量不是一道從圓心拖到旋鈕的水痕，是一片鋪滿整個軌道的放射漸層，
       圓心就在旋鈕的中心：推到哪裡，那裡最亮。

   跳躍鍵一個像素都沒動：細環儀器、按下鼓成水滴、炸出水花、向上的箭頭。

   ── 顏色 ──────────────────────────────────────────────────────────
   遊戲那邊是葉綠（touch.js 的 tint）；這裡搖桿與跳躍鍵都是靈魂的顏色，色階的走法一樣
   （白 → 那一色，張力越大越濃）：
     按著    靈魂的藍灰（monster.js 的 GHOST.face：幽靈、倒下浮起來的那一隻的臉色）。
     靜止    細線、靶標、空心的旋鈕與鍵、鍵上的圖案、水花是靈魂身上的淡冰藍（GHOST.body），
             軌道與鍵的底是壓暗的藍灰。
   ------------------------------------------------------------------ */

import { waveAt } from '../../src/touch.js';

/** 按著的顏色：靈魂的藍灰，monster.js 的 GHOST.face（0.34, 0.44, 0.60）換成 0～255。 */
const SOUL = [87, 112, 153];
/** 靜止時的細線、靶標、空心的旋鈕與鍵、圖案、水花：靈魂身上那一層淡冰藍（monster.js 的 GHOST.body）。 */
const SOUL_PALE = [199, 224, 250];
/** 軌道與鍵的底：壓暗的藍灰。 */
const SOUL_DEEP = [16, 20, 30];

/** 白 → col，張力 t 越大越濃。touch.js 的 tint 同一條色階，只換了終點的顏色。 */
function tint(t, a, col = SOUL) {
  const k = t * t;
  const c = col.map((v) => Math.round(255 + (v - 255) * k));
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
const solid = (col, a) => `rgba(${col[0]},${col[1]},${col[2]},${a})`;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 死區與滿速門檻，跟遊戲的手把一樣。 */
const DEADZONE = 0.12;
const THROW = 0.86;
/* 彈簧一步最長這麼久。這幾條彈簧是半隱式歐拉積分的，旋鈕跟手那一條
   （k 900、阻尼 46）一步超過約 1/31 秒就發散：手機一掉到 30 幀以下，旋鈕
   每幀往反方向甩得更遠，畫的時候又被夾回圈上，看起來就是旋鈕在圈邊左右
   甩、在對角之間閃；幀率回來之後還要一兩秒才收得回來。拆成小步積分，
   手感就跟幀率無關。 */
const SPRING_DT = 1 / 120;
/* 跳躍鍵的圖案一離開箭頭（換成刀、托著靈魂的手），那顆水就一直晃到換回箭頭為止：跟長按的時候
   一模一樣——同一個踢、同一條液化與按壓的彈簧、同一個擾動——像一直被按著，換回箭頭才放開，只是不經過
   指標：不排跳、不回報、bOn 不變。不限時，變化多久就晃多久。 */
export const REST_ICON = 'arrow';

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/* 閒置擾動 + 朝某個方向的鼓起 + 收斂的行進波。src/pad.js 的原文。 */
function blobPath(cx, cy, r, tilt, pull, t, ph, wa) {
  const N = 44;
  const xs = new Float32Array(N), ys = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const th = (i / N) * TAU;
    let k = 1
      + 0.026 * Math.sin(3 * th + ph[0] + 1.30 * t)
      + 0.020 * Math.sin(5 * th + ph[1] - 0.95 * t)
      + 0.014 * Math.sin(7 * th + ph[2] + 2.05 * t);
    const d = angDiff(th, tilt);
    const face = Math.cos(d);
    k += pull * (0.26 * Math.pow(Math.max(0, face), 1.5) - 0.09 * Math.max(0, -face));
    const env = 0.3 + 0.7 * Math.pow(Math.cos(d * 0.5), 2);
    k += wa * waveAt(Math.abs(d), t) * env;
    xs[i] = cx + Math.cos(th) * r * k;
    ys[i] = cy + Math.sin(th) * r * k;
  }
  const p = new Path2D();
  p.moveTo((xs[N - 1] + xs[0]) / 2, (ys[N - 1] + ys[0]) / 2);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    p.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2);
  }
  p.closePath();
  return p;
}

/* 水的菲涅耳 + 高光。src/pad.js 的 fillLiquid 原文。 */
function fillLiquid(ctx, p, cx, cy, r, tn, glow, col = SOUL) {
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.34, r * 0.08, cx, cy, r * 1.05);
  g.addColorStop(0, 'rgba(255,255,255,0.26)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.82, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, tint(tn, 0.3, col));
  ctx.fillStyle = g;
  ctx.fill(p);

  ctx.save();
  ctx.clip(p);
  const hx = cx - r * 0.34, hy = cy - r * 0.4;
  const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.55);
  hg.addColorStop(0, 'rgba(255,255,255,0.4)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
  ctx.restore();

  ctx.lineWidth = 1.6;
  ctx.strokeStyle = tint(tn, 0.5 + 0.35 * tn, col);
  ctx.shadowColor = tint(tn, 0.45, col);
  ctx.shadowBlur = glow;
  ctx.stroke(p);
  ctx.shadowBlur = 0;
}

/**
 * 靈魂的剪影：實心、一條尾巴，直直立著（使用者在調整工具裡一點一點調出來的那一版，數字照抄）。底下
 * 是一大塊胖胖的身體——底邊是一段平的直線（底邊左、底邊右兩點同高，y 0.85，左右對稱在 x = 0 兩邊），
 * 兩頭斜斜往上接到左下、右下；左邊往上收、腰上凹一下；右邊往上到一個肩。身體的頂從肩往左上斜進去，
 * 冒出一條尾巴：先往右上斜、折一下再往左上衝，收在最上面一個尖（圓角最小、整圈最尖的那一個轉折）；
 * 尾巴的左緣也跟著折一下（往右下凹進去、再往左下斜出到身體）——像一撮火、一縷魂。全是直邊，每一個
 * 轉折都倒圓角（roundPath 的 [x, y, 圓角半徑]），沒有一段是畫出來的圓弧；尾巴尖也只是一個圓角。
 * path 是一圈：從左下往底邊左斜下去的那一段上出發、繞回同一點（頭尾兩點不用半徑）。y 朝下。
 *   base  底邊那一段的兩頭是 path 的第幾點（底邊左、底邊右）：整個圖案最後照它的正中左右置中。
 *   body  擺的時候量「身體」左右到哪的那一條水平線（使用者挑的 −0.5：左邊切在尾巴左緣斜出來的那一段、
 *         右邊切在肩到尾巴根那一段，各一刀）。只在算放大倍數（fit）的時候用，見 GIVE。
 */
export const SOUL_SHAPE = {
  path: [
    [-0.55, 0.625],
    [-0.35, 0.85, 0.25],                // 底邊左
    [0.35, 0.85, 0.25],                 // 底邊右
    [0.75, 0.35, 0.15],                 // 右下
    [0.5, -0.2, 0.1],                   // 肩
    [0.1, -0.55, 0.1],                  // 尾巴根（往裡凹）
    [0.25, -0.75, 0.1],                 // 尾巴右折
    [-0.05, -1.1, 0.05],                // 尾巴尖
    [-0.1, -0.8, 0.1],                  // 尾巴左折（往裡凹）
    [-0.5, -0.4, 0.1],                  // 尾巴左斜出來接身體
    [-0.4, -0.08, 0.1],                 // 腰（往裡凹）
    [-0.75, 0.4, 0.15],                 // 左下
    [-0.55, 0.625],
  ],
  base: [1, 2],
  body: -0.5,
};

/**
 * 一條折線，中間每一個頂點都倒成圓角：pts 是 [x, y, 圓角半徑]（以 u 為單位），頭尾兩點不用半徑。
 * 接在目前的路徑上（先 beginPath）。
 */
function roundPath(g, u, pts) {
  g.moveTo(pts[0][0] * u, pts[0][1] * u);
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y, rad] = pts[i], [nx, ny] = pts[i + 1];
    g.arcTo(x * u, y * u, nx * u, ny * u, rad * u);
  }
  const [lx, ly] = pts[pts.length - 1];
  g.lineTo(lx * u, ly * u);
}

/* ── 交靈魂的圖案的擺法（都以 r：鍵的半徑為單位）──────────────────────────
   HAND   那隻手：點是以 0.92·r（unit）為單位、[x, y, 圓角半徑]；實心，外面再描一圈 lw 寬。tilt 是 0：
          掌心那一條線是水平的。從右下伸進來，在離圓心 clip（0.9）的那一圈被切掉——鍵的邊緣留 0.1 的
          空白，切口照著那一圈的弧走。沿著手的方向（水平）滑到那一圈剛好切在右邊那根指頭（立著的
          拇指）的根部外緣：圈裡只剩手掌、手指與那根指頭。x 由這一條算（placeHand）。y 是定死的：
          原本那一版（托著狗頭的時候）挑出來的那一個——當時挑「狗頭對在露出來的手正中、整顆留在 clip
          那一圈裡」的最高那一個，二分出來是 0.42386165518237606。fit 的時候手釘在那裡（換靈魂也不動）；
          fit 完，整個圖案置中的時候手才跟著靈魂一起左右平移 dx（見下面 SOUL_ICON 的第 2 步）。
   SOUL_ICON 靈魂：SOUL_SHAPE 放大 k 倍。分兩步，先 fit、再 shift：
          1. fit（定 k）：手在上面那個位置不動。靈魂的 y 擺到最低的那一點（含線寬）比手最高的那一點（拇指
             的尖，含線寬）再高 gap，看起來是浮在手上面；x 擺到身體（剪影在 SOUL_SHAPE.body 那一條水平線
             上的那一段）的左右正中對在鍵的直中線（x = 0）上。k 挑這樣擺得下的最大那一個：整顆（含線寬）
             剛好還在 clip 那一圈裡——k 越大，底邊釘在手上面、頭頂越往上衝出鍵外。body 那一條線只在這一步用。
          2. shift（置中）：k 與靈魂、手兩個之間的相對位置都照 fit 的不動，整個圖案（靈魂與手一起）左右平移
             同一段 dx，讓靈魂平的底邊（SOUL_SHAPE.base 那兩點）的正中落在鍵的直中線（x = 0）上。clip 那一圈
             是鍵的邊緣、不跟著動，所以手切在哪裡跟著變（不再剛好切在拇指的根部）；靈魂平移之後離圓心最遠
             的那一筆也可能不再剛好是 clip——不再縮放，照實記在 GIVE.soulReach。
   GIVE   算好的擺法與量出來的幾個數（模組載入時算一次）：hand、soul 是平移之後（畫出來的）的位置，
          fit 是平移之前的，shift 是那一段 dx。 */
const HAND = {
  tilt: 0, unit: 0.92, lw: 0.07, clip: 0.9, root: 1, y: 0.42386165518237606,
  path: [
    [0.46, 0.33],                       // 手臂上緣（從右下伸進來，圈外切掉）
    [0.31, 0.24, 0.07],                 // 手腕接拇指：拇指的根部（root），切口切在這裡的外緣
    [0.26, 0.06, 0.035],                // 拇指的尖：右邊那一側往裡收，拇指是上窄下寬的梯形，尖是圓角矩形
    [0.15, 0.06, 0.035],
    [0.15, 0.21, 0.05],                 // 拇指接掌心
    [-0.43, 0.21, 0.035],               // 掌心、手指平平地往左伸出去，指尖是圓角矩形
    [-0.43, 0.40, 0.035],
    [0.08, 0.46, 0.12],                 // 掌根接手臂
    [0.46, 0.61],                       // 手臂下緣（圈外切掉）
  ],
};
const SOUL_ICON = { lw: 0.05, gap: 0.08 };

/** 靈魂畫出來的外框（含倒圓角的弧），攤平成 [x, y, x, y, …]，SOUL_SHAPE 的單位。 */
export const SOUL_OUTLINE = filletPoints(SOUL_SHAPE.path).slice(0, -1).flat();

/**
 * 身體左右到哪（SOUL_SHAPE 的單位）：外框跟 body 那一條水平線交在哪幾點，取最左與最右。
 * 那一條只碰到外框兩次（左右各一刀），尾巴尖整個在它上面。只在 fit 用。
 */
export function bodySpan() {
  const o = SOUL_OUTLINE, y = SOUL_SHAPE.body, xs = [];
  for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [o[i], o[i + 1], o[j], o[j + 1]];
    if ((yi > y) !== (yj > y)) xs.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
  }
  return [Math.min(...xs), Math.max(...xs)];
}

/**
 * roundPath 畫出來的那條線上的點（倒圓角的弧取樣），單位跟 pts 一樣。arcTo 的幾何：頂點 P 兩邊的
 * 方向夾角 2θ，切點離 P 是 rad / tan θ，圓心在角平分線上離 P rad / sin θ。
 */
function filletPoints(pts, steps = 12) {
  const out = [pts[0].slice(0, 2)];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py, rad] = pts[i];
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i + 1];
    const l1 = Math.hypot(ax - px, ay - py), l2 = Math.hypot(bx - px, by - py);
    const d1 = [(ax - px) / l1, (ay - py) / l1], d2 = [(bx - px) / l2, (by - py) / l2];
    const th = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1]))) / 2;
    const t = rad / Math.tan(th), h = rad / Math.sin(th);
    const m = [d1[0] + d2[0], d1[1] + d2[1]], ml = Math.hypot(...m);
    const cx = px + (m[0] / ml) * h, cy = py + (m[1] / ml) * h;
    const a0 = Math.atan2(py + d1[1] * t - cy, px + d1[0] * t - cx);
    let a1 = Math.atan2(py + d2[1] * t - cy, px + d2[0] * t - cx);
    while (a1 - a0 > Math.PI) a1 -= TAU;
    while (a1 - a0 < -Math.PI) a1 += TAU;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + ((a1 - a0) * k) / steps;
      out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
  }
  out.push(pts[pts.length - 1].slice(0, 2));
  return out;
}

/** 手畫出來的每一點（含倒圓角的弧，直線段也切細），擺在 (x, y)，單位 r。 */
function handPoints(x = HAND.x, y = HAND.y) {
  const cs = Math.cos(HAND.tilt), sn = Math.sin(HAND.tilt);
  const f = filletPoints(HAND.path), out = [];
  for (let i = 0; i < f.length; i++) {
    const [ax, ay] = f[i], [bx, by] = f[Math.min(i + 1, f.length - 1)];
    for (let k = 0; k < 8; k++) {
      const px = (ax + ((bx - ax) * k) / 8) * HAND.unit, py = (ay + ((by - ay) * k) / 8) * HAND.unit;
      out.push([x + px * cs - py * sn, y + px * sn + py * cs]);
    }
  }
  return out;
}

/** 手擺在高度 y 的時候，x 要多少：拇指根部的外緣剛好落在 clip 那一圈上（掌心水平，外緣往右 lw/2）。 */
function placeHand(y) {
  const [rx, ry] = HAND.path[HAND.root];
  const yy = y + ry * HAND.unit;
  return Math.sqrt(HAND.clip * HAND.clip - yy * yy) - rx * HAND.unit - HAND.lw / 2;
}

/**
 * 靈魂放大 k 倍、底邊釘在拇指的尖（top，含線寬）上面 gap、身體正中對在 x = 0 的時候擺在哪：
 * 回傳 (x, y)、離圓心最遠的那一筆（reach，含線寬）、最高與最低到哪（含線寬）。
 */
function soulAt(k, top) {
  const o = SOUL_OUTLINE, oy = o.filter((_, i) => i % 2 === 1), [bl, br] = bodySpan();
  const x = -((bl + br) / 2) * k, y = top - SOUL_ICON.gap - (Math.max(...oy) * k + SOUL_ICON.lw / 2);
  return {
    x, y, reach: soulReach(x, y, k),
    top: y + Math.min(...oy) * k - SOUL_ICON.lw / 2, low: y + Math.max(...oy) * k + SOUL_ICON.lw / 2,
  };
}

/** 靈魂擺在 (x, y)、放大 k 倍的時候，離圓心最遠的那一筆（含線寬）。 */
function soulReach(x, y, k) {
  const o = SOUL_OUTLINE;
  let far = 0;
  for (let i = 0; i < o.length; i += 2) far = Math.max(far, Math.hypot(x + o[i] * k, y + o[i + 1] * k));
  return far + SOUL_ICON.lw / 2;
}

export const GIVE = (() => {
  // ── 1. fit ── 手：y 定死（見 HAND），x 照切口算；拇指的尖最高到哪（含線寬）。
  const fitX = placeHand(HAND.y), pad = HAND.lw / 2;
  const thumb = Math.min(...handPoints(fitX, HAND.y).map(([, py]) => py)) - pad;
  // 靈魂擺得下的最大那一個 k：身體置中的時候整顆剛好在 clip 那一圈裡。二分（k 越大，頭頂越往鍵外衝）。
  let lo = 0, hi = 2;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (soulAt(m, thumb).reach > HAND.clip) hi = m; else lo = m;
  }
  const k = lo, S = soulAt(k, thumb), [bl, br] = bodySpan();
  // rootR：fit 的時候拇指根部的外緣離圓心多遠（就是切口那一圈）。
  const [rx, ry] = HAND.path[HAND.root];
  const rootR = Math.hypot(fitX + rx * HAND.unit + HAND.lw / 2, HAND.y + ry * HAND.unit);

  // ── 2. shift ── 靈魂與手一起左右平移 dx：底邊（base 那兩點）的正中落在 x = 0。k、y、兩個之間的相對位置不動。
  const [ia, ib] = SOUL_SHAPE.base, P = SOUL_SHAPE.path;
  const dx = -(S.x + ((P[ia][0] + P[ib][0]) / 2) * k);
  HAND.x = fitX + dx;
  SOUL_ICON.k = k; SOUL_ICON.x = S.x + dx; SOUL_ICON.y = S.y;
  // 平移之後露出來的手（clip 那一圈裡、含線寬）左右上下到哪；靈魂離圓心最遠的那一筆。
  const seen = handPoints(HAND.x, HAND.y).filter(([px, py]) => Math.hypot(px, py + pad) <= HAND.clip);
  const sx = seen.map(([px]) => px), sy = seen.map(([, py]) => py);
  return {
    hand: { x: HAND.x, y: HAND.y, tilt: HAND.tilt, clip: HAND.clip,
      seen: [Math.min(...sx) - pad, Math.min(...sy) - pad, Math.max(...sx) + pad, Math.max(...sy) + pad] },
    soul: { x: SOUL_ICON.x, y: S.y, k, base: SOUL_ICON.x + ((P[ia][0] + P[ib][0]) / 2) * k },
    shift: dx,
    // fit：平移之前。body 是身體那一段（剛好左右對稱在 x = 0），reach 剛好是 clip。
    fit: { hand: { x: fitX, y: HAND.y }, soul: { x: S.x, y: S.y, body: [S.x + bl * k, S.x + br * k] }, reach: S.reach },
    // soulReach：平移之後靈魂離圓心最遠的那一筆（含線寬）；不超過 clip 的話鍵的邊緣也留著 0.1 的空白。
    // clear：靈魂最低的那一點與手最高的那一點之間空多少（都含線寬；一起平移，不變）。
    // top：靈魂最高到哪；bottom：露出來的手最低到哪（都含線寬）。
    soulReach: soulReach(SOUL_ICON.x, S.y, k), clear: thumb - S.low, rootR, top: S.top,
    bottom: Math.max(...sy) + pad,
  };
})();

/** 圖案的小畫布半邊多寬（r）：至少是鍵的半徑，交靈魂的靈魂伸出去的話照它（平移之後的）再留一點。 */
const GLYPH_HALF = Math.max(1, GIVE.soulReach) + 0.02;

/* ── 跳躍鍵上的圖案 ─────────────────────────────────────────────
   每一個都以鍵的圓心為 (0, 0)、用 r（鍵的半徑）量，畫在 _glyph 給的那張小畫布上（筆的顏色、
   圓頭圓角已經設好）。 */
const GLYPHS = {
  /** 向上的箭頭：跳。 */
  arrow(g, r) {
    const q = r * 0.30;
    g.lineWidth = Math.max(2, r * 0.09);
    g.beginPath();
    g.moveTo(-q, q * 0.45);
    g.lineTo(0, q * 0.45 - q * 0.95);
    g.lineTo(q, q * 0.45);
    g.moveTo(0, q * 0.45 - q * 0.8);
    g.lineTo(0, q * 0.45 + q * 0.62);
    g.stroke();
  },

  /** 往右上斜指的刀：第二、三段攻擊。 */
  sword(g, r) {
    /* 刀的座標：u 沿著刀身（往刀尖），v 橫過刀身；整把轉 −45°，刀尖朝右上。斜擺的刀比箭頭
       細，放大一點才跟箭頭一樣搶眼。v 是對稱的；u 從柄頭的外緣到刀尖，取那一段的中點對在
       圓心上，整把刀的外框就置中。 */
    const q = r * 0.42;
    const thin = Math.max(1.6, r * 0.07), thick = Math.max(2, r * 0.09);
    const w = q * 0.17, guard = -q * 0.35, tip = q * 1.08, pommel = -q * 0.93, knob = q * 0.1;
    const mid = (tip + thin / 2 + pommel - knob - thick / 2) / 2;
    g.rotate(-Math.PI / 4);
    g.translate(-mid, 0);
    g.lineWidth = thin;
    g.beginPath();                                     // 刀身：兩條刃、斜切的刀尖
    g.moveTo(guard, -w);
    g.lineTo(q * 0.78, -w);
    g.lineTo(tip, 0);
    g.lineTo(q * 0.78, w);
    g.lineTo(guard, w);
    g.closePath();
    g.stroke();
    g.lineWidth = thick;
    g.beginPath();
    g.moveTo(guard, -q * 0.46);                        // 護手
    g.lineTo(guard, q * 0.46);
    g.moveTo(guard, 0);                                // 刀柄
    g.lineTo(pommel + knob, 0);
    g.stroke();
    g.beginPath();                                     // 柄頭
    g.arc(pommel, 0, knob, 0, TAU);
    g.stroke();
  },

  /**
   * 交靈魂：一隻從右下伸進來（HAND，在離圓心 0.9 的那一圈切掉）、掌心朝上托著的手，上面浮著一顆靈魂（SOUL_SHAPE、
   * SOUL_ICON：實心、立著，一條尾巴往上衝）。手跟靈魂一樣是實心的：兩隻指頭——靠手腕立著的拇指、往左平平伸出去
   * 的手指——拇指與掌心是一個托；拇指是上窄下寬的梯形，兩個指尖都是圓角矩形（平的頭、圓的角），手腕接拇指、拇指接掌心、
   * 手指接掌根、掌根接手臂，每一個轉折都倒圓角（roundPath），沒有一個尖角。靈魂也是同一種畫法：直邊、圓角轉折。
   */
  give(g, r) {
    g.lineWidth = r * HAND.lw;
    g.save();
    g.beginPath();
    g.arc(0, 0, HAND.clip * r, 0, TAU);                             // 鍵的邊緣留 0.1 的空白，手在這一圈切掉
    g.clip();
    g.translate(HAND.x * r, HAND.y * r);
    g.rotate(HAND.tilt);
    g.fillStyle = g.strokeStyle;
    g.beginPath();
    roundPath(g, r * HAND.unit, HAND.path);
    g.closePath();                                                  // 手腕那一頭接起來（在圈外，切掉）
    g.fill();                                                       // 實心，跟靈魂一樣
    g.stroke();                                                     // 外面描一圈：外緣跟原本那條線的外緣一樣
    g.restore();

    g.save();
    g.translate(SOUL_ICON.x * r, SOUL_ICON.y * r);
    g.fillStyle = g.strokeStyle;
    g.lineWidth = r * SOUL_ICON.lw;                                 // 描一圈，跟手一樣
    g.beginPath();
    roundPath(g, r * SOUL_ICON.k, SOUL_SHAPE.path);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  },
};

/** 跳躍鍵畫得出來的圖案。 */
export const ICONS = Object.keys(GLYPHS);

/**
 * 跳躍鍵這一幀畫哪一個：在倒下的國王身邊（give：長按就是交靈魂）是托著靈魂的手，第二、三段攻擊
 * 的那一段（striking）是刀，其餘是箭頭。國王倒下之後才交得了，兩個本來就不會同時成立；真的同時
 * 的話交靈魂優先——那時候按跳不出招（模式不交給連段）。
 */
export const iconOf = ({ give = false, striking = false } = {}) => (give ? 'give' : striking ? 'sword' : 'arrow');

export class Pad {
  /**
   * @param {HTMLCanvasElement} canvas 操作層那張 2D 畫布
   * @param {{onJump:()=>void}} [opts]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onJump = opts.onJump || (() => {});
    this.t = 0;

    /** 給外面讀的：圓形的二維軸，長度 ≤ 1。 */
    this.axis = { x: 0, y: 0 };
    this.mag = 0;

    // 搖桿
    this.jOn = false; this.jPid = null;
    this.jTx = 0; this.jTy = 0;          // 旋鈕目標（−1..1，含死區內的微量）
    this.jKx = 0; this.jKy = 0;          // 旋鈕視覺位置
    this.jKvx = 0; this.jKvy = 0;        // …與它的彈簧速度
    this.jLiq = 0;                       // 0 = 儀器環，1 = 液化
    this.jPh = [0, 0, 0];

    // 跳躍鍵
    this.bOn = false; this.bPid = null;
    this.bPress = 0; this.bPressv = 0;
    this.bLiq = 0;
    this.bPh = [0, 0, 0];
    this.drops = [];
    this._queued = false;
    /** 跳躍鍵上畫什麼（ICONS 的一個，iconOf 挑）：見 icon 的 getter／setter。 */
    this._icon = 'arrow';
    /** 每個圖案淡進來多少（0～1）：現在那一個往 1、其他的往 0，交叉淡換。 */
    this.iconW = Object.fromEntries(ICONS.map((k) => [k, k === this._icon ? 1 : 0]));

    this.W = 0; this.H = 0; this.dpr = 1;
    this.portrait = false;
    this.rail = 0; this.barT = 0; this.barB = 0; this.zoneH = 0; this.ctrlTop = 0;
    this.joy = { r: 48, kr: 20 };
    this.jmp = { r: 40 };
    this.slotJoy = { x: 0, y: 0 };
    this.slotJmp = { x: 0, y: 0 };
    this.zoneJoy = { x: 0, y: 0, w: 0, h: 0 };
    this.zoneJmp = { x: 0, y: 0, w: 0, h: 0 };
  }

  /** 跳躍鍵上畫什麼。模式的主程式每幀給；換成箭頭以外的圖案就讓那顆水晃起來（stir），換回箭頭才停。 */
  get icon() { return this._icon; }
  set icon(v) {
    if (v === this._icon) return;
    this._icon = v;
    if (this.stirred) this.stir();
  }

  /** 圖案不在箭頭：那顆水當作一直被按著，直到換回箭頭。 */
  get stirred() { return this._icon !== REST_ICON; }

  /**
   * 讓跳躍鍵那顆水晃起來，晃法跟長按一模一樣：被按下去的那一下（_squeeze），之後只要 stirred 就當作
   * 按著。手指本來就按著的話它已經是那個樣子，不再踢一次。只動外觀：不排跳、不叫 onJump、bOn 不變。
   */
  stir() {
    if (!this.bOn) this._squeeze();
  }

  /* ── 幾何 ──────────────────────────────────────────────────────
     src/pad.js 的 layout()，數字照抄。回傳的 rail / barT / barB / ctrlTop
     / zoneH 由 controls.js 寫進 CSS 變數，所以 DOM 的面板與這裡畫的東西
     共用同一條操作列。

     預設左搖桿、右跳躍，而且不提供對調——遊戲那邊有對調是因為它要照顧
     左右手，這一頁是試玩場，少一個狀態少一個要驗的東西。 */
  layout(W, H, dpr, safe = { l: 0, r: 0, t: 0, b: 0 }) {
    this.W = W; this.H = H; this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    const { l: sl, r: sr, t: st, b: sb } = safe;
    this.portrait = H > W;

    if (!this.portrait) {
      // 橫向：左右兩根直欄，上儀表板、下操作元件
      const rail = clamp(Math.min(W * 0.155, H * 0.44), 96, 190);
      const iw = Math.min(rail - 18, 168);
      /* 圓軌道的直徑就是那條膠囊的寬度，所以拇指的行程跟遊戲一樣寬；
         旋鈕的比例也照抄（膠囊高 0.42·iw、旋鈕半徑 0.42·高）。 */
      const jr = iw / 2;
      const kr = clamp(iw * 0.42, 46, 70) * 0.42;
      const br = Math.min(iw * 0.5, 52);
      const half = Math.max(jr, br);
      const boxH = Math.max(jr * 2, br * 2);
      const cy = H - sb - 20 - boxH / 2;

      this.rail = rail; this.barT = 0; this.barB = 0;
      this.joy = { r: jr, kr };
      this.jmp = { r: br };
      this.slotJoy = { x: sl + Math.max(rail / 2, half + 6), y: cy };
      this.slotJmp = { x: W - sr - Math.max(rail / 2, half + 6), y: cy };

      this.ctrlTop = cy - boxH / 2 - 12;
      const top = Math.min(cy - boxH / 2 - 28, H * 0.5);
      this.zoneH = H - top;
      this.zoneJoy = { x: 0, y: top, w: sl + rail + 12, h: this.zoneH };
      this.zoneJmp = { x: W - sr - rail - 12, y: top, w: sr + rail + 12, h: this.zoneH };
    } else {
      // 直向：上下兩條橫帶，中間整片留給遊戲
      const barB = clamp(Math.min(H * 0.21, W * 0.56), 120, 200);
      const barT = clamp(H * 0.175, 104, 168);
      const iw = clamp(W * 0.34, 130, 240);
      const jr = clamp(Math.min(iw * 0.42, barB * 0.5), 50, 88) / 2 * 1.6;
      const kr = clamp(Math.min(iw * 0.42, barB * 0.5), 50, 88) * 0.42;
      const br = clamp(Math.min(W * 0.13, barB * 0.34), 38, 60);
      const half = Math.max(jr, br);
      const cy = H - sb - barB / 2;

      this.rail = 0; this.barT = barT; this.barB = barB;
      this.joy = { r: jr, kr };
      this.jmp = { r: br };
      this.slotJoy = { x: sl + 16 + half, y: cy };
      this.slotJmp = { x: W - sr - 16 - half, y: cy };

      const top = H - sb - barB - 12;
      this.ctrlTop = top;
      this.zoneH = H - top;
      this.zoneJoy = { x: 0, y: top, w: W / 2, h: this.zoneH };
      this.zoneJmp = { x: W / 2, y: top, w: W / 2, h: this.zoneH };
    }
  }

  /** 這一點該由誰接。`null` 是中間那片遊戲畫面（轉鏡頭與縮放）。 */
  hit(x, y) {
    const inside = (z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
    if (inside(this.zoneJoy)) return 'joy';
    if (inside(this.zoneJmp)) return 'jmp';
    return null;
  }

  /* ── 指標 ────────────────────────────────────────────────────── */
  down(kind, pid, x, y) {
    if (kind === 'joy') {
      if (this.jOn) return;
      this.jOn = true; this.jPid = pid;
      for (let i = 0; i < 3; i++) this.jPh[i] = Math.random() * TAU;
      this._aim(x, y);
      return;
    }
    if (this.bOn) return;
    this.bOn = true; this.bPid = pid;
    this._squeeze();
    this._splash();
    try { if (navigator.vibrate) navigator.vibrate(10); } catch { /* 不支援就算了 */ }
    this._queued = true;
    this.onJump();
  }

  move(pid, x, y) {
    if (this.jOn && pid === this.jPid) this._aim(x, y);
  }

  up(pid) {
    if (this.jOn && pid === this.jPid) {
      this.jOn = false; this.jPid = null;
      this.axis.x = 0; this.axis.y = 0; this.mag = 0;
      this.jTx = 0; this.jTy = 0;
    }
    if (this.bOn && pid === this.bPid) { this.bOn = false; this.bPid = null; }
  }

  releaseAll() { this.up(this.jPid); this.up(this.bPid); }

  /** 按過跳沒有。讀一次就清掉，所以一次按下只跳一次。 */
  takeJump() {
    if (!this._queued) return false;
    this._queued = false;
    return true;
  }

  /* 旋鈕固定不浮動：軸值是「手指相對搖桿中心」，不是相對按下的那一點。
     所以按在觸控區哪裡就已經在推了，不必先滑到旋鈕上——看得到位置、
     又抓得寬鬆。夾圓不夾方，斜推才不會比直推快。手指在圈外跟推到底
     一樣，只取方向。 */
  _aim(x, y) {
    const dx = x - this.slotJoy.x, dy = y - this.slotJoy.y;
    const travel = Math.max((this.joy.r - this.joy.kr) * THROW, 1);
    let ax = dx / travel;
    let ay = dy / travel;
    const m = Math.hypot(ax, ay);
    if (m > 1) { ax /= m; ay /= m; }
    this.jTx = ax; this.jTy = ay;
    const mag = Math.min(1, m);
    if (mag < DEADZONE) {
      this.axis.x = 0; this.axis.y = 0; this.mag = 0;
      return;
    }
    const k = (mag - DEADZONE) / (1 - DEADZONE);
    const len = Math.max(m, 1e-6);
    this.axis.x = ((x - this.slotJoy.x) / travel / len) * k;
    this.axis.y = ((y - this.slotJoy.y) / travel / len) * k;
    this.mag = k;
  }

  /** 跳躍鍵那顆水被按下去的那一下：擾動換一組相位、往下踢一下（之後由 update 的彈簧接手）。 */
  _squeeze() {
    for (let i = 0; i < 3; i++) this.bPh[i] = Math.random() * TAU;
    this.bPressv = 26;
  }

  _splash() {
    const r = this.jmp.r;
    const n = 9 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 70 + Math.random() * 150;
      this.drops.push({
        ax: Math.cos(a) * r * 0.75, ay: Math.sin(a) * r * 0.75,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        r0: 1.6 + Math.random() * 2.8, t: 0,
        life: 0.30 + Math.random() * 0.22,
      });
    }
  }

  /* ── 每幀 ────────────────────────────────────────────────────
     每一條彈簧的係數都是 src/pad.js 的：旋鈕推的時候硬（900/46）、放開
     軟一點看得到回彈（420/26），液化與按壓各自一條。 */
  update(dt) {
    this.t += dt;

    const jtx = this.jOn ? this.jTx : 0;
    const jty = this.jOn ? this.jTy : 0;
    const kS = this.jOn ? 900 : 420, kD = this.jOn ? 46 : 26;
    // 那顆水當作按著：手指按著，或圖案還不是箭頭（stirred）。
    const bt = this.bOn || this.stirred ? 1 : 0;
    const n = Math.max(1, Math.ceil(dt / SPRING_DT)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.jKvx += ((jtx - this.jKx) * kS - this.jKvx * kD) * h;
      this.jKvy += ((jty - this.jKy) * kS - this.jKvy * kD) * h;
      this.jKx += this.jKvx * h;
      this.jKy += this.jKvy * h;
      this.bPressv += ((bt - this.bPress) * 420 - this.bPressv * 26) * h;
      this.bPress += this.bPressv * h;
    }

    const liqK = 1 - Math.pow(0.0006, dt);
    this.jLiq += ((this.jOn ? 1 : 0) - this.jLiq) * liqK;
    this.bLiq += (bt - this.bLiq) * liqK;
    const fade = 1 - Math.exp(-14 * dt);
    for (const k of ICONS) this.iconW[k] += ((this._icon === k ? 1 : 0) - this.iconW[k]) * fade;

    const out = [];
    for (const d of this.drops) {
      d.t += dt / d.life;
      if (d.t >= 1) continue;
      d.ax += d.vx * dt;
      d.ay += d.vy * dt;
      d.vy += 300 * dt;
      const drag = Math.pow(0.1, dt);
      d.vx *= drag; d.vy *= drag;
      out.push(d);
    }
    this.drops = out;
  }

  /* ── 繪製 ──────────────────────────────────────────────────── */
  draw() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this._drawJoy(ctx, this.slotJoy.x, this.slotJoy.y);
    this._drawJump(ctx, this.slotJmp.x, this.slotJmp.y);
    ctx.restore();
  }

  /** 搖桿：圓軌道（儀器）＋ 液化旋鈕。 */
  _drawJoy(ctx, cx, cy) {
    const R = this.joy.r, kr = this.joy.kr;
    const travel = R - kr;
    const liq = this.jLiq;
    let ax = this.jKx, ay = this.jKy;
    const am = Math.hypot(ax, ay);
    if (am > 1) { ax /= am; ay /= am; }
    // 張力：推多深就多綠、鼓多大，跟 src/pad.js 的 tn = |a| 一樣是一條斜坡
    const tn = Math.min(1, am);

    // 軌道
    const track = new Path2D();
    track.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = solid(SOUL_DEEP, 0.46);
    ctx.fill(track);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = solid(SOUL, (0.3 + 0.3 * liq).toFixed(3));
    ctx.stroke(track);

    // 十字刻度：只在靜止時看得到，一推就讓位給水
    ctx.save();
    ctx.globalAlpha *= 0.5 - 0.4 * liq;
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = solid(SOUL_PALE, 0.5);
    ctx.beginPath();
    ctx.moveTo(cx - travel, cy); ctx.lineTo(cx + travel, cy);
    ctx.moveTo(cx, cy - travel); ctx.lineTo(cx, cy + travel);
    ctx.stroke();
    ctx.restore();

    /* 四個端點靶標。旋鈕推到那一側時會蓋住它（幾何注定如此），所以靠近
       就讓它淡掉——「到位了」，力道交給那道水痕去說。 */
    const chev = (dx, dy) => {
      const on = Math.max(0, ax * dx + ay * dy);
      ctx.save();
      ctx.globalAlpha *= 0.34 * (1 - on * 0.92);
      ctx.strokeStyle = solid(SOUL_PALE, 0.75);
      ctx.lineWidth = 1.8;
      const q = R * 0.10;
      const ex = cx + dx * (R - R * 0.16), ey = cy + dy * (R - R * 0.16);
      // 三角形的兩隻腳往「靶標方向的兩側」張開
      const px = -dy, py = dx;
      ctx.beginPath();
      ctx.moveTo(ex - dx * q + px * q, ey - dy * q + py * q);
      ctx.lineTo(ex + dx * q * 0.6, ey + dy * q * 0.6);
      ctx.lineTo(ex - dx * q - px * q, ey - dy * q - py * q);
      ctx.stroke();
      ctx.restore();
    };
    chev(-1, 0); chev(1, 0); chev(0, -1); chev(0, 1);

    /* 推桿量：一片鋪滿整個軌道的放射漸層，圓心在旋鈕的中心——推到哪裡哪裡最亮，往外淡到
       軌道最遠的那一側。半徑取旋鈕中心到軌道最遠一點的距離，整個圓都在漸層裡。 */
    const kx = cx + ax * travel, ky = cy + ay * travel;
    if (am > 0.02) {
      const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, R + am * travel);
      g.addColorStop(0, tint(tn, 0.45, SOUL));
      g.addColorStop(1, tint(tn, 0.03, SOUL));
      ctx.fillStyle = g;
      ctx.fill(track);
    }

    /* 旋鈕：靜止是空心環，被按住就液化。兩者交叉淡入，中間那一刻正好是
       「開始成形」。 */
    if (liq < 0.99) {
      ctx.save();
      ctx.globalAlpha *= 1 - liq;
      ctx.beginPath();
      ctx.arc(kx, ky, kr, 0, TAU);
      ctx.fillStyle = solid(SOUL_PALE, 0.07);
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = solid(SOUL_PALE, 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(kx, ky, 2.2, 0, TAU);
      ctx.fillStyle = solid(SOUL_PALE, 0.75);
      ctx.fill();
      ctx.restore();
    }
    if (liq > 0.01) {
      ctx.save();
      ctx.globalAlpha *= liq;
      // 被推的時候朝行進方向鼓起，像被水流帶著跑
      const tilt = Math.atan2(ay, ax);
      const p = blobPath(kx, ky, kr, tilt, tn * 0.85 * liq, this.t, this.jPh, 0.03 + 0.06 * tn);
      fillLiquid(ctx, p, kx, ky, kr, tn, 8 + 14 * tn, SOUL);
      ctx.restore();
    }
  }

  /** 跳躍鍵：細環儀器 ＋ 按下時鼓成水滴、炸出水花。src/pad.js 的原文。 */
  _drawJump(ctx, cx, cy) {
    const r = this.jmp.r;
    const liq = this.bLiq;
    const press = clamp(this.bPress, 0, 1.4);

    // 外環：按著時整圈亮起來——「還按著」就是「還在長高」，這件事要看得到
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = solid(SOUL, (0.3 + 0.4 * liq).toFixed(3));
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, TAU);
    ctx.stroke();

    if (liq < 0.99) {
      ctx.save();
      ctx.globalAlpha *= 1 - liq;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fillStyle = solid(SOUL_DEEP, 0.46);
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = solid(SOUL_PALE, 0.42);
      ctx.stroke();
      ctx.restore();
    }
    if (liq > 0.01) {
      ctx.save();
      ctx.globalAlpha *= liq;
      const rr = r * (1 + 0.10 * press);
      const p = blobPath(cx, cy, rr, -Math.PI / 2, 0.34 * press, this.t, this.bPh,
        0.035 + 0.075 * press);
      fillLiquid(ctx, p, cx, cy, rr, 0.55 + 0.45 * press, 12 + 22 * press);
      ctx.restore();
    }

    /* 圖案：這顆鍵在說什麼，一眼就懂。平常是向上的箭頭（跳）；第二、三段攻擊的那一段是一把
       往右上斜指的刀（按下去是出招）；在倒下的國王身邊是一隻往上托的手、上面浮著一顆
       靈魂（長按是交靈魂）。幾個交叉淡換（iconW）。

       每個圖案先用不透明的顏色畫進一張離屏的小畫布（_glyph），再整張用一個透明度貼上來：
       直接用半透明的線畫的話，刀身、護手、刀柄疊在一起的地方會疊出比較濃的一塊，剪影的
       透明度就不一致。 */
    const lit = liq > 0.02;
    const rgb = lit ? tint(0.4 + 0.6 * liq, 1) : solid(SOUL_PALE, 1);
    const alpha = (0.55 + 0.45 * liq) * (lit ? 0.95 : 0.62);
    const lift = press * r * 0.06;
    for (const k of ICONS) {
      const w = this.iconW[k];
      if (w > 0.01) this._glyph(ctx, cx, cy - lift, r, rgb, alpha * w, (g) => GLYPHS[k](g, r));
    }

    this._drawDrops(ctx, cx, cy);
  }

  /**
   * 畫一個圖案：在離屏的小畫布上以 (0, 0) 為圓心、用不透明的 color 畫 draw(g)，再整張以
   * alpha 貼到 (cx, cy)。重疊的筆畫因此是同一個透明度。小畫布至少跳躍鍵那麼大（2r 見方），
   * 交靈魂的靈魂伸出去的話照它（GIVE.soulReach）放大，不切到筆畫；照 dpr 放大，不夠大才重新配。
   */
  _glyph(ctx, cx, cy, r, color, alpha, draw) {
    if (alpha <= 0.002) return;
    const dpr = this.dpr, half = Math.ceil(r * GLYPH_HALF);
    const px = Math.ceil(half * 2 * dpr);
    if (!this._glyphCv) this._glyphCv = document.createElement('canvas');
    const cv = this._glyphCv;
    if (cv.width < px || cv.height < px) { cv.width = px; cv.height = px; }
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(dpr, 0, 0, dpr, half * dpr, half * dpr);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = color;
    draw(g);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.drawImage(cv, 0, 0, px, px, cx - half, cy - half, half * 2, half * 2);
    ctx.restore();
  }

  /* 水滴存的是「相對跳躍鍵中心」的位移。src/pad.js 的原文。 */
  _drawDrops(ctx, cx, cy) {
    for (const d of this.drops) {
      const rr = d.r0 * Math.pow(1 - d.t, 0.6);
      if (rr < 0.35) continue;
      const fade = Math.pow(1 - d.t, 0.5);
      const x = cx + d.ax, y = cy + d.ay;
      const g = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.3, 0, x, y, rr);
      g.addColorStop(0, `rgba(255,255,255,${(0.72 * fade).toFixed(3)})`);
      g.addColorStop(0.7, `rgba(255,255,255,${(0.34 * fade).toFixed(3)})`);
      g.addColorStop(1, solid(SOUL_PALE, (0.5 * fade).toFixed(3)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.fill();
    }
  }
}
