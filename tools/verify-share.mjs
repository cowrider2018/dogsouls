// 同一種動物共用一份烘焙（critter.js 的 BAKES）的離線驗證器。
//
// 第二隻起不再量部位、不再烘超橢球，直接拿第一隻烘好的那一份。主張是「建出來跟自己烘的
// 一模一樣，而且誰也動不到誰」，這支工具量的就是那句話：
//
//   · 每一種建法（怪物每一類、玩家的幽靈、復活的國王、路人、圖鑑那種戴帽子的）拿共用那一份
//     建的，跟用一份從沒烘過的資料自己烘的比：每個頂點屬性、索引與群組、包圍球、縮放與腳的
//     位置、部位表、建構完的骨架、倒下用的輪廓（death.js 的 footprint），逐位元相同
//   · 動起來也一樣：同樣的輸入跑幾幀，骨架逐位元相同
//   · 真的有共用：頂點陣列是同一個；顏色、屬性物件（GPU 緩衝）、包圍球是每一隻自己的
//   · 誰也動不到誰：怪物上色、戴頭盔漆耳朵、玩家換毛色，都只改自己那一份顏色
//   · 建一隻要多久：自己烘的、共用的（只印，不當成過關條件）
//
// 用法：node tools/verify-share.mjs

import { readFileSync } from 'node:fs';
import { loadZoo, Critter } from '../public/test/src/critter.js';
import { parseCat } from '../public/src/cat/rig.js';
import { speciesModels } from '../public/src/cat/species.js';
import { makeMonsterCritter, makeLivingKing, makeGhostCritter } from '../public/test/src/monster.js';
import { footprint } from '../public/test/src/death.js';
import { Helm } from '../public/test/src/helm.js';
import { KINDS } from '../public/test/src/combat.js';

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok ' : ' FAIL'} ${msg}`);
  if (!cond) fails++;
};

const buf = readFileSync('public/assets/cat.bin');
const bytes = () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const zoo = await loadZoo({ buffer: bytes() });

/** 一份從沒烘過的資料：跟 loadZoo 同一個名冊，但 data 物件是新的，所以 BAKES 裡沒有它。 */
function fresh() {
  const roster = speciesModels(parseCat(bytes()), { wear: ['bucket'] });
  const critters = new Map();
  for (const { id, data } of roster) critters.set(id, { data, height: zoo.critters.get(id).height });
  return { critters, models: zoo.models };
}

const ATTRS = ['position', 'normal', 'aOuter', 'aBakeN', 'aInkW', 'aBone', 'aSway', 'color'];
const sameArr = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const rigOf = (c) => [c.rig.matrices, c.rig.position, c.rig.rotation, c.rig.scale];

/** 共用那一份建的 c，跟自己烘的 ref（同樣的建法）比。 */
function same(label, c, ref) {
  const bad = [];
  for (const a of ATTRS) if (!sameArr(c.geometry.attributes[a].array, ref.geometry.attributes[a].array)) bad.push(a);
  if (!sameArr(c.geometry.index.array, ref.geometry.index.array)) bad.push('index');
  if (JSON.stringify(c.geometry.groups) !== JSON.stringify(ref.geometry.groups)) bad.push('groups');
  if (!c.geometry.boundingSphere.equals(ref.geometry.boundingSphere)) bad.push('包圍球');
  if (!c.mesh.scale.equals(ref.mesh.scale) || !c.mesh.position.equals(ref.mesh.position) || c.height !== ref.height) bad.push('縮放／腳');
  if (JSON.stringify(c.shape) !== JSON.stringify(ref.shape)) bad.push('部位表');
  for (const k of ['_posRaw', '_nrmRaw', '_boneId', '_twin', '_posBaked']) if (!sameArr(c[k], ref[k])) bad.push(k);
  if (!rigOf(c).every((m, i) => sameArr(m, rigOf(ref)[i])) || !!c.rig._cache !== !!ref.rig._cache) bad.push('骨架');
  if (!sameArr(footprint(c), footprint(ref))) bad.push('footprint');
  ok(!bad.length, `${label}：跟自己烘的一模一樣${bad.length ? `（${bad.join('、')} 不一樣）` : ''}`);
  const st = [
    { speed: 5, grounded: true, vy: 0, viewYaw: 0.7 },
    { speed: 3, grounded: false, vy: 4, viewYaw: -1.2, move: { yaw: 0.4, headYaw: 0.3, tailYaw: -0.5, legs: 0.6, front: 0.3, w: 1 } },
    { speed: 0, grounded: true, vy: 0, viewYaw: 2.5 },
  ];
  for (const s of st) for (const x of [c, ref]) { x.setFacing(1.1); x.update(1 / 60, s); x.update(1 / 30, s); }
  ok(rigOf(c).every((m, i) => sameArr(m, rigOf(ref)[i])), `${label}：動起來骨架也一樣`);
}

/** 拿共用那一份的 c 跟 first（那一種動物第一隻、真的烘過的）：陣列共用、每一隻自己的不共用。 */
function shares(label, c, first) {
  const A = c.geometry.attributes, F = first.geometry.attributes;
  const baked = ['position', 'normal', 'aOuter', 'aBakeN', 'aInkW', 'aBone', 'aSway'];
  ok(baked.every((a) => A[a].array === F[a].array) && c._posBaked === first._posBaked && c.shape === first.shape,
    `${label}：頂點陣列與部位表跟第一隻是同一份`);
  ok(A.color.array !== F.color.array && baked.every((a) => A[a] !== F[a])
    && c.geometry !== first.geometry && c.geometry.boundingSphere !== first.geometry.boundingSphere,
  `${label}：顏色、屬性物件（GPU 緩衝）、幾何、包圍球是自己的`);
}

console.log('1. 每一種建法：共用的跟自己烘的比');
const firsts = zoo.critters;          // Zoo 那三隻就是每一種動物的第一隻
const built = [];
for (const kind of Object.keys(KINDS)) {
  const c = makeMonsterCritter(zoo, kind);
  same(`怪物 ${kind}`, c, makeMonsterCritter(fresh(), kind));
  shares(`怪物 ${kind}`, c, firsts.get(c.modelId));
  built.push(c);
}
for (const id of zoo.models) {
  const c = makeGhostCritter(zoo, id);
  same(`幽靈 ${id}`, c, makeGhostCritter(fresh(), id));
  shares(`幽靈 ${id}`, c, firsts.get(id));
}
{
  const c = makeLivingKing(zoo);
  same('復活的國王', c, makeLivingKing(fresh()));
  shares('復活的國王', c, firsts.get(c.modelId));
}
for (const [id, own] of zoo.critters) {
  for (const skin of own.skins) {
    const opts = { height: own.height, skin, hat: false };
    const c = new Critter(own.data, id, opts);
    same(`路人 ${id}/${skin}`, c, new Critter(fresh().critters.get(id).data, id, opts));
  }
  const opts = { height: own.height, skin: own.skins[1] || own.skins[0] };
  const c = new Critter(own.data, id, opts);
  same(`圖鑑 ${id}（戴帽子）`, c, new Critter(fresh().critters.get(id).data, id, opts));
  shares(`圖鑑 ${id}`, c, own);
  ok(c.geometry.index.array === own.geometry.index.array, `圖鑑 ${id}：戴得上帽子的共用同一份索引`);
}
{
  const [a, b] = [makeMonsterCritter(zoo, 'minion'), makeMonsterCritter(zoo, 'ghost')];
  const z = zoo.critters.get('dog-prick');
  ok(a.geometry.index.array === b.geometry.index.array && a.geometry.index.array !== z.geometry.index.array,
    '光頭的共用光頭的索引，戴得上帽子的那一份另外記');
}

console.log('2. 誰也動不到誰');
{
  const snap = new Map([...zoo.critters].map(([id, c]) => [id, c.geometry.attributes.color.array.slice()]));
  const knight = makeMonsterCritter(zoo, 'knight');
  new Helm().follow(knight);                 // 漆耳朵
  makeMonsterCritter(zoo, 'ghost');
  ok([...zoo.critters].every(([id, c]) => sameArr(c.geometry.attributes.color.array, snap.get(id))),
    '怪物上色、頭盔漆耳朵：Zoo 那幾隻的顏色一個沒變');
  const m = built[0], before = m.geometry.attributes.color.array.slice();
  const id = zoo.models.find((x) => x === m.modelId);
  for (const s of zoo.critters.get(id).skins) zoo.setLook(`${id}/${s}`);
  ok(sameArr(m.geometry.attributes.color.array, before), '玩家換毛色：怪物的顏色沒變');
  const baked = zoo.critters.get(id).geometry.attributes.position.array.slice();
  m.geometry.dispose();
  ok(sameArr(zoo.critters.get(id).geometry.attributes.position.array, baked), '一隻的幾何 dispose 了，共用的頂點還在');
}

console.log('3. 建一隻要多久（只印）');
{
  const time = (f, n) => { const t = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t) / n; };
  const own = zoo.critters.get('dog-prick');
  const a = time(() => new Critter(fresh().critters.get('dog-prick').data, 'dog-prick', { hat: false }), 4);
  const p = time(() => fresh(), 4);
  const b = time(() => new Critter(own.data, 'dog-prick', { hat: false }), 20);
  console.log(`  自己烘 ${(a - p).toFixed(1)} ms／隻，共用 ${b.toFixed(1)} ms／隻`);
}

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
