<div align="center">
  <img src="./dashboard/public/app-icon.png" width="96" height="96" alt="TokenTracker Plus Logo" />
  <h1>TokenTracker Plus (TT-plus)</h1>
  <p><strong>跨 52 款 AI 編碼工具與 IDE，看清你到底在 AI 上花了多少錢與即時 Token 速率</strong></p>
  <p>
    <a href="./README.zh-CN.md">简体中文</a> · <b>繁體中文</b> · <a href="./README.md">English</a>
  </p>
  <p>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
    <a href="#-支援的-ai-工具列表52-款"><img src="https://img.shields.io/badge/AI%20Tools-52%20Supported-brightgreen.svg" alt="52 Supported AI Tools" /></a>
    <a href="#-快速開始"><img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-9cf.svg" alt="Platform" /></a>
    <a href="#-數據與隱私準則"><img src="https://img.shields.io/badge/Privacy-100%25%20Offline%20First-success.svg" alt="100% Offline First" /></a>
    <a href="#-核心特性"><img src="https://img.shields.io/badge/Speed%20Engine-tok%2Fs%20Capture-orange.svg" alt="Speed Engine" /></a>
    <a href="#-熱力圖色階與數據分析"><img src="https://img.shields.io/badge/Heatmap-Lv0~Lv7%208--tier-blueviolet.svg" alt="8-tier Heatmap" /></a>
    <a href="https://github.com/01UNCLEDOG01/TokenTracker-plus"><img src="https://img.shields.io/github/stars/01UNCLEDOG01/TokenTracker-plus?style=social" alt="GitHub stars" /></a>
  </p>
</div>

> 💡 **關於本倉庫**：TT-plus 是基於原作者 [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker)（MIT 許可）深度重構的單機與自託管增強版。核心目標是**100% 本地優先**、**真值計費**、**會話拓撲下鑽**與**全鏈路 Token 生成速率即時捕獲**。上游版權歸原作者所有，本改造同樣遵循 MIT 協議開源。上游官方不為此 fork 提供支援或背書。

---

## ⚡ 快速開始

> **環境要求**：Node.js **20+**（CLI 支援 Windows / macOS / Linux；Windows 桌面端另需 .NET 8 SDK 與 WebView2 Runtime）。

```bash
# 1. 複製代碼倉庫並安裝依賴
git clone https://github.com/01UNCLEDOG01/TokenTracker-plus.git
cd TokenTracker-plus
npm install

# 2. 首次運行：自動掛接所有 Hook、同步本機用量並開啟 Dashboard
node bin/tracker.js

# 常用操作
node bin/tracker.js sync       # 手動增量同步
node bin/tracker.js status     # 查看 52 款工具 hook / 解析器掛接狀態
node bin/tracker.js status --json  # 機器可讀 JSON 輸出（供 AI Agent 管道處理）
node bin/tracker.js doctor     # 運行系統診斷與健康檢查
```

**30 秒內你能看到什麼：**
- 📊 **本地 Dashboard**（預設 `http://localhost:7680`）—— 總花費、每日趨勢、按模型明細、項目歸屬與會話拓撲。
- ⚡ **毫秒級 Token 速率流** —— 自動接入 Antigravity、DeepSeek Harness、ZCode、OpenCode、Kimi 等客戶端的即時生成速率（`tok/s`）。
- 🔌 **全自動掃描掛接** —— 自動識別掛接本地已安裝的 52 款 AI 編碼工具，零帳號綁定、零 API Key 洩漏風險。
- 🏆 **42 枚成就全量離線判定** —— 100% 按本機本地佇列解鎖，無需連接公網排行榜服務。

> **想要原生桌面端？**
> - **Windows** —— 運行 `TokenTrackerWin`（C# .NET 8 + WebView2 系統匣 App），附帶動態桌寵、桌面額度小組件與置頂用量藥丸。構建方式見 [TokenTrackerWin/README.md](./TokenTrackerWin/README.md)。
> - **macOS** —— 運行 `TokenTrackerBar`（選單列狀態圖示 + 原生 WKWebView Dashboard）。
> - **Linux** —— 運行 `TokenTrackerLinux`（Tauri / AppImage 系統匣版）。

---

## ✨ 核心特性

- 🔌 **專為多平台重度開發者打造（支援 52 款工具）** —— 專為日常混合使用多款 AI 客戶端的高強度極客設計。無論是終端 CLI、VS Code / Cursor 插件，還是原生桌面 IDE，一鍵免密掛接全部碎片化帳本，無需來回切換 10+ 網站查帳。
- 💰 **全網獨家：Free 模型真值計費（看清自己到底白嫖賺了多少）** —— 堅決拒絕上游將 -free 路由粗暴歸零！免費/限免模型一律按官方公開刊例價折算真實算力價值，清清楚楚量化自己薅到了多少真金白銀的算力，專屬解鎖【白嫖之光】勳章與【零元精算巨匠】極客稱號。
- ⚡ **奈秒級 Token 生成速率捕獲** —— 自研多源速率解析與 SQLite WAL 無鎖感知，毫秒級流式分段，獨立核算思考模型推理 tokens，精準輸出會話級 	ok/s。
- 🏠 **100% 本地優先與嚴格隱私保護** —— 跑在本地。直接讀取本機日誌與資料庫，程式碼正文、Prompt 絕不離開你的電腦，嚴禁收錄或洩漏任何個人敏感帳號資訊。
- 📊 **Lv0~Lv7 八階熱力圖（含 Lv7 宇宙奇點 · Singularity）** —— 告别舊版封頂！針對單日突破 30 億 Token 的超神極客爆發，專屬解鎖頂級【宇宙奇點】色階與 3D 體素突破拔高，支援 2D 階梯與 3D 體素熱力圖。
- 🌲 **深度會話拓撲與 Agent 下鑽** —— 穿透主會話、工具調用與子代理（Subagent）鏈路，精準排查高耗會話；Trae CN 完美融合早期 Trae Work 與最新 Trae CN 雙軌數據。
- 🏆 **42 枚成就與 8 大 3D 稱號殿堂（Steam 原生並發堆疊 Toast）** —— 100% 本地離線判定；搭載 Steam 解鎖音效與最多 3 張垂直懸浮並發堆疊 Toast、懸停獨立倒計時凍結（Hover-to-Pause）、8 枚極客專屬 3D 浮雕 Crest 紋章與全端佩戴點亮，支援一鍵匯出 AAA 級極客 Canvas 戰報。
- 🔄 **高頻持續維護承諾** —— 站長與開源社群緊跟國內外 AI 編碼圈最新動態，高頻持續更新熱門 AI 工具解析與額度監控卡片，隨出隨接，常用常新。
- 🐱 **動態桌寵與桌面小組件** —— 懸浮像素桌寵（多套動作輪換與滑鼠注視）、4 種桌面小組件、置頂用量藥丸。

---

## 🖼️ 介面預覽

<table>
<tr>
<td width="50%">

**Web Dashboard** —— 用量趨勢、模型明細、成本分析

<img src="./docs/screenshots/dashboard-dark.png" alt="Dashboard" />

</td>
<td width="50%">

**桌面小組件** —— 把用量與限額釘在桌面

<img src="./docs/screenshots/widgets-overview.png" alt="Desktop Widgets" />

</td>
</tr>
<tr>
<td width="50%">

**桌面桌寵** —— 響應 Token 消耗與動作輪換的桌寵

<img src="./docs/screenshots/pet.png" alt="Desktop Pet" />

</td>
<td width="50%">

**離線成就系統** —— 42 枚全量成就離線判定與稱號羈絆體系

<img src="./docs/screenshots/achievements.png" alt="Achievements" />

</td>
</tr>
</table>

---

## 🆚 為什麼選 TokenTracker Plus？

> **想要一款既有宏觀帳本、又有即時生成速率與深度拓撲的用量追蹤工具？** 下表客觀對比 TokenTracker Plus、原版 TokenTracker 與 Token Monitor 的核心能力差異：

| 功能維度 | ⚡ **TokenTracker Plus (本分支)** | 📦 **原版 TokenTracker (上游)** | 🪟 **Token Monitor (TM)** |
|:---|:---:|:---:|:---:|
| **定位與架構** | **宏觀全局帳本 + 深度拓撲 + 即時速率** | 通用全能看板（含官方雲託管） | 極簡桌面即時懸浮窗 |
| **支援的 AI 工具數** | **52 款**（覆蓋國內外全譜系工具與本地端） | 46 款 | ~15 款（主要覆蓋主流模型 API 與常見 CLI） |
| **限額追蹤** | **✅ 17 家 provider**（即時限額窗口與重置倒數計時） | 10 家 provider | ⚠️ 基礎限額展示 |
| **主要交互方式** | **Windows 系統匣 + Web Dashboard + 小組件 + CLI** | macOS 選單列 + Web Dashboard + 小組件 + CLI | 桌面極簡懸浮窗 |
| **數據隱私與存儲** | **100% 本地優先**（零強制外傳，多端 WAL 感知） | 本地 SQLite + 可選官方雲端同步 | 本地 SQLite WAL（無宏觀歷史報表） |
| **Token 速率 (tok/s)** | **✅ 原生支援**（自研奈秒分段，區分思考 tokens，協同 TM） | ❌ 僅統計總量與花費，無速率計算 | ✅ 支援（懸浮窗主打核心亮點） |
| **會話分析與 Agent 拓撲** | **✅ 深度拓撲**（主代理/子會話下鑽、調用鏈路穿透） | ⚠️ 基礎會話列表彙總 | ❌ 僅平鋪羅列請求，無層級結構 |
| **活躍度熱力圖** | **✅ 8 階尺度 (Lv0~Lv7)**（新增 Lv7 宇宙奇點，容納單日 30 億+ 極限爆發） | ⚠️ 傳統 4 階 (Lv0~Lv4，極限量易打滿) | ❌ 無熱力圖功能 |
| **成本計量真值** | **✅ 嚴謹刊例價核算**（拒絕 `-free` 抹平；支援 WorkBuddy 消耗積分） | ⚠️ `-free` 路由強制歸 $0；積分未細化 | ⚠️ 基礎定價配置，覆蓋面有限 |
| **成就與徽章** | **✅ 42 枚全量成就離線解鎖**（本地佇列與首發日核算） | ⚠️ 依賴官方雲服務與排行榜下發 | ❌ 無成就系統 |
| **桌面伴侶擴展** | **✅ 動態桌寵 + 額度卡片 + 置頂藥丸** | ✅ macOS 選單列動畫 / 基礎小組件 | ⚠️ 基礎懸浮窗口 |
| **開源與透明性** | **✅ 100% 原始碼開源**（可自由審計與二次開發） | ✅ 原始碼開源 (MIT) | ⚠️ Electron asar 閉源分發 |

---

## 🔌 支援的 AI 工具列表（52 款）

本倉庫當前支援的 **52 款 AI 編碼工具**（以 `src/commands/init.js` 的 `SUPPORTED_PROVIDERS` 為準）：

| 工具名稱 | 識別方式 | 接入方式與機制 | Fork 增強說明 |
|---|:---:|---|---|
| **Claude Code** | ✅ 自動 | 寫入 `settings.json` 的 SessionEnd hook | 原生支援子代理鏈路與專案歸屬 |
| **Codex CLI** | ✅ 自動 | 寫入 `config.toml` 的 TOML notify hook | 自動關聯本地 workspace 專案元數據 |
| **AStudio** | ✅ 自動 | 寫入 `config.toml` 的 TOML notify hook | 支援 `TOKENTRACKER_ACODE_HOME` 目錄覆蓋 |
| **Cursor** | ✅ 自動 | API + 本地 SQLite 中的 auth token | 自動去重與小時級快照 |
| **Kiro** | ✅ 自動 | SQLite + JSONL 混合讀取 | 完整解析會話事件流 |
| **Gemini CLI** | ✅ 自動 | SessionEnd hook | 自動捕獲各模型輸入輸出 |
| **Antigravity** | ✅ 自動 | 被動讀取 `transcript.jsonl` + 速率探針 | **新增 tok/s 速率解析與思考 tokens 獨立核算** |
| **OpenCode** | ✅ 自動 | 外掛系統 + SQLite 資料庫 | **支援 reasoning_output_tokens 速率修正** |
| **OpenClaw** | ✅ 自動 | Session 外掛（`openclaw-session-sync`） | 獨立行程安全同步 |
| **Loomy** | ✅ 自動 | 外掛系統 + 會話日誌 | 完美相容 OpenCode 架構 |
| **Every Code** | ✅ 自動 | TOML notify hook | 會話級用量同步 |
| **Hermes Agent** | ✅ 自動 | 被動讀取 SQLite（`~/.hermes/state.db`） | 自動解析 sessions 表 |
| **GitHub Copilot** | ✅ 自動 | 逐請求 SQLite 讀取（`~/.copilot/session-store.db`） | 協調多源數據，防止重疊請求雙計 |
| **Kimi Code** | ✅ 自動 | 被動讀取 `wire.jsonl` + 速率流 | **即時計算輸出與分段 tok/s 生成速率** |
| **CodeBuddy** (騰訊) | ✅ 自動 | 寫入 `~/.codebuddy/settings.json` SessionEnd hook | 騰訊雲體系編碼助手支援 |
| **WorkBuddy** (騰訊) | ✅ 自動 | SessionEnd hook + 被動掃描 `projects/**/*.jsonl` | **雙源拆分：支援國內標準版** |
| **WorkBuddy AI** (騰訊) | ✅ 自動 | SessionEnd hook + 被動掃描 | **雙源拆分：支援進階版與積分對帳** |
| **Grok Build** (xAI) | ✅ 自動 | SessionEnd hook + 被動掃描 `updates.jsonl` | 共享限額卡與多產品佔比拆分 |
| **oh-my-pi** | ✅ 自動 | 被動讀取會話日誌 + 託管 notify 擴展 | 支援近即時變更同步 |
| **OmO** | ✅ 自動 | 被動讀取會話日誌 | 細化模型映射 |
| **pi** | ✅ 自動 | 被動讀取（`~/.pi/agent/sessions/**/*.jsonl`） | 零侵入被動解析 |
| **Dots** | ✅ 自動 | 透過 pi provider 拆分路由 | 無需額外 hook |
| **Prime Agent** | ✅ 自動 | 僅元數據被動用量讀取 | 絕不讀取提示詞與回覆正文 |
| **Craft Agents** | ✅ 自動 | 被動讀取 session 日誌 | 多工作區會話聚合 |
| **Reasonix** | ✅ 自動 | 被動讀取 telemetry 遙測數據 | 會話元數據追蹤 |
| **Muse Code** | ✅ 自動 | 被动讀取會話日誌（`session.jsonl`） | 支援 `TOKENTRACKER_MUSE_HOME` 覆蓋 |
| **Kilo CLI** | ✅ 自動 | 被動讀取 SQLite（`~/.local/share/kilo/kilo.db`） | OpenCode-fork 架構適配 |
| **Kilo Code** | ✅ 自動 | 被動讀取 `ui_messages.json` | VS Code 外掛全域儲存解析 |
| **Roo Code** | ✅ 自動 | 被動讀取 `ui_messages.json` | 自動提取模型與 token 計數 |
| **Zed Agent** | ✅ 自動 | 被動讀取 SQLite（`threads.db`） | 僅統計託管模型與會話 |
| **Goose** | ✅ 自動 | 被動會話日誌掃描 | 相容開源 Goose 會話格式 |
| **Droid** (Factory) | ✅ 自動 | 被動讀取會話軌跡與事件流 | 準確提取模型與用量指標 |
| **Mimo** | ✅ 自動 | 被動 SQLite 解析 | 支援本地資料庫提取 |
| **DuMate** (百度) | ✅ 自動 | 被動讀取會話日誌 | 支援 `TOKENTRACKER_DUMATE_HOME` 覆蓋 |
| **ZCode** | ✅ 自動 | 被動讀取會話日誌 + 速率探針 | **會話層下鑽與毫秒級 tok/s 捕獲** |
| **Qoder** | ✅ 自動 | 被動讀取 `~/.qoder[-cn]/projects/**/*.jsonl` | **支援國際版與國內版細化模型與積分對帳** |
| **AnythingLLM Desktop** | ✅ 自動 | 被動讀取本地 SQLite 資料庫 | 桌面端工作區用量歸集 |
| **Claude Science** | ✅ 自動 | 被動讀取 SQLite（`operon-cli.db`） | 只讀取 frames token 計數 |
| **DeepSeek Harness** | ✅ 自動 | 被動讀取會話日誌（`.jsonl[.zstd]`） + 速率探針 | **多幀 zstd 解壓與即時 tok/s 流式計算** |
| **TRAE CN** (字節跳動) | ✅ 自動 | 整合早期 Trae Work 與 Trae CN 國內版合併後的全新統一架構，自動適配本地會話存儲與 SQLite | **支援國內版最新合併架構解析與會話拓撲下鑽** |
| **TRAE** (國際版) | ✅ 自動 | 使用共享應用密鑰讀取 SQLCipher 資料庫 | 本地安全解析，不調用外部 API |
| **LM Studio** | ✅ 自動 | 被動讀取本地日誌與活動狀態 | 支援 `TOKENTRACKER_LMSTUDIO_HOME` 覆蓋 |
| **Unsloth Studio** | ✅ 自動 | 被動讀取 SQLite（`unsloth.db`） | 支援 `TOKENTRACKER_UNSLOTH_DB` 覆蓋 |
| **Devin CLI** | ✅ 自動 | 被動讀取本地 Devin 資料庫 | 支援 `TOKENTRACKER_DEVIN_DB` 覆蓋 |
| **Cline** | ✅ 自動 | 被動讀取 VS Code 全域儲存與歷史 | 自動提取任務級用量 |
| **MiniMax Code** | ✅ 自動 | 被動讀取本地會話日誌 | 提取模型與 Token 統計 |
| **CodeArts Agent** | ✅ 自動 | 被動讀取華為 CodeArts 會話與日誌 | 華為雲編碼助手適配 |
| **Command Code** | ✅ 自動 | 被動讀取會話快照與日誌 | 統一按模型價目表估算 |
| **AutoClaw** | ✅ 自動 | 自動化 Agent 工作流日誌整合 | 任務級用量歸集 |
| **Cola** | ✅ 自動 | 協作 Agent 日誌接入 | 本地安全同步 |
| **Tuanjie Cowork** | ✅ 自動 | 協作工作流日誌接入 | 團隊端本地用量解析 |
| **Agent2API** | ✅ 自動 | 本地閘道器與 Agent 映射用量歸集 | 面向多模型路由用量 |

---

## 🏗️ 工作原理

```mermaid
flowchart LR
    A["52 款 AI 編碼工具<br/>(Claude Code · Codex · Cursor · Gemini · Antigravity · OpenCode · ZCode · DSH · Qoder 等)"] -->|Hook 觸發 / 被動探測| B[TokenTracker Plus 核心引擎]
    B -->|速率解析 & 思考Token拆分<br/>SQLite WAL 無鎖感知| C[(本地 SQLite & 佇列快照)]
    C --> D[Web Dashboard 介面]
    C --> E[Windows 系統匣 & 藥丸]
    C --> F[桌面小組件]
    C --> G[動態像素桌寵]
    C -.->|可選自建部署| H[(私有 PGlite 後端)]
```

1. **正常使用 AI 工具**：你在各 CLI 或 IDE 中正常對話寫代碼，它們會在本地產生日誌、SQLite 記錄或觸發 hook。
2. **輕量感知與速率提取**：TT-plus 引擎毫秒級感知變動，提取輸入、輸出、快取與思考模型 reasoning tokens，計算精準耗時與 `tok/s`。
3. **100% 本地解析落帳**：Prompt、回覆正文和程式碼絕不保存或上傳，僅將 token 指標寫入本地存儲。
4. **多端消費展示**：Web Dashboard、Windows 系統匣、桌寵、小組件同時讀取本地快照，秒級刷新呈現。

---

## 💰 費用口徑與熱力圖準則

### 費用計算公式
$$\text{Cost} = \text{Input} \times P_{\text{in}} + \text{Cached} \times P_{\text{cached}} + \text{CacheWrite} \times P_{\text{cw}} + \text{Output} \times P_{\text{out}} + \text{Reasoning} \times P_{\text{reason}}$$

- **堅決拒絕上游 `-free` 歸零規則**：上游將帶 `-free` 字尾的模型統一強制歸 $0，本 fork 永久拒絕該規則，所有模型嚴格按照廠商真實刊例單價計費，反映真實的 AI 生產力成本。
- **價格數據源**：聚合 LiteLLM 全量官方價表 + `src/lib/pricing/curated-overrides.json` 本地精選校準；未公開價格的模型只記錄 token 數量，絕不胡亂捏造虛假金額。
- **WorkBuddy 積分與雙源核算**：獨立支援 WorkBuddy 標準版與進階版，將消耗積分與官方代幣嚴格對帳，防止雙計。

### 熱力圖色階與數據分析（Lv0 ~ Lv7 八階色階 · 含 Lv7 宇宙奇點）
熱力圖採用全新 **8 階色階體系**，在 5 個關鍵分位點（`P35`, `P60`, `P80`, `P92`, `P97`）基礎上拓展單日突破 30 億極限爆發的宇宙奇點色階：
- **Level 0**：0 tokens（無活動）
- **Level 1**：`0 < tokens ≤ P35`（輕度編碼）
- **Level 2**：`P35 < tokens ≤ P60`（日常開發）
- **Level 3**：`P60 < tokens ≤ P80`（深度編碼）
- **Level 4**：`P80 < tokens ≤ P92`（高強度輸出）
- **Level 5**：`P92 < tokens ≤ P97`（極限爆發，20~28.5 億 tokens 翠綠強化）
- **Level 6**：`> P97`（巔峰爆發 / 神級產出，專屬暗夜熒光翡翠階）
- **Level 7【宇宙奇點 · Singularity】**：`tokens ≥ 3,000,000,000`（單日 30 億+ tokens 超神產出，3D 體素高度突破至 $1.25 \times H_{\text{max}}$ 聳立，專屬祖母綠發光星環）

2D 平面熱力圖與 3D 體素熱力圖（Lv0~Lv6 按高度線性拔高，Lv7 突破頂峰上限）全面對齊。

---

## 🔒 數據與隱私準則

- **100% 本地優先**：所有數據解析、速率計算與報表彙總都在你的本地設備上完成。
- **純用量指標記錄**：僅記錄 input / output / cached / reasoning token 數量、時間戳、模型名與金額；**程式碼正文、Prompt 絕不保存、絕不上傳**。
- **憑證本機隔離**：API Key、Cookie、本地資料庫密碼僅保存在使用者本地目錄或 `.env.local` 中，絕不提交至代碼倉庫或前端構建產物。

---

## 🛠️ 本地配置與自建後端（可選）

```bash
cp .env.example .env.local
```

常用變量：`OPENROUTER_API_KEY`、`TOKENTRACKER_DEVICE_TOKEN`、`VITE_INSFORGE_BASE_URL`。本地覆蓋均放 `.env.local`（已納入 `.gitignore`）。**不要建立 `.dev.vars`**。

### 私有自建後端（技術預覽）
若有多台設備需要彙總視圖，可將 `scripts/self-host/` 部署到自己的私有 Docker 宿主機上：
- 詳見 [docs/self-hosting.md](./docs/self-hosting.md)；
- 註：早期內部測試用 Docker 宿主機已於 2026-10-23 正式退役，專案預設 100% 離線單機運行。

---

## 📄 License 與致謝

- **License**：本專案遵循 [MIT 許可證](./LICENSE)。
- **上游專案**：致敬並感謝原作者 [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker) 的傑出工作與開源貢獻。
- **第三方聲明**：詳見 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。Clawd 角色形象歸 Anthropic 所有，本專案與 Anthropic 官方無關聯。
