# TT-plus（TokenTracker-plus）

> **TT-plus 是基于原作者开源仓库做的个人改造版。**
> 本项目基于 [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker)（MIT）开发，**不是上游官方发行版**，也不代表原作者。上游的版权、设计与基础功能归原作者所有；本仓库的改造部分同样以 MIT 发布。上游不为此 fork 提供支持或背书。

[English](./README.md) · **简体中文** · [繁體中文](./README.zh-TW.md)

本仓库当前支持 **52 款 AI 编码工具**（以上游为基础，含 fork 扩展）。TT-plus 是一个**本地优先**的 AI 编码 token 用量与成本看板：解析本机 CLI / IDE 的日志与数据库，按模型和小时记账，提供 Dashboard、会话明细、项目归属、限额卡、桌宠、桌面小组件和自建后端同步。

---

## 这是什么

- **本地采集**：读取本机 JSONL / SQLite / 日志中的 token 计数、时间、模型名与成本，写入 `~/.tokentracker/queue.jsonl`。
- **本地看板**：CLI 启动本地面板，展示总花费、每日趋势、模型拆分、项目归属、会话列表、限额与成就。
- **自建云功能（可选）**：排行榜、成就、跨设备账号视图可以指向自己的 Node + PGlite 后端（`scripts/self-host/`），没有会员/付费界面。
- **桌面端**：Windows 托盘应用内嵌 Dashboard，附带桌宠、桌面额度小组件和置顶用量药丸。
- **可审计的费用口径**：每个 token 分量分开记，成本按 `Σ(tokens × 单价)` 计算；价格来自 LiteLLM + 本地 curated overrides。

## 支持的 AI 工具（52）

本仓库当前支持的 **52 款 AI 编码工具**（以 `src/commands/init.js` 的 `SUPPORTED_PROVIDERS` 为准）：

Claude Code、AutoClaw、Cola、Tuanjie Cowork、Agent2API、Codex CLI、AStudio、Cursor、Gemini CLI、Antigravity、Kiro、OpenCode、OpenClaw、Loomy、Every Code、Hermes Agent、GitHub Copilot、Kimi Code、CodeBuddy、WorkBuddy、WorkBuddy AI、Grok Build、oh-my-pi、OmO、pi、Dots、Prime Agent、Craft Agents、Reasonix、Muse Code、Kilo CLI、Kilo Code、Roo Code、Zed Agent、Goose、Droid、Mimo、DuMate、ZCode、Qoder、AnythingLLM Desktop、Claude Science、DeepSeek Harness、TRAE CN、TRAE、LM Studio、Unsloth Studio、Devin CLI、Cline、MiniMax Code、CodeArts Agent、Command Code

目录覆盖：`TOKENTRACKER_ACODE_HOME`（AStudio）、`TOKENTRACKER_DUMATE_HOME`（DuMate）、`TOKENTRACKER_LMSTUDIO_HOME`（LM Studio）、`TOKENTRACKER_UNSLOTH_DB`（Unsloth Studio）、`TOKENTRACKER_DEVIN_DB`（Devin CLI），以及各 provider 自己的 home 环境变量。

## 与上游的区别

| 方面 | 上游 TokenTracker | TT-plus |
|---|---|---|
| 定位 | 通用、多用户、可选托管 Cloud | 单机、单用户、自托管 |
| **支持的 AI 工具数** | **52** | **52**（含 fork 扩展） |
| **限额追踪** | ✅ 17 家 provider | ✅ 17 家 provider + fork 扩展 |
| 云功能 | 官方托管 / 可选自托管 | 默认对接自己的后端；无会员/付费 UI |
| 用量源 | 上游 52 款工具 | 另补 WorkBuddy 双版、DSH、ZCode、TRAE CN 本地库、Kimi 桌面版、AutoClaw、Cola、Tuanjie Cowork 等 |
| 限额卡 | 上游 provider 集合 | 另加 Agent2API（小浣熊）、APIGOTO、AgentRouter、DeepSeek、Trae 小号、CodeArts、Cline Pass、SenseNova |
| Windows | 托盘 + Dashboard | 另加桌宠动作轮换、桌面额度小组件、置顶用量药丸 |
| 定价 | 上游 `-free` 归零规则 | **拒绝 `-free` 归零**：免费路由仍按刊例价计值 |
| 发布 | npm / 官方安装包 | 不发布 npm；桌面端从源码构建 |

## 不包含什么

- **不是官方发行版**：没有 npm 包、没有官方 release、没有上游支持承诺。
- **没有会员/付费界面**：排行榜和成就是自建后端上的功能。
- **不保证与上游同步**：合并上游时会有取舍；fork 特有行为（尤其是计费语义）不会自动跟随上游。
- **不收集提示词/代码**：只记 token 计数、时间、模型名和成本。

## 快速开始（CLI + 本地 Dashboard）

要求 **Node.js 20+**。Windows 桌面端另需 .NET 8 SDK 与 WebView2 Runtime。

```bash
git clone https://github.com/01UNCLEDOG01/TokenTracker-plus.git
cd TokenTracker-plus
npm install

node bin/tracker.js          # 首次运行会安装 hooks、同步本地数据并打开 Dashboard
node bin/tracker.js sync     # 手动同步
node bin/tracker.js status   # 查看 hook 状态
node bin/tracker.js doctor   # 健康检查
```

默认面板：`http://localhost:7680`。本地 Dashboard 不登录也能看本机用量；云功能需要配置自建后端并登录。

### Windows 桌面端

```bash
TOKENTRACKER_BUILD_PET=1 npm --prefix dashboard run build
cd TokenTrackerWin
dotnet build -c Release
```

构建必须带 `TOKENTRACKER_BUILD_PET=1`，否则不会产出 `pet.html` / `quota.html`。Windows 壳会选一个空闲 loopback 端口（不固定 7680）。详见 [TokenTrackerWin/README.md](./TokenTrackerWin/README.md)。

## 自建后端（可选）

```bash
ROUTER_PW=... scripts/self-host/internal-deploy.sh [host]
scripts/self-host/internal-backup.sh
```

- 这是**技术预览**，不是“空 VPS 一键安装器”；完整门槛见 [docs/self-hosting.md](./docs/self-hosting.md)。
- 部署前必须先 `docker stop -t 30`，不要 `docker rm -f` 活容器。
- 客户端用 `VITE_INSFORGE_BASE_URL` / `VITE_INSFORGE_ANON_KEY`（或 CLI 的 `TOKENTRACKER_INSFORGE_BASE_URL`）指向自己的实例。
- 自建后端只接收用量聚合数据，不接收提示词或代码。

## 数据与隐私

- **本地优先**：解析在本机完成，原始日志不会因为同步而整份上传。
- **只记计数**：input / cached / cache_creation / output / reasoning、时间桶、模型名、来源、金额；不保留对话正文与工具参数。
- **凭据留在本机**：cookie、API key、设备 token 放在用户目录或 `.env.local`；不会写进仓库、日志或前端构建产物。
- **第三方请求**：只有你显式配置的限额 provider 才会向对应厂商 API 发请求。

## 费用口径

- `cost = input×input价 + cached×缓存读价 + cache_write×缓存写价 + output×输出价 + reasoning×推理价`，不用 `total_tokens` 直接乘单价。
- 价格来自 LiteLLM 全量价表 + `src/lib/pricing/curated-overrides.json`；没有公开价的模型只记 token，不伪造金额。
- **免费路由按刊例价计值**：上游 `-free` 归零规则在本 fork 被永久拒绝。
- **AgentRouter 中转面值不并入总花费**：codex 流量已按 token 记入总账；站方面值只由 AgentRouter 卡承载。
- 估算值会显式标注（如 antigravity、Qoder CN）。

### 热力图等级

热力图 **Level 0–4** 是相对当前窗口的等级，不是固定的每日 token 门槛。服务端规则：

- `P` = 窗口内最高单日 `billable_total_tokens`；
- Level 1：`0 < tokens ≤ 25% × P`
- Level 2：`≤ 50% × P`
- Level 3：`≤ 75% × P`
- Level 4：`> 75% × P`

客户端 fallback 目前用的是活跃日分位数（50/75/90 分位），两套规则尚未统一，界面也还没有显示当前门槛。见 KI-016。

## 配置

```bash
cp .env.example .env.local
```

常用变量：`TOKENTRACKER_DEVICE_TOKEN`、`TOKENTRACKER_ACCESS_TOKEN`、`TOKENTRACKER_INSFORGE_BASE_URL`、`VITE_INSFORGE_BASE_URL`、`VITE_INSFORGE_ANON_KEY`、`OPENROUTER_API_KEY`、`OPENCODE_GO_API_KEY`。

本地覆盖放 `.env.local`（gitignored）。**不要创建 `.dev.vars`**——那是 Cloudflare Workers 的约定，本项目使用 Node/Electron 的 `.env.local`。

数据目录：`~/.tokentracker/`；Windows 桌面应用还会使用 `%LOCALAPPDATA%` 下的应用数据目录。

## 仓库结构

```
src/                 CLI、解析器、本地 API、计价
dashboard/           React + Vite Dashboard
TokenTrackerWin/     Windows 托盘应用（.NET 8 + WebView2）
TokenTrackerBar/     macOS 菜单栏应用
TokenTrackerLinux/   Linux Tauri 应用
scripts/self-host/   自建后端部署、备份、聚合 SQL
test/                Node 测试与基线名单
docs/                专题文档
```

## 文档地图

| 文件 | 用途 |
|---|---|
| [FORK_STATUS.md](./FORK_STATUS.md) | 当前 HEAD、部署状态、门禁摘要 |
| [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | 未完成项、待拍板、已知限制 |
| [GATE_REGISTRY.md](./GATE_REGISTRY.md) | 提交/部署前必须跑的命令 |
| [CHANGELOG.md](./CHANGELOG.md) | 按时间正序的完整改造台账 |
| [AGENTS.md](./AGENTS.md) | 给 AI/协作者的导航与工作规则 |
| [CLAUDE.md](./CLAUDE.md) | 上游架构参考；fork 规则以 AGENTS.md 为准 |

## 开发与验证

```bash
npm run test:fast
npm test
npm run validate:fast
npm run validate:bot-frames
npm --prefix dashboard run test
npm --prefix dashboard run typecheck
TOKENTRACKER_BUILD_PET=1 npm --prefix dashboard run build
```

本机 Node 全量约有 50 条环境/基线红 + 已知 flaky，详见 [GATE_REGISTRY.md](./GATE_REGISTRY.md)。不要用单文件绿给全量红开脱。

## 已知限制

- **opencode 首读慢、之后增量**：SQLite 库约 27GB，首次扫描约 18s（应用新进程也是冷启动）；之后只读新增/更新行，本机该源约 6.4s，整轮第二次刷新约 12.6s。v2/过渡布局仍走全量。
- **antigravity 优先用 tokscale 真数**：Token Monitor 的 tokscale 缓存覆盖到的天用实测值，没覆盖到的天继续用 transcript 估算。本机缓存只覆盖 2026-10-03..10-10。
- **Qoder token 是按 credits 反推的**：Qoder 国际版 JSONL 的 token 字段全是 0，TT 按 credits 反推，并标成 Qwen3.8-Flash（积分）/ DeepSeek-Flash（积分）。Qoder CN 的官方消耗与 Qoder 国际版额度都依赖 `qoder-usage-cookie.txt`；国际版 cookie 是 httpOnly，需要在 DevTools 复制一次（用刷新脚本）。
- **Qoder 国际版在 Windows 没有本地配额服务**：数据在 `~/.qoder`，限额卡走 cookie 路线，不找 `%APPDATA%\Qoder`。
- **DeepSeek 只有余额卡**：旧的 `/user/balance/models` 逐日用量端点已不存在，卡片只显示余额与赠送额。
- **部分源没有逐对话数据**：cursor / minimax-code / reasonix 的会话层尚未接入。
- **Windows 壳是 MVP**：托盘实时数字、原生 bridge、自动更新、签名安装包/CI 仍未完全移植。
- **上游合并可能覆盖 fork 改动**：合并后必须重新对账计费总额与关键行为。

## License 与致谢

- **License**：[MIT](./LICENSE)。上游版权归 `xiufengsun`；本 fork 的修改同样以 MIT 发布。
- **上游项目**：[xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker)。
- **第三方组件**：见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。Clawd 角色设计归 Anthropic，本项目与 Anthropic 无官方关联。
- 上游问题请提到 [上游 issue](https://github.com/xiufengsun/TokenTracker/issues)。

## 一个仓库，两种模式

- **单机版（默认）**：桌面端 + CLI 完全离线运行。运行时描述符带 `localOnly: true`：隐藏云服务导航与设置，排行榜读本机队列历史（本机历史），31 枚成就全部本机解锁。
- **自部署联机版（可选）**：把 `scripts/self-host/` 部署到自己的服务器，获得跨设备账号视图与共享排行榜。所有云端能力都挂在这个部署后面，单机构建不会调用它。

两种模式出自同一份代码；安装时按是否指向后端自动区分。
