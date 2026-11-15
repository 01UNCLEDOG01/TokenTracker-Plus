# README 截图重拍 runbook（2026-11-15 定稿）

README 的六张 `docs/screenshots/*.png` 必须用**脱敏演示环境**拍摄——公开图里不允许出现站主真实身份（头像 / 昵称 / 称号可保留成就类称号，名字头像必须是匿名的）。站主 2026-11-14 拍板：**用量数字可以用真实数据**（更可信），身份与项目内容必须脱敏。

## 环境

- 演示数据 home：`D:\TokenTrackerPlus\demo-home\`（**不入库**，含真实用量；重建方法见下）
- 真实 home：`C:\Users\Administrator\.tokentracker\`

### 重建/更新演示 home（数据要跟当前真实数据同步时）

拷贝以下文件（其余一律不拷——凭据/令牌/云端偏好/config 绝不进演示 home）：

- `tracker/`：`queue.jsonl`、`project.queue.jsonl`、`session.queue.jsonl`、`auto-outcomes.jsonl(+.meta.json)`、`badge-earned-values.json`、`aihot-free-tokens-cache.json`
- 根层：`global-models-cache.json`、`aihot-models-cache*.json`

拷完跑一遍体检：demo-home 里不得存在文件名匹配 `/credential|token(?!s)|pref|config|auth|secret/i` 的文件（`aihot-free-tokens-cache.json` 的 "tokens" 是 AIHOT 羊毛缓存，属公开数据，误报可放行）。

### 起演示服务器

```bash
TOKENTRACKER_HOME="D:/TokenTrackerPlus/demo-home" node bin/tracker.js serve --port 17685
```

- 端口 17685 避开真实实例（17680）；拍完 `taskkill` 该 node 进程。
- 身份在**浏览器 localStorage**（`tt.localProfile.v1`），不在 home——全新浏览器配置即匿名；要显示旧图同款「Demo」名，加载后注入 `{"displayName":"Demo"}` 并刷新。

## 拍摄（浏览器 1920×1080，深色）

| 文件 | 页面 | 构图要点 |
| --- | --- | --- |
| dashboard-dark.png | `/` | 切「总计」tab（大聚合要等 15–20s 才出数，别在「还没有数据」占位时拍）；本机数据口径 |
| achievements.png | 侧栏「成就」 | 双口径页签（云端/本机）入镜 |
| perks.png | 侧栏「福利指南」 | 卡册统计头 + 翻页卡牌带 + 绝版玻璃柜同框 |
| global-models.png | 侧栏「全球模型榜」 | AA 智能榜表格 |
| pet.png | 侧栏「桌面宠物」 | 选中「庚戌」 |
| widgets-overview.png | 原生窗口合成图 | 无法用浏览器拍；需计算机操作截托盘浮窗/小组件或沿用旧图 |

坑：SPA 元素常「可见但不可点击」（Playwright actionability 超时）——改用 `playwright.evaluate` 里 `document.querySelectorAll('[role=tab]')` 找文本后 `el.click()`，或 `tab.cua.click` 坐标点击。

## 收尾

- 提交：仅 `docs/screenshots/*.png` 与本 runbook；演示 home 不入库。
- 拍完杀演示服务器进程；demo-home 保留供下次同步数据。
