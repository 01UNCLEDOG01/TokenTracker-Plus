# Qoder Desktop Limits — log fallback (0.4.x)

> 吸收自上游 TokenTracker #921（adapted from upstream PR #921），按本仓架构改写。

## Why

Qoder Desktop 0.4.x 移除了旧的 `SharedClientCache/.info.json` JSON-RPC 端点——纯桌面安装（没有网站登录态）的场景下，`credit/usage` / `auth/status` 两条老路都会返回 `configured:false`。为了不让这类安装的额度卡直接空掉，额度读取增加一条**日志兜底源**。

排除项：`mcp/router*.log`（MCP Router 端口返回 401，不是配额端点）。

## Paths

| 版本 | 日志根 |
|---|---|
| International (0.4.x) | `%APPDATA%\com.qoder.app.stable\logs`（Windows）；`~/Library/Application Support/com.qoder.app.stable/logs`（macOS）；`~/.config/com.qoder.app.stable/logs`（Linux） |
| CN (0.4.x) | 同布局，`com.qodercn.app.stable` |
| 旧版兜底 | `Qoder/logs`、`QoderCN/logs`（老 `renderer.log`） |

覆盖变量：`QODER_LOG_ROOT` / `QODER_CN_LOG_ROOT`（整根替换）、`QODER_HOME` / `QODER_CN_HOME`（换 home）。

## Scanning rules

- 收集 `main.log` + `renderer.log`，按 mtime 新到旧排序，最多扫 8 个文件。
- 每个文件从**尾部**向前按 512 KiB 分块回扫，上限 8 MiB，块间 64 KiB 重叠（防跨块截断）。
- 优先解析 `[Auth] [AccountUsage]` **JSON 行**（`qoderUsage.userQuota` → primary_window、`qoderUsage.addOnQuota` → tertiary_window、`expiresAt` 的 9999 哨兵 → `reset_at: null`），复用 `normalizeQoderRpcUsage`，不重复推导百分比与单位。
- 解析不出 JSON 行时回落到 legacy `renderer.log` 文本格式（`userQuota= used=…,total=…,remaining=…`）。
- **新鲜度**：只接受 7 天内的快照（JSON 行时间戳优先，否则文件 mtime）；跨文件保留**最新**的合格行，而不是第一个命中。

## Merge semantics

- 被动 SQLite 读取（`Qoder/SharedClientCache/cache/db/local.db`）仍是主路径；日志扫描是 0.4.x 桌面安装的**兜底**。
- 结果写入既有 last-good 缓存（`~/.tokentracker/tracker/qoder-usage-limits-cache.json`，CN 独立命名空间），沿用既有 TTL（无 `reset_at` 12 小时、有 `reset_at` 到期为止、7 天硬上限）。
- 有解析时间戳的日志行，**新于缓存快照时优先于缓存**；否则缓存优先。
- 解析失败静默回落，不影响其他额度来源。

## Privacy

只提取配额摘要字段（`userQuota` / `addOnQuota` / `userType` / `expiresAt` / `isQuotaExceeded`），不保留、不上传任何其他日志内容；Electron 凭据存储（`auth.v1.dat`、safeStorage、cookies、tokens）一律不读；无网络请求。
