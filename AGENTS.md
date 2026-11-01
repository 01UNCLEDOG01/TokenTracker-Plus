# Agent Instructions

**This file is the single source of truth for how agents work in TT-plus.** It overrides `CLAUDE.md` for fork workflow, documentation, gates, deployment, and working-tree rules. [CLAUDE.md](./CLAUDE.md) is the upstream architecture/conventions/release reference: use it for code-level detail, but when it conflicts with this file on fork workflow or docs, follow `AGENTS.md`.

## Read order for this fork

> **2026-11-01 公开前清扫**：HANDOFF / FORK_STATUS / KNOWN_ISSUES / GATE_REGISTRY 四份内部台账已随 filter-repo 从 git 历史+HEAD 移除，本机继续在仓库根维护（`.gitignore` 挡提交，留底在仓库外归档区）。clone 本仓库看不到这四份文件——本机 AI 协作流程照旧，对外仓库不携带。原内部详细 CHANGELOG 一并退库，仓库里的 `CHANGELOG.md` 是重建的对外版（用户面要点）。

| 顺序 | 文件 | 用途 |
|---|---|---|
| 0 | [HANDOFF.md](./HANDOFF.md) | **接手先读这页**：本轮交接状态、剩余任务与判据、门禁命令、判回归的方法（内部台账，不入库） |
| 1 | [README.md](./README.md) | 对外定位、安装/构建、隐私与许可 |
| 2 | [FORK_STATUS.md](./FORK_STATUS.md) | 当前 HEAD、部署状态、门禁摘要（内部台账，不入库） |
| 3 | [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | 未完成项、待拍板、已知限制（内部台账，不入库） |
| 4 | [GATE_REGISTRY.md](./GATE_REGISTRY.md) | 提交/部署前必须跑的门禁（内部台账，不入库） |
| 5 | [CHANGELOG.md](./CHANGELOG.md) | 对外版变更日志（2026-11-01 重建入库）；详细内部台账已退库 |
| 6 | [CLAUDE.md](./CLAUDE.md) | 上游架构、代码约定、发布流程参考；fork 规则以本文件为准 |

## Fork-specific working rules

- **Development happens only in `D:\TokenTrackerPlus\repo` on branch `standalone`**（推 `origin/main`；2026-10-29 起 `usage-desk-135` 已作废）。
- **This fork ships the Windows package + source only** (owner decision 2026-10-28; earlier "keep macOS/Linux source consistent" rule is retired). `TokenTrackerBar/` (Swift) and `TokenTrackerLinux/` (Tauri) were **deleted** together with `release-dmg.yml`, the `linux-client`/`macos-tests` CI jobs, `scripts/gen-bot-frames.cjs` and the platform-only tests (`pet-parity`, `bot-parity`, `linux-*`, `gnome-extension`, `dynamic-island-*`, `limits-providers-parity`). Do not re-add cross-platform parity gates: there is no second implementation to compare against. `scripts/native-qa-server.cjs` + `native-qa-auth.cjs` were moved out of `TokenTrackerBar/scripts/` and must stay in `scripts/`.
- **Do not widen the CI triggers.** `ci.yml` has `linux-client` (ubuntu) and `macos-tests` (macos-26) jobs but they fire only on push/PR to `main`; the repo is **private**, so macOS minutes are billed (Linux has a free monthly quota). Owner's standing call: zero spend — leave both jobs alone, and never propose enabling them on `usage-desk-135` as a convenience.
  - **2026-10-28 correction:** the "never fires" premise died when `main` was created (it had not existed before — the fork tracked `usage-desk`), so the two paid jobs went live on the first push. `macos-tests` and `windows-build` now carry an explicit `if: github.event.repository.private == false`, so they stay skipped while private and switch on by themselves at publication; the two ubuntu jobs remain unguarded on purpose. **Any future branch/renaming work must re-check this guard rather than assume a branch is inert.**
- **Hot-mirroring the installed app is one command: `npm run mirror:installed`.** It builds with `TOKENTRACKER_BUILD_PET=1`, stops the app, waits for the port, mirrors `dist`+`src`+`bin` into *both* trees (delete-then-copy), verifies file counts/entry pages/sizes, restarts and smokes five URLs. Do not hand-run GATE_REGISTRY §4: on 2026-10-27 a bare `dashboard:build` without the flag shipped a tree with no `pet.html`/`quota.html`, and the desktop pet rendered the server's 404 body ("Not Found").
- The legacy worktree/object store (`D:\tt-rebase` / `D:\tt-fork`) was deleted on 2026-10-26 after the one-week keep; the same-disk bare mirror `backup` (`D:\TokenTrackerPlus\archive\tt-fork-backup.git`) was deleted on 2026-10-27 — one disk protects against nothing, and with dual push a bad push would have mirrored anyway. Pre-rewrite history is preserved in private off-repo backups only (read-only archive bundles); it is not reachable from this repository — do not fetch, restore or re-push it. `origin` (TokenTracker-Plus) is the daily push target: push `standalone` → `origin/main`; never push to the upstream author's repo (xiufengsun/TokenTracker).
- After a work batch: update `FORK_STATUS.md` (current state), append to the internal detailed ledger (本机维护、不入库), and add/remove `KNOWN_ISSUES.md` entries. The ledger files are local-only since 2026-11-01 — never commit them.
- Never commit secrets. Put local overrides in `.env.local` (gitignored); `.env.example` is the template. Do **not** create `.dev.vars` (Cloudflare Workers convention, not used here).
- Merging upstream: any commit that changes pricing/billing semantics must be reconciled against local totals before and after. The upstream `-free` → zero-price rule is permanently rejected in this fork.
- Before claiming a UI feature is delivered, read the rendered text/DOM, not only the server endpoint.
- **新增 UI 必须复用原版组件与版式，不许自制一套**（2026-10-28 站主明确要求）。具体到限额页：行 = 标签列（`--tt-limits-label-w`）+ `h-1.5` 圆角轨道 + 右侧百分比列；配色只用 `barColor()` 的 emerald/amber/red；悬浮一律用 `HoverTooltip`（深色玻璃卡），**禁止原生 `title`**；行上要有 `cursor-pointer`；明细只放悬浮提示里，正文不重复；`limit_credits = 0` 的窗口不占行。新增卡片、行类型、图例都按这条走。
- **上游吸收建议必须先逐条对照本仓已有能力**（2026-10-30 站主裁定；起因：WorkBuddy CN/AI 拆分本仓早已实现，AI 仍当作可吸收的新功能上报，且不是第一次）。流程：写上游动态报告前，先读 `FORK_STATUS.md` 的能力段与 `src/lib/*-limits.js`、`src/lib/rollout.js` 的来源/卡片清单，对每条上游改动标注「本仓已有 / 部分有（差什么）/ 没有」；没有这一列的报告不许交付。
- **修复凡涉及客户端持久化状态（localStorage、WebView2 缓存、`~/.tokentracker` 下的缓存/快照文件），必须自带迁移或版本失效**（2026-10-30 站主裁定；起因：宠物勾选、榜单图标两次被旧缓存咬，"修好了"在用户端看不到）。验收标准：`mirror:installed` 重启后新行为立即可测，交付说明里不允许出现"请清缓存/请重装"。数据形状变更 → 升 schema/版本号并让旧数据被拒读；新增映射 → 映射放读取端，不许把判定结果烤进快照。

## 版本与发版规则（semver，2026-10-26 起所有接手 AI 必须遵守）

1. **按内容定版本，不按感觉**。每次要出安装包时，先盘点「自上个安装包以来累计的热更」，再选号：
   - 只有 bug 修复、无新功能 → **PATCH**（如 1.0.1）；
   - 含任何新功能（新卡片 / 新来源 / 新页面 / 新交互 / 新数据迁移）→ **MINOR**（如 1.0.1 → 1.1.0：WorkBuddy 配额卡、OMP 会话、速率口径下拉、模型统一、README 六语）；
   - 破坏性变更（数据格式不兼容、移除用户依赖的功能）→ **MAJOR**，且必须先问站主。
2. **单一版本轨**：根 `package.json` 是唯一真源。同一提交内同步全部 manifest（`package-lock.json` 两处 + `TokenTrackerBar/project.yml` + `TokenTrackerWin.csproj` + `TokenTrackerLinux/{package.json,package-lock.json,src-tauri/tauri.conf.json,src-tauri/Cargo.toml,Cargo.lock,PKGBUILD}`），改完必跑 `npm run validate:versions`（全部应为 vX.Y.Z 才放行）。dashboard 的 lock 不含本包版本，不用动。
3. **热更 ≠ 发版**：改 `src/` 或 `dashboard/` 后镜像到两处安装副本只是热更，台账必须记「未重打安装包」；热更内容必须随下一个安装包进入安装器，不许无限期只靠热更。**2026-11-01 站主钦定新节奏：每个 MINOR（x.y.0）批次收尾必须走完整发版链打安装包 + tag + 草稿 Release（站主 Publish），不再攒多个 MINOR 只热更；PATCH 可只热更（内容随下一个 MINOR 安装包进入安装器）。自 v1.12.0 起执行（1.8.1 之后 1.9.0~1.11.2 只热更未发版属旧节奏）。**
4. **发版链固定顺序**（详见内部台账 GATE_REGISTRY §4，本机维护不入库，坑点已写在注释里）：版本号 → `bundle-node.ps1`（**自带 PET dashboard 构建**——2026-10-31 起不再手工先跑，防陈旧 dist） → `dotnet publish` → **先 `Remove-Item` 再 `Copy-Item` EmbeddedServer（直接 Copy 会嵌套，1.0.1 首包事故）** → `verify-windows-package.cjs`（版本号必须正确、matchedInputs>0，不过不准进 ISCC）→ `dotnet test` → `MSYS_NO_PATHCONV=1 ISCC /DMyAppVersion=X.Y.Z` → 停 app → `/VERYSILENT` 安装 → FileVersion/端点/哈希冒烟 → 大小 + SHA-256 记账。
5. **tag 与推送**：注释 tag `vX.Y.Z`（2026-10-29 独立仓库起取消 `plus-` 前缀——本仓库已无上游 tag 可冲突）；只推本仓库的 `origin` 与备份裸库。GitHub Release 一律先建**草稿**（draft），由站主手动 Publish。
6. **发版完成的定义**：内部台账四处（CHANGELOG 详细台账 / FORK_STATUS 版本行与门禁表 / HANDOFF 版本行 / GATE_REGISTRY runbook 版本引用）同步更新即算完成——台账均本机维护、不入库，对外仓库只随 `CHANGELOG.md` 对外版同步用户面要点。
7. **队列迁移纪律**（发版相关，2026-10-25 事故教训）：任何要改写 `queue.jsonl` 的脚本，对账必须模拟**读取端语义**（`createAsyncQueueReader` 的 last-wins/resolve），不能对原始行求和；先备份、先 dry-run、断言失败拒绝写入。

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **No project backend exists.** The fork is local-first: cloud features require the user to self-host an InsForge instance and configure it explicitly. The upstream instance (`srctyff5`) is retired and hard-blocked in `src/lib/runtime-config.js` (`LEGACY_INSFORGE_HOSTS`) — persisted installs pointing at it fall back to "no cloud".
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->
