// 永遠不戴帽子的 Critter（怪物、國王、路人；critter.js 的 opts.hat === false）的離線驗證器。
//
// 那幾隻建幾何的時候就把帽子的三角形從索引裡拿掉，而不是每幀縮到零再畫。主張是「除了帽子，
// 畫出來一模一樣」，這支工具量的就是那句話：
//
//   · 去掉的只有帽子骨頭的三角形：每根骨頭的三角形數，帽子的歸零、其餘的一個不少
//   · 留下來的三角形就是原本那一串照順序去掉帽子——同樣的頂點、同樣的繞向、同樣的先後，
//     三個材質群組照樣首尾相接
//   · 沒有三角形一半在帽子上、一半在別的骨頭上（那種去掉了會在身上開洞）
//   · 頂點（烘焙後的位置、墨線往外推的方向）、縮放、站的位置、包圍球跟戴得上帽子的那一隻一樣
//   · Zoo 共用的那份資料（data.index、群組）沒被動到
//   · setHat(true) 戴不回去；幽靈、Zoo、圖鑑那幾隻還留著帽子，H 鍵照樣戴上脫下
//
// 用法：node tools/verify-hatless.mjs

import { readFileSync } from 'node:fs';
import { loadZoo, Critter } from '../public/src/critter.js';
import { makeMonsterCritter, makeLivingKing, makeGhostCritter } from '../public/src/monster.js';
import { KINDS } from '../public/src/combat.js';

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok ' : ' FAIL'} ${msg}`);
  if (!cond) fails++;
};

const buf = readFileSync('public/assets/cat.bin');
const zoo = await loadZoo({ buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
const shared = new Map([...zoo.critters].map(([id, c]) => [id, {
  index: c.data.index.slice(), groups: JSON.stringify(c.data.header.groups),
}]));

const GROUPS = ['lit', 'unlit', 'outline'];
const groupsOf = (c) => Object.fromEntries(c.data.header.groups.map((q) => [q.name, q]));

/** 每根骨頭有幾個三角形（照第一個角的骨頭；每個三角形只屬於一根骨頭，下面另外驗）。 */
function perBone(c, index, ranges) {
  const n = new Array(c.rig.count).fill(0);
  for (const r of ranges) for (let i = r.start; i < r.start + r.count; i += 3) n[c._boneId[index[i]]]++;
  return n;
}

/** 原本那一串照順序去掉帽子：每個群組各自比。 */
function sameMinusHat(c) {
  const hat = new Set(c._hatBones), src = c.data.index, dst = c.geometry.index.array, G = groupsOf(c);
  let mixed = 0;
  for (let m = 0; m < 3; m++) {
    const q = G[GROUPS[m]], g = c.geometry.groups[m];
    if (g.materialIndex !== m) return 'materialIndex';
    let j = g.start;
    for (let i = q.start; i < q.start + q.count; i += 3) {
      const h = [0, 1, 2].filter((k) => hat.has(c._boneId[src[i + k]])).length;
      if (h && h < 3) mixed++;
      if (h === 3) continue;
      for (let k = 0; k < 3; k++) if (dst[j + k] !== src[i + k]) return `${GROUPS[m]} 第 ${(j - g.start) / 3} 個三角形不一樣`;
      j += 3;
    }
    if (j !== g.start + g.count) return `${GROUPS[m]} 多了 ${(g.start + g.count - j) / 3} 個三角形`;
    if (m && g.start !== c.geometry.groups[m - 1].start + c.geometry.groups[m - 1].count) return `${GROUPS[m]} 沒有接在上一段後面`;
  }
  if (c.geometry.groups[0].start !== 0) return 'lit 不是從 0 開始';
  if (dst.length !== c.geometry.groups[2].start + c.geometry.groups[2].count) return '索引尾巴多出來';
  return mixed ? `${mixed} 個三角形一半在帽子上` : '';
}

const tris = (c) => c.geometry.groups.reduce((n, g) => n + g.count, 0) / 3;
const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 光頭的 c 跟戴得上帽子的 ref（同一隻、同樣大）比：除了索引，其餘一樣。 */
function checkBare(label, c, ref) {
  const G = groupsOf(c), hat = new Set(c._hatBones);
  const before = perBone(c, c.data.index, GROUPS.map((n) => G[n]));
  const after = perBone(c, c.geometry.index.array, c.geometry.groups);
  const hatTris = c._hatBones.reduce((n, b) => n + before[b], 0);
  console.log(`  ${label}（${c.modelId}）：${tris(ref)} → ${tris(c)} 個三角形（帽子 ${hatTris}，`
    + `${(100 * hatTris / tris(ref)).toFixed(1)}%）；墨線 ${ref.geometry.groups[2].count / 3} → ${c.geometry.groups[2].count / 3}`);
  ok(c._hatBones.length > 0 && hatTris > 0, `${label}：有帽子可拿`);
  ok(before.every((n, b) => (hat.has(b) ? after[b] === 0 : after[b] === n)), `${label}：只有帽子的骨頭少了三角形，其餘每根骨頭一個不少`);
  ok(tris(ref) - tris(c) === hatTris, `${label}：少掉的正好是帽子那 ${hatTris} 個`);
  const why = sameMinusHat(c);
  ok(!why, `${label}：留下的三角形就是原本那一串照順序去掉帽子${why ? `（${why}）` : ''}`);
  for (const a of ['position', 'aBakeN', 'aInkW', 'normal', 'aBone']) {
    ok(sameArr(c.geometry.attributes[a].array, ref.geometry.attributes[a].array), `${label}：${a} 跟戴得上帽子的一樣`);
  }
  ok(c.mesh.scale.equals(ref.mesh.scale) && c.mesh.position.equals(ref.mesh.position), `${label}：縮放與腳的位置一樣`);
  ok(c.geometry.boundingSphere.equals(ref.geometry.boundingSphere), `${label}：包圍球一樣`);
  c.setHat(true);
  c.update(1 / 60, { speed: 0, grounded: true, vy: 0, viewYaw: 0 });
  ok(!c.hatOn && c._hatBones.every((b) => c.rig.scale[b * 3] === 0), `${label}：setHat(true) 戴不回去`);
}

/** 留著帽子的：索引與群組照原樣。 */
function checkHatted(label, c) {
  const G = groupsOf(c);
  ok(sameArr(c.geometry.index.array, c.data.index)
    && c.geometry.groups.every((g, m) => g.start === G[GROUPS[m]].start && g.count === G[GROUPS[m]].count),
  `${label}：帽子的三角形還在（${tris(c)} 個）`);
}

console.log('1. 怪物');
for (const kind of Object.keys(KINDS)) {
  const c = makeMonsterCritter(zoo, kind);
  const ref = new Critter(c.data, c.modelId, { height: c.height });
  checkBare(kind, c, ref);
}

console.log('2. 復活的國王');
{
  const c = makeLivingKing(zoo);
  checkBare('國王', c, new Critter(c.data, c.modelId, { height: c.height, skin: 'grey' }));
}

console.log('3. 路人（folk.js 的建法）');
for (const [id, own] of zoo.critters) {
  const c = new Critter(own.data, id, { height: own.height, skin: own.skins[0], hat: false });
  checkBare(`路人 ${id}`, c, new Critter(own.data, id, { height: own.height, skin: own.skins[0] }));
}

console.log('4. 留著帽子的那幾隻');
for (const [id, c] of zoo.critters) checkHatted(`Zoo ${id}`, c);
for (const id of zoo.models) {
  const g = makeGhostCritter(zoo, id);
  checkHatted(`幽靈 ${id}`, g);
  g.setHat(true);
  ok(g.hatOn, `幽靈 ${id}：照玩家戴上帽子`);
}
{
  zoo.setHat(false);
  zoo.update(1 / 60, { speed: 0, grounded: true, vy: 0, viewYaw: 0 });
  const a = zoo.active;
  const off = a._hatBones.every((b) => a.rig.scale[b * 3 + 1] === 0);
  zoo.setHat(true);
  zoo.update(1 / 60, { speed: 0, grounded: true, vy: 0, viewYaw: 0 });
  const on = a._hatBones.every((b) => a.rig.scale[b * 3 + 1] === a.rig.rest.scale[b * 3 + 1] && a.rig.scale[b * 3 + 1] !== 0);
  ok(zoo.hatOn && off && on, '玩家：H 鍵照樣脫下、戴上');
}

console.log('5. Zoo 共用的資料');
for (const [id, c] of zoo.critters) {
  const s = shared.get(id);
  ok(sameArr(c.data.index, s.index) && JSON.stringify(c.data.header.groups) === s.groups, `${id}：data.index 與群組沒被動到`);
}

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
