/* ── src/snap.js ─────────────────────────────────────────────────────
   錄影的存檔點用的兩把工具：把一個物件「會變的那些數」抓成一份普通的資料（grab），之後原封不動
   寫回另一頁裡同一個位置的那個物件（put）。

   為什麼要存檔點：轉檔的時候重演那一頁要從頭把世界一幀一幀推到勾的那一場，前面幾分鐘全是白算。
   玩的時候在平靜的時刻（mode-flow.js 的 calm）把世界抓一份記在帶子上，重演的那一頁照常載入、
   回到開始的那一刻（rewind），再把最近的那一份寫回去，從那一幀接著走。

   兩頁是同一份程式、同一顆種子砌的：載入之後物件長得一模一樣，所以「寫回同一個位置」就對得上。
   載入之後才生的（怪物、靈魂、特效）各模組自己處理，這裡只管長得一樣的那些。

   ── 抓什麼 ──────────────────────────────────────────────────────
     數字、字串、真假、null          原樣
     陣列、普通物件、Map、Set         一層一層抓下去
     自己寫的類別（Critter、Story…）  一樣一層一層抓它的欄位
     three 的向量、四元數、顏色、矩陣  抓它的那幾個數
     小的 typed array（≤ TA_MAX）     抄一份；大的是模型、貼圖那種載入時就定了的，不抓
     three 的物件（mesh、材質、幾何、貼圖）、DOM、畫布、音訊、函式、WeakMap
                                       不抓——兩頁各自有一份、各自由每一幀的狀態擺好；要擺的另外抓
                                       （pose：一棵 Object3D 底下每一節的位置、旋轉、縮放、看不看得到）
   同一個物件第二次碰到不再抓（寫回的時候第一次那裡寫過了）。

   ── 寫回 ────────────────────────────────────────────────────────
   照抓的時候的樣子一個欄位一個欄位寫進去，物件本身不換（別人手上拿著的參照還是同一個）。
   普通的物件與陣列長得不一樣（抓的時候有、現在沒有）就照抓的那一份新做一個；類別的實例做不出來，
   記一筆「對不上」——呼叫的那一邊看到有對不上的就不用這一份存檔，照舊從頭推。
   普通物件抓的時候沒有的欄位刪掉（抓的那一刻還沒有那個欄位，例如招還沒出）。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';

/** 比這長的 typed array 當作載入時就定了的資料（模型、貼圖），不抓。 */
const TA_MAX = 4096;

/** three 的數學型別：抓它的數，寫回的時候 fromArray。 */
const MATH = [
  ['v2', THREE.Vector2], ['v3', THREE.Vector3], ['v4', THREE.Vector4], ['q', THREE.Quaternion],
  ['e', THREE.Euler], ['c', THREE.Color], ['m3', THREE.Matrix3], ['m4', THREE.Matrix4],
];
const mathOf = (v) => MATH.find(([, C]) => v instanceof C);

/** 不抓的：兩頁各自一份的活東西。 */
const g = globalThis;
const LIVE = [
  THREE.Object3D, THREE.Material, THREE.BufferGeometry, THREE.BufferAttribute, THREE.InterleavedBuffer,
  THREE.Texture, THREE.WebGLRenderTarget, THREE.WebGLRenderer, THREE.Raycaster, THREE.Clock,
  g.Node, g.CanvasRenderingContext2D, g.OffscreenCanvas, g.OffscreenCanvasRenderingContext2D, g.Path2D,
  g.ImageBitmap, g.ImageData, g.CanvasGradient, g.CanvasPattern,
  g.AudioNode, g.BaseAudioContext, g.AudioBuffer, g.AudioParam,
  g.WeakMap, g.WeakSet, g.Promise, g.WebGLRenderingContext, g.WebGL2RenderingContext,
].filter(Boolean);
const isLive = (v) => typeof v === 'function' || LIVE.some((C) => v instanceof C);
const isTyped = (v) => ArrayBuffer.isView(v) && !(v instanceof DataView);
const isPlain = (v) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };

/**
 * 抓一份。`skip` 是這一層（第一層）不抓的欄位名。回傳普通的資料（postMessage 傳得過去）。
 * 抓不了的位置是 undefined（寫回的時候那裡不動）。
 */
export function grab(obj, skip = []) {
  const seen = new Set();
  const top = new Set(skip);
  const go = (v, first = false) => {
    if (v === undefined) return { $: 'u' };
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    if (isLive(v)) return undefined;
    if (seen.has(v)) return SKIP;                 // 第二次碰到：寫回的時候第一次那裡寫過了，這裡佔著位置不動
    const m = mathOf(v);
    if (m) return { $: m[0], a: v.toArray() };
    if (isTyped(v)) return v.length <= TA_MAX ? { $: 'ta', t: v.constructor.name, a: v.slice() } : SKIP;
    seen.add(v);
    // 陣列、Map 裡抓不了的那一格記成 SKIP（不是 undefined：那一格要佔著位置，寫回的時候不動它）。
    const keep = (x) => { const r = go(x); return r === undefined ? SKIP : r; };
    if (Array.isArray(v)) return { $: 'arr', a: v.map(keep) };
    if (v instanceof Map) return { $: 'map', e: [...v].map(([k, x]) => [keep(k), keep(x)]) };
    if (v instanceof Set) return { $: 'set', a: [...v].map(keep) };
    const o = {};
    for (const k of Object.keys(v)) {
      if (first && top.has(k)) continue;
      const x = go(v[k]);
      if (x !== undefined) o[k] = x;              // 函式、活東西不記（寫回的時候也不會刪它們）；大的資料、第二次碰到的記 SKIP
    }
    return { $: isPlain(v) ? 'obj' : 'cls', o };
  };
  return go(obj, true);
}

/** make 做不出來（類別的實例、抓的時候就沒抓到的）。 */
const FAIL = Symbol('fail');

/** 抓不了的那一格（陣列、Map 裡）。 */
const SKIP = { $: 's' };

/** 照資料新做一個（普通的物件、陣列、Map、Set、數學型別、typed array）；做不出來回 FAIL。 */
function make(d) {
  if (d === undefined) return FAIL;
  if (d === null || typeof d !== 'object') return d;
  const all = (list) => (list.includes(FAIL) ? FAIL : list);
  switch (d.$) {
    case 'u': return undefined;
    case 's': return FAIL;
    case 'ta': return new g[d.t](d.a);
    case 'arr': return all(d.a.map(make));
    case 'map': {
      const e = d.e.map(([k, v]) => [make(k), make(v)]);
      return e.some(([k, v]) => k === FAIL || v === FAIL) ? FAIL : new Map(e);
    }
    case 'set': { const a = all(d.a.map(make)); return a === FAIL ? FAIL : new Set(a); }
    case 'obj': {
      const o = {};
      for (const [k, v] of Object.entries(d.o)) {
        const x = make(v);
        if (x === FAIL) return FAIL;
        o[k] = x;
      }
      return o;
    }
    case 'cls': return FAIL;
    default: {
      const m = MATH.find(([n]) => n === d.$);
      return m ? new m[1]().fromArray(d.a) : FAIL;
    }
  }
}

/**
 * 寫回：把 grab 抓的那一份寫進 `obj`（同一個位置的那個物件）。回傳對不上的那幾個位置（空的就是都寫好了）。
 */
export function put(obj, data) {
  const bad = [];
  const into = (t, d, path) => {
    if (d.$ === 'arr') {
      if (!Array.isArray(t)) return void bad.push(path);
      if (t.length !== d.a.length) {
        // 長度不一樣：全部是做得出來的就照抓的那一份重做；不然對不上。
        const made = make(d);
        if (made === FAIL) return void bad.push(`${path}[${t.length}→${d.a.length}]`);
        t.length = 0;
        t.push(...made);
        return;
      }
      d.a.forEach((x, i) => slot(t, i, x, `${path}[${i}]`));
      return;
    }
    if (d.$ === 'map') {
      if (!(t instanceof Map)) return void bad.push(path);
      const keep = new Map(t);
      t.clear();
      for (const [kd, vd] of d.e) {
        const k = make(kd);
        if (vd !== null && typeof vd === 'object' && vd.$ !== 'u' && keep.has(k) && typeof keep.get(k) === 'object' && keep.get(k) !== null) {
          t.set(k, keep.get(k));
          into(keep.get(k), vd, `${path}<${String(k)}>`);
        } else {
          const v = make(vd);
          if (v === FAIL || k === FAIL) bad.push(`${path}<${String(k)}>`);
          else t.set(k, v);
        }
      }
      return;
    }
    if (d.$ === 'set') {
      if (!(t instanceof Set)) return void bad.push(path);
      const a = d.a.map(make);
      if (a.includes(FAIL)) return void bad.push(path);
      t.clear();
      for (const x of a) t.add(x);
      return;
    }
    if (d.$ === 'ta') {
      if (!isTyped(t) || t.length !== d.a.length) return void bad.push(path);
      t.set(d.a);
      return;
    }
    if (d.$ === 'obj' || d.$ === 'cls') {
      if (t === null || typeof t !== 'object') return void bad.push(path);
      for (const [k, x] of Object.entries(d.o)) slot(t, k, x, `${path}.${k}`);
      // 普通物件：抓的時候沒有的欄位（之後才加上去的）刪掉。
      if (d.$ === 'obj') for (const k of Object.keys(t)) if (!(k in d.o) && !isLive(t[k])) delete t[k];
      return;
    }
    const m = MATH.find(([n]) => n === d.$);
    if (m && t instanceof m[1]) return void t.fromArray(d.a);
    bad.push(path);
  };
  const slot = (t, k, x, path) => {
    if (x === undefined || (x !== null && x.$ === 's')) return;
    if (x === null || typeof x !== 'object') { t[k] = x; return; }
    if (x.$ === 'u') { t[k] = undefined; return; }
    const cur = t[k];
    if (cur !== null && typeof cur === 'object' && !isLive(cur) && sameKind(cur, x)) { into(cur, x, path); return; }
    const v = make(x);
    if (v === FAIL) { bad.push(path); return; }
    t[k] = v;
  };
  into(obj, data, '');
  return bad;
}

/** 現在的這個物件跟抓的那一份是不是同一種（才能原地寫）。 */
function sameKind(cur, d) {
  switch (d.$) {
    case 'arr': return Array.isArray(cur);
    case 'map': return cur instanceof Map;
    case 'set': return cur instanceof Set;
    case 'ta': return isTyped(cur) && cur.length === d.a.length;
    case 'obj': return isPlain(cur);
    case 'cls': return !isPlain(cur) && !Array.isArray(cur);
    default: { const m = MATH.find(([n]) => n === d.$); return !!m && cur instanceof m[1]; }
  }
}

/** 兩份抓出來的資料一不一樣（NaN 跟 NaN 算一樣）。不一樣的話回傳第一個不一樣的位置，一樣是 null。 */
export function differ(a, b, path = '') {
  if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return path || '.';
  if (isTyped(a) || isTyped(b)) {
    if (!isTyped(a) || !isTyped(b) || a.length !== b.length) return path;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return `${path}[${i}]`;
    return null;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return path;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return `${path}{${ka.filter((k) => !kb.includes(k)).concat(kb.filter((k) => !ka.includes(k))).join(',')}}`;
  for (const k of ka) {
    const r = differ(a[k], b[k], `${path}.${k}`);
    if (r) return r;
  }
  return null;
}

/**
 * 一棵 Object3D 擺成什麼樣子：每一節（traverse 的順序）的位置、旋轉（四元數與尤拉角都記）、縮放、看不看得到。
 * 動物的骨架、倒下的身體這種「上一幀擺到哪、這一幀接著擺」的才要。
 *
 * 旋轉兩種都記、寫回的時候各自原樣寫進去（不讓 three 互相換算）：同一個旋轉的尤拉角不只一組，
 * 從四元數換回來的那一組可能是 (π, y', π)——之後只改 rotation.y 的地方（動物的朝向就是這樣轉的）
 * 就轉成另一個方向了。
 */
export function pose(root) {
  const out = [];
  root.traverse((o) => {
    const q = o.quaternion, e = o.rotation;
    out.push([...o.position.toArray(), q._x, q._y, q._z, q._w, e._x, e._y, e._z, ...o.scale.toArray(), o.visible ? 1 : 0]);
  });
  return out;
}

/** 照 pose 抓的那一份擺回去。節數對不上回 false。 */
export function setPose(root, data) {
  const nodes = [];
  root.traverse((o) => nodes.push(o));
  if (nodes.length !== data.length) return false;
  nodes.forEach((o, i) => {
    const d = data[i], q = o.quaternion, e = o.rotation;
    o.position.fromArray(d, 0);
    [q._x, q._y, q._z, q._w] = [d[3], d[4], d[5], d[6]];
    [e._x, e._y, e._z] = [d[7], d[8], d[9]];
    o.scale.fromArray(d, 10);
    o.visible = d[13] === 1;
  });
  return true;
}
