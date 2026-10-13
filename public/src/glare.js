/* ── src/glare.js ────────────────────────────────────────────────────
   國王瞪視（skills.js 的 glare）在畫面上的樣子。規則——蓄力多久、主角定住多久、被吸多遠——在
   skills.js 與 combat.js 的 DAZE；這裡只畫，fight.js 每幀叫。

     眼睛發光  國王蓄力的時候兩隻眼睛各亮起一團紅光（永遠面向鏡頭的光暈，跟靈魂的光暈同一張貼圖）：
              外面一圈紅暈照一般的混合疊上去（國王是淺色的幽靈，加色的紅疊在淺色上會被洗成白的），
              中間一顆小的暖白亮芯照加色混合——亮的地方是光，紅的那一圈才看得出顏色。越蓄越大、越亮；瞪下去的那一刻閃一下（GLOW.flash），之後一直亮到收招，
              收招之後很快淡掉。光暈擺在眼睛（那根骨頭的頂點的中心）往鏡頭挪 GLOW.ahead 公尺：
              擺在眼睛正中的話一半埋在頭裡，被頭的深度擋掉。
     出竅      主角被瞪的那 DAZE.time 秒，主角身上疊一隻自己的幽靈（monster.js 的 makeGhostCritter，
              倒下的時候浮起來的那一隻）：同一隻動物、同一個朝向、接手主角這一刻的步態與空中姿勢，
              往上浮一點點、左右微微晃（SPIRIT），頭一直甩（monster.js 的 DAZE_MOVE，BOSS 第一次倒下
              站起來的那一套甩）。時間到就收起來——靈魂回到身體裡。
     畫面      同一段時間鏡頭的縮放來回晃（dazeView：不是挪位置，是 zoom）：先往裡推、一邊推一邊抖，
              時間到剛好回到 1；畫面糊掉（CSS 的 blur），正中間最糊。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { DAZE } from './combat.js';
import { SKILL } from './skills.js';
import { makeGhostCritter, DAZE_MOVE } from './monster.js';
import { Mover } from './moves.js';
import { glowTexture } from './soul.js';

/**
 * 眼睛的光暈：紅暈多大（公尺，直徑）、亮芯是紅暈的幾成大、蓄力一開始有幾成、閃一下多大幾成、閃多久（秒，指數收）、
 * 淡進淡出多快（秒，指數追）、往鏡頭挪多遠（公尺）、紅暈與亮芯的顏色（sRGB 0～1）。
 */
export const GLOW = {
  size: 0.5, core: 0.4, start: 0.35, flash: 0.8, flashTau: 0.12, tau: 0.06, ahead: 0.12,
  color: [0.95, 0.08, 0.04], hot: [1, 0.85, 0.6],
};

/** 出竅的幽靈：往上浮多高（公尺）、左右晃多大（公尺）、一秒晃幾下。 */
export const SPIRIT = { lift: 0.12, sway: 0.035, hz: 7 };

/** 畫面：縮放往裡推多少、抖多大、一秒抖幾下；最糊多糊（CSS 像素）。 */
export const VIEW = { push: 0.06, shake: 0.05, hz: 8, blur: 3 };

const smooth = (u) => { const k = Math.min(1, Math.max(0, u)); return k * k * (3 - 2 * k); };

/**
 * 被瞪了 t 秒的時候畫面怎樣：zoom（鏡頭的縮放，1 是原本）、blur（CSS 像素）。頭尾都是原本的樣子。
 */
export function dazeView(t) {
  const u = Math.min(1, Math.max(0, t / DAZE.time)), env = Math.sin(Math.PI * u);
  return { zoom: 1 + env * (VIEW.push + VIEW.shake * Math.sin(2 * Math.PI * VIEW.hz * t)), blur: VIEW.blur * env };
}

/**
 * 這一隻（會瞪的那一類）的眼睛現在該亮幾成（0～1）：蓄力的時候從 GLOW.start 往上長（越蓄越快），
 * 瞪下去之後滿的；沒在瞪是 0。
 */
export function glowOf(m) {
  const c = m.cast, S = SKILL.glare;
  if (!c || c.skill !== 'glare') return 0;
  if (c.t >= S.windup) return 1;
  const u = c.t / S.windup;
  return GLOW.start + (1 - GLOW.start) * u * u;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _to = new THREE.Vector3();

/** 國王的兩團眼光：掛在場景上（世界座標），每幀照眼睛那兩根骨頭擺。 */
export class EyeGlow {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./critter.js').Critter} critter 會瞪的那一隻
   */
  constructor(scene, critter) {
    this.critter = critter;
    /* 每一隻眼睛：骨頭、那根骨頭的頂點在骨頭座標裡的中心（cat.bin 的頂點就是骨頭座標，death.js 的 footprint）。 */
    this.eyes = [];
    const pos = critter.data.position, ids = critter._boneId;
    for (let b = 0; b < critter.rig.count; b++) {
      if (!critter.rig.names[b].startsWith('eye')) continue;
      const at = new THREE.Vector3();
      let n = 0;
      for (let v = 0; v < ids.length; v++) {
        if (ids[v] !== b) continue;
        at.x += pos[v * 3]; at.y += pos[v * 3 + 1]; at.z += pos[v * 3 + 2];
        n++;
      }
      if (n) this.eyes.push({ bone: b, at: at.divideScalar(n) });
    }
    const map = glowTexture(), srgb = (c) => new THREE.Color().setRGB(...c, THREE.SRGBColorSpace);
    this.halo = new THREE.SpriteMaterial({ map, color: srgb(GLOW.color), depthWrite: false, transparent: true, fog: false });
    this.hot = new THREE.SpriteMaterial({
      map, color: srgb(GLOW.hot), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    });
    /* 每一隻眼睛兩片：紅暈、亮芯（亮芯後畫，疊在紅暈上）。都在半透明的國王（monster.js 的 SEE_THROUGH_ORDER）之後。 */
    this.sprites = this.eyes.map(() => [this.halo, this.hot].map((mat, i) => {
      const s = new THREE.Sprite(mat);
      s.renderOrder = 6 + i;
      s.visible = false;
      scene.add(s);
      return s;
    }));
    /** 現在亮幾成、閃到哪（1 → 0）、上一幀瞪下去了沒。 */
    this.k = 0;
    this.flash = 0;
    this._stared = false;
  }

  hide() {
    this.k = 0;
    this.flash = 0;
    for (const pair of this.sprites) for (const s of pair) s.visible = false;
  }

  /** 一幀：照 m 在不在瞪（glowOf）追亮度，瞪下去的那一幀閃一下，擺好兩團光。在 critter.update 之後叫。 */
  show(dt, m, camera) {
    const goal = glowOf(m), stared = !!(m.cast && m.cast.stared);
    if (stared && !this._stared) this.flash = 1;
    this._stared = stared;
    this.k += (goal - this.k) * (1 - Math.exp(-dt / GLOW.tau));
    this.flash *= Math.exp(-dt / GLOW.flashTau);
    const on = this.k > 0.01;
    for (const pair of this.sprites) for (const s of pair) s.visible = on;
    if (!on) return;
    this.halo.opacity = this.hot.opacity = Math.min(1, this.k);
    const size = GLOW.size * (0.5 + 0.5 * this.k) * (1 + GLOW.flash * this.flash) * this.critter.root.scale.x;
    const mesh = this.critter.mesh, M = this.critter.rig.matrices;
    mesh.updateWorldMatrix(true, false);
    this.eyes.forEach(({ bone, at }, i) => {
      _p.copy(at).applyMatrix4(_m.fromArray(M, bone * 16)).applyMatrix4(mesh.matrixWorld);
      _to.subVectors(camera.position, _p).normalize();
      const [halo, hot] = this.sprites[i];
      halo.position.copy(_p).addScaledVector(_to, GLOW.ahead);
      hot.position.copy(halo.position);
      halo.scale.set(size, size, 1);
      hot.scale.set(size * GLOW.core, size * GLOW.core, 1);
    });
  }
}

/**
 * 出竅的幽靈：主角那幾隻動物各一隻（要用到才建，換動物的時候 prep），被瞪的時候疊在主角身上。
 */
export class Spirit {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./critter.js').Zoo} zoo 主角那一隻
   */
  constructor(scene, zoo) {
    this.scene = scene;
    this.zoo = zoo;
    this.looks = new Map();
    this.mover = new Mover({ daze: DAZE_MOVE }, (phase, t) => [phase, t]);
    this._on = null;
    this._ink = null;
    this.prep(zoo.modelId);
  }

  /** 這一隻動物的幽靈先建好、藏著（被瞪的那一刻才建就是一頓）。 */
  prep(model) {
    if (this.looks.has(model)) return;
    const c = makeGhostCritter(this.zoo, model);
    c.root.visible = false;
    if (this._ink) c.setInkPx(...this._ink);
    this.scene.add(c.root);
    this.looks.set(model, c);
  }

  setInkPx(px, h) {
    this._ink = [px, h];
    for (const c of this.looks.values()) c.setInkPx(px, h);
  }

  /**
   * 一幀：主角被瞪著（player.daze）的話，這一隻動物的幽靈疊在牠身上、浮起一點、左右晃、甩頭；
   * 沒被瞪就收起來。在 zoo.update 之後叫（接手主角這一幀的朝向）。
   */
  show(dt, player, viewYaw) {
    const D = player.daze, model = this.zoo.modelId;
    if (D) this.prep(model);
    const c = D ? this.looks.get(model) : null;
    for (const g of this.looks.values()) if (g !== c) g.root.visible = false;
    if (!c) { this._on = null; this.mover.step(dt, null, 0); return; }
    // 剛出竅（或換了動物）：接手主角的朝向與步態，從同一個樣子開始晃。
    if (this._on !== c) { c.adopt(this.zoo.active); c.setHat(this.zoo.hatOn); this._on = c; }
    const u = D.t / DAZE.time, yaw = this.zoo.active._yaw;
    const sway = SPIRIT.sway * Math.sin(2 * Math.PI * SPIRIT.hz * D.t) * Math.sin(Math.PI * Math.min(1, u));
    c.root.visible = true;
    c.root.position.set(player.x + Math.cos(yaw) * sway, player.y + SPIRIT.lift * smooth(2 * u), player.z - Math.sin(yaw) * sway);
    c.setFacing(yaw);
    c.update(dt, {
      speed: 0, grounded: player.grounded, vy: player.vy, viewYaw,
      move: this.mover.step(dt, 'daze', D.t),
    });
  }
}
