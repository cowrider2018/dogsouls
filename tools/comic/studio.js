/* ── tools/comic/studio.js ───────────────────────────────────────────
   漫畫的攝影棚（studio.html）。照 shots.js 一格一格把角色擺好、拍下來，背景透明，出成書頁上
   那一格的圖（make-comic.mjs 開無頭瀏覽器來這裡拿圖、存檔）。

   這一頁不在網站上：它是畫漫畫的工具，跟著 tools/ 走、不部署。make-comic.mjs 起的伺服器把
   public/ 與這個資料夾（在 /studio/ 底下）一起供出來，所以角色、著色、王冠這些直接 import
   遊戲本身的那幾支（/test/src/…），不是抄一份。

   角色是遊戲那幾隻本人（critter.js 的 Critter：同一份 cat.bin、同一副骨架、同一個三階
   著色、同一條墨線），不是另外畫的——漫畫裡的主角跟遊戲裡的主角是同一隻。姿勢是
   moveOverlay 那幾個欄位（跟出招用的同一套），倒下是 death.js 那一種繞著身體側緣轉。

   ── 漫畫質感：一道後製 ────────────────────────────────────────
   三階的平塗與墨線本來就是 2D 的光影；後製再在暗的地方疊網點（45° 的圓點網，越暗點越大，
   點是那一塊自己的顏色壓暗——全彩，不是黑白網點）。先畫進一張離屏的圖，再整張過一次網點
   畫到畫布上；透明的地方留透明。

   ── 表情：畫在圖上 ────────────────────────────────────────────
   模型的眼睛演不了戲，漫畫的表情靠眼睛與眉毛。有指定表情（face）的那一隻，拍之前把兩隻
   眼睛的骨頭縮成零（模型那兩片藏起來），從眼睛骨頭投影出每一隻眼睛在畫面上的位置、大小、
   頭頂朝哪、鼻樑在哪一側，拍完之後用 2D 照 faces.js 畫上去——在網點之後畫，線是乾淨的。
   單邊縮小：遠的那一隻照頭真正側過去多少（3D 量，頭仰、頭低都算）縮——45° 以內一直畫、縮的幅度
   是遊戲的一半，45° 以外一刀不畫（遊戲裡模型自己的遠眼收合是線性收到零的，漫畫不用它）；臉背對
   鏡頭（偏過 110°，正側面之後）兩隻都不畫。
   往額頭抬、往外分開（shots.js 的 eyes）是在頭上用 3D 移的，畫上去的眼睛跟著頭仰、頭低走。

   ── 剪影：背景 ────────────────────────────────────────────────
   背景是遊戲地形零件（pieces.js）的剪影拼貼。剪影只取零件的形狀：一個顏色、不分階、沒有墨線，
   從正面平拍（正交，沒有透視），不拿來做遠近與空間感。每一件放在畫面上哪裡、多大，照構圖給
   （畫面的比例），跟 3D 場景無關；角色拍好之後疊在背景上面。地面是漫畫的橫排線，從構圖給的
   地平線往下排滿。角色碰得到的東西（國王坐的王座）才是 3D 的道具（props），同一個顏色。

   ── 集中線 ────────────────────────────────────────────────────
   緊張的格子（focusLines）在紙上畫一圈往臉收的墨線：一條一條細長的楔形，外粗內尖，中間留一圈
   空白給臉。畫在角色與剪影底下（先畫線、再把拍好的圖疊上去）。亂數有固定的種子，重拍一樣。

   ── 投影的深度圖 ───────────────────────────────────────────────
   毛皮與王冠的著色器宣告了接收投影的 sampler2DShadow（light/shadow.js）。沒有綁一張設了
   比較模式的深度圖，ANGLE 會整個 draw 不畫——畫面是一片墨色（戰鬥場的地面當初就是這樣
   不見的）。這裡沒有東西投影，照戰鬥場那樣讓 shadow.js 綁一張清成最遠的 1×1。

   打開來看：畫面是紙色，上面是那一格拍出來的樣子；← → 換一格。
   給工具用的把手是 window.comic：
     ids             每一格的 id
     render(id)      擺好、拍下來，回傳 PNG 的 data URL
   ------------------------------------------------------------------ */

import * as THREE from '/test/vendor/three.module.js';
import { loadZoo, Critter, LIGHT_DIR } from '/test/src/critter.js';
import { Crown } from '/test/src/crown.js';
import { Helm } from '/test/src/helm.js';
import { ShieldRing } from '/test/src/shield.js';
import { SoulLook } from '/test/src/soul.js';
import { makeMonsterCritter, sizeOf, GHOST_ALPHA } from '/test/src/monster.js';
import { Blade } from '/test/src/blade.js';
import * as Pieces from '/test/src/pieces.js';
import { Build } from '/test/src/geom.js';
import { C, INK, KEY_POS, U_KEYDIR } from '/test/src/palette.js';
import * as shadowLight from '/test/src/light/shadow.js';
import { Driver, Sway } from '/src/cat/pose.js';
import { SHOTS } from './shots.js';
import { drawFace } from './faces.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
shadowLight.setup({ scene, renderer, camera, ruins: null, cols: [], arenas: [] });

/* ── 網點 ────────────────────────────────────────────────────────
   一格網點寬 size[1] / HALFTONE.cells 像素；亮度（感知的，sRGB）在 lo 以下點最大、hi 以上沒有點。
   點的顏色是底色乘 HALFTONE.ink。離屏那一張存的是預乘過 alpha 的顏色（清成透明再畫上去），
   這裡先除回來再算亮度。 */
const HALFTONE = { cells: 120, lo: 0.06, hi: 0.5, ink: 0.45 };
const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: target.texture }, uCell: { value: 8 } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
uniform sampler2D tSrc;
uniform float uCell;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tSrc, vUv);
  if (c.a < 0.003) discard;
  c.rgb /= c.a;
  float lum = dot(pow(max(c.rgb, 0.0), vec3(1.0 / 2.2)), vec3(0.299, 0.587, 0.114));
  float t = smoothstep(${HALFTONE.hi.toFixed(2)}, ${HALFTONE.lo.toFixed(2)}, lum);
  const float A = 0.7853982;
  vec2 q = mat2(cos(A), -sin(A), sin(A), cos(A)) * gl_FragCoord.xy / uCell;
  float d = length(fract(q) - 0.5);
  float r = 0.53 * sqrt(t);
  float e = fwidth(d);
  float dotIn = (1.0 - smoothstep(r - e, r + e, d)) * step(0.02, t);
  c.rgb = mix(c.rgb, c.rgb * ${HALFTONE.ink.toFixed(2)}, dotIn);
  gl_FragColor = c;
  #include <colorspace_fragment>
}`,
  transparent: true, depthTest: false, depthWrite: false,
}));
const screenScene = new THREE.Scene();
screenScene.add(screen);
const screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/* ── 角色 ────────────────────────────────────────────────────────
   主角：遊戲預設那一隻（立耳犬、黃、戴漁夫帽）。國王：活著的時候——垂耳犬、灰、王冠、
   1.4 倍高。怪物是遊戲裡那幾隻本人（monster.js 的 makeMonsterCritter：同一件毛、同樣大、
   幽靈一樣半透明），頭盔、王冠、盾照 fight.js 那樣戴上去。

     hero         主角                       king         活著的國王
     zombie       殭屍                       boss         殭屍王（兩倍大、頭盔）
     knight       騎士（1.2 倍高、頭盔）     ghost        幽靈
     ghostKing    國王的亡魂（幽靈那一件、王冠、shields 幾面盾繞著轉）
     knightGhost  騎士幽靈（幽靈加頭盔，劇本說的「先拼」：幽靈＋頭盔＋劍）
     folk         王國的人民：look 給哪一隻、哪一件毛（'cat/tabby'、'dog-drop/cow'……）
     comrade      復活的夥伴：活著的騎士幽靈——立耳犬（幽靈的那個模型）、乳牛毛、同一頂頭盔

   同一種角色一格裡可以有好幾隻：照 cast 的順序一隻一隻借，不夠就再做一隻。 */
const zoo = await loadZoo({ look: 'dog-prick/yellow', height: 1.0 });
const ROLES = {
  hero: { look: 'dog-prick/yellow', height: 1.0, hat: true },
  king: { look: 'dog-drop/grey', height: 1.4, crown: true },
  zombie: { monster: 'minion' },
  boss: { monster: 'boss', helm: true },
  knight: { monster: 'knight', helm: true },
  ghost: { monster: 'ghost' },
  ghostKing: { monster: 'king', crown: true },
  knightGhost: { monster: 'ghost', helm: true },
  folk: {},
  comrade: { look: 'dog-prick/cow', helm: true },
};
/** 腳下的影子的材質（每一隻一塊，共用材質）。 */
const shadowMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.22, depthWrite: false });

/** 做一隻：who 是 ROLES 的鍵，look 是 folk 的那一件（'模型/毛色'）。 */
function makeActor(who, look) {
  const r = ROLES[who];
  if (!r) throw new Error(`沒有這種角色：${who}`);
  let c, height;
  if (r.monster) {
    c = makeMonsterCritter(zoo, r.monster);
    height = sizeOf(r.monster);
  } else {
    const [model, skin] = (r.look || look || '').split('/');
    const own = zoo.critters.get(model);
    if (!own) throw new Error(`沒有這一隻：${look}`);
    height = r.height ?? own.height;
    c = new Critter(own.data, model, { height, skin });
    c.setCoat(skin);
    c.setHat(!!r.hat);
  }
  const crown = r.crown ? new Crown() : null;
  if (crown) crown.follow(c);
  const helm = r.helm ? new Helm() : null;
  if (helm) helm.follow(c);
  /* 半透明的（幽靈）是兩個網格，上色的那一個照 alpha 混色（monster.js 的 seeThrough）：
     找出來，散掉的幽靈（spec.alpha）調它的不透明度。 */
  const seeThrough = c.mesh.material[0]?.colorWrite === false;
  const tint = seeThrough ? c.mesh.parent.children.find((m) => m !== c.mesh && m.geometry === c.geometry) : null;
  // 倒下轉的是外面這一層（death.js 轉 Zoo 的 root 也是一樣的道理：朝向在裡面那一層）。
  const wrap = new THREE.Group();
  wrap.add(c.root);
  // 腳下一塊墨色的影子：沒有地面的時候，它是唯一告訴人「牠站在地上」的東西。
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42 * height, 40), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1, 1.6, 1);
  scene.add(wrap, shadow);
  return { c, crown, helm, tint, wrap, shadow, height, blades: {}, shields: null };
}

/** 每一種角色（folk 是每一件）借出去的那幾隻。 */
const pool = new Map();
/** 這一格第幾次借這一種：照 cast 的順序借，不夠就再做一隻。 */
function borrow(spec, used) {
  const key = spec.who === 'folk' ? `folk:${spec.look}` : spec.who;
  if (!pool.has(key)) pool.set(key, []);
  const list = pool.get(key);
  const k = (used[key] = (used[key] || 0) + 1);
  while (list.length < k) list.push(makeActor(spec.who, spec.look));
  return list[k - 1];
}
const allActors = () => [...pool.values()].flat();
pool.set('hero', [makeActor('hero')]);
/** 一公尺高的動物，一個模型單位是幾公尺：刀劍是模型單位做的（blade.js），掉在地上的照它縮。 */
const UNIT = pool.get('hero')[0].c.mesh.scale.x;

/** 這一隻嘴裡咬著哪一把（blade.js 的 SWORDS：knife、knight、king），null 是空手。第一次用到才做。 */
function arm(a, kind) {
  for (const b of Object.values(a.blades)) b.node.visible = false;
  if (!kind) return null;
  const b = a.blades[kind] ??= new Blade(kind);
  b.follow(a.c);
  b.node.visible = true;
  return b;
}

/* ── 剪影 ────────────────────────────────────────────────────────
   零件照它們在關卡裡的砌法砌出來（pieces.js），整個塗成 SIL 一個顏色（MeshBasicMaterial，不吃光，
   墨線那一份不用）。顏色夠亮（感知亮度 > 網點的 hi），不長網點。

   一件零件：{ piece, ...o }。piece 是 PIECES 裡的名字，o 原樣交給那支零件（pavilion 的 R、h，
   wall 的 from、to……），零件自己的 x、z 是 0。 */
const SIL = 0xa8977c;

/** 吃 (B, o) 的零件照抄；其餘的包一層。火焰（brazier、campfire 回報的座標）不要。 */
const PIECES = {
  ...Object.fromEntries([
    'column', 'banner', 'pavilion', 'weaponRack', 'standard', 'dummy', 'archeryTarget', 'sackStack',
    'woodpile', 'deadTree', 'knight', 'rubble', 'rubbleHeap', 'well', 'pointedArch', 'arcade', 'stair',
    'gargoyle', 'wall', 'throneSeat', 'sarcophagus', 'portcullis', 'chain', 'buttress',
  ].map((n) => [n, Pieces[n]])),
  brazier: (B, o) => Pieces.brazier(B, o, []),
  campfire: (B, o) => Pieces.campfire(B, o, []),
  crate: (B, o) => Pieces.crate(B, 0, o.y || 0, 0, 0, o.s),
  barrel: (B, o) => Pieces.barrel(B, 0, o.y || 0, 0),
  /** 城牆：牆加牆頂一排垛口（兵營那道幕牆的樣子）。 */
  rampart: (B, o) => Pieces.merlons(B, { ...o, on: Pieces.wall(B, o), y: (o.y || 0) + o.h }),
  /** 窄巷的連棟屋：W 寬、D 深、簷口 e 高，立面朝 −z。 */
  house: (B, o) => Pieces.house(B, o.seed, { W: 5, D: 4, e: 5.2, alt: false, ...o, vx: false, us: 1, at: (u, v) => [u, v] }),
  /** 王座廳北端的台座：三級台階接上石台，台上是王座、兩側兩尊騎士石像，階前兩盆火（blocks.js 的砌法）。 */
  dais: (B, o) => {
    Pieces.stair(B, { x: 0, z: -2.7, y: 0, yaw: Math.PI, steps: 3, rise: 0.3, run: 0.7, w: 8, seed: 100 });
    B.add(B.kit.brick(9, 0.9, 5.4, 0.09), { p: [0, 0.45, 0], color: C.granite });
    if (o.throne !== false) Pieces.throneSeat(B, { x: 0, z: 1.1, y: 0.9 });
    for (const side of [-1, 1]) {
      Pieces.knight(B, { x: side * 3.6, z: -0.7, y: 0.9, s: 1.15, yaw: Math.PI, damage: side < 0 ? 0 : 0.55, seed: 120 + side });
      Pieces.brazier(B, { x: side * 2.6, z: -3.1, y: 0, s: 1.05, seed: 130 + side }, []);
    }
  },
  /** 門洞：一道尖拱加兩側一段牆（中庭門樓、水窖與墓室的門），lift 給了就是拱裡升到那裡的鐵閘。 */
  gateway: (B, o) => {
    const { span = 5, rise = 3.6, y: _y, h = 6.4, side = 4, thick = 1.2, lift } = o;
    const half = span / 2;
    Pieces.wall(B, { from: [-half - side, 0], to: [-half, 0], h, thick, ruin: o.ruin ?? 0.2, seed: 3 });
    Pieces.wall(B, { from: [half, 0], to: [half + side, 0], h, thick, ruin: o.ruin ?? 0.2, seed: 4 });
    const ARCH = { y: h * 0.56, span, rise, thick: 0.55 };
    Pieces.pointedArch(B, { x: 0, z: 0, ...ARCH, yaw: 0, depth: thick + 0.1, ruin: 0, seed: 5 });
    if (lift !== undefined) {
      const e = (rise * rise - half * half) / (2 * half), ri = half + e - ARCH.thick / 2;
      const ceil = (t) => ARCH.y + Math.sqrt(Math.max(0, ri * ri - (Math.abs(t) + e) ** 2));
      Pieces.portcullis(B, { x: 0, z: 0, y: 0, w: span - 0.6, h: ARCH.y - 0.2, yaw: 0, lift, ceil, solid: false });
    }
  },
};
const KIT = new Pieces.Kit();
const silMat = new THREE.MeshBasicMaterial({ color: SIL });

/** 砌一件零件，回傳它的剪影 mesh（原點在零件的原點）。 */
function silhouette({ piece, at, yaw, scale, view, tilt, x, y, size, flip, vanish, dash, ...o }) {
  const make = PIECES[piece];
  if (!make) throw new Error(`沒有這種零件：${piece}`);
  const B = new Build(KIT);
  make(B, { x: 0, z: 0, y: 0, seed: 1, ...o });
  return new THREE.Mesh(B.finish().geometry, silMat);
}

/* ── 道具：角色碰得到的那幾件，3D ─────────────────────────────────
   { piece, at: [x, z], yaw, scale, ...o }：擺在場景裡，跟角色一起拍（國王坐在王座上），剪影的顏色。
   { blade, at: [x, z], y, yaw, size }：一把掉在地上的刀劍（blade.js，原本的顏色）——刀面是平的，
   所以平放在地上就是轉一個 yaw；size 是拿它的那一隻多高（騎士 1.2）。 */
const set = new THREE.Group();
scene.add(set);
/** 掉在地上的刀劍：每一種一把，放好的時候才掛上來。 */
const loose = {};
const looseSet = new THREE.Group();
scene.add(looseSet);
function buildProps(props) {
  for (const m of set.children) m.geometry.dispose();
  set.clear();
  looseSet.clear();
  for (const spec of props || []) {
    if (spec.blade) {
      const g = (loose[spec.blade] ??= new THREE.Group());
      if (!g.children.length) g.add(new Blade(spec.blade).node);
      // 刀劍是模型單位做的：一隻 size 公尺高的動物的一個模型單位多長，就照那個比例縮。
      g.scale.setScalar(UNIT * (spec.size || 1));
      g.position.set(spec.at[0], spec.y ?? 0.03, spec.at[1]);
      g.rotation.set(spec.tilt || 0, spec.yaw || 0, 0, 'YXZ');
      looseSet.add(g);
      continue;
    }
    const m = silhouette(spec);
    m.position.set(spec.at[0], spec.y || 0, spec.at[1]);
    m.rotation.y = spec.yaw || 0;
    m.scale.setScalar(spec.scale || 1);
    set.add(m);
  }
}

/* ── 靈魂：發光的狗頭（soul.js），3D ───────────────────────────────
   { at: [x, y, z], yaw, scale, seed, trail }：頭、光暈、周圍冒的小球。小球是 soul.js 用 Math.random 撒的，
   這裡借固定種子的亂數撒一段（trail 幀，預設 90：冒到滿），重拍才一樣。同一格好幾顆的時候 trail 給少一點，
   小球才不會疊成密密的一片。 */
let soulLook = null;
const souls = [];
function placeSouls(list) {
  for (const v of souls) v.root.visible = false;
  if (!list?.length) return;
  soulLook ??= new SoulLook(zoo);
  list.forEach((sl, i) => {
    if (!souls[i]) { souls[i] = soulLook.make(); scene.add(souls[i].root); }
    const v = souls[i];
    const [x, y, z] = sl.at;
    const keep = Math.random;
    Math.random = rng(sl.seed ?? 5 + i);
    try {
      v.bubbles.clear();
      v.node.scale.setScalar(sl.scale || 1);
      for (let k = 0, n = sl.trail ?? 90; k < n; k++) v.bubbles.step(1 / 60, x, y, z);
      v.show({ x, y, z, yaw: sl.yaw || 0 }, 0, camera);
    } finally {
      Math.random = keep;
    }
  });
}

/* ── 背景：照構圖拼貼的剪影，2D ───────────────────────────────────
   { piece, x, y, size, view, tilt, flip, vanish, ...o }：零件從正面平拍成一張剪影（正交鏡頭，view 是繞直軸
   轉幾弳再拍——要拍側面就給 π/2；tilt 往前傾幾弳，看得到一點頂），底邊正中間放在畫面的
   (x, y)（寬高的比例，y 往下），高 size（畫面高的比例），flip 左右翻。vanish: [vx, vy] 是消失點
   （畫面的比例）：剪影變成梯形——直的邊還是直的，每一條直線照它離消失點多遠縮放、對著 vy 那條
   水平線收，所以底邊與頂邊都往消失點收（離它越近越矮）。底邊正中間那一條不變。超出畫面的照裁。

   虛線（dash）：原本在那裡、現在不見了的東西，只剩一圈粗虛線的輪廓——沒有填色、沒有實體，裡面
   透出紙（或後面的剪影）。dash: true 是這一件整個只畫輪廓；dash: { ...參數 } 是這一件照常畫剪影，
   再把同一件零件換上這些參數重砌一次、只畫輪廓，疊在剪影上——同一個位置、同一個比例（框是全部
   合起來的大小）。給陣列就是好幾層，後面的先畫，前面那一層蓋住的地方，後面那幾層的虛線擦掉（盾
   擋在長槍前面，槍桿的虛線停在盾的輪廓外）。例如兵器架：{ piece: 'weaponRack', spears: false,
   shields: false, dash: [{ rack: false, spears: true }, { rack: false, shields: true }] } 是空的
   架子，加上原本靠著的長槍、擋在前面的盾的虛線。輪廓是從拍好的剪影描出來的（marching squares）。
   不支援 vanish。 */
const cutFat = document.createElement('canvas');
const cutScene = new THREE.Scene();
const cutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const cutCanvas = document.createElement('canvas');
const dashCanvas = document.createElement('canvas');
/** 虛線：線寬是畫面高的 w 倍；一段 on、一個空隙 off（線寬的倍數，看得到的長度，圓頭算在裡面）。 */
const DASH = { w: 1 / 120, on: 2.6, off: 1.7, color: `#${INK.toString(16).padStart(6, '0')}` };

/** 把一件轉好的零件用框 box 平拍成 pw × ph，拍在 cutCanvas 上。 */
function snapCutout(m, box, pw, ph) {
  cutScene.add(m);
  m.updateMatrixWorld(true);
  Object.assign(cutCam, { left: box.min.x, right: box.max.x, top: box.max.y, bottom: box.min.y, far: box.max.z - box.min.z + 2 });
  cutCam.position.set(0, 0, box.max.z + 1);              // 沒轉過的正交鏡頭本來就朝 −Z 看
  cutCam.updateProjectionMatrix();
  cutCam.updateMatrixWorld();
  renderer.setSize(pw, ph, false);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(cutScene, cutCam);
  cutScene.remove(m);
  m.geometry.dispose();
  cutCanvas.width = pw;
  cutCanvas.height = ph;
  cutCanvas.getContext('2d').drawImage(canvas, 0, 0, pw, ph, 0, 0, pw, ph);
}

/** 零件是一塊一塊砌的，磚縫、鼓與鼓之間的縫拍出來會透光；剪影要是實心的，所以把 cutCanvas 往外補
    r 像素（同一個顏色錯開疊幾次）畫到 c 的 (ox, oy)，縫就合起來了。 */
function fat(c, ox, oy, r) {
  for (let k = 0; k < 9; k++) {
    const a = (k / 8) * Math.PI * 2, d = k === 8 ? 0 : r;
    c.drawImage(cutCanvas, ox + Math.cos(a) * d, oy + Math.sin(a) * d);
  }
}

/** 剪影（畫布的不透明度）的輪廓：marching squares，回傳一圈一圈封閉的折線（畫布的像素座標）。 */
function contours(c) {
  const w = c.width, h = c.height;
  const px = c.getContext('2d').getImageData(0, 0, w, h).data;
  // 四周墊一圈 0，每一圈輪廓都是封閉的。v(i, j) 是像素 (i−1, j−1) 的中心。
  const v = (i, j) => (i < 1 || j < 1 || i > w || j > h ? 0 : px[((j - 1) * w + (i - 1)) * 4 + 3] / 255);
  const T = 0.5;
  const pt = new Map(), nb = new Map();
  // 邊的編號：橫的 (i, j)—(i+1, j) 是 2k，直的 (i, j)—(i, j+1) 是 2k+1，k = j·(w+2)+i。
  const edge = (i, j, vert) => {
    const id = 2 * (j * (w + 2) + i) + (vert ? 1 : 0);
    if (!pt.has(id)) {
      const a = v(i, j), b = vert ? v(i, j + 1) : v(i + 1, j), t = (T - a) / (b - a);
      pt.set(id, vert ? [i - 1 + 0.5, j - 1 + 0.5 + t] : [i - 1 + 0.5 + t, j - 1 + 0.5]);
    }
    return id;
  };
  const link = (a, b) => {
    if (!nb.has(a)) nb.set(a, []);
    if (!nb.has(b)) nb.set(b, []);
    nb.get(a).push(b);
    nb.get(b).push(a);
  };
  for (let j = 0; j <= h; j++) {
    for (let i = 0; i <= w; i++) {
      const k = (v(i, j) > T ? 1 : 0) | (v(i + 1, j) > T ? 2 : 0) | (v(i + 1, j + 1) > T ? 4 : 0) | (v(i, j + 1) > T ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const top = () => edge(i, j, false), bot = () => edge(i, j + 1, false);
      const lef = () => edge(i, j, true), rig = () => edge(i + 1, j, true);
      switch (k) {
        case 1: case 14: link(lef(), top()); break;
        case 2: case 13: link(top(), rig()); break;
        case 4: case 11: link(rig(), bot()); break;
        case 8: case 7: link(bot(), lef()); break;
        case 3: case 12: link(lef(), rig()); break;
        case 6: case 9: link(top(), bot()); break;
        case 5: link(lef(), top()); link(rig(), bot()); break;   // 對角的兩塊：當成分開的
        case 10: link(top(), rig()); link(bot(), lef()); break;
      }
    }
  }
  const loops = [], seen = new Set();
  for (const start of nb.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      loop.push(pt.get(cur));
      const next = nb.get(cur).find((n) => n !== prev && !seen.has(n));
      prev = cur;
      cur = next;
    }
    loops.push(loop);
  }
  return loops;
}

/**
 * 一圈一圈輪廓畫成粗虛線，圓頭。先抹掉像素的鋸齒、重新取成每 1 像素一點。
 * 尖角（槍尖、兩塊交會的凹角）一定落在一段的正中間，形狀才讀得出來：輪廓在尖角切成幾截，
 * 每一截各自取整數段、把間隔攤勻；沒有尖角的一圈（盾）整圈取整數段。段長都一樣，間隔只差一點點。
 */
const dashWidth = (H) => Math.max(2, DASH.w * H);
function strokeDashed(g, loops, H) {
  const lw = dashWidth(H), on = DASH.on * lw, P = (DASH.on + DASH.off) * lw;
  // 圓頭往兩頭各長出半個線寬：畫的那一截短一個線寬，看起來才是 on。
  const half = Math.max(0.01, on - lw) / 2;
  const k = Math.max(2, Math.round(lw * 1.5)), CORNER = (45 * Math.PI) / 180;
  g.save();
  g.strokeStyle = DASH.color;
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let loop of loops) {
    for (let pass = 0; pass < 3; pass++) {
      const q = loop;
      loop = q.map((p, i) => {
        const a = q[(i + q.length - 1) % q.length], b = q[(i + 1) % q.length];
        return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
      });
    }
    // 每 1 像素取一點：索引就是弧長。
    const pts = [];
    let arc = 0, next = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!d) continue;
      for (; next < arc + d; next += 1) {
        const t = (next - arc) / d;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
      arc += d;
    }
    const N = pts.length;
    if (N < P * 1.5) continue;                            // 剪影裡零星的小洞、小碎塊
    const at = (i) => pts[((Math.floor(i) % N) + N) % N];
    const turn = pts.map((p, i) => {
      const a = at(i - k), b = at(i + k);
      const t = Math.atan2(b[1] - p[1], b[0] - p[0]) - Math.atan2(p[1] - a[1], p[0] - a[0]);
      return Math.abs(Math.atan2(Math.sin(t), Math.cos(t)));
    });
    const corners = [];
    for (let i = 0; i < N; i++) {
      if (turn[i] < CORNER) continue;
      let top = true;
      for (let j = -k; j <= k && top; j++) {
        const o = turn[(i + j + N) % N];
        if (o > turn[i] || (o === turn[i] && j < 0)) top = false;
      }
      if (top) corners.push(i);
    }
    // 每一截（尖角到下一個尖角）取整數段，段的中心排在 c、c + u、c + 2u……
    const centres = [];
    if (!corners.length) {
      const n = Math.max(1, Math.round(N / P));
      for (let j = 0; j < n; j++) centres.push((j * N) / n);
    } else {
      corners.forEach((c, i) => {
        const S = (i + 1 < corners.length ? corners[i + 1] : corners[0] + N) - c;
        const n = Math.max(1, Math.round(S / P));
        for (let j = 0; j < n; j++) centres.push(c + (j * S) / n);
      });
    }
    g.beginPath();
    for (const c of centres) {
      const from = Math.round(c - half), to = Math.round(c + half);
      g.moveTo(...at(from));
      for (let i = from + 1; i <= to; i++) g.lineTo(...at(i));
      if (to === from) g.lineTo(at(from)[0] + 0.01, at(from)[1]);
    }
    g.stroke();
  }
  g.restore();
}

function drawCutout(g, spec, W, H) {
  if (spec.dash && spec.vanish) throw new Error('虛線（dash）不支援 vanish');
  const solid = spec.dash === true ? null : silhouette(spec);
  // 虛線的那幾層，後面的先、前面的後。
  const layers = !spec.dash ? [] : spec.dash === true ? [{}] : [spec.dash].flat();
  const ghosts = layers.map((d) => silhouette({ ...spec, ...d }));
  const box = new THREE.Box3();
  for (const m of [solid, ...ghosts]) {
    if (!m) continue;
    m.rotation.set(spec.tilt || 0, spec.view || 0, 0, 'YXZ');
    m.updateMatrixWorld(true);
    box.union(new THREE.Box3().setFromObject(m));
  }
  const bw = box.max.x - box.min.x, bh = box.max.y - box.min.y;
  const ph = Math.max(2, Math.round(spec.size * H));
  const pw = Math.max(2, Math.round(ph * bw / bh));
  const r = Math.max(1, Math.round(H / 300));
  if (!spec.vanish) {
    // 底邊正中間在 (x, y)。
    g.save();
    g.translate(spec.x * W, spec.y * H);
    if (spec.flip) g.scale(-1, 1);
    if (solid) {
      snapCutout(solid, box, pw, ph);
      fat(g, -pw / 2, -ph, r);
    }
    if (ghosts.length) {
      // 補好縫畫在 cutFat 再描：多補半個線寬，虛線整條落在原本的形狀外面，裡面空出來的就是原本的
      // 寬——細長的東西（槍桿）才不會被兩邊的虛線吃掉。一層一層畫在 dashCanvas 上：前面那一層先把
      // 它蓋住的地方（再寬一個線寬）擦掉，後面那幾層的虛線就停在它的輪廓外面。座標是 cutFat 的，
      // 往回挪 e 對齊剪影。
      const lw = dashWidth(H), e = r + Math.round(lw / 2), cover = e + Math.ceil(lw) + 1;
      dashCanvas.width = cutFat.width = pw + 2 * cover;
      dashCanvas.height = cutFat.height = ph + 2 * cover;
      const dg = dashCanvas.getContext('2d'), fg = cutFat.getContext('2d');
      ghosts.forEach((m, i) => {
        snapCutout(m, box, pw, ph);
        if (i) {
          fg.clearRect(0, 0, cutFat.width, cutFat.height);
          fat(fg, cover, cover, cover);
          dg.globalCompositeOperation = 'destination-out';
          dg.drawImage(cutFat, 0, 0);
          dg.globalCompositeOperation = 'source-over';
        }
        fg.clearRect(0, 0, cutFat.width, cutFat.height);
        fat(fg, cover, cover, e);
        strokeDashed(dg, contours(cutFat), H);
      });
      g.drawImage(dashCanvas, -pw / 2 - cover, -ph - cover);
    }
    g.restore();
    return;
  }
  // 梯形：先補好、翻好畫在 cutFat（左上角在 (x0, y0)），再一條一條直線畫，第 i 條照它離消失點
  // 多遠（跟底邊正中間比）縮，對著 vy 那條線。
  snapCutout(solid, box, pw, ph);
  const fw = pw + 2 * r, fh = ph + 2 * r;
  cutFat.width = fw;
  cutFat.height = fh;
  const fg = cutFat.getContext('2d');
  if (spec.flip) { fg.translate(fw, 0); fg.scale(-1, 1); }
  fat(fg, r, r, r);
  const x0 = spec.x * W - fw / 2, y0 = spec.y * H - ph - r;
  const vx = spec.vanish[0] * W, vy = spec.vanish[1] * H, cx = spec.x * W;
  for (let i = 0; i < fw; i++) {
    const f = (x0 + i + 0.5 - vx) / (cx - vx);
    if (f <= 0) continue;
    g.drawImage(cutFat, i, 0, 1, fh, x0 + i, vy + (y0 - vy) * f, 1.5, fh * f);
  }
}

/* ── 地面：不規則的長橫線 ──────────────────────────────────────────
   空地不能是一片白紙——那看起來像沒畫完。從地平線（構圖給的 horizon，畫面高的比例）往下，
   畫幾條長短不一的長橫線，每一條兩頭收尖，像筆一劃拉過去。

   不規則，所以要照 README 的紋理規則：不規則的紋理只能夠大或稀疏，不能平均密密一片。這裡是
   兩者都做到：每一條都很長（畫面寬的 LEN 倍），而且稀疏——每一列最多兩條、有的列整列空著。
   亂數有固定的種子，重拍一樣。列距、線寬以出圖的高度算，特寫與遠景一樣比例。 */
const HATCH = { rows: 26, w: 1 / 380, len: [0.16, 0.5], empty: 0.3, color: '#9c8a70', seed: 11 };
function hatchGround(g, W, H, horizon) {
  const rand = rng(HATCH.seed);
  const S = H / HATCH.rows, hw = 0.5 * HATCH.w * H;
  const [lo, hi] = HATCH.len;
  g.save();
  g.fillStyle = HATCH.color;
  for (let y = horizon * H + S * 0.6; y < H; y += S) {
    if (rand() < HATCH.empty) continue;
    const n = rand() < 0.55 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const len = W * (lo + rand() * (hi - lo));
      const x = (i + rand()) / n * W - len / 2;
      const dy = (rand() - 0.5) * S * 0.4;
      g.beginPath();
      g.moveTo(x, y + dy);
      g.quadraticCurveTo(x + len / 2, y + dy - hw * 2, x + len, y + dy);
      g.quadraticCurveTo(x + len / 2, y + dy + hw * 2, x, y + dy);
      g.fill();
    }
  }
  g.restore();
}

const UP = new THREE.Vector3(0, 1, 0);
const _side = new THREE.Vector3(), _axis = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * 單邊縮小（漫畫的，不是遊戲的）：頭真正側過去多少——兩眼連線與「臉 → 鏡頭」方向的內積 d
 * （側轉角的正弦），頭仰、頭低、身體立起來都算在裡面。遠的那一隻：
 *   側轉 cut（45°）以內   一直畫，照開根號平緩地收，到 45° 還有 1 − gentle（七成五）——
 *                         縮小的幅度是遊戲裡的一半
 *   45° 以外              不畫：一刀斷掉，不是線性縮到零
 *   臉偏過 back（110°）    背對：兩隻都不畫。正側面畫靠鏡頭那一隻是刻意的，所以界線在側面之後
 * 遊戲實體遊玩時模型自己的遠眼收合（critter.js）是線性收到零的，漫畫不用它：眼睛的位置與大小一律
 * 照沒收合的骨頭量。
 */
const FAR_EYE = { from: 0.1, cut: Math.SQRT1_2, gentle: 0.25, back: (110 * Math.PI) / 180 };
function farEye(d) {
  const { from, cut, gentle } = FAR_EYE;
  if (d > cut) return 0;
  if (d <= from) return 1;
  return 1 - gentle * Math.sqrt((d - from) / (cut - from));
}

/** 骨頭 b 的局部座標 (x, y, z) → 世界座標。 */
function toWorld(c, b, x, y, z, out) {
  _m.fromArray(c.rig.matrices, b * 16);
  return out.set(x, y, z).applyMatrix4(_m).applyMatrix4(c.mesh.matrixWorld);
}
/** 世界座標 → 畫布像素 [x, y]。 */
const project = (v, w, h) => {
  const p = v.clone().project(camera);
  return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h];
};

/**
 * 藏起模型的兩隻眼睛，回傳看得到的那幾隻在畫面上的錨點（faces.js 的格式）。要在姿勢擺好、
 * 世界矩陣更新之後叫。每一隻帶著縮到幾成（s，單邊縮小，見 FAR_EYE）；r 是沒縮的原尺寸，
 * 縮多少由 drawFace 照 s 乘上去（最細的線寬限制要算在原尺寸上，遠眼才縮得下去）。
 *
 * lift、spread（shots.js 的 eyes，單位是眼睛的半高）在頭上用 3D 移：沿著這隻眼睛的頭頂方向往額頭抬、
 * 沿著兩眼連線往外分開，再投影到畫面上——頭仰起來、低下去，畫上去的眼睛跟著頭走。
 */
function eyeAnchors(c, w, h, { lift = 0, spread = 0 } = {}) {
  const eyes = [c._eyeMinusX, c._eyePlusX];
  // 先把模型的遠眼收合還原（那是遊戲的），照原尺寸的骨頭量位置與大小。
  for (const b of eyes) for (let k = 0; k < 3; k++) c.rig.scale[b * 3 + k] = c.rig.rest.scale[b * 3 + k];
  c.rig.update();
  const o3 = eyes.map((b) => toWorld(c, b, 0, 0, 0.05, new THREE.Vector3()));
  const top3 = eyes.map((b) => toWorld(c, b, 0, 0.21, 0.05, new THREE.Vector3()));
  // 頭側過去多少：d > 0 是鏡頭在 +X 那隻眼睛那一側，遠的是 −X 那隻（eyes[0]）。
  const across = o3[1].clone().sub(o3[0]).normalize();
  const toCam = camera.position.clone().sub(o3[0].clone().add(o3[1]).multiplyScalar(0.5)).normalize();
  const d = across.dot(toCam);
  const far = d >= 0 ? 0 : 1;
  // 臉朝哪：兩隻眼睛骨頭的 +z 平均。背對鏡頭（超過 FAR_EYE.back）的臉一隻眼睛都看不到——d 只量得到側過去
  // 多少，分不出前後，背後的斜角跟正面的斜角會量成一樣。界線放在側面之後：正側面（頭再低一點、偏一點，
  // 量起來常是 90° 多）畫靠鏡頭那一隻是刻意的畫法，不算背對。
  const ahead = eyes.map((b, i) => toWorld(c, b, 0, 0, 1.05, new THREE.Vector3()).sub(o3[i]))
    .reduce((m, v) => m.add(v), new THREE.Vector3());
  for (const b of eyes) for (let k = 0; k < 3; k++) c.rig.scale[b * 3 + k] = 0;
  c.rig.update();
  if (ahead.normalize().dot(toCam) < Math.cos(FAR_EYE.back)) return [];
  const s = [0, 1].map((i) => (i === far ? farEye(Math.abs(d)) : 1));
  const out = [];
  eyes.forEach((_, i) => {
    if (!s[i]) return;
    // 這一隻的頭頂方向（世界，長度是眼睛的半高）與往鼻樑的方向（往另一隻）。
    const upW = top3[i].clone().sub(o3[i]);
    const half = upW.length();
    const nose = o3[1 - i].clone().sub(o3[i]).normalize();
    const c3 = o3[i].clone().addScaledVector(upW, lift).addScaledVector(nose, -spread * half);
    const o = project(c3, w, h);
    const top = project(c3.clone().add(upW), w, h);
    const toNose = project(c3.clone().addScaledVector(nose, half), w, h);
    const r = Math.hypot(top[0] - o[0], top[1] - o[1]);
    const up = Math.atan2(top[1] - o[1], top[0] - o[0]);
    // 眼睛自己的 +x 在畫面上是 up 轉 +90°（canvas 的 y 往下，所以是順時針）；鼻樑在那一側就是 +1。
    const side = (toNose[0] - o[0]) * Math.cos(up + Math.PI / 2) + (toNose[1] - o[1]) * Math.sin(up + Math.PI / 2);
    out.push({ x: o[0], y: o[1], r, s: s[i], up, inward: side >= 0 ? 1 : -1, i });
  });
  return out;
}

/** 一隻的臉在哪（世界座標）：兩隻眼睛骨頭的中點。 */
function faceAt(c, out) {
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const [bone, v] of [[c._eyeMinusX, a], [c._eyePlusX, b]]) {
    _m.fromArray(c.rig.matrices, bone * 16);
    v.set(0, 0, 0.05).applyMatrix4(_m).applyMatrix4(c.mesh.matrixWorld);
  }
  return out.addVectors(a, b).multiplyScalar(0.5);
}

/**
 * 擺鏡頭。兩種寫法：
 *   { pos, look, fov }                       世界座標
 *   { focus, yaw, pitch, dist, fov, frame, roll }  對準 focus 那一隻的臉（cast 裡 name 或 who 是它的第一隻）：
 *                                            從臉往 yaw（世界方位，0 = +Z 那一側）、
 *                                            pitch（仰角，負的是從下往上拍）退 dist 公尺看著臉；frame [fx, fy]
 *                                            是臉落在畫面上的哪裡（從正中間算，畫面寬高的幾分之幾，+y 往下）；
 *                                            roll 是鏡頭繞視線轉幾弳（整個畫面跟著轉，臉的位置不變）
 */
function aim(cam, w, h, who) {
  camera.clearViewOffset();
  if (cam.focus) {
    const a = who(cam.focus);
    if (!a) throw new Error(`鏡頭要對準的那一隻不在場：${cam.focus}`);
    const f = faceAt(a.c, new THREE.Vector3());
    const cp = Math.cos(cam.pitch || 0);
    camera.position.set(
      f.x + cam.dist * cp * Math.sin(cam.yaw), f.y + cam.dist * Math.sin(cam.pitch || 0), f.z + cam.dist * cp * Math.cos(cam.yaw),
    );
    camera.lookAt(f);
    // roll：鏡頭繞著視線轉（拼貼裡讓幽靈頭朝畫面中間、身體往角落外伸出去），轉完臉還在正中間。
    if (cam.roll) camera.rotateZ(cam.roll);
    const [fx, fy] = cam.frame || [0, 0];
    if (fx || fy) camera.setViewOffset(w, h, -fx * w, -fy * h, w, h);
  } else {
    camera.position.set(...cam.pos);
    camera.lookAt(...cam.look);
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/** 鏡頭大概在哪個方位（擺姿勢的時候要知道：頭會稍微轉向鏡頭）。 */
const camYawFrom = (cam, x, z) => (cam.focus ? cam.yaw : Math.atan2(cam.pos[0] - x, cam.pos[2] - z));

/**
 * 一隻角色的動態狀態歸零成剛建好的樣子（critter.js 的 Critter 建構子裡那幾個）：呼吸與步態的
 * 驅動、尾巴的彈簧、空中姿勢的權重、出招的累積量。同一隻角色在每一格之間共用，不歸零的話
 * 上一格的狀態會帶進這一格——同一筆設定單獨拍跟接在別格後面拍，會是兩張不一樣的圖。
 */
function fresh(c) {
  c.drv = new Driver();
  c.sway = new Sway();
  c._vySmooth = c._airW = c._riseW = c._dip = c._dipV = c._lastVy = 0;
  c._wasGrounded = true;
  c._mvYaw = c._mvYawPrev = c._mvTail = c._mvPitch = 0;
}

/**
 * 擺好一隻：站哪、面朝哪、什麼姿勢、倒了幾度。姿勢跑幾十幀讓呼吸與尾巴的彈簧穩下來。
 * speed（公尺／秒）是在跑：步態跑 frames 幀（預設 45）停在那一格——換 frames 就是換一個步伐。
 * air 是在空中，值是垂直速度（正的往上衝、負的往下掉：critter.js 的空中姿勢）。
 * scale 整隻放大（騎士幽靈 1.2）；alpha 是半透明的那幾隻（幽靈）散到剩幾成；
 * shields 是國王的亡魂繞著幾面盾。
 */
function pose(a, spec, cam) {
  const { c, crown, helm, wrap, shadow } = a;
  fresh(c);
  const [x, z] = spec.at;
  const y0 = spec.y || 0;
  const k = spec.scale || 1, height = a.height * k;
  c._yaw = c._yawGoal = spec.yaw;
  const viewYaw = camYawFrom(cam, x, z);
  const st = { speed: spec.speed || 0, grounded: spec.air === undefined, vy: spec.air || 0, viewYaw, move: spec.move };
  for (let i = 0, n = spec.frames || 45; i < n; i++) c.update(1 / 60, st);
  if (crown) crown.update();
  if (helm) helm.update();
  arm(a, spec.blade)?.update();
  if (a.tint) for (const m of a.tint.material) m.opacity = spec.alpha ?? GHOST_ALPHA;
  wrap.scale.setScalar(k);
  // 往牠自己的 +X 側倒：支點在那一側的身體外緣（大約半個身寬）。
  const tip = spec.tip || 0, half = 0.28 * height;
  _side.set(Math.cos(spec.yaw), 0, -Math.sin(spec.yaw));
  _axis.crossVectors(UP, _side).normalize();
  wrap.quaternion.setFromAxisAngle(_axis, tip);
  wrap.position.set(x + half * _side.x * (1 - Math.cos(tip)), y0 + half * Math.sin(tip), z + half * _side.z * (1 - Math.cos(tip)));
  shadow.position.set(x + half * _side.x * Math.sin(tip) * 0.6, (spec.ground ?? y0) + 0.002, z + half * _side.z * Math.sin(tip) * 0.6);
  shadow.visible = spec.shadow !== false;
  shadow.rotation.z = -spec.yaw;
  shadow.scale.set(k, 1.6 * k, 1);
  if (spec.shields) {
    if (!a.shields) { a.shields = new ShieldRing(spec.shields); a.shields.follow(c); scene.add(a.shields.node); }
    a.shields._spin = spec.spin || 0;
    a.shields._t = 0;
    a.shields.snap(spec.shields);
    a.shields.show(0, spec.shields, x, y0, z, height);
  }
}

/** 固定種子的亂數（mulberry32）：集中線每次重拍都一樣。 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 集中線：從畫面外往 (cx, cy) 收的 n 條楔形，內端尖、落在 clear × h 外面（每條長短不一），
 * 外端寬 width × h 上下。線本身就是「線」，沒有邊。
 */
function focusLines(g, w, h, cx, cy, { n = 110, clear = 0.42, width = 0.012, seed = 7 } = {}) {
  const rand = rng(seed);
  const R = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + 4;
  g.save();
  g.fillStyle = `#${INK.toString(16).padStart(6, '0')}`;
  for (let i = 0; i < n; i++) {
    const a = (i + rand() * 0.8) / n * Math.PI * 2;
    const r0 = clear * h * (0.9 + rand() * rand() * 0.9);
    const half = width * h * (0.25 + rand() ** 2 * 1.2) / 2;
    const ux = Math.cos(a), uy = Math.sin(a);
    g.beginPath();
    g.moveTo(cx + ux * r0, cy + uy * r0);
    g.lineTo(cx + ux * R - uy * half, cy + uy * R + ux * half);
    g.lineTo(cx + ux * R + uy * half, cy + uy * R - ux * half);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/**
 * 光芒（光從哪裡透出來、從誰身上擴散出去）：從 at（畫面的比例）往外放的 n 道光，等角度、等寬，
 * 一道光一道空——規則的排法。from、to 是放射的角度範圍（弳，canvas 的角度：0 往右、π/2 往下），
 * 沒給就是一整圈；inner 是內端離中心多遠（畫面高的幾倍）；width 是一道光佔它那一份角度的幾成；
 * color、alpha 是光的顏色。畫在角色底下、剪影後面（門後的光被門擋住）；front: true 的畫在剪影前面。
 * 光芒是效果線，不是紋理。
 */
function rays(g, w, h, { at = [0.5, 0.5], n = 24, from = 0, to = Math.PI * 2, inner = 0.08, width = 0.5, color = '#fff6d8', alpha = 0.9 } = {}) {
  const cx = at[0] * w, cy = at[1] * h;
  const R = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + 4;
  const r0 = inner * h, step = (to - from) / n, half = (step * width) / 2;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = from + (i + 0.5) * step;
    g.moveTo(cx + Math.cos(a - half * 0.25) * r0, cy + Math.sin(a - half * 0.25) * r0);
    g.lineTo(cx + Math.cos(a - half) * R, cy + Math.sin(a - half) * R);
    g.lineTo(cx + Math.cos(a + half) * R, cy + Math.sin(a + half) * R);
    g.lineTo(cx + Math.cos(a + half * 0.25) * r0, cy + Math.sin(a + half * 0.25) * r0);
    g.closePath();
  }
  g.fill();
  g.restore();
}

/**
 * 速度線（跑過去、掉下去）：沿 angle（弳，canvas 的角度）的一列一列平行長線，等間隔，每一列
 * 一條、兩頭收尖，長度是畫面寬的 len 倍（一列一列輪流長短）。rows 是幾列，band [y0, y1] 是
 * 排在畫面的哪一段（沿垂直於線的方向，畫面的比例）。畫在角色底下，墨色。
 */
function speedLines(g, w, h, { angle = 0, rows = 16, band = [0.1, 0.9], len = [0.35, 0.6], width = 0.006, seed = 3 } = {}) {
  const rand = rng(seed);
  const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
  const D = Math.hypot(w, h), hw = (width * h) / 2;
  g.save();
  g.fillStyle = `#${INK.toString(16).padStart(6, '0')}`;
  for (let i = 0; i < rows; i++) {
    const t = band[0] + ((i + 0.5) / rows) * (band[1] - band[0]);
    // 這一列的中線：畫面中心沿法線方向偏 (t − 0.5) 個對角線。
    const ox = w / 2 + nx * (t - 0.5) * D, oy = h / 2 + ny * (t - 0.5) * D;
    const L = w * (i % 2 ? len[0] : len[1]);
    const s = (rand() - 0.5) * D * 0.5;
    const ax = ox + ux * (s - L / 2), ay = oy + uy * (s - L / 2);
    const bx = ox + ux * (s + L / 2), by = oy + uy * (s + L / 2);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo(mx + nx * hw * 2, my + ny * hw * 2, bx, by);
    g.quadraticCurveTo(mx - nx * hw * 2, my - ny * hw * 2, ax, ay);
    g.fill();
  }
  g.restore();
}

/**
 * 霧與塵（幽靈散掉的霧、砸起來的塵土）：幾團大圓，同一團的圓聯成一個形狀（一條路徑一次塗），
 * 沒有墨線、半透明。不規則，所以照紋理規則要夠大、成叢：每一團是畫面上看得出形狀的一塊。
 * 每一團 { x, y, r, color, alpha, n, seed }：中心（畫面的比例）、大小（畫面高的比例），圓的個數。
 * 畫在最上層（角色前面）。
 */
function puffs(g, w, h, list) {
  for (const { x, y, r, color = '#e8f1fa', alpha = 0.8, n = 6, seed = 1 } of list) {
    const rand = rng(seed);
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.6;
      const d = i ? r * h * (0.45 + rand() * 0.3) : 0;
      const rr = r * h * (i ? 0.45 + rand() * 0.25 : 0.62);
      const px = x * w + Math.cos(a) * d * 1.3, py = y * h + Math.sin(a) * d * 0.8;
      g.moveTo(px + rr, py);
      g.arc(px, py, rr, 0, Math.PI * 2);
    }
    g.fill();
    g.restore();
  }
}

/** 拍好的那一張（網點之後）再畫上表情：一張 2D 畫布。 */
const sheet = document.createElement('canvas');
const sheetG = sheet.getContext('2d');

/**
 * 拍一組角色：擺好 view.cast、照 view.cam 對好鏡頭、用 view.light 打光，拍下來過一次網點，
 * 回傳那一張（透明的離屏畫布）與要畫上去的表情。props、souls 只有主畫面有。
 */
function shoot(view, w, h, ink, { props, souls } = {}) {
  renderer.setSize(w, h, false);
  camera.fov = view.cam.fov;
  camera.aspect = w / h;
  // 主光從哪裡來：這一組自己的（世界方向，指向光），沒給就是遊戲那一盞。毛皮與王冠各讀一份。
  const key = new THREE.Vector3(...(view.light || KEY_POS)).normalize();
  LIGHT_DIR.value.copy(key);
  U_KEYDIR.value.copy(key);
  for (const a of allActors()) {
    a.wrap.visible = false;
    a.shadow.visible = false;
    a.shields?.hide();
  }
  buildProps(props);
  const used = {};
  const cast = view.cast.map((spec) => [spec, borrow(spec, used)]);
  for (const [spec, a] of cast) {
    a.wrap.visible = true;
    a.c.setInkPx(ink, h);
    pose(a, spec, view.cam);
  }
  scene.updateMatrixWorld(true);
  aim(view.cam, w, h, (name) => cast.find(([s]) => (s.name ?? s.who) === name)?.[1]);
  placeSouls(souls);
  scene.updateMatrixWorld(true);
  const faces = [];
  for (const [spec, a] of cast) {
    if (spec.face) faces.push([spec.face, eyeAnchors(a.c, w, h, spec.eyes)]);
  }
  target.setSize(w, h);
  screen.material.uniforms.uCell.value = h / HALFTONE.cells;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(screenScene, screenCam);
  // 拍好了，先收起來：下一組、背景的剪影都要借同一個畫布。
  const img = document.createElement('canvas');
  img.width = w;
  img.height = h;
  img.getContext('2d').drawImage(canvas, 0, 0);
  return { img, faces };
}

/** 拍第 id 格：回傳 PNG 的 data URL。 */
function render(id) {
  const shot = SHOTS.find((s) => s.id === id);
  if (!shot) throw new Error(`沒有這一格：${id}`);
  const [w, h] = shot.size;
  /* 拼貼（collage）：同一個畫面裡另外幾組角色，各用自己的鏡頭與光拍，疊進來——現實裡不可能同時
     成立的視角（四個角落各一個俯視）在漫畫裡拼在一起，製造張力。每一組 { cast, cam, light, front }，
     預設疊在主畫面底下，front 的疊在上面。 */
  const collage = (shot.collage || []).map((v) => ({ ...shoot(v, w, h, shot.ink), front: !!v.front }));
  const main = shoot(shot, w, h, shot.ink, { props: shot.props, souls: shot.souls });
  sheet.width = w;
  sheet.height = h;
  sheetG.clearRect(0, 0, w, h);
  if (shot.horizon !== undefined) hatchGround(sheetG, w, h, shot.horizon);
  // 光芒預設在剪影後面（門後透出來的光被門擋住）；front 的在剪影前面（從誰身上擴散出來的光）。
  const light = [shot.rays || []].flat();
  for (const r of light) if (!r.front) rays(sheetG, w, h, r);
  for (const spec of shot.bg || []) drawCutout(sheetG, spec, w, h);
  for (const r of light) if (r.front) rays(sheetG, w, h, r);
  if (shot.focusLines) {
    // 收向鏡頭對準的那張臉（cam.focus），沒有就是畫面正中間；at 給了就收向那裡（畫面的比例）。
    const o = shot.focusLines === true ? {} : shot.focusLines;
    const [fx, fy] = shot.cam.frame || [0, 0];
    const [cx, cy] = o.at ? [o.at[0] * w, o.at[1] * h] : shot.cam.focus ? [(0.5 + fx) * w, (0.5 + fy) * h] : [w / 2, h / 2];
    focusLines(sheetG, w, h, cx, cy, o);
  }
  if (shot.speedLines) speedLines(sheetG, w, h, shot.speedLines);
  const lay = ({ img, faces }) => {
    sheetG.drawImage(img, 0, 0);
    for (const [face, anchors] of faces) drawFace(sheetG, face, anchors, shot.ink);
  };
  for (const v of collage) if (!v.front) lay(v);
  lay(main);
  for (const v of collage) if (v.front) lay(v);
  if (shot.puffs) puffs(sheetG, w, h, shot.puffs);
  return sheet.toDataURL('image/png');
}

/* ── 打開來看 ─────────────────────────────────────────────────── */
const label = document.createElement('div');
label.id = 'shot-label';
const shown = document.createElement('img');
shown.id = 'shot';
document.body.append(shown, label);
let at = 0;
function show(i) {
  at = (i + SHOTS.length) % SHOTS.length;
  shown.src = render(SHOTS[at].id);
  label.textContent = `${SHOTS[at].id}　（← → 換一格）`;
}
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') show(at + 1);
  if (e.key === 'ArrowLeft') show(at - 1);
});

document.getElementById('boot')?.remove();
show(0);

window.comic = { ids: SHOTS.map((s) => s.id), render };
