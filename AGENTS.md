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

- **Development happens on branch `standalone`**（推 `origin/main`；2026-10-29 起 `usage-desk-135` 已作废）。主开发机 = Windows `D:\TokenTrackerPlus\repo`；**2026-11-09 站主购入 mac 立项第二开发机**（clone 在 `~/Projects/TokenTracker-Plus`，Node 22 tar 包装 `~/tools/node22`），mac 上也直接推 `standalone`。
- **This fork ships the Windows package + macOS package + source** (**2026-11-09 owner order supersedes the 2026-10-28 Windows-only rule**: the owner bought a Mac and ordered the macOS client — `TokenTrackerMac/` native menu-bar shell, CLT-swiftc build, release chain `TokenTrackerMac/scripts/bundle-node.sh` → `package-macos.sh` → `scripts/verify-macos-package.cjs`). The 2026-10-28 deletion of `TokenTrackerBar/` (Swift upstream bar) and `TokenTrackerLinux/` (Tauri) still stands — the macOS client is a fresh Swift implementation mirroring `TokenTrackerWin/`'s architecture, **not** a resurrection of those directories. Do not re-add cross-platform parity gates: the mac shell and the Windows shell have no shared implementation to compare against. `scripts/native-qa-server.cjs` + `native-qa-auth.cjs` stay in `scripts/`.
- **CI shape: two jobs, no Linux/macOS client.** `ci.yml` fires only on push/PR to `main`. It runs `test + validate + build` on `ubuntu-latest` (the fast cross-platform Node CLI + dashboard gate, ~2.5 min measured 2026-11-02 — a test runner, **not** a Linux client) and `windows-build` on `windows-latest` (the real packaging gate, ~11 min; the bundled-Node22 suite inside it runs on main pushes only, PRs skip that second ~3.5 min pass). Docs-only pushes (`**.md`, `docs/**`, `.gitignore`) skip both workflows. The repo has been public since 2026-11-01, so standard GitHub-hosted runners are free; the `if: github.event.repository.private == false` guard on `windows-build` stays as a paid-minutes tripwire if it ever goes private again. Do not add macOS/Linux client jobs — there are no clients to compare — and do not widen the triggers.
  - **2026-11-02 correction:** the old "inherited linux suite has permanent platform reds" premise is dead — leftover runner-only divergences are explicit `process.env.CI` skips (KI-055) and the Ubuntu gate is green. `continue-on-error` was removed from that job (it had let a job red hide behind a green run-level badge), so a red there now fails the workflow and mails the owner.
- **Hot-mirroring the installed app is one command: `npm run mirror:installed`** (Windows). On macOS the equivalent refresh is `TokenTrackerMac/scripts/bundle-node.sh` + `package-macos.sh`; the mac app bundles its own EmbeddedServer copy, so server-side changes on mac go through re-bundling, not mirroring. Either platform: do not hand-run GATE_REGISTRY §4 — on 2026-10-27 a bare `dashboard:build` without `TOKENTRACKER_BUILD_PET=1` shipped a tree with no `pet.html`/`quota.html`, and the desktop pet rendered the server's 404 body ("Not Found"). Both packaging chains (bundle-node.ps1 / bundle-node.sh) force the PET build themselves and verify enforces pet/quota as sentinels.
- The legacy worktree/object store (`D:\tt-rebase` / `D:\tt-fork`) was deleted on 2026-10-26 after the one-week keep; the same-disk bare mirror `backup` (`D:\TokenTrackerPlus\archive\tt-fork-backup.git`) was deleted on 2026-10-27 — one disk protects against nothing, and with dual push a bad push would have mirrored anyway. Pre-rewrite history is preserved in private off-repo backups only (read-only archive bundles); it is not reachable from this repository — do not fetch, restore or re-push it. `origin` (TokenTracker-Plus) is the daily push target: push `standalone` → `origin/main`; never push to the upstream author's repo (xiufengsun/TokenTracker).
- After a work batch: update `FORK_STATUS.md` (current state), append to the internal detailed ledger (本机维护、不入库), and add/remove `KNOWN_ISSUES.md` entries. The ledger files are local-only since 2026-11-01 — never commit them.
- Never commit secrets. Put local overrides in `.env.local` (gitignored); `.env.example` is the template. Do **not** create `.dev.vars` (Cloudflare Workers convention, not used here).
- Merging upstream: any commit that changes pricing/billing semantics must be reconciled against local totals before and after. The upstream `-free` → zero-price rule is permanently rejected in this fork.
- Before claiming a UI feature is delivered, read the rendered text/DOM, not only the server endpoint.
- **新增 UI 必须复用原版组件与版式，不许自制一套**（2026-10-28 站主明确要求）。具体到限额页：行 = 标签列（`--tt-limits-label-w`）+ `h-1.5` 圆角轨道 + 右侧百分比列；配色只用 `barColor()` 的 emerald/amber/red；悬浮一律用 `HoverTooltip`（深色玻璃卡），**禁止原生 `title`**；行上要有 `cursor-pointer`；明细只放悬浮提示里，正文不重复；`limit_credits = 0` 的窗口不占行。新增卡片、行类型、图例都按这条走。
- **福利指南统一 A–Z 排序**（2026-11-03 站主明确要求）：`perksData.js` 的 `sortNames` 写中文品牌名全拼与英文品牌名（大写），取较靠前的名称排序；通用描述 AI/MaaS 不单独当品牌。`perks-sort.mjs` 在读取端排序，中英文界面使用同一顺序；新增卡片必须补排序名并通过 `validate:perks`，不可再把可用服务商追加沉底。
- **福利标记按周期判断**（2026-11-03 站主要求）：`daily_claim` 每个北京时间自然日、`monthly_claim` 每月 1 日重置提示；混合卡片两个独立按钮，其他卡片一次性标记。以 `perks-claims.mjs` 为准，v2 存各周期日期，迁移时保留 v1；分类筛选按对应周期，全部分类须整卡所有周期已标记，不能再按旧记录是否存在判断领取状态。
- **上游吸收建议必须先逐条对照本仓已有能力**（2026-10-30 站主裁定；起因：WorkBuddy CN/AI 拆分本仓早已实现，AI 仍当作可吸收的新功能上报，且不是第一次）。流程：写上游动态报告前，先读 `FORK_STATUS.md` 的能力段与 `src/lib/*-limits.js`、`src/lib/rollout.js` 的来源/卡片清单，对每条上游改动标注「本仓已有 / 部分有（差什么）/ 没有」；没有这一列的报告不许交付。
- **修复凡涉及客户端持久化状态（localStorage、WebView2 缓存、`~/.tokentracker` 下的缓存/快照文件），必须自带迁移或版本失效**（2026-10-30 站主裁定；起因：宠物勾选、榜单图标两次被旧缓存咬，"修好了"在用户端看不到）。验收标准：`mirror:installed` 重启后新行为立即可测，交付说明里不允许出现"请清缓存/请重装"。数据形状变更 → 升 schema/版本号并让旧数据被拒读；新增映射 → 映射放读取端，不许把判定结果烤进快照。
- **读取现役采集游标使用 `src/lib/cursor-store.js` 的 `readCursorStateSummary()`**：大数据模式下 `cursors.json` 是冻结的兼容副本；统计对账与备份必须包含 `cursor-store-v2` 的现役代次，不能把兼容副本当作当前真源。

## 版本与发版规则（semver，2026-10-26 起所有接手 AI 必须遵守）

1. **按内容定版本，不按感觉**。每次要出安装包时，先盘点「自上个安装包以来累计的热更」，再选号：
   - 只有 bug 修复、无新功能 → **PATCH**（如 1.0.1）；
   - 含任何新功能（新卡片 / 新来源 / 新页面 / 新交互 / 新数据迁移）→ **MINOR**（如 1.0.1 → 1.1.0：WorkBuddy 配额卡、OMP 会话、速率口径下拉、模型统一、README 六语）；
   - 破坏性变更（数据格式不兼容、移除用户依赖的功能）→ **MAJOR**，且必须先问站主。
2. **单一版本轨**：根 `package.json` 是唯一真源。**现役受管版本文件只有两个**——`package.json` + `TokenTrackerWin/TokenTrackerWin.csproj`（见 `scripts/version-files.cjs` 的 `VERSION_FILES` 数组，只有这 2 条）。macOS 壳不带独立版本文件——`package-macos.sh` 打包时从 `package.json` 注入 Info.plist，`verify-macos-package.cjs` 校验两处一致。`package-lock.json` 的 `version` 字段由 npm 自动同步，不受管；dashboard 的 lock 不含本包版本。**2026-10-28 平台裁剪前的 `TokenTrackerBar/project.yml` 与 `TokenTrackerLinux/*` 五个 manifest 已随目录删除，不要再按旧清单去同步不存在的文件。** 改完必跑 `npm run validate:versions`（两个文件都应为 vX.Y.Z 才放行）。
3. **热更 ≠ 发版**：改 `src/` 或 `dashboard/` 后镜像到两处安装副本只是热更，台账必须记「未重打安装包」。**2026-11-01 站主钦定新节奏：每个 MINOR（x.y.0）批次收尾必须走完整发版链打安装包 + tag + 草稿 Release（验收后按站主明确指令 Publish），不再攒多个 MINOR 只热更。2026-11-09 站主改定 PATCH 口径：PATCH（x.y.z）同样打安装包 + tag + Release 推出去——终结此前「PATCH 只热更」与 1.17.x/1.18.x/1.24.1 实践漂移，自 v1.24.2 起执行，不再有「内容随下一个 MINOR 进安装器」的挂账状态。**自 v1.12.0 起执行（1.8.1 之后 1.9.0~1.11.2 只热更未发版属旧节奏）。**
4. **发版链固定顺序**（详见内部台账 GATE_REGISTRY §4，本机维护不入库，坑点已写在注释里）：版本号 → `bundle-node.ps1`（**自带 PET dashboard 构建**——2026-10-31 起不再手工先跑，防陈旧 dist） → `dotnet publish -c Release -r win-x64 --self-contained true`（**三个参数缺一不可**——2026-11-09 FDD 误包事故：漏 `-r` 与 `--self-contained` 会产出无 .NET runtime 的载荷（1029 文件/133MB vs 正确 1266 文件/278MB），壳启动即死且源一致性比对拦不住） → EmbeddedServer 换装进 publish（**robocopy /MIR**；PowerShell `Copy-Item src/*` 通配有「容器→叶项」坑，直接 Copy 会嵌套，1.0.1 首包事故） → `verify-windows-package.cjs`（版本号必须正确、matchedInputs>0、**self-contained 哨兵 coreclr/hostfxr/hostpolicy 缺失即红**——2026-11-09 补，不过不准进 ISCC） → `dotnet test` → `MSYS_NO_PATHCONV=1 ISCC /DMyAppVersion=X.Y.Z`（Git Bash 下 `/D` 会被 MSYS 吃、`$env:` 会被展开——写死 ISCC 路径） → 停 app → `/VERYSILENT` 安装 → FileVersion/端点/哈希冒烟（**包体对账：Setup 应 ≈88.8MB、packageFiles ≈1260**，41.8MB=FDD 废包特征） → 大小 + SHA-256 记账。
   **macOS 行（2026-11-10 起）**：版本号 → `TokenTrackerMac/scripts/bundle-node.sh`（自带 PET 构建 + pinned Node 22.22.2 darwin-arm64 SHA-256 校验） → `TokenTrackerMac/scripts/package-macos.sh`（swiftc → .app → ad-hoc codesign → dmg+zip） → `scripts/verify-macos-package.cjs`（node 二进制 + pet/quota 页哨兵、dist 指纹、Info.plist 与 package.json 版本一致） → `npm test` → 装 `/Applications` 实机冒烟（菜单栏/三窗/端点/退出进程树） → dmg 双开验证单实例 → 大小 + SHA-256 记账。坑：mac 的 npm 在 node_modules/.bin 塞符号链接，bundle-node.sh 已删（运行时不需要，且 verify 的无符号链接断言会红）；打包后不要再动 .app 内文件（会废掉 ad-hoc 签名）。
5. **tag 与推送**：注释 tag `vX.Y.Z`（2026-10-29 独立仓库起取消 `plus-` 前缀——本仓库已无上游 tag 可冲突）；只推本仓库的 `origin`（同盘备份裸库已退役，不恢复双推）。GitHub Release 先建**草稿**（draft）。站主明确要求收尾包含 Publish 时，AI 在测试、一次对抗审查、文件/运行态同步和 push 完成后，核对 tag、附件 SHA-256 与 CI，直接 Publish 并按版本设置 Latest，无需重复请求确认。未获得 Publish 指令时保留草稿。
6. **发版完成的定义**：内部台账四处（CHANGELOG 详细台账 / FORK_STATUS 版本行与门禁表 / HANDOFF 版本行 / GATE_REGISTRY runbook 版本引用）同步更新即算完成——台账均本机维护、不入库，对外仓库只随 `CHANGELOG.md` 对外版同步用户面要点。
7. **队列迁移纪律**（发版相关，2026-10-25 事故教训）：任何要改写 `queue.jsonl` 的脚本，对账必须模拟**读取端语义**（`createAsyncQueueReader` 的 last-wins/resolve），不能对原始行求和；先备份、先 dry-run、断言失败拒绝写入。

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime and an AI model gateway.

- **No project backend exists.** The fork is local-first: cloud features require the user to self-host an InsForge instance and configure it explicitly. The upstream instance (`srctyff5`) is retired and hard-blocked in `src/lib/runtime-config.js` (`LEGACY_INSFORGE_HOSTS`) — persisted installs pointing at it fall back to "no cloud".
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->
