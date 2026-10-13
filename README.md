# Dogsouls: Revive the Kingdom from Zombie Invasion

王國最強的戰士睡過頭，醒來時防線已經被攻破，城裡滿是殭屍與幽靈。在城堡遺跡裡一場一場打下去，收集靈魂，回到王座廳讓國王用它們復活整個國家。

六場戰鬥（兵營、中庭、窄巷、水窖、墓室、王座廳），場與場之間是漫畫。劇本見 [STORY.md](STORY.md)。

**整個遊戲都是靜態檔案**：`public/` 由 Cloudflare Workers Static Assets 直接送出，沒有伺服器程式，執行時不打任何 API。

---

## 本機開發

```bash
npm install
npm run dev
```

http://localhost:8787/ 是完整遊戲。本機另外開得到幾個開發用的模式：

| 網址 | 是什麼 |
| --- | --- |
| `/?mode=terrain` | 地形：四個城堡遺跡區塊，走上去看看 |
| `/?mode=combat` | 戰鬥：黑牆圍起來的空地，試打每一種怪物 |
| `/?mode=flow` | 完整流程：完整遊戲加上面板、提示字與開發用的鍵（R 重玩、1–6 跳場） |

這幾個模式**不上 Cloudflare**：它們的表（`public/src/dev-modes.js`）與只有它們用得到的檔案列在 [`public/.assetsignore`](public/.assetsignore)，`wrangler deploy` 不會上傳；線上帶任何 `?mode=` 都是完整遊戲。

錄影不是模式，是完整遊戲的開關，**線上也開得到**：`/?record` 是完整遊戲，國王坐上王位之後可以把每一場轉成影片下載（全部在瀏覽器裡做，不上傳）。只跟完整遊戲搭，跟 `?mode=` 一起給就不算。

`npm run dev` 是 `tools/serve.mjs`，一台不讀 `.assetsignore` 的靜態伺服器——`wrangler dev` 跟部署一樣會把那些檔案擋掉，所以不拿它當開發伺服器。想看線上實際的樣子就跑：

```bash
npm run preview   # wrangler dev：送出去的檔案跟部署一模一樣
```

讓同一個網路的手機也連得到：`HOST=0.0.0.0 npm run dev`（PowerShell：`$env:HOST='0.0.0.0'; npm run dev`）。

---

## 驗證

```bash
npm run verify
```

全部不開瀏覽器，在 node 底下跑：上線的檔案拼不拼得起來（`verify:ship`）、動物、戰鬥、路線、劇本與漫畫、音效、錄影帶、地形走不走得到。每一支也可以單獨跑，名字見 `package.json` 的 `verify:*`。

---

## 部署

```bash
npx wrangler login
npm run deploy
```

Worker 的名字是 `dogsouls`（`wrangler.toml`）。

`.github/workflows/deploy.yml`：push 到 `main` 會先跑 `npm run verify`，全部通過才部署。需要在 repo 的 Settings → Secrets 加 `CLOUDFLARE_API_TOKEN`（Cloudflare dashboard → My Profile → API Tokens → 用 "Edit Cloudflare Workers" 範本）。

---

## 目錄

```
public/
  index.html            唯一的一頁：版面、CSS、各模式的面板（data-for）
  src/boot.js           讀 ?mode=、收拾頁面、載入那個模式的主程式
  src/mode-flow.js      完整遊戲（與 flow、record 模式）的組裝
  src/dev-modes.js      開發模式的表（不上線）
  src/cat/              動物：模型、骨架、步態、毛色、帽子
  src/light/            光影：陰影、接觸陰影、火光、空氣、後製
  src/…                 其餘每一支的用途寫在它自己的開頭註解
  vendor/three.module.js
  assets/               cat.bin（動物模型）、音效、音樂
  comic/                漫畫的每一格（tools/comic/ 拍的）
  .assetsignore         不上 Cloudflare 的檔案
tools/
  serve.mjs             npm run dev
  verify-*.mjs          npm run verify 的每一支
  comic/                畫漫畫的攝影棚，見 tools/comic/README.md
  make-sfx.mjs、make-music.mjs、make-icons.mjs
STORY.md                劇本
DEVNOTES.md             往場景裡加東西之前要知道的規矩
```
