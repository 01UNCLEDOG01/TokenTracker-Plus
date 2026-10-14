# APIGOTO 面板 API 侦察记录（2026-10-15）

来源：`https://apigoto.com/user/` 前端 JS（`index-DGRrxppp.js` + 62 个懒加载分块，全部已抓到 `/tmp/ag-chunks/`）。
面板版本 v1.1.240。**不是** one-api/new-api 系（无 `/v1/dashboard/billing/*`），是自研面板。

## 用户端 API 约定

- axios `baseURL: "/api/v1/user"`；各业务模块再拼自己的子路径。
- **鉴权**：`Authorization: Bearer <access_token>`；令牌对（access_token/refresh_token）由包装器存取
  （bundle 内 `ln.get/set("access_token")`，登录后写入；`document.cookie` 与 `localStorage` 均不可见于 JS
  ——实测浏览器控制台两者皆空，疑似 httpOnly cookie 或内层存储）。
- **刷新**：过期后调 `POST /api/v1/user/user/refresh`，响应 `data.access_token` + `data.refresh_token`
  （前端 `applyTokens(t.data.access_token, t.data.refresh_token)`）。
- **登录**：页面路由 `/login`（LoginView），端点 `/user/login`（模块路径，全路径
  `POST /api/v1/user/user/login`）与验证码 `/api/v1/user/user/captcha/slider/challenge`
  （滑条验证码，登录可能要求携带 challenge 结果）。

## 订阅（本次目标：面板上"使用情况：APIGOTO PLUS 订阅额度 98%"）

`dashboard/edge-patches` 之外的**页面模块** `/user/subscription`（全路径 `/api/v1/user/subscription/*`）：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v1/user/subscription/current` | **当前订阅**（额度百分比、剩余、到期） |
| GET | `/api/v1/user/subscription/page` | 订阅记录分页 |
| GET | `/api/v1/user/subscription/policy-limit` | 订阅外消费上限策略 |

注意路径里的 `/user/subscription` 是页面模块路径，**不是** `/api/v1/user/subscription` 直接拼
（控制台实测 `/api/v1/user/subscription/current` → 404；按 axios baseURL 规则应为
`/api/v1/user/user/subscription/current` 一类双段形式，待登录后验证——参照已知端点
`/api/v1/user/user/refresh` 的双 `user` 结构）。

**响应字段**（来自渲染视图 SubscriptionList 的取值）：`plan_name`、`expires_at`/`expired`、
`percent`/`percentage`、`remaining`、`usage`、`usage_limits`。实时值样例：RouterCode PLUS、
健康分 100、订阅额度(TCredits) 98%（7 天窗口，到期 2026-11-09）。

## 其它可用端点（全部 `/api/v1/user` + 模块路径）

| 模块 | 子端点 |
|---|---|
| `/user/dashboard` | `/overview` `/trend` `/models` |
| `/user/api-key` | `/list` `/test` `/test` `/test-models` `/vendors` `/models` |
| `/user/stats` | （消费统计） |
| `/user/call-log`、`/user/consumption-log`、`/user/balance-log` | `/page`（日志） |
| `/user/user` | `/refresh` `/login` `/login/code`（短信登录）`/captcha/slider/challenge` |
| `/user/order`、`/user/payment`、`/user/billing-plan`、`/user/model-group` | — |

## 已排除

- `/v1/dashboard/billing/subscription|usage` → 404（非 OpenAI 兼容计费端点）。
- `localStorage`/`document.cookie` 在页面控制台均为空（httpOnly 或内层存储），
  DevTools 抓令牌不可行；**TT 集成的正路是账号密码登录流**（同 AgentRouter 设计）。

## 下一步（实现 TT provider）

1. 向用户要 APIGOTO 账号密码（账号 UNCLEDOG / 手机 135****8025）。
2. 实现：登录 → 保存会话 → GET 订阅 current → 解析 percent/remaining/expires_at
   → 限额页与桌宠显示"RouterCode PLUS：98%"。
3. 滑条验证码是自动化登录的最大变数：若登录必带 challenge，需人工一次登录后
   长期续期（refresh 流），或引导用户粘贴一次会话。
