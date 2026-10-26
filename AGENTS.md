# Agent Instructions

**This file is the single source of truth for how agents work in TT-plus.** It overrides `CLAUDE.md` for fork workflow, documentation, gates, deployment, and working-tree rules. [CLAUDE.md](./CLAUDE.md) is the upstream architecture/conventions/release reference: use it for code-level detail, but when it conflicts with this file on fork workflow or docs, follow `AGENTS.md`.

## Read order for this fork

| 顺序 | 文件 | 用途 |
|---|---|---|
| 0 | [HANDOFF.md](./HANDOFF.md) | **接手先读这页**：本轮交接状态、剩余任务与判据、门禁命令、判回归的方法 |
| 1 | [README.md](./README.md) | 对外定位、安装/构建、隐私与许可 |
| 2 | [FORK_STATUS.md](./FORK_STATUS.md) | 当前 HEAD、部署状态、门禁摘要 |
| 3 | [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | 未完成项、待拍板、已知限制 |
| 4 | [GATE_REGISTRY.md](./GATE_REGISTRY.md) | 提交/部署前必须跑的门禁 |
| 5 | [CHANGELOG.md](./CHANGELOG.md) | 历史台账；查「当时为什么这么改」 |
| 6 | [CLAUDE.md](./CLAUDE.md) | 上游架构、代码约定、发布流程参考；fork 规则以本文件为准 |

## Fork-specific working rules

- **Development happens only in `D:\TokenTrackerPlus\repo` on branch `usage-desk-135`.**
- **This fork ships source + the Windows package only** (owner decision 2026-10-27). `TokenTrackerBar/` (Swift) and `TokenTrackerLinux/` (Tauri) are kept consistent at source level only — text gates such as `test/pet-parity.test.js` and `validate:versions`. **Nobody builds them here**: this box has no Xcode, and Tauri needs a Linux toolchain. When you touch either side, say so in the commit and in `KNOWN_ISSUES.md` so whoever has a Mac/Linux compiles it; `ci.yml` does have `linux-client` (ubuntu) and `macos-tests` (macos-26) jobs, but they only fire on push/PR to `main`, not on `usage-desk-135`.
- The legacy worktree/object store (`D:\tt-rebase` / `D:\tt-fork`) was deleted on 2026-10-26 after the one-week keep; the same-disk bare mirror `backup` (`D:\TokenTrackerPlus\archive\tt-fork-backup.git`) was deleted on 2026-10-27 — one disk protects against nothing, and with dual push a bad push would have mirrored anyway. Pre-rewrite history still lives on `mine` as branch `backup/pre-rewrite-868bfe16`. Never push to `origin`/`upstream`; `mine` is the only pushable remote.
- After a work batch: update `FORK_STATUS.md` (current state), append to `CHANGELOG.md` (what happened and how it was verified), and add/remove `KNOWN_ISSUES.md` entries.
- Never commit secrets. Put local overrides in `.env.local` (gitignored); `.env.example` is the template. Do **not** create `.dev.vars` (Cloudflare Workers convention, not used here).
- Merging upstream: any commit that changes pricing/billing semantics must be reconciled against local totals before and after. The upstream `-free` → zero-price rule is permanently rejected in this fork.
- Before claiming a UI feature is delivered, read the rendered text/DOM, not only the server endpoint.

## 版本与发版规则（semver，2026-10-26 起所有接手 AI 必须遵守）

1. **按内容定版本，不按感觉**。每次要出安装包时，先盘点「自上个安装包以来累计的热更」，再选号：
   - 只有 bug 修复、无新功能 → **PATCH**（如 1.0.1）；
   - 含任何新功能（新卡片 / 新来源 / 新页面 / 新交互 / 新数据迁移）→ **MINOR**（如 1.0.1 → 1.1.0：WorkBuddy 配额卡、OMP 会话、速率口径下拉、模型统一、README 六语）；
   - 破坏性变更（数据格式不兼容、移除用户依赖的功能）→ **MAJOR**，且必须先问站主。
2. **单一版本轨**：根 `package.json` 是唯一真源。同一提交内同步全部 manifest（`package-lock.json` 两处 + `TokenTrackerBar/project.yml` + `TokenTrackerWin.csproj` + `TokenTrackerLinux/{package.json,package-lock.json,src-tauri/tauri.conf.json,src-tauri/Cargo.toml,Cargo.lock,PKGBUILD}`），改完必跑 `npm run validate:versions`（全部应为 vX.Y.Z 才放行）。dashboard 的 lock 不含本包版本，不用动。
3. **热更 ≠ 发版**：改 `src/` 或 `dashboard/` 后镜像到两处安装副本只是热更，台账必须记「未重打安装包」；热更内容必须随下一个安装包进入安装器，不许无限期只靠热更。
4. **发版链固定顺序**（详见 GATE_REGISTRY §4，坑点已写在注释里）：版本号 → `TOKENTRACKER_BUILD_PET=1` dashboard 构建 → `bundle-node.ps1` → `dotnet publish` → **先 `Remove-Item` 再 `Copy-Item` EmbeddedServer（直接 Copy 会嵌套，1.0.1 首包事故）** → `verify-windows-package.cjs`（版本号必须正确、matchedInputs>0，不过不准进 ISCC）→ `dotnet test` → `MSYS_NO_PATHCONV=1 ISCC /DMyAppVersion=X.Y.Z` → 停 app → `/VERYSILENT` 安装 → FileVersion/端点/哈希冒烟 → 大小 + SHA-256 记账。
5. **tag 与推送**：注释 tag `plus-vX.Y.Z`；只推 `mine` 与 `backup`；`origin`/`upstream` 永不推。GitHub Release 一律先建**草稿**（draft），由站主手动 Publish。
6. **发版完成的定义**：CHANGELOG（发版段）/ FORK_STATUS（版本行 + 门禁表安装包行 + 里程碑）/ HANDOFF（版本行）/ GATE_REGISTRY（runbook 中的版本引用）四处同步更新并提交后，才算发版完成。
7. **队列迁移纪律**（发版相关，2026-10-25 事故教训）：任何要改写 `queue.jsonl` 的脚本，对账必须模拟**读取端语义**（`createAsyncQueueReader` 的 last-wins/resolve），不能对原始行求和；先备份、先 dry-run、断言失败拒绝写入。

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **tokentracker** (API base `https://srctyff5.us-east.insforge.app`)
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
