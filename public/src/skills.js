/* ── src/skills.js ────────────────────────────────────────────
   怪物的技能（殭屍王、騎士、幽靈騎士、國王）：規則。

   跟 combat.js 一樣只算數字——哪一招、打在哪裡、碰到沒有。畫出預告與球是
   fx.js 與 mode-combat.js 的事，而這一支 node 驗得動（tools/verify-combat.mjs）。

   ── 循環 ────────────────────────────────────────────────────────
   有技能的那一類（KINDS 的 `skills`；第二條命有 `rage` 的照 `rage`，見 skillsOf）每 `every` 秒從自己的技能裡挑一招。
   開場固定：先照順序放完 KINDS 的 `open`（第二條命 `rageOpen`），之後才隨機——帶 `chance` 的招
   照它的機率（國王的召喚 25%），其他的平分剩下的；再照冷落的時間加權（越久沒放越容易挑中，IDLE），
   同一招最多連放 REPEAT 次（planOf）。全隨機的話小怪常常死前只放得出一種招。
   挑中的那一刻鎖定玩家的水平位置，之後玩家怎麼跑都不改——預告就是給人躲的。
   放招的這段時間牠不追人（站著，或照那一招自己的路線走）；放完才回去追。

   帶 `range` 的招只在玩家離牠這麼近（水平、身體中心到身體中心）的時候挑得到：
   時間到了、沒有一招夠得到，就接著追，哪一幀夠得到了哪一幀放。

   倒數期間牠不會被擊退、受到的傷害減半（combat.js 的 armored）。唯一打斷得了
   的是破防攻擊：被定住的那一刻放到一半的招直接取消，不打。倒數照走，下一招
   還是從上一招開始算起的 `every` 秒後。

   出招之後（球射出去——第二條命是第三顆、跳砸落地——第二條命是第二下、扇形打下去、跳砍的上挑落地）僵直 SKILL.recover 秒（有自己的
   `recover` 的招照它的：hew 短一點，甩頭的 reap、gale 多出甩之前與之後不動的 STILL 秒）：站著不動、
   也不追人，而且跟平常一樣打得退、傷害照算——這是反擊的空檔。被破防攻擊打斷
   的不算出招，沒有僵直。

     orb   不限距離。倒數 0.75 秒（地上一條往目標延伸的預告），然後朝鎖定的方向直線發射
           一顆球：半徑 0.75 個狗高、每秒 6 公尺，碰到黑牆或場上的東西（牆、柱子、
           台階的側面；開著的門不算）就炸掉消失。
     leap  離玩家 6.9 公尺以內才放。目標點上兩個圓倒數 1.5 秒：淺色的是範圍（半徑 2.5 個狗高），亮色的
           從中心長到邊。目標點不鎖定：站著蓄力的時候一直瞄著主角——落點跟著主角腳下的地板走（主角
           跳起來也是落在牠底下那一塊地板上，不跟著往上），頭正對著主角，身體只轉 TRACK.body 那麼多
           （整隻跟著轉的話看不出在轉頭）。最後 0.6 秒殭屍王起跳（落點在這一刻定下來，身體轉正）、照
           拋物線飛過去，倒數到 0 的那一刻落在目標點上，打那一整圈。
     cone  離玩家 3.68 公尺（扇形的長度）以內才放。站在原地朝鎖定的方向倒數 1 秒：淺色的 60° 扇形（長 4 個狗高）是範圍，
           亮色的扇形從殭屍王腳下往外長，長滿的那一刻打那一整片。

   殭屍王的第二條命（combat.js 的 RALLY 站起來之後）招變兇（RAGE），傷害不變：
     orb   連吐三顆拋物線的球：倒數一樣 0.75 秒，之後每 0.5 秒吐一顆，每一顆吐的那一刻轉向主角、
           瞄準主角那時腳下的地板，從嘴（腳上 1.5 個狗高）照拋物線 0.9 秒落到那一點（球底剛好貼地）。
           飛的時候落點上有一圈預告（fight.js），亮色照飛了幾成長滿。落地停一幀（站在落點上的照樣
           被打中）就炸掉；路上撞到場上的東西一樣炸掉。吐完第三顆才僵直。
     leap  範圍（連震波的塵幾道）跟第一條命一樣，但連跳兩下：第一下落地打下去的那一刻不僵直，就地再倒數
           一次（倒數、預告、起跳之前一直瞄著主角都跟第一下一樣），第二下落地才僵直。
     cone  半徑（連夠得到的距離 `range`）跟第一條命一樣，只有角度從 60° 張開到 105°。

   騎士的招：

     whirl  劍迴旋衝刺（離玩家 3.2 公尺以內才放）。牠腳下出現一條往目標延伸的
            膠囊形紅區（寬是迴旋的直徑、長是衝得到的距離），倒數 0.5 秒；然後
            朝鎖定的方向衝（初速 16、0.4 秒減到 0，3.2 公尺），衝的同時劍掃兩圈
            （主角第三擊落地那一下的迴旋，多轉一圈）。衝的每一幀打的是這一幀走過的
            那一段，外擴迴旋的半徑——整段衝下來就是預告的那一條。
     cleave 跳砍（離玩家 8 公尺以內才放）。玩家腳下出現一條紅色長條（沿著騎士往
            玩家的方向，玩家在正中間），倒數 0.5 秒；然後騎士跳起來、0.4 秒沿一道
            弧線（最高 1.2 公尺）落在長條靠牠的那一頭，落地那一刻劍往前劈下，打
            那一整條。玩家離得比半條還近的話，牠原地跳起來劈（長條從牠腳下起）。
            落地之後轉向玩家現在的位置，牠腳下再出一條同樣寬、長 REACH 的紅色長條，
            0.25 秒後上挑：跟主角第二段一樣原地起跳、劍往上掃一片直立扇形（combat.js
            的 fanFrame，下緣指著長條的遠端，往左右各厚半條長條寬），起跳後 SWING 秒內
            碰到就算——這一下跳起來躲不掉。上挑落地才僵直。

   幽靈騎士的招：

     reapAir、reapGround   兩套連斬（離玩家 8 公尺以內才放；牠只有這兩招，所以各一半）。
            前兩下就是騎士的跳砍：玩家腳下的紅色長條、
            倒數、跳過去劈到地上那一條，落地的那一刻轉向玩家（上挑那一條預告從這時起長）。差別在
            牠不受重力：上挑升到頂點（主角一跳那麼高）就停在空中，不落下。另一下是原地轉一圈——
            主角第三擊落地那一下（REND.spin 秒轉完，前 swing 秒打得到），一片在牠腰那麼高
            的水平圓盤（半徑是騎士劍迴旋那一圈）。兩套只差後兩下的順序（REAP）：
              reapAir     對空：落地 gap 秒後上挑，升到頂點緊接著在空中轉。
              reapGround  對地：落地 gap 秒後在地上轉，轉完緊接著上挑、升到頂點。
            三下之間沒有僵直，最後一下打完才僵直 0.75 秒（甩頭），停在半空中。

   國王的招（第二條命多了瞪視、召喚改成一直召，KINDS 的 `rage`）：

     hew    直線劈砍（不限距離）。牠腳下出現一條往鎖定方向一直延伸到黑牆的紅色長條
            （寬 0.8 個狗高），倒數 0.5 秒；然後站在原地往前劈：劍長（跟騎士跳砍劈的那一條
            一樣長）以內那一刻打下去；同時那一刀的劍光變成一塊氣流（world.gusts，形狀是 GUST：
            劍光立在劈的那個直立面上、往左右加厚到長條的寬）推出去，每秒 20 公尺沿那一條往前
            走，走到黑牆、或撞上場上的東西（跟球一樣，開著的門不擋）就停。一招只打得到一次：
            被那一刀劈到的，氣流就不再算。出招後只僵直 0.25 秒
            （SKILL.hew.recover，其他招是 SKILL.recover）；氣流不等僵直，自己走完。
            第二條命是下劈後上挑：劈下去的那一刻（不是挑招的那一刻）才轉向玩家、瞄第二刀，牠腳下
            再出一條往那個方向一直到黑牆的長條，0.25 秒（up.gap）後上挑——騎士跳砍之後的那一下：原地
            起跳、受重力落回來（不像幽靈騎士停在空中），劍往上掃一片直立扇形（半徑是劍長，起跳後
            SWING 秒內，跳起來躲不掉），起跳那一刻劍尖沿那個方向推出第二道氣流（跟劈的那一道一樣），
            劍長那一截一樣留斬痕。上挑落地才僵直（一樣 0.25 秒）。
     summon 召喚。挑的那一刻在牠身邊半徑 3 公尺內隨機挑幾個點（地板上），倒數 0.5 秒——
            這段時間每個點上一隻幽靈從地底升上來（畫面，fight.js；沒有紅圈），還不算上場、
            不動、打不到也打不到人；倒數完的那一刻整隻離開地面，就在那一點上場、開始追人
            （不打人的招）。場上牠召喚出來、還活著的
            （`m.brood`，呼叫端每幀數好寫進來）最多 4 隻：0～2 隻的時候召兩隻，3 隻的時候
            召一隻，滿 4 隻就挑不到這一招。召出來的放進 world.spawns，由呼叫端接上場。
            第二條命是一直召（SKILL.summon.rage）：從挑的那一刻起每 1 秒在身邊挑一個點、一隻幽靈從那裡升上來
            （升 1 秒，升完上場），場上牠召喚的（連正在升的）最多 6 隻；滿了就不再升，最後一隻升完才收招、
            僵直。這是唯一打得斷的招（`frail`）：召到一半被主角打到身上就斷（盾擋掉的不算）——正在升的那一隻
            收回去，不僵直；倒數中不是 armored（打得退、傷害照算），沒滿 6 隻才挑得到。
     gale   旋風斬（不限距離）。整片場地亮起淡紅，牠腰那麼高浮著一片圓（半徑是劍長）從中心長到邊，
            倒數 1 秒；然後原地轉一圈——主角第三擊落地那一下（SKILL.gale.spin 秒轉完，前 swing 秒
            打得到）：腰那麼高的一片水平圓盤，扣 5。轉完的那一刻那一圈劍光推出去，成一圈熱氣流
            （world.rings）：劍光那一圈環（從牠身上量 GUST.inner～劍長）在腰那個高度上下加厚，
            每秒 20 公尺往外擴散，扣 2。碰到場上的東西（跟氣流一樣，開著的門不擋；比它低、比它高的
            不擋）的那一段停在那裡，其他的照走，一直到黑牆。哪一段會被什麼擋下，挑這一招的那一刻就
            算好了（occlude.js 的 shadeOf，精確的）：預告的淡紅照它挖掉擋住的地方，留下斬痕也照它。
            一招只打得到一次：被轉的那一下打到的，熱氣流就不再算。出招後僵直 0.5 秒（甩頭）。
     glare  瞪視（只有第二條命，不限距離）。蓄力 0.75 秒：一直轉向主角瞪著（眼睛發光，fight.js）；
            蓄力完的那一刻瞪下去，主角靈魂出竅 0.5 秒（combat.js 的 DAZE）：操作全部停下，被往國王那一邊
            吸過去半個狗高。這 0.5 秒國王還是一直瞪著、不放別的招，瞪完才僵直（SKILL.recover）。不扣血；
            主角無敵的時候（第三段、破防攻擊）瞪不到。

   範圍攻擊照畫面上看得到的東西判，不是一次打完貼地的一片：

     leap、cone  地震。打下去那一刻起一道震波從腳下往外走，QUAKE.wave 秒走完半徑（dust.js 的
                 塵就是它揚起來的）：前緣掃到哪、哪裡才挨，站在已經過去的地方不會；高度是那一道
                 塵鼓多高（quakeTop，越外面越高，最外圈扇形 2 公尺）。每一幀的前緣放在 world.waves，
                 wavesStep 推進。
     whirl       移動的圓盤：跟主角第三擊那一圈同一種判法（一片在腰高 waist、沒有厚度的水平圓盤，
                 碰到身體的圓柱才算），只是衝的每一幀從這一幀的起點掃到終點（膠囊），像球一樣一路移動。
     cleave、hew 貼地的長條，打的是地面上一個狗高以內：玩家的腳比那還高——跳起來了——就躲得過。
     hew 的氣流  移動的一塊（gustHits）：劍光那四分之一圈加厚成的體積，每一幀打的是它這一幀走過的
                 地方。有兩公尺高，跳不過，只能往旁邊閃。
     連斬的轉    跟 gale 轉的那一下同一種，跟著牠的腰那麼高。對空的在空中轉：站在地上的打不到，
                 跳上去追牠的才挨；對地的在地上轉：跟 gale 一樣跳得過。
     gale        轉的那一下跟騎士的 whirl 同一種（移動的圓盤，只是不移動）。熱氣流是一圈薄薄的環帶
                 （ringHits），在牠腰那麼高：跳得過，也躲得到東西後面。
     跳砍之後的上挑例外：那一片是立起來的（國王第二條命劈砍之後的上挑也是）。

   碰到扣血：殭屍王的招 5、騎士的 whirl 2、cleave 3、上挑 3、幽靈騎士的連斬劈 3、挑 3、轉 2、國王的 hew 5、氣流 2、gale 5、熱氣流 2（每一招的 `damage`；衝刺咬到的見 combat.js 的 KINDS）。
   打中人的球就炸掉消失。玩家無敵的時候（第三段、破防攻擊）碰到不算，球穿過去。
   ------------------------------------------------------------------ */

import { PHYS, arenaGap, supportInfo, overlapXZ, roundTop, clampArena } from './walk.js';
import { FIELD, DOG_H, REACH, SWING, STILL, DAZE, kindOf, busy, walkTo, inFan } from './combat.js';
import { QUAKE, quakeTop } from './dust.js';
import { hullOf, TRAILS } from './trail.js';
import { shadeOf, reachAt, farthestOf } from './occlude.js';
import { random } from './chance.js';

/**
 * 幽靈騎士的兩套連斬（SKILL.reapAir、reapGround 都是這一份）：劈與上挑照 SKILL.cleave（倒數、弧線、
 * 長條、上挑都一樣），range 也是。另一下是原地轉一圈（跟上挑誰先見 REAP）：spin 秒轉完（主角第三擊
 * 那一圈），前 swing 秒每一幀打一片在牠腰（waist：畫成 1.2 倍高，跟騎士一樣）那麼高、半徑 radius
 * （騎士劍迴旋那一圈）的水平圓盤。最後一下打完的僵直是甩頭：先 STILL.before 秒不動，甩 0.5 秒，
 * 再 STILL.after 秒沒有動作。
 */
export const REND = {
  range: 8, spin: TRAILS.slam.t1, swing: SWING, radius: 1.75 * DOG_H, waist: 0.6 * DOG_H, damage: 2,
  recover: STILL.before + 0.5 + STILL.after,
};

/** 跳砍（與國王第二條命的劈砍）劈下去之後站多久才上挑（秒）：兩招是同一套身體動作（monster.js 的 cleaveLand）。 */
const UP_GAP = 0.25;

/** 每一招的數值。長度一律用狗高量；`damage` 是打中玩家扣幾點血。 */
export const SKILL = {
  orb: { windup: 0.75, radius: 0.75 * DOG_H, speed: 6, damage: 5 },
  leap: { windup: 1.5, air: 0.6, radius: 2.5 * DOG_H, range: 6.9, damage: 5 },
  cone: { windup: 1, radius: 4 * DOG_H, half: Math.PI / 6, range: 4 * DOG_H, damage: 5 },
  /* 騎士的劍迴旋衝刺：倒數 windup，然後 time 秒裡速度從 speed 線性減到 0（衝 speed·time/2
     = 3.2 公尺），劍掃的半徑是 radius。time 是 trail.js 的 whirl 那兩圈掃完的 0.40 秒
     （跟主角第三擊那一圈一樣長，轉兩倍快），衝完剛好轉完。range：離玩家這麼近才放。
     劍掃的跟主角第三擊那一圈（combat.js 的 inRing）同一種：一片沒有厚度的水平圓盤，在牠腰那麼高
     （waist：騎士畫成 1.2 倍高，腰是 1.2 × DOG_H / 2，跟劍光同高），碰到身體那根圓柱就算——只是
     這片圓盤跟著衝的位置一路移動（每一幀掃過的是一段膠囊）。 */
  whirl: { windup: 0.5, time: 0.4, speed: 16, radius: 1.75 * DOG_H, range: 3.2, damage: 2, waist: 0.6 * DOG_H },
  /* 騎士的跳砍：倒數 windup，然後 air 秒跳一道最高 hop 公尺的弧線落下、劈那一條（長 len、
     寬 width，從落點往前）。range：離玩家這麼近才放。
     up：落地 gap 秒後上挑——主角第二段那一跳（初速 PHYS.jump），起跳後 swing 秒內打；
     扇形往左右各厚 thick（預告那一條的半寬）。 */
  cleave: {
    windup: 0.5, air: 0.4, hop: 1.2, len: 2.2 * DOG_H, width: 0.8 * DOG_H, range: 8, damage: 3,
    up: { gap: UP_GAP, swing: SWING, thick: 0.4 * DOG_H, damage: 3 },
  },
  /* 幽靈騎士的兩套連斬：數值是同一份（REND），只差後兩下的順序（REAP）。 */
  reapAir: REND,
  reapGround: REND,
  /* 國王的直線劈砍：倒數 windup，劈一條從牠腳下往鎖定方向、長 len、寬 width 的長條（劍長，
     跟騎士跳砍劈的那一條一樣長）。不限距離：劍尖推出一道同樣寬的氣流（gust），每秒 speed
     公尺往前走到黑牆或撞上東西。出招後的僵直是自己的 recover（比別招短）。
     up：第二條命劈下去 gap 秒後上挑（扇形的半徑是 len），起跳後 swing 秒內打。 */
  hew: {
    windup: 0.5, len: 2.2 * DOG_H, width: 0.2 * DOG_H, damage: 5, recover: 0.25, gust: { speed: 20, damage: 2 },
    up: { gap: UP_GAP, swing: SWING, damage: 5 },
  },
  /* 國王的召喚：倒數 windup，在身邊 radius 公尺內（離牠至少 near，不疊在牠身上）的點上各冒出
     一隻 kind（倒數的時候從地底升上來）。場上牠召喚的最多 cap 隻，一次最多召 each 隻（補到 cap 為止）。
     挑得到的時候被挑中的機率是 chance（pickSkill）。rage：第二條命一直召——每 every 秒升一隻（升 every 秒），
     場上最多 cap 隻（連正在升的）。 */
  summon: { chance: 0.25, windup: 0.5, radius: 3, near: 2 * PHYS.radius, cap: 4, each: 2, kind: 'ghost', rage: { every: 1, cap: 6 } },
  /* 國王的旋風斬：倒數 windup，然後原地轉一圈（主角第三擊落地那一下：spin 秒轉完，前 swing 秒
     打得到），一片在腰（waist：國王畫成 1.4 倍高，腰是 1.4 × DOG_H / 2）那麼高、半徑 radius（劍長，
     跟 hew 一樣）的水平圓盤。轉完的那一刻劍光推出去成一圈熱氣流（wave）：每秒 speed 公尺往外，
     在腰的高度上下各厚 half（跟 hew 那一道氣流一樣寬，只是躺平了）。僵直是甩頭：先 STILL.before 秒不動，甩 0.25 秒，再 STILL.after 秒沒有動作。 */
  gale: {
    windup: 1, radius: 2.2 * DOG_H, waist: 0.7 * DOG_H, spin: TRAILS.slam.t1, swing: SWING, damage: 5, recover: STILL.before + 0.25 + STILL.after,
    wave: { speed: 20, damage: 2, half: 0.1 * DOG_H },
  },
  /* 國王第二條命的瞪視：蓄力 windup 秒（一直轉向主角瞪著），瞪下去的那一刻主角靈魂出竅 hold 秒
     （combat.js 的 DAZE：操作停下、被吸過來），這段時間牠一直瞪著，瞪完才收招。不扣血。 */
  glare: { windup: 0.75, hold: DAZE.time },
  /** 出招後僵直幾秒（那一招沒有自己的 `recover` 的話）。 */
  recover: 0.5,
};

/**
 * 國王劈砍推出去的氣流長什麼樣：那一刀的劍光（trail.js 的 cleave，三道合起來）照劍長縮放
 * （scale，fight.js 給 qi.js 的同一個），立在劈的那個直立面上。top 是外緣離刀根多遠——
 * 也就是前緣在刀根前面多遠；inner 是最寬的時候最靠內的那一道的內緣離刀根多遠（公尺）。
 * 往左右加厚的時候不是平頂：正中間是整片劍光，往兩邊高度照橢圓壓低，到邊上剩 edge 那麼多
 * （gustRise）。只壓高度，往前伸多遠不變——落在地上的那一頭整條一樣寬。
 */
export const GUST = (() => {
  const scale = SKILL.hew.len / REACH;
  return { scale, top: hullOf(1).outer * scale, inner: hullOf(1).inner * scale, edge: 0.45 };
})();

/** 離中線 t 成半寬（0～1）的地方，氣流有正中間的幾成高。 */
export const gustRise = (t) => GUST.edge + (1 - GUST.edge) * Math.sqrt(Math.max(0, 1 - t * t));

/**
 * 旋風斬那一圈熱氣流的截面：轉的那一圈劍光（三道合起來的外框，照劍長縮放：離牠 GUST.inner～
 * GUST.top）往外推，所以前緣後面 depth 那麼深；在腰那個高度上下各厚 half。不是平的：正中間
 * 整片那麼深，往上下照橢圓壓淺（gustRise，跟 hew 的氣流往兩邊壓低同一條），到邊上剩 edge 那麼多
 * ——只壓深度，前緣整圈一樣齊。
 */
export const RING = { depth: GUST.top - GUST.inner, half: SKILL.gale.wave.half };

/**
 * 殭屍王第二條命的招（見檔頭）。half：扇形的半角（半徑不變）；hops：跳砸連跳幾下。
 * orb：連吐 count 顆拋物線的球，倒數完之後每 every 秒一顆，每一顆從腳上 mouth 那麼高飛 flight 秒落到主角腳下。
 */
export const RAGE = { half: (105 / 2) * (Math.PI / 180), hops: 2, orb: { count: 3, every: 0.5, flight: 0.9, mouth: 1.5 * DOG_H } };

/** 這隻在第二條命以後了嗎（有 `lives` 的那一類，combat.js 的 RALLY）：招照 RAGE。 */
export const raging = (m) => (m.life || 1) > 1;

/** 這隻現在挑得到哪幾招：第二條命以後、那一類有 `rage` 的話照它（國王多了瞪視），其餘照 `skills`。 */
export const skillsOf = (m) => (raging(m) && kindOf(m).rage) || kindOf(m).skills || [];

/** 這隻放扇形的半角：第二條命張開到 RAGE.half。 */
export const halfOf = (m) => (raging(m) ? RAGE.half : SKILL.cone.half);

/** 這一招出完僵直幾秒：那一招自己的 `recover`，沒有就是 SKILL.recover。 */
export const recoverOf = (skill) => SKILL[skill].recover ?? SKILL.recover;

/** 招在什麼時候出手（倒數走完）：跳砸是起跳的那一刻，兩套連斬是跳砍那一跳。 */
const LAUNCH = { leap: SKILL.leap.windup - SKILL.leap.air, reapAir: SKILL.cleave.windup, reapGround: SKILL.cleave.windup };
const launched = (c) => c.t >= (LAUNCH[c.skill] ?? SKILL[c.skill].windup);

/**
 * 主角倒下了（Fight.standDown）：放到一半的招怎麼收。還在倒數的收掉；一直放下去的（第二條命連吐球、
 * 一直召）出手了的話停在這一下、進僵直；其餘出手了的照它的路線與動作播完（bossStep 的 calm）——
 * 打倒主角的那一下就在這裡面，不會停在半空中或劈到一半。
 */
export function windDown(m) {
  const c = m.cast;
  if (!c) return;
  if (!launched(c)) m.cast = null;
  else if (c.skill === 'orb' || c.frail) { m.cast = null; m.stun = recoverOf(c.skill); }
}

/** 這一次召喚召幾隻：補到 cap 為止，一次最多 each 隻（0～2 隻時召 2、3 隻時召 1、滿了 0）。 */
export const summonCount = (m) => Math.max(0, Math.min(SKILL.summon.each, SKILL.summon.cap - (m.brood || 0)));

/** 這隻場上最多有幾隻牠召喚的：第二條命是 SKILL.summon.rage.cap。 */
export const broodCap = (m) => (raging(m) ? SKILL.summon.rage.cap : SKILL.summon.cap);

/** 除了距離（`range`）之外，這一招現在挑不挑得到：第二條命只要場上沒滿。 */
const READY = { summon: (m) => (raging(m) ? (m.brood || 0) < broodCap(m) : summonCount(m) > 0) };

/**
 * 打斷一招打得斷的招（`frail`：第二條命的召喚）：收招、不僵直，下一招從現在起 `every` 秒之後才挑
 * （不然召了好幾秒，挑招的倒數早就到了，一斷就馬上又挑一招）。
 */
export function cut(m) {
  m.cast = null;
  m.castT = kindOf(m).every;
}

/** 劍迴旋衝刺衝出去 s 秒（0 ≤ s ≤ time）走了多遠：速度從 speed 線性減到 0 的積分。 */
export const whirlDist = (s) => SKILL.whirl.speed * (s - (s * s) / (2 * SKILL.whirl.time));

/** 劍迴旋衝刺整段衝多遠（預告那一條的長度，不算兩頭的半圓）。 */
export const WHIRL_LEN = whirlDist(SKILL.whirl.time);

/** 上挑那一跳在空中多久：初速 PHYS.jump 起跳、落回同一層。 */
export const UP_AIR = (2 * PHYS.jump) / PHYS.gravity;

/** 幽靈騎士的上挑升多久就到頂點、停在那裡：主角那一跳的上升那一半（初速 PHYS.jump、照重力減速到 0）。 */
export const UP_RISE = PHYS.jump / PHYS.gravity;

/**
 * 幽靈騎士兩套連斬落地 gap 秒之後那兩下的順序，鍵是那一招：上挑（up）與原地轉一圈（spin）各從
 * 那一刻之後幾秒開始，end 是幾秒收招（兩套一樣長）。一招是不是連斬也查這裡（REAP[skill]）。
 *   reapAir     對空：先上挑升到頂點，在空中轉——跳起來追牠的挨轉的那一圈。
 *   reapGround  對地：先在地上轉（腰那麼高，站在地上的挨），轉完才上挑升到頂點。
 */
export const REAP = {
  reapAir: { up: 0, spin: UP_RISE, end: UP_RISE + REND.spin },
  reapGround: { spin: 0, up: REND.spin, end: REND.spin + UP_RISE },
};

/** 範圍攻擊打得到的高度：腳在打下去的那一塊地板往上這麼高以內才算（一個狗高）。 */
const REACH_UP = PHYS.height;

/**
 * 場上飛著的東西（球）。每一局一份，回到站位就清空。`field` 是這一局的場地
 * （combat.js 的 FIELD 那一種）：球飛到它的黑牆就消失。
 */
export function makeWorld(field = FIELD) {
  return { shots: [], waves: [], gusts: [], rings: [], spawns: [], field };
}

/**
 * 地震的震波往前一幀（扇形與跳砸的圓，`bossStep` 打下去那一幀放進 world.waves）：前緣從腳下
 * 照 QUAKE.wave 秒走完半徑，`from`～`to` 是這一幀前緣掃過的那一圈（strikeHits 照它判），走完
 * 那一幀之後的下一次收掉。新放進來的那一幀不推進（前緣還在腳下）。每一幀在 bossStep 之後、判定之前叫。
 */
export function wavesStep(world, dt) {
  world.waves = world.waves.filter((w) => !w.done);
  for (const w of world.waves) {
    if (w.fresh) { w.fresh = false; continue; }
    w.t += dt;
    w.from = w.to;
    w.to = w.r * Math.min(1, w.t / QUAKE.wave);
    if (w.to >= w.r) w.done = true;
  }
}

/* 不能開始放招的狀態（combat.js 的 busy）。倒數中不會被擊退（見 armored），
   所以放到一半會碰上的只有「被定住」——破防攻擊打斷得了。 */

/**
 * 一直瞄著主角的招（跳砸起跳之前，`track`）身體跟著轉多少：從開始那一刻的朝向起，主角繞過去的角度只轉
 * 這麼多成，其餘交給頭（monster.js 的 LOOK，頭正對著主角）。整隻跟著轉的話頭跟身體一起動，看不出在轉頭。
 */
export const TRACK = { body: 0.3 };

/**
 * 瞄準玩家現在的水平位置：寫進這一招的方向與目標點，面向它。回傳離玩家多遠。
 * 跳砸起跳之前每一幀都瞄一次（`track`）：方向與落點照瞄的，身體只從開始那一刻的朝向（`yaw0`）轉
 * TRACK.body 那麼多。其他招只在開始的那一刻瞄（鎖定），身體正對著。
 */
function aimAt(m, c, target) {
  const dx = target.x - m.x, dz = target.z - m.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) { c.dirX = dx / d; c.dirZ = dz / d; }
  let face = Math.atan2(c.dirX, c.dirZ);
  if (c.track) {
    let turn = face - c.yaw0;
    turn -= 2 * Math.PI * Math.round(turn / (2 * Math.PI));
    face = c.yaw0 + TRACK.body * turn;
  }
  /* 目標點的地板：玩家可能在空中，跳砸落在牠腳下那一塊的頂上。 */
  const ty = supportInfo(m.field.cols, target.x, target.z, target.y).y;
  /* 跳砸落在那一點上：玩家站得到、怪物不准待的地方（比 MOUNT 高的台子）就落在旁邊最近准許的
     那一格（allowed）。其他招的 tx / tz 是「鎖定的那一點」（召喚的朝向、跳砍的方向），不動。 */
  [c.tx, c.ty, c.tz] = c.skill === 'leap' ? allowed(m, target.x, ty, target.z) : [target.x, ty, target.z];
  m.aimX = Math.sin(face); m.aimZ = Math.cos(face);
  return d;
}

/** 開始一招：瞄準玩家現在的水平位置（aimAt），面向它，停下來。 */
function begin(m, skill, target, rng) {
  m.cast = { skill, t: 0, dirX: m.aimX, dirZ: m.aimZ, x0: m.x, y0: m.y, z0: m.z };
  const d = aimAt(m, m.cast, target);
  // 跳砸不鎖定：起跳之前一直瞄著主角（CAST.leap），起跳那一刻 track 收掉。身體從這一刻的朝向起轉。
  if (skill === 'leap') Object.assign(m.cast, { track: true, yaw0: Math.atan2(m.aimX, m.aimZ) });
  m.vx = 0; m.vz = 0;
  if (skill === 'cleave' || REAP[skill]) aimCleave(m, d);
  if (skill === 'summon') {
    // 第二條命一直召：點是升的那一刻才挑（channel），而且打得斷。
    if (raging(m)) Object.assign(m.cast, { spots: [], next: 0, rng, frail: true });
    else m.cast.spots = summonSpots(m, rng);
  }
  if (skill === 'gale') m.cast.env = galeShade(m);
}

/**
 * 旋風斬的熱氣流從牠身上往外擴散，每個方向會被什麼擋下、在多遠：挑這一招的那一刻就算好
 * （牠倒數、轉的時候站著不動，打不退）。高度是熱氣流那一段（腰上下各 half）。
 */
function galeShade(m) {
  const mid = m.y + SKILL.gale.waist;
  return shadeOf(m.field, m.x, m.z, mid - RING.half, mid + RING.half);
}

/**
 * 召喚的點：summonCount 個，在牠身邊 near～radius 公尺的圓環裡均勻地隨機挑（面積均勻，
 * 不是半徑均勻），夾回黑牆裡面，高度是那一點的地板。
 */
function summonSpots(m, rng) {
  const out = [];
  for (let i = 0; i < summonCount(m); i++) out.push({ ...summonSpot(m, rng), t0: 0, dur: SKILL.summon.windup });
  return out;
}

/** 一個召喚的點（summonSpots 的一個）。 */
function summonSpot(m, rng) {
  const S = SKILL.summon;
  const a = rng() * 2 * Math.PI;
  const r = Math.sqrt(S.near * S.near + rng() * (S.radius * S.radius - S.near * S.near));
  const [x, z] = clampArena(m.field.arena, m.x + Math.sin(a) * r, m.z + Math.cos(a) * r, PHYS.radius);
  return { x, z, y: supportInfo(m.field.cols, x, z, m.y + PHYS.step).y };
}

/**
 * 跳砍的落點：長條的正中間是鎖定的那一點，所以落在它前面半條的地方；比半條還近就
 * 原地跳。落點的地板照那一點往下找（跳得上去的台也算）。
 */
function aimCleave(m, d) {
  const c = m.cast, S = SKILL.cleave;
  const k = Math.max(0, d - S.len / 2);
  const lx = m.x + c.dirX * k, lz = m.z + c.dirZ * k;
  [c.lx, c.ly, c.lz] = allowed(m, lx, supportInfo(m.field.cols, lx, lz, Math.max(m.y, c.ty) + PHYS.step).y, lz);
}

/**
 * 跳過去的落點（跳砸、跳砍）：不在允許區（m.field.roam，見 roam.js）裡就換成最近的那一格。
 * 直線上的那一點可能在井口裡、柱子後面的死角、木箱裡面——路線不看碰撞，飛過去就是落在
 * 那裡。沒有允許區（戰鬥模式那一片空地）、會飛的，照原來的點。
 */
function allowed(m, x, y, z) {
  const roam = m.field.roam;
  if (!roam || kindOf(m).fly || roam.has(x, y, z)) return [x, y, z];
  const c = roam.nearest(x, y, z);
  return c ? [c.x, c.y, c.z] : [x, y, z];
}

/** 每一招倒數時與倒數完的那一幀要做什麼。 */
const CAST = {
  orb(m, world, target) {
    const c = m.cast, S = SKILL.orb;
    if (c.t < S.windup) return;
    if (raging(m)) {
      // 第二條命：倒數完每 every 秒吐一顆拋物線的球（`spat` 是吐了幾顆），吐滿收招。
      const n = c.spat || 0, R = RAGE.orb;
      if (c.t < S.windup + n * R.every) return;
      world.shots.push(lob(m, target));
      c.spat = n + 1;
      if (c.spat >= R.count) m.cast = null;
      return;
    }
    // 從身體前緣發出去，剛好不跟自己重疊。
    const off = PHYS.radius + S.radius;
    world.shots.push({
      x: m.x + c.dirX * off, y: m.y + S.radius, z: m.z + c.dirZ * off,
      vx: c.dirX * S.speed, vz: c.dirZ * S.speed, r: S.radius, dmg: S.damage,
    });
    m.cast = null;
  },

  /* 倒數的前 0.9 秒站著，最後 `air` 秒沿直線飛向目標、高度是一條拋物線（頂點
     g·air²/8，0.6 秒大約 1 公尺）。倒數到 0 那一幀落在目標點上，打那一圈。站著的那 0.9 秒（`track`）
     每一幀重新瞄主角，起跳的那一刻定下來、身體轉正朝著飛的方向。第二條命還沒跳滿 RAGE.hops 下的話，
     落地的那一刻就地再開始一下（`hop` 是第幾下，一樣起跳之前一直瞄），不收招。 */
  leap(m, world, target) {
    const c = m.cast, S = SKILL.leap;
    const s = (c.t - (S.windup - S.air)) / S.air;
    if (s < 0) {
      if (c.track) aimAt(m, c, target);
      return null;
    }
    if (c.track) { c.track = false; m.aimX = c.dirX; m.aimZ = c.dirZ; }
    if (s < 1) {
      m.x = c.x0 + (c.tx - c.x0) * s;
      m.z = c.z0 + (c.tz - c.z0) * s;
      m.y = c.y0 + (c.ty - c.y0) * s + (PHYS.gravity * S.air * S.air / 2) * s * (1 - s);
      m.grounded = false;
      return null;
    }
    m.x = c.tx; m.z = c.tz; m.y = c.ty;
    m.grounded = true;
    m.cast = null;
    const hop = c.hop || 1;
    if (raging(m) && hop < RAGE.hops) { begin(m, 'leap', target); m.cast.hop = hop + 1; }
    return { shape: 'circle', x: c.tx, y: c.ty, z: c.tz, r: S.radius, dmg: S.damage };
  },

  cone(m) {
    const c = m.cast, S = SKILL.cone;
    if (c.t < S.windup) return null;
    m.cast = null;
    return { shape: 'cone', x: m.x, y: m.y, z: m.z, dirX: c.dirX, dirZ: c.dirZ, r: S.radius, half: halfOf(m), dmg: S.damage };
  },

  /* 倒數的時候站著；之後 air 秒沿直線飛向落點、高度是一條最高 hop 的拋物線（疊在起點與
     落點的高低差上）。飛完那一幀落在落點上，劈那一條，轉向玩家；接著是上挑（upper）。 */
  cleave(m, world, target) {
    const c = m.cast, S = SKILL.cleave;
    const s = (c.t - S.windup) / S.air;
    if (s < 0) return null;
    if (s < 1) {
      m.x = c.x0 + (c.lx - c.x0) * s;
      m.z = c.z0 + (c.lz - c.z0) * s;
      m.y = c.y0 + (c.ly - c.y0) * s + 4 * S.hop * s * (1 - s);
      m.grounded = false;
      return null;
    }
    if (c.up) return upper(m);
    m.x = c.lx; m.z = c.lz; m.y = c.ly;
    m.grounded = true;
    aimUp(m, target);
    return { shape: 'strip', x: c.lx, y: c.ly, z: c.lz, dirX: c.dirX, dirZ: c.dirZ, len: S.len, w: S.width, dmg: S.damage };
  },

  /* 兩套連斬：倒數、飛過去、劈下去、轉向玩家都是騎士的跳砍（cleave）；落地之後換成不落下的上挑與
     原地的那一圈（rend，照 REAP 的順序）。 */
  reapAir: (m, world, target) => (m.cast.up ? rend(m) : CAST.cleave(m, world, target)),
  reapGround: (m, world, target) => (m.cast.up ? rend(m) : CAST.cleave(m, world, target)),

  /* 倒數完沿鎖定的方向衝，走多遠是那一段時間的積分（跟幀長無關，一次永遠 3.2 公尺，
     被牆擋住就沿著牆滑）。每一幀打的是這一幀走過的那一段（膠囊）；衝完那一幀收招。 */
  whirl(m) {
    const c = m.cast, S = SKILL.whirl;
    const s = Math.min(S.time, c.t - S.windup);
    if (s <= 0) return null;
    const step = whirlDist(s) - whirlDist(c.s || 0);
    c.s = s;
    const x0 = m.x, z0 = m.z;
    walkTo(m, m.x + c.dirX * step, m.z + c.dirZ * step);
    if (s >= S.time) m.cast = null;
    return { shape: 'capsule', x: x0, y: m.y, z: z0, x1: m.x, z1: m.z, r: S.radius, waist: m.y + S.waist, dmg: S.damage };
  },

  /* 倒數的時候站著；倒數完站在原地劈劍長那一條（黑牆比劍近的話到牆為止），劍尖推出一道氣流。
     那一刀記著它的氣流（`gust`）：劈到人的話氣流就不再算（fight.js）。第二條命劈下去的那一刻才
     轉向玩家、瞄第二刀，接著是上挑（hewUp），不收招。 */
  hew(m, world, target) {
    const c = m.cast, S = SKILL.hew;
    if (c.t < S.windup) return null;
    if (c.up) return hewUp(m, world);
    const gust = hewGust(m, world, m.x, m.y, m.z, c.dirX, c.dirZ);
    if (raging(m)) aimUp(m, target, S.len);
    else m.cast = null;
    return { shape: 'strip', x: m.x, y: m.y, z: m.z, dirX: c.dirX, dirZ: c.dirZ, len: gust.len, w: S.width, dmg: S.damage, gust };
  },

  /* 倒數的時候站著；倒數完原地轉一圈：轉的頭 swing 秒每一幀打腰那麼高的那一片圓盤（跟騎士的
     whirl 同一種形狀，只是不移動）。那一下記著它的熱氣流（`wave`）：轉到的話熱氣流就不再算
     （fight.js）。轉完那一幀熱氣流推出去（world.rings），收招。 */
  gale(m, world) {
    const c = m.cast, S = SKILL.gale;
    if (c.t < S.windup) return null;
    c.wave ??= makeRing(m, c.env);
    const s = c.t - S.windup;
    if (s >= S.spin) {
      world.rings.push(c.wave);
      m.cast = null;
      return null;
    }
    if (s > S.swing) return null;
    return { shape: 'capsule', x: m.x, y: m.y, z: m.z, x1: m.x, z1: m.z, r: S.radius, waist: m.y + S.waist, dmg: S.damage, wave: c.wave };
  },

  /* 一直轉向主角瞪著（身體跟著主角現在的位置轉）。蓄力完的那一幀瞪下去：回傳 glare（fight.js 讓主角
     靈魂出竅，combat.js 的 daze），只這一幀；之後再瞪 hold 秒才收招，這段時間不放別的招。 */
  glare(m, world, target) {
    const c = m.cast, S = SKILL.glare;
    const dx = target.x - m.x, dz = target.z - m.z, d = Math.hypot(dx, dz);
    if (d > 1e-6) { m.aimX = c.dirX = dx / d; m.aimZ = c.dirZ = dz / d; }
    if (c.t < S.windup) return null;
    if (c.t >= S.windup + S.hold) { m.cast = null; return null; }
    if (c.stared) return null;
    c.stared = true;
    return { shape: 'glare', x: m.x, y: m.y, z: m.z, dmg: 0 };
  },

  /* 倒數的時候站著；倒數完每一個點上場一隻（面向玩家被鎖定的那一點），交給呼叫端接上場。
     不打人。第二條命一直召（channel）。每一個點記著它從什麼時候升（t0）、升多久（dur），升完的標 out。 */
  summon(m, world, target) {
    const c = m.cast, S = SKILL.summon;
    if (c.frail) return channel(m, world, target);
    if (c.t < S.windup) return null;
    for (const s of c.spots) {
      s.out = true;
      world.spawns.push({ kind: S.kind, x: s.x, y: s.y, z: s.z, yaw: Math.atan2(c.tx - s.x, c.tz - s.z), by: m, spot: s });
    }
    m.cast = null;
    return null;
  },
};

/**
 * 第二條命的召喚一幀：到了下一隻該升的時刻（`next`，每 every 秒），場上牠召喚的（m.brood）加上正在升的
 * 還沒滿 cap 就在身邊挑一個點、開始升一隻，滿了就不再升（`full`）。升完 every 秒的那一隻上場（world.spawns）。
 * 先看要不要升、再上場：同一幀剛升完的那一隻還沒算進 m.brood，這樣才算得到它。滿了、正在升的都上場了，收招。
 */
function channel(m, world, target) {
  const c = m.cast, S = SKILL.summon, R = S.rage;
  const rising = c.spots.filter((s) => !s.out);
  if (!c.full && c.t >= c.next) {
    if ((m.brood || 0) + rising.length < R.cap) {
      const s = { ...summonSpot(m, c.rng), t0: c.next, dur: R.every };
      s.yaw = Math.atan2(target.x - s.x, target.z - s.z);          // 升的那一刻面向主角
      c.spots.push(s);
      rising.push(s);
      c.next += R.every;
    } else c.full = true;
  }
  for (const s of rising) {
    if (c.t - s.t0 < s.dur) continue;
    s.out = true;
    world.spawns.push({ kind: S.kind, x: s.x, y: s.y, z: s.z, yaw: s.yaw, by: m, spot: s });
  }
  if (c.full && c.spots.every((s) => s.out)) m.cast = null;
  return null;
}

/**
 * 吐一顆拋物線的球（第二條命的 orb）：轉向玩家，從嘴（身體前緣、腳上 RAGE.orb.mouth）飛 flight 秒
 * 落到玩家腳下那一塊地板上（球心在地板上一個半徑，球底剛好貼地）。位置照時間算（`lob`，shotsStep），
 * 跟幀長無關；vx、vz 是水平的速度（火球照它朝向、噴尾巴）。
 */
function lob(m, target) {
  const S = SKILL.orb, R = RAGE.orb, T = R.flight;
  const dx = target.x - m.x, dz = target.z - m.z, d = Math.hypot(dx, dz);
  if (d > 1e-6) { m.aimX = dx / d; m.aimZ = dz / d; }
  m.cast.dirX = m.aimX; m.cast.dirZ = m.aimZ;
  const off = PHYS.radius + S.radius;
  const x0 = m.x + m.aimX * off, y0 = m.y + R.mouth, z0 = m.z + m.aimZ * off;
  const floor = supportInfo(m.field.cols, target.x, target.z, target.y).y, y1 = floor + S.radius;
  const vx = (target.x - x0) / T, vz = (target.z - z0) / T;
  return {
    x: x0, y: y0, z: z0, vx, vz, r: S.radius, dmg: S.damage,
    lob: { x0, y0, z0, vy: (y1 - y0) / T + (PHYS.gravity * T) / 2, t: 0, T, tx: target.x, tz: target.z, floor },
  };
}

/**
 * 國王劈砍劍尖推出去的一道氣流（world.gusts）：從腳 (x, y, z) 沿 (dirX, dirZ)，前緣一開始在劍長
 * （黑牆比劍近的話到牆為止，`len`）。
 */
function hewGust(m, world, x, y, z, dirX, dirZ) {
  const S = SKILL.hew, wall = laneLength(x, z, dirX, dirZ, m.field.arena), len = Math.min(S.len, wall);
  const gust = {
    x, y, z, dirX, dirZ, w: S.width, dmg: S.gust.damage, wall, len,
    from: len, to: len, fresh: true, done: false, spent: false, blocker: null,
  };
  world.gusts.push(gust);
  return gust;
}

/**
 * 國王第二條命的上挑（劈下去之後）：身體是騎士跳砍之後的那一下（upper），只是劍是國王的。劈下去的
 * 那一刻已經瞄好了（aimUp，扇形的末端在劍長那麼遠）。站 up.gap 秒，然後原地起跳（初速 PHYS.jump、
 * 受重力，UP_AIR 秒落回同一層）；起跳那一刻劍尖沿上挑的方向推出第二道氣流（跟劈的那一道一樣），
 * 起跳後 swing 秒內每一幀打一片直立扇形（半徑是劍長，左右各厚半條長條寬）。落地收招。
 * 打下去的那一下帶著 `mark`：斬痕照它留（劍長那一條，在起跳那一層；fight.js）。
 */
function hewUp(m, world) {
  const c = m.cast, S = SKILL.hew, U = S.up, up = c.up;
  const u = c.t - S.windup - U.gap;
  if (u < 0) return null;
  c.upGust ??= hewGust(m, world, up.x, up.y, up.z, up.dirX, up.dirZ);
  if (u >= UP_AIR) {
    m.y = up.y;
    m.grounded = true;
    m.cast = null;
    return null;
  }
  m.y = up.y + PHYS.jump * u - (PHYS.gravity * u * u) / 2;
  m.grounded = false;
  if (u > U.swing) return null;
  const g = c.upGust;
  return {
    shape: 'fan', x: m.x, y: m.y, z: m.z, aimX: up.dirX, aimZ: up.dirZ, tip: up.tip, thick: S.width / 2, r: S.len, dmg: U.damage,
    gust: g, up: true, mark: { x: up.x, y: up.y, z: up.z, dirX: up.dirX, dirZ: up.dirZ, len: g.len, w: S.width },
  };
}

/**
 * 跳砍落地：轉向玩家現在的位置，記下上挑的方向與那一片扇形的末端點（起跳那一層、
 * 往前 len——預告那一條的遠端，fanFrame 的下緣指著它；騎士是 REACH）。
 */
function aimUp(m, target, len = REACH) {
  const c = m.cast;
  const dx = target.x - m.x, dz = target.z - m.z, d = Math.hypot(dx, dz);
  const [dirX, dirZ] = d > 1e-6 ? [dx / d, dz / d] : [c.dirX, c.dirZ];
  c.up = { dirX, dirZ, x: m.x, y: m.y, z: m.z, tip: { x: m.x + dirX * len, y: m.y, z: m.z + dirZ * len } };
  m.aimX = dirX; m.aimZ = dirZ;
}

/**
 * 上挑：落地之後站 gap 秒，然後原地起跳（初速 PHYS.jump 的拋物線，UP_AIR 秒落回同一層），
 * 起跳後 swing 秒內每一幀打那一片扇形（跟主角第二段一樣照這一幀的位置），落地收招。
 */
function upper(m) {
  const c = m.cast, S = SKILL.cleave, U = S.up, up = c.up;
  const u = c.t - S.windup - S.air - U.gap;
  if (u < 0) return null;
  if (u < UP_AIR) {
    m.y = up.y + PHYS.jump * u - (PHYS.gravity * u * u) / 2;
    m.grounded = false;
    if (u > U.swing) return null;
    return { shape: 'fan', x: m.x, y: m.y, z: m.z, aimX: up.dirX, aimZ: up.dirZ, tip: up.tip, thick: U.thick, dmg: U.damage };
  }
  m.y = up.y;
  m.grounded = true;
  m.cast = null;
  return null;
}

/**
 * 幽靈騎士連斬的後兩下：落地之後站 gap 秒（跟騎士一樣），之後照 REAP[c.skill] 的順序：
 *   上挑  照主角那一跳往上升，升 UP_RISE 秒到頂點就停在那裡（不受重力，不落下）。起跳後 swing 秒內
 *         每一幀打上挑那一片扇形（跟騎士的上挑同一片）。
 *   轉    原地轉一圈（在哪個高度就在那裡轉），前 swing 秒每一幀打腰那麼高的那一片圓盤。
 * 兩下都打完收招，停在空中。
 */
function rend(m) {
  const c = m.cast, S = SKILL.cleave, U = S.up, R = REND, up = c.up, P = REAP[c.skill];
  const u = c.t - S.windup - S.air - U.gap;
  if (u < 0) return null;
  const k = Math.min(Math.max(0, u - P.up), UP_RISE);
  m.y = up.y + PHYS.jump * k - (PHYS.gravity * k * k) / 2;
  m.grounded = false;
  if (u >= P.end) { m.cast = null; return null; }
  const a = u - P.up, s = u - P.spin;
  if (a >= 0 && a < UP_RISE) {
    if (a > U.swing) return null;
    return { shape: 'fan', x: m.x, y: m.y, z: m.z, aimX: up.dirX, aimZ: up.dirZ, tip: up.tip, thick: U.thick, dmg: U.damage };
  }
  if (s < 0 || s > R.swing) return null;
  return { shape: 'capsule', x: m.x, y: m.y, z: m.z, x1: m.x, z1: m.z, r: R.radius, waist: m.y + R.waist, dmg: R.damage };
}

/** 點 (px, pz) 到線段 (ax, az)–(bx, bz) 的水平距離。 */
function segGap(px, pz, ax, az, bx, bz) {
  const ux = bx - ax, uz = bz - az, L2 = ux * ux + uz * uz;
  const k = L2 > 1e-12 ? Math.min(1, Math.max(0, ((px - ax) * ux + (pz - az) * uz) / L2)) : 0;
  return Math.hypot(px - ax - ux * k, pz - az - uz * k);
}

/**
 * 從挑得到的招裡挑一招（r 是 0～1 的亂數）：帶 `chance` 的招照它的機率，沒帶的平分剩下的。
 * 全部都帶 `chance`（或只剩帶的那幾招）的話照比例放大到加起來是 1。
 * idle（可以沒有）：每一招幾次挑招沒輪到它——權重再乘 1 + IDLE × 它，越久沒放越容易挑中。
 */
export function pickSkill(can, r, idle = {}) {
  const odds = can.map((s) => SKILL[s].chance);
  const fixed = odds.reduce((a, p) => a + (p ?? 0), 0), free = odds.filter((p) => p === undefined).length;
  const each = free ? Math.max(0, 1 - fixed) / free : 0;
  const w = can.map((s, i) => (odds[i] ?? each) * (1 + IDLE * (idle[s] || 0)));
  let x = r * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < can.length; i++) if ((x -= w[i]) < 0) return can[i];
  return can[can.length - 1];
}

/** 冷落的權重：一招每多一次挑招沒輪到它，權重多基礎的這麼多倍（pickSkill）。 */
export const IDLE = 1;

/** 同一招最多連放幾次：到了就先不挑它，等別招夠得到。 */
export const REPEAT = 2;

/**
 * 這隻挑招的記性（m.plan；重生、第二條命站起來的時候 combat.js 清掉，這裡重來）。
 * open：還沒放的開場招（KINDS 的 `open`，第二條命 `rageOpen`），照順序先放完——類魂的頭目
 * 開場是固定的，玩家每一次都從同一招開始讀；夠不到就追到夠得到為止，不跳過。
 * idle：每一招幾次挑招沒輪到它（給 pickSkill）。last、run：上一招是哪一招、連放了幾次（REPEAT）。
 */
export function planOf(m) {
  if (!m.plan) {
    const k = kindOf(m);
    m.plan = { open: [...((raging(m) ? k.rageOpen : k.open) || [])], idle: {}, last: null, run: 0 };
  }
  return m.plan;
}

/** 從夠得到的招（can）裡照記性挑一招，記下來。一招都不行（開場招夠不到、只剩連放滿的）是 null。 */
function choose(m, list, can, rng) {
  const P = planOf(m);
  let skill;
  if (P.open.length) {
    if (!can.includes(P.open[0])) return null;
    skill = P.open.shift();
  } else {
    const fresh = can.filter((s) => !(s === P.last && P.run >= REPEAT));
    if (!fresh.length) return null;
    skill = pickSkill(fresh, rng(), P.idle);
  }
  for (const s of list) P.idle[s] = s === skill ? 0 : (P.idle[s] || 0) + 1;
  P.run = skill === P.last ? P.run + 1 : 1;
  P.last = skill;
  return skill;
}

/**
 * 範圍攻擊打到玩家了嗎。範圍是平面上的形狀，高度各有各的（見每一種）：
 * 形狀碰到身體（身體半徑算進去）、身體的圓柱又跟那個高度重疊，才算。
 *
 *   circle   圓心 (x, z)、半徑 r。震波：這一幀前緣掃過 from～to 那一圈，高度是塵鼓的高度（waveHits）。
 *   cone     尖在 (x, z)、朝 (dirX, dirZ)、半角 half、長 r。同上，只有那一片扇形裡的那一段前緣。
 *   capsule  (x, z)–(x1, z1) 那一段往外擴 r（劍迴旋衝刺這一幀走過的那一段），在 waist 那個高度：移動的圓盤。
 *   strip    從 (x, z) 往 (dirX, dirZ) 長 len、寬 w 的長方形（跳砍劈下去的那一條）。
 *   fan      腳在 (x, y, z)、下緣指著 tip 的直立扇形，左右各厚 thick、半徑 r（沒有就是 REACH）（跳砍之後的上挑，
 *            combat.js 的 inFan）。立起來的，所以不看高度——跳起來躲不掉。
 */
export function strikeHits(st, p) {
  if (st.shape === 'fan') return inFan(st, p, st.tip, st.thick, st.r);
  if (QUAKE[st.shape]) return waveHits(st, p);
  if (st.shape === 'capsule') {
    // 移動的圓盤：跟 inRing 一樣，waist 那片平面切得到身體的圓柱、這一幀走過的那一段（膠囊）又碰到身體。
    if (st.waist < p.y || st.waist > p.y + PHYS.height) return false;
    return segGap(p.x, p.z, st.x, st.z, st.x1, st.z1) <= st.r + PHYS.radius;
  }
  if (p.y >= (st.y ?? 0) + REACH_UP) return false;
  if (st.shape === 'strip') {
    // 長方形到身體中心的距離（裡面是 0），碰到身體就算。
    const rx = p.x - st.x, rz = p.z - st.z;
    const u = rx * st.dirX + rz * st.dirZ, v = rz * st.dirX - rx * st.dirZ;
    const du = Math.max(0, -u, u - st.len), dv = Math.max(0, Math.abs(v) - st.w / 2);
    return Math.hypot(du, dv) <= PHYS.radius;
  }
  return false;
}

/**
 * 地震的震波這一幀打到玩家了嗎（circle、cone）。震波是一道往外走的前緣，不是整片一次打下去：
 *   前緣  這一幀掃過半徑 from～to 的那一圈（往外各多半條塵的寬，最外不超過 r）；身體那根圓柱
 *         碰到那一圈才算。震波走完之後裡面就沒有東西了——站在已經過去的地方不會挨。
 *   高度  那一層地板往上、前緣所在的那一道塵鼓多高（dust.js 的 quakeTop）：越外面越高。身體
 *         的圓柱碰到 [地板, 塵頂] 才算，所以矮的裡圈跳得過、高的外圈跳不過，也不會打到腳下
 *         更低那一層的人。
 *   扇形  角度跟第一段同一種判法：身體在那個距離張開的角度算進去。
 * from／to 由 bossStep 打下去那一刻寫進來（都是 0：前緣在腳下），之後 wavesStep 推進。
 */
function waveHits(st, p) {
  const d = Math.hypot(p.x - st.x, p.z - st.z), R = PHYS.radius;
  const y0 = st.y ?? 0;
  if (p.y >= y0 + quakeTop(st.shape, d / st.r) || p.y + PHYS.height <= y0) return false;
  const half = QUAKE[st.shape].width / 2;
  if (d - R > Math.min(st.r, st.to + half) || d + R < st.from - half) return false;
  if (st.shape === 'circle' || d <= R) return true;
  const cos = ((p.x - st.x) * st.dirX + (p.z - st.z) * st.dirZ) / d;
  const off = Math.acos(Math.max(-1, Math.min(1, cos)));
  return off <= st.half + Math.asin(Math.min(1, R / d));
}

/**
 * 有技能的那一類（殭屍王、騎士、幽靈騎士、國王）的一幀：倒數、挑招、推進放到一半的招。沒有技能的那一類
 * 什麼都不做。要在 monsterStep 之前叫——放招中的怪物 monsterStep 讓牠站著不動（要走的招
 * 自己在 CAST 裡走）。
 *
 * 挑招只從夠得到的招裡挑（`range`，見檔頭，第二條命的扇形見 RAGE；召喚還要場上沒滿，READY），照記性挑（planOf）；一招都挑不到的話不重新計時，下一幀再看。
 *
 * calm：主角倒下了（windDown 收過一次），target 是牠倒下的地方。不挑新招，放到一半的照常播完，
 * 播完不接下一下（第二條命的跳砸）。
 *
 * @param {() => number} rng 挑招用的亂數（離線驗證給固定的）
 * @returns {object|null} 這一幀打下來的範圍攻擊（給 strikeHits），沒有就是 null
 */
export function bossStep(m, dt, target, world, rng = random, calm = false) {
  const k = kindOf(m);
  const list = skillsOf(m);
  if (!list.length || m.rally) return null;   // 站起來的時候（combat.js 的 RALLY）不放招
  if (m.cast && busy(m)) {                             // 被打斷
    if (m.cast.frail) cut(m);
    else m.cast = null;
  }
  m.castT -= dt;
  // 衝刺（combat.js 的 LUNGE）打完才挑下一招，兩件事不會疊在一起。
  if (!calm && !m.cast && m.castT <= 0 && !busy(m) && !(m.stun > 0) && !m.lunge) {
    const gap = Math.hypot(target.x - m.x, target.z - m.z);
    const can = list.filter((s) => gap <= (SKILL[s].range ?? Infinity) && (!READY[s] || READY[s](m)));
    const skill = can.length ? choose(m, list, can, rng) : null;
    if (skill) {
      m.castT = k.every;
      begin(m, skill, target, rng);
    }
  }
  if (!m.cast) return null;
  const c = m.cast;
  c.t += dt;
  const skill = c.skill;
  const hit = CAST[skill](m, world, target) || null;
  if (calm && m.cast !== c) m.cast = null;
  if (!m.cast) m.stun = recoverOf(skill);              // 出完了：僵直
  // 地震：打下去的這一刻是震波的起點，之後由 wavesStep 一圈一圈往外推，不是一次打完。
  if (hit && QUAKE[hit.shape]) world.waves.push(Object.assign(hit, { t: 0, from: 0, to: 0, fresh: true, done: false }));
  return hit;
}

/** 球貼著地板飛（底剛好在發射那一層的頂上）：頂面不比球底高出這麼多的東西不算撞到。 */
const SKIM = 0.05;

/**
 * 水平半徑 r、高度 lo～hi 的一塊（方框近似）撞到場上的哪一個東西：第一個碰到的碰撞體，
 * 沒有就是 null。坑與黑牆不在這裡算（黑牆用 arenaGap 量），開著的門不擋；圓柱照它的頂
 * （圓頂的話照碰得到的那一圈的高度）。
 */
export function blockerAt(field, x, z, r, lo, hi) {
  const doors = field.doors || {};
  for (const b of field.cols) {
    if (b.kind === 'pit' || b.kind === 'bound') continue;
    if (b.door && doors[b.door]) continue;
    if (b.min[1] >= hi) continue;
    if (b.shape === 'circle') {
      const d = Math.hypot(x - b.x, z - b.z);
      if (d < b.r + r && roundTop(b, Math.max(0, d - r)) > lo) return b;
      continue;
    }
    if (b.max[1] > lo && overlapXZ(x, z, b, r)) return b;
  }
  return null;
}

/** 一顆球撞到場上的東西了嗎：球（用外接方框近似）跟碰撞體重疊（blockerAt）。 */
export const shotBlocked = (s, field) => !!blockerAt(field, s.x, s.z, s.r, s.y - s.r + SKIM, s.y + s.r);

/**
 * 球往前飛，碰到黑牆或場上的東西就炸掉消失。回傳這一幀炸掉的那幾顆（畫爆炸用）。
 * 拋物線的球（`lob`）照時間擺在拋物線上，落到落點的那一幀停在那裡（這一幀照樣打得到人），下一幀炸掉；
 * 不看黑牆——起點與落點都在場裡，中間那一條也在。
 */
export function shotsStep(world, dt) {
  const gone = [];
  world.shots = world.shots.filter((s) => {
    const L = s.lob;
    if (L) {
      if (L.t >= L.T) { gone.push(s); return false; }
      L.t = Math.min(L.T, L.t + dt);
      s.x = L.x0 + s.vx * L.t; s.z = L.z0 + s.vz * L.t;
      s.y = L.y0 + L.vy * L.t - (PHYS.gravity * L.t * L.t) / 2;
      const hit = shotBlocked(s, world.field);
      if (hit) gone.push(s);
      return !hit;
    }
    s.x += s.vx * dt; s.z += s.vz * dt;
    const hit = arenaGap(world.field.arena, s.x, s.z) <= s.r || shotBlocked(s, world.field);
    if (hit) gone.push(s);
    return !hit;
  });
  return gone;
}

/** 氣流前緣那一塊（前緣往後 w 那麼長的方框，跟劍光一樣高）在離起點 d 的地方撞到什麼。 */
function gustBlocker(g, field, d) {
  const k = d - g.w / 2;
  return blockerAt(field, g.x + g.dirX * k, g.z + g.dirZ * k, g.w / 2, g.y + SKIM, g.y + GUST.top);
}

/** 氣流往前找的一步最多多長：比它的寬短得多，薄的東西（門）才不會被一步跨過去。 */
const GUST_PROBE = 0.1;

/**
 * 氣流從離起點 a 走到 b（a 那裡沒撞到）：第一個撞到的地方。沒撞到是 null；撞到的話 d 是
 * 剛好碰到的那一點（往回二分找到幾公分以內），b 是撞到的那一個碰撞體。
 */
function gustHit(g, field, a, b) {
  for (let lo = a; lo < b;) {
    const hi = Math.min(b, lo + GUST_PROBE), hit = gustBlocker(g, field, hi);
    if (hit) {
      let u = lo, v = hi;
      for (let i = 0; i < 8; i++) {
        const mid = (u + v) / 2;
        if (gustBlocker(g, field, mid)) v = mid; else u = mid;
      }
      return { d: u, b: gustBlocker(g, field, v) || hit };
    }
    lo = hi;
  }
  return null;
}

/**
 * 國王劈砍推出去的氣流往前一幀（`hew` 劈下去那一幀放進 world.gusts）：前緣每秒 speed 公尺沿那一條走，
 * `from`～`to` 是這一幀前緣走過的那一段（離起點量，gustHits 照它判）。走到黑牆
 * （`wall`）或撞上場上的東西就停在那裡（`blocker` 是撞到的那一個，黑牆是 null），那一幀之後的
 * 下一次收掉。新放進來的那一幀不走：先看劍長那一截裡有沒有東西（有的話氣流根本推不出去）。
 * 每一幀在 bossStep 之後、判定之前叫。
 *
 * @returns {object[]} 這一幀停下來的氣流（畫撞上去的那一下用）
 */
export function gustsStep(world, dt) {
  const field = world.field, stopped = [];
  world.gusts = world.gusts.filter((g) => !g.done);
  for (const g of world.gusts) {
    const fresh = g.fresh;
    g.fresh = false;
    const a = fresh ? Math.min(g.w, g.to) : g.to, b = fresh ? g.to : Math.min(g.wall, g.to + SKILL.hew.gust.speed * dt);
    const hit = gustHit(g, field, a, b);
    // 劍長那一截裡就撞到了：氣流停在撞到的地方，一步都沒走。
    g.from = fresh && hit ? hit.d : g.to;
    g.to = hit ? Math.max(g.from, hit.d) : b;
    if (hit || g.to >= g.wall) { g.done = true; g.blocker = hit ? hit.b : null; stopped.push(g); }
  }
  return stopped;
}

/**
 * 氣流這一幀打到玩家了嗎。那一塊是劍光（GUST）立在劈的那個直立面上、往左右加厚 w：在那個面上
 * 近似成刀根前上方的四分之一圈環（離刀根 inner～top，從水平往前到正上方；三道的尖尾不算），
 * 刀根在前緣後面 top。這一幀刀根從 from − top 走到 to − top，走過的地方都算——身體（圓柱
 * 近似成方框）在那個面上是一個長方形，往後拉長這一幀走的那一段，碰到那四分之一圈環就算。
 * 兩側比較矮（gustRise）：照身體最靠中線的那一側那麼高算，高度除回去再比。
 */
export function gustHits(g, p) {
  const R = PHYS.radius, rx = p.x - g.x, rz = p.z - g.z;
  const u = rx * g.dirX + rz * g.dirZ, v = rz * g.dirX - rx * g.dirZ;
  if (Math.abs(v) > g.w / 2 + R) return false;
  // 身體在那個面上的長方形（從刀根量）：往前 a0～a1、往上 b0～b1，切掉四分之一圈以外的那幾象限。
  const a0 = Math.max(0, u - R - (g.to - GUST.top)), a1 = u + R - (g.from - GUST.top);
  const rise = gustRise(Math.max(0, Math.abs(v) - R) / (g.w / 2));
  const b0 = Math.max(0, p.y - g.y) / rise, b1 = (p.y + PHYS.height - g.y) / rise;
  if (a1 < a0 || b1 < b0) return false;
  return Math.hypot(a0, b0) <= GUST.top && Math.hypot(a1, b1) >= GUST.inner;
}

/**
 * 旋風斬的熱氣流：一圈環帶，圓心在國王腳下 (x, z)，腰的高度 mid 上下各 half。前緣在離圓心 `to`
 * 的地方（推出去那一刻是劍長 r0），`from`～`to` 是這一幀前緣走過的那一段（ringHits 照它判）。
 * env 是每個方向會被什麼擋下（occlude.js），far 是整圈最遠的那一點：前緣走過它就整圈都停了。
 */
function makeRing(m, env) {
  const S = SKILL.gale, mid = m.y + S.waist;
  return {
    x: m.x, y: m.y, z: m.z, mid, half: RING.half, depth: RING.depth, r0: S.radius, env, far: farthestOf(env),
    from: S.radius, to: S.radius, dmg: S.wave.damage, t: 0, fresh: true, done: false, spent: false,
  };
}

/**
 * 熱氣流往外一幀（旋風斬轉完那一幀放進 world.rings）：前緣每秒 speed 公尺往外。每個方向在被擋下
 * 的地方（reachAt）停住，那一段就不再往前、也不再打人；前緣走過整圈最遠的那一點（`far`）就整圈
 * 停了，那一幀之後的下一次收掉。新放進來的那一幀不走。每一幀在 bossStep 之後、判定之前叫。
 */
export function ringsStep(world, dt) {
  world.rings = world.rings.filter((g) => !g.done);
  for (const g of world.rings) {
    if (g.fresh) { g.fresh = false; continue; }
    g.t += dt;
    g.from = g.to;
    g.to += SKILL.gale.wave.speed * dt;
    if (g.to >= g.far) g.done = true;
  }
}

/** 熱氣流在離中線 dy（公尺，往上往下一樣）的地方有多深（前緣往後量）：正中間 depth，往邊上照橢圓壓淺。 */
export const ringDepth = (g, dy) => g.depth * gustRise(Math.min(1, Math.abs(dy) / g.half));

/** 判一個身體碰到熱氣流的時候，身體張開的那一段角度裡取幾個方向（再加上擋住的分段在裡面的每一個交界）。 */
const RING_PROBES = 16;

/**
 * 熱氣流這一幀打到玩家了嗎。
 *   高度  身體那根圓柱跟環帶（mid ± half）重疊才算；在最靠中線的那個高度量那裡有多深（ringDepth）。
 *   方向  身體在圓心那裡張開一段角度。那一段裡每一個方向：熱氣流在那個方向這一幀的前緣是
 *         min(to, 擋下的地方)，後緣是這一幀開始時的 from 往後那麼深；這一段（從後緣到前緣）跟
 *         身體在那個方向上的那一截（弦）重疊就算。這一幀開始的時候已經被擋下的方向不算。
 *         方向取那一段的兩頭、等分的 RING_PROBES 個，與擋住的分段在那一段裡的每一個交界——
 *         所以躲在柱子後面露出一點點也挨得到，整個躲進去就不挨。
 */
export function ringHits(g, p) {
  const R = PHYS.radius;
  const dy = Math.min(Math.max(g.mid, p.y), p.y + PHYS.height) - g.mid;
  if (Math.abs(dy) > g.half) return false;
  const deep = ringDepth(g, dy);
  const rx = p.x - g.x, rz = p.z - g.z, rho = Math.hypot(rx, rz);
  if (rho - R > g.to || rho + R < g.from - deep) return false;
  const at = Math.atan2(rx, rz), half = rho > R ? Math.asin(R / rho) : Math.PI;
  const probes = [];
  for (let i = 0; i <= RING_PROBES; i++) probes.push(at - half + (2 * half * i) / RING_PROBES);
  for (const pc of g.env.pieces) {
    for (const a of [pc.a0, pc.a0 + 2 * Math.PI, pc.a0 - 2 * Math.PI]) if (a > at - half && a < at + half) probes.push(a, a - 1e-9);
  }
  for (const th of probes) {
    const d = reachAt(g.env, th);
    if (g.from >= d) continue;
    const off = th - at, s = rho * Math.sin(off), w = Math.sqrt(Math.max(0, R * R - s * s)), c = rho * Math.cos(off);
    if (Math.min(g.to, d) >= c - w && g.from - deep <= c + w) return true;
  }
  return false;
}

/**
 * 一顆球碰到玩家了嗎：球心到玩家那根圓柱（半徑 PHYS.radius、高 PHYS.height）
 * 的距離小於球的半徑。
 */
export function shotHits(s, p) {
  const out = Math.max(0, Math.hypot(s.x - p.x, s.z - p.z) - PHYS.radius);
  const dy = s.y < p.y ? p.y - s.y : s.y > p.y + PHYS.height ? s.y - p.y - PHYS.height : 0;
  return Math.hypot(out, dy) < s.r;
}

/**
 * 從 (x, z) 沿 (dirX, dirZ) 走到黑牆 `arena` 有多遠。球的預告畫到這裡為止——球本來就
 * 在那裡消失。方的量到四條邊，圓的解射線與圓的交點。
 */
export function laneLength(x, z, dirX, dirZ, arena = FIELD.arena) {
  if (arena.shape === 'circle') {
    const ox = x - arena.x, oz = z - arena.z;
    const b = ox * dirX + oz * dirZ, c = ox * ox + oz * oz - arena.r * arena.r;
    return Math.max(0, -b + Math.sqrt(Math.max(0, b * b - c)));
  }
  let t = Infinity;
  if (dirX > 1e-9) t = Math.min(t, (arena.x1 - x) / dirX);
  if (dirX < -1e-9) t = Math.min(t, (arena.x0 - x) / dirX);
  if (dirZ > 1e-9) t = Math.min(t, (arena.z1 - z) / dirZ);
  if (dirZ < -1e-9) t = Math.min(t, (arena.z0 - z) / dirZ);
  return Math.max(0, t);
}
