# TT-plus（TokenTracker-plus）

> **TT-plus 是基於原作者開源倉庫做的個人改造版。**
> 本項目基於 [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker)（MIT）開發，**不是上游官方發行版**，也不代表原作者。上游的版權、設計與基礎功能歸原作者所有；本倉庫的改造部分同樣以 MIT 發布。上游不為此 fork 提供支援或背書。

[English](./README.md) · [简体中文](./README.zh-CN.md) · **繁體中文**

本倉庫當前支援 **52 款 AI 編碼工具**（以上游為基礎，含 fork 擴展）。TT-plus 是一個**本地優先**的 AI 編碼 token 用量與成本看板：解析本機 CLI / IDE 的日誌與資料庫，按模型和小時記帳，提供 Dashboard、會話明細、項目歸屬、限額卡、桌寵、桌面小組件和自建後端同步。

---

## 這是什麼

- **本地採集**：讀取本機 JSONL / SQLite / 日誌中的 token 計數、時間、模型名與成本，寫入 `~/.tokentracker/queue.jsonl`。
- **本地看板**：CLI 啟動本地面板，展示總花費、每日趨勢、模型拆分、項目歸屬、會話列表、限額與成就。
- **自建雲功能（可選）**：排行榜、成就、跨設備帳號視圖可以指向自己的 Node + PGlite 後端（`scripts/self-host/`），沒有會員/付費界面。
- **桌面端**：Windows 托盤應用內嵌 Dashboard，附帶桌寵、桌面額度小組件和置頂用量藥丸。
- **可審計的費用口徑**：每個 token 分量分開記，成本按 `Σ(tokens × 單價)` 計算；價格來自 LiteLLM + 本地 curated overrides。

## 支援的 AI 工具（52）

本倉庫當前支援的 **52 款 AI 編碼工具**（以 `src/commands/init.js` 的 `SUPPORTED_PROVIDERS` 為準）：

Claude Code、AutoClaw、Cola、Tuanjie Cowork、Agent2API、Codex CLI、AStudio、Cursor、Gemini CLI、Antigravity、Kiro、OpenCode、OpenClaw、Loomy、Every Code、Hermes Agent、GitHub Copilot、Kimi Code、CodeBuddy、WorkBuddy、WorkBuddy AI、Grok Build、oh-my-pi、OmO、pi、Dots、Prime Agent、Craft Agents、Reasonix、Muse Code、Kilo CLI、Kilo Code、Roo Code、Zed Agent、Goose、Droid、Mimo、DuMate、ZCode、Qoder、AnythingLLM Desktop、Claude Science、DeepSeek Harness、TRAE CN、TRAE、LM Studio、Unsloth Studio、Devin CLI、Cline、MiniMax Code、CodeArts Agent、Command Code

目錄覆蓋：`TOKENTRACKER_ACODE_HOME`（AStudio）、`TOKENTRACKER_DUMATE_HOME`（DuMate）、`TOKENTRACKER_LMSTUDIO_HOME`（LM Studio）、`TOKENTRACKER_UNSLOTH_DB`（Unsloth Studio）、`TOKENTRACKER_DEVIN_DB`（Devin CLI），以及各 provider 自己的 home 環境變量。

## 與上游的區別

| 方面 | 上游 TokenTracker | TT-plus |
|---|---|---|
| 定位 | 通用、多用戶、可選託管 Cloud | 單機、單用戶、自託管 |
| **支援的 AI 工具數** | **52** | **52**（含 fork 擴展） |
| **限額追蹤** | ✅ 17 家 provider | ✅ 17 家 provider + fork 擴展 |
| 雲功能 | 官方託管 / 可選自託管 | 默認對接自己的後端；無會員/付費 UI |
| 用量源 | 上游 52 款工具 | 另補 WorkBuddy 雙版、DSH、ZCode、TRAE CN 本地庫、Kimi 桌面版、AutoClaw、Cola、Tuanjie Cowork 等 |
| 限額卡 | 上游 provider 集合 | 另加 Agent2API（小浣熊）、APIGOTO、AgentRouter、DeepSeek、Trae 小號、CodeArts、Cline Pass、SenseNova |
| Windows | 托盤 + Dashboard | 另加桌寵動作輪換、桌面額度小組件、置頂用量藥丸 |
| 定價 | 上游 `-free` 歸零規則 | **拒絕 `-free` 歸零**：免費路由仍按刊例價計值 |
| 發布 | npm / 官方安裝包 | 不發布 npm；桌面端從源碼構建 |

## 不包含什麼

- **不是官方發行版**：沒有 npm 包、沒有官方 release、沒有上游支援承諾。
- **沒有會員/付費界面**：排行榜和成就是自建後端上的功能。
- **不保證與上游同步**：合併上游時會有取捨；fork 特有行為（尤其是計費語義）不會自動跟隨上游。
- **不收集提示詞/代碼**：只記 token 計數、時間、模型名和成本。

## 快速開始（CLI + 本地 Dashboard）

要求 **Node.js 20+**。Windows 桌面端另需 .NET 8 SDK 與 WebView2 Runtime。

```bash
git clone https://github.com/01UNCLEDOG01/TokenTracker-plus.git
cd TokenTracker-plus
npm install

node bin/tracker.js          # 首次運行會安裝 hooks、同步本地數據並打開 Dashboard
node bin/tracker.js sync     # 手動同步
node bin/tracker.js status   # 查看 hook 狀態
node bin/tracker.js doctor   # 健康檢查
```

默認面板：`http://localhost:7680`。本地 Dashboard 不登錄也能看本機用量；雲功能需要配置自建後端並登錄。

### Windows 桌面端

```bash
TOKENTRACKER_BUILD_PET=1 npm --prefix dashboard run build
cd TokenTrackerWin
dotnet build -c Release
```

構建必須帶 `TOKENTRACKER_BUILD_PET=1`，否則不會產出 `pet.html` / `quota.html`。Windows 殼會選一個空閒 loopback 埠（不固定 7680）。詳見 [TokenTrackerWin/README.md](./TokenTrackerWin/README.md)。

## 自建後端（可選）

```bash
ROUTER_PW=... scripts/self-host/internal-deploy.sh [host]
scripts/self-host/internal-backup.sh
```

- 這是**技術預覽**，不是「空 VPS 一鍵安裝器」；完整門檻見 [docs/self-hosting.md](./docs/self-hosting.md)。
- 部署前必須先 `docker stop -t 30`，不要 `docker rm -f` 活容器。
- 客戶端用 `VITE_INSFORGE_BASE_URL` / `VITE_INSFORGE_ANON_KEY`（或 CLI 的 `TOKENTRACKER_INSFORGE_BASE_URL`）指向自己的實例。
- 自建後端只接收用量聚合數據，不接收提示詞或代碼。

## 數據與隱私

- **本地優先**：解析在本機完成，原始日誌不會因為同步而整份上傳。
- **只記計數**：input / cached / cache_creation / output / reasoning、時間桶、模型名、來源、金額；不保留對話正文與工具參數。
- **憑據留在本機**：cookie、API key、設備 token 放在用戶目錄或 `.env.local`；不會寫進倉庫、日誌或前端構建產物。
- **第三方請求**：只有你顯式配置的限額 provider 才會向對應廠商 API 發請求。

## 費用口徑

- `cost = input×input價 + cached×緩存讀價 + cache_write×緩存寫價 + output×輸出價 + reasoning×推理價`，不用 `total_tokens` 直接乘單價。
- 價格來自 LiteLLM 全量價表 + `src/lib/pricing/curated-overrides.json`；沒有公開價的模型只記 token，不偽造金額。
- **免費路由按刊例價計值**：上游 `-free` 歸零規則在本 fork 被永久拒絕。
- **AgentRouter 中轉面值不併入總花費**：codex 流量已按 token 記入總帳；站方面值只由 AgentRouter 卡承載。
- 估算值會顯式標註（如 antigravity、Qoder CN）。

### 熱力圖等級

熱力圖 **Level 0–4** 是相對於當前窗口的等級，不是固定的每日 token 門檻。服務端規則：

- `P` = 窗口內最高單日 `billable_total_tokens`；
- Level 1：`0 < tokens ≤ 25% × P`
- Level 2：`≤ 50% × P`
- Level 3：`≤ 75% × P`
- Level 4：`> 75% × P`

用戶端 fallback 目前使用活躍日分位數（50/75/90 分位），兩套規則尚未統一，介面也還沒有顯示當前門檻。見 KI-016。

## 配置

```bash
cp .env.example .env.local
```

常用變量：`TOKENTRACKER_DEVICE_TOKEN`、`TOKENTRACKER_ACCESS_TOKEN`、`TOKENTRACKER_INSFORGE_BASE_URL`、`VITE_INSFORGE_BASE_URL`、`VITE_INSFORGE_ANON_KEY`、`OPENROUTER_API_KEY`、`OPENCODE_GO_API_KEY`。

本地覆蓋放 `.env.local`（gitignored）。**不要創建 `.dev.vars`**——那是 Cloudflare Workers 的約定，本項目使用 Node/Electron 的 `.env.local`。

數據目錄：`~/.tokentracker/`；Windows 桌面應用還會使用 `%LOCALAPPDATA%` 下的應用數據目錄。

## 倉庫結構

```
src/                 CLI、解析器、本地 API、計價
dashboard/           React + Vite Dashboard
TokenTrackerWin/     Windows 托盤應用（.NET 8 + WebView2）
TokenTrackerBar/     macOS 菜單欄應用
TokenTrackerLinux/   Linux Tauri 應用
scripts/self-host/   自建後端部署、備份、聚合 SQL
test/                Node 測試與基線名單
docs/                專題文檔
```

## 文檔地圖

| 文件 | 用途 |
|---|---|
| [FORK_STATUS.md](./FORK_STATUS.md) | 當前 HEAD、部署狀態、門禁摘要 |
| [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | 未完成項、待拍板、已知限制 |
| [GATE_REGISTRY.md](./GATE_REGISTRY.md) | 提交/部署前必須跑的命令 |
| [CHANGELOG.md](./CHANGELOG.md) | 按時間正序的完整改造臺帳 |
| [AGENTS.md](./AGENTS.md) | 給 AI/協作者的導航與工作規則 |
| [CLAUDE.md](./CLAUDE.md) | 上游架構參考；fork 規則以 AGENTS.md 為準 |

## 開發與驗證

```bash
npm run test:fast
npm test
npm run validate:fast
npm run validate:bot-frames
npm --prefix dashboard run test
npm --prefix dashboard run typecheck
TOKENTRACKER_BUILD_PET=1 npm --prefix dashboard run build
```

本機 Node 全量約有 50 條環境/基線紅 + 已知 flaky，詳見 [GATE_REGISTRY.md](./GATE_REGISTRY.md)。不要用單文件綠給全量紅開脫。

## 已知限制

- **opencode 首讀慢、之後增量**：SQLite 庫約 27GB，首次掃描約 18s（應用新進程也是冷啟動）；之後只讀新增/更新行，本機該源約 6.4s，整輪第二次刷新約 12.6s。v2/過渡佈局仍走全量。
- **antigravity 優先使用 tokscale 真數**：Token Monitor 的 tokscale 緩存涵蓋到的天用實測值，未涵蓋到的天繼續用 transcript 估算。本機緩存只涵蓋 2026-10-03..10-10。
- **Qoder token 是按 credits 反推的**：Qoder 國際版 JSONL 的 token 欄位全是 0，TT 按 credits 反推，並標成 Qwen3.8-Flash（積分）/ DeepSeek-Flash（積分）。Qoder CN 的官方消耗與 Qoder 國際版額度都依賴 `qoder-usage-cookie.txt`；國際版 cookie 是 httpOnly，需要在 DevTools 複製一次（用刷新腳本）。
- **Qoder 國際版在 Windows 沒有本地配額服務**：資料在 `~/.qoder`，限額卡走 cookie 路線，不找 `%APPDATA%\Qoder`。
- **DeepSeek 只有餘額卡**：舊的 `/user/balance/models` 逐日用量端點已不存在，卡片只顯示餘額與贈送額。
- **部分源沒有逐對話數據**：cursor / minimax-code / reasonix 的會話層尚未接入。
- **Windows 殼是 MVP**：托盤實時數字、原生 bridge、自動更新、簽名安裝包/CI 仍未完全移植。
- **上游合併可能覆蓋 fork 改動**：合併後必須重新對帳計費總額與關鍵行為。

## License 與致謝

- **License**：[MIT](./LICENSE)。上游版權歸 `xiufengsun`；本 fork 的修改同樣以 MIT 發布。
- **上游項目**：[xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker)。
- **第三方組件**：見 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。Clawd 角色設計歸 Anthropic，本項目與 Anthropic 無官方關聯。
- 上游問題請提到 [上游 issue](https://github.com/xiufengsun/TokenTracker/issues)。
