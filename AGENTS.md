# Agent Instructions

**This file is the single source of truth for how agents work in TT-plus.** It overrides `CLAUDE.md` for fork workflow, documentation, gates, deployment, and working-tree rules. [CLAUDE.md](./CLAUDE.md) is the upstream architecture/conventions/release reference: use it for code-level detail, but when it conflicts with this file on fork workflow or docs, follow `AGENTS.md`.

## Read order for this fork

| 顺序 | 文件 | 用途 |
|---|---|---|
| 1 | [README.md](./README.md) | 对外定位、安装/构建、隐私与许可 |
| 2 | [FORK_STATUS.md](./FORK_STATUS.md) | 当前 HEAD、部署状态、门禁摘要 |
| 3 | [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | 未完成项、待拍板、已知限制 |
| 4 | [GATE_REGISTRY.md](./GATE_REGISTRY.md) | 提交/部署前必须跑的门禁 |
| 5 | [CHANGELOG.md](./CHANGELOG.md) | 历史台账；查「当时为什么这么改」 |
| 6 | [CLAUDE.md](./CLAUDE.md) | 上游架构、代码约定、发布流程参考；fork 规则以本文件为准 |

## Fork-specific working rules

- **Development happens only in `D:\tt-rebase` on branch `usage-desk-135`.**
- `D:\tt-fork` is a detached mirror of the main object store. Never commit or create branches there; sync it with `git checkout --detach usage-desk-135` after new commits.
- After a work batch: update `FORK_STATUS.md` (current state), append to `CHANGELOG.md` (what happened and how it was verified), and add/remove `KNOWN_ISSUES.md` entries.
- Never commit secrets. Put local overrides in `.env.local` (gitignored); `.env.example` is the template. Do **not** create `.dev.vars` (Cloudflare Workers convention, not used here).
- Merging upstream: any commit that changes pricing/billing semantics must be reconciled against local totals before and after. The upstream `-free` → zero-price rule is permanently rejected in this fork.
- Before claiming a UI feature is delivered, read the rendered text/DOM, not only the server endpoint.

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
