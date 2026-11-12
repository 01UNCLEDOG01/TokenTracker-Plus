import { comparePerks } from "./perks-sort.mjs";

/**
 * 服务商福利指南数据源
 * 包含各个可以免费试用、领取初始额度、每日刷新、签到或具备邀请福利的 AI 服务商与客户端。
 * 每个卡片均配备「专属邀请/优惠注册」与「官网直达」双链接。
 * sortNames 记录中文全拼与英文品牌名（大写）；取较靠前的名称统一按 A-Z 排序。
 *
 * 每行必须带 checkedAt（核对日期）与 sourceUrl（该轮核对所依据的页面），
 * 由 `npm run validate:perks` 校验结构与时效措辞。查不到官方公开口径的数字
 * 一律写「以站内为准」，不许编造具体额度。
 *
 * badgeType = 福利价值等级。2026-11-12 站主定谳并复核（统一量纲 = 单月 30 天
 * 稳定可白嫖的等效人民币价值；一次性按面额走同档门槛）：
 *   neutral 灰   纯本地网关 / 纯付费订阅，无任何赠送额度
 *   success 绿   < ¥10/月（或单次 < ¥10）：轻量额度、$1 级免费档
 *   blue    蓝   ¥10–49/月（或单次 ¥10–29）：免费模型月估、小代金券、日签积分小户
 *   purple  紫   ¥50–149/月（或单次 ¥30–99）：日签积分主力、1 亿 token 一次性、中转站折算
 *   rose    粉   ¥150–499/月（或单次 ≥ ¥100）：日 1 亿 token 连日、积分日签大户、学生 ¥300
 *   amber   琥珀 ≥ ¥500/月（或单次 ≥ 5 亿 token）：每晚 3 亿 token 级、每日 ¥20+ 算力
 * 折算口径：真金白银取 AIHOT 官方折算；积分按厂商官方购价；免费模型按月用量估算。
 * 全量核算与逐卡归属见 dashboard/src/data/perks-value-audit.md（2026-11-12 终版）。
 * Qoder 国内/国际版：纸面 ¥216/月 但已无免费模型且排队严重，仅作防衰减备份（卡片正文已标注）。
 */

export const PERK_CATEGORIES = [
  {
    "id": "all",
    "label": "全部服务商"
  },
  {
    "id": "featured",
    "label": "主力推荐"
  },
  {
    "id": "permanent_free",
    "label": "长期免费"
  },
  {
    "id": "gateway",
    "label": "聚合平台"
  },
  {
    "id": "daily_claim",
    "label": "每日可领取积分"
  },
  {
    "id": "monthly_claim",
    "label": "每月福利"
  },
  {
    "id": "big_quota",
    "label": "赠送大额额度"
  },
  {
    "id": "client",
    "label": "客户端/工作台"
  }
];

export const PERK_PROVIDERS = [
  {
    "id": "agent2api",
    "name": "Agent2API (开源本地网关)",
    "sortNames": [
      "AGENT2API"
    ],
    "provider": "agent2api",
    "category": [
      "gateway",
      "client"
    ],
    "badge": "开源本地网关 · 多端账号聚合 · 自动签到打卡",
    "badgeType": "neutral",
    "tags": [
      "开源自建",
      "本地聚合网关",
      "自动签到打卡",
      "转OpenAI接口"
    ],
    "description": "开源免费的本地 AI 逆向代理与多 Agent 聚合网关（GitHub: aimod-cc/Agent2API）。专为打通割裂的 AI 客户端而设计：1. 自动签到打卡：内置定时任务与补签中心，可集中托管 WorkBuddy、小浣熊、AutoClaw、Qoder CN 等平台的每日签到与额度刷新，省去每天手动逐个打开客户端领积分的繁琐；2. 统一转 API：将各平台分散的免费额度与登录态集中聚合，转换为本地标准的 OpenAI 兼容接口（127.0.0.1 端口），供 Cursor、Cline、Cherry Studio、NextChat 等任意第三方开发或对话工具自由调用。",
    "tips": "支持 Windows/macOS 桌面客户端（Tauri）与 Docker 本地部署；凭证与 Token 均保存在本地机器不上传云端，适合搭配各家白嫖额度构建自己的个人私有聚合 API 池。",
    "officialUrl": "https://github.com/aimod-cc/Agent2API",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://github.com/aimod-cc/Agent2API"
  },
  {
    "id": "agentrouter",
    "name": "Agent Router",
    "sortNames": [
      "AGENT ROUTER"
    ],
    "provider": "agentrouter",
    "category": [
      "big_quota",
      "daily_claim",
      "gateway"
    ],
    "badge": "✅ 2026-11-03 实测已恢复：3/3 模型可用",
    "badgeType": "purple",
    "tags": [
      "实测已恢复",
      "美元赠额",
      "多模型路由",
      "海外网络"
    ],
    "description": "**2026-11-03 站主账号实测已恢复：模型状态页 3/3 可用**（gpt-6.1-sol 正常 97.81%、gpt-6-astra 正常 98.13%、gpt-5.6-sol 降级 96.13%，近 24h 可用率 97.76%），此前「无流量」状态解除。签到入口不受影响，每日签到得 **$25**（站内计价口径、非官方美元价，实际可用量以站内为准；签到积分有效期以端内为准）。历史注册与签到额度按官方说法保留。**每成功邀请得 $100** 用量额度，公开价目仅列 gpt-5.6-sol / gpt-6-astra / gpt-6.1-sol / claude-opus-5-5（后者限 svip/test 组）。历史：2026-10-31 站内实测曾显示「无流量」、调用空回（分账号/分节点现象，非全站故障）；2026-11-02 复查官方侧正常——站点与 API 正常响应，公告称折扣倍率已恢复标准价、将按使用规范持续补足额度，但当日模型列表仍显示「无流量」。",
    "tips": "此前流传的「注册送 $125 / 每日签到 $25」每日签到 $25 实测可得（站内计价口径、非官方美元价，实际可用量以站内为准）；一律以官方公告与站内额度页为准。",
    "inviteUrl": "https://agentrouter.org/register?aff=tt0I",
    "officialUrl": "https://agentrouter.org",
    "inviteCode": "tt0I",
    "hasInvite": true,
    "checkedAt": "2026-11-03",
    "sourceUrl": "https://agentrouter.org/api/status"
  },
  {
    "id": "agnes",
    "name": "Agnes AI",
    "sortNames": [
      "AGNES AI"
    ],
    "provider": "agnes",
    "category": [
      "permanent_free"
    ],
    "badge": "自研文本/图像/视频免费档",
    "badgeType": "success",
    "tags": [
      "免费档模型",
      "免费 10 RPM",
      "长上下文",
      "多模态"
    ],
    "description": "自研免费档模型换代：文本 agnes-2.5-flash、agnes-3-flash；生图 agnes-image-2.0 / 2.1 / 2.5-flash；视频 Agnes Video 2.5 Flash（720p）。官方 2026-09-23 公告把免费档与企业档速率各下调 50%，现为免费 10 RPM、企业 20 RPM。中国站 agnes-ai.cn 与国际站 www.agnes-ai.com 双站可用，均无邀请活动；每日登录领积分的网页版另见「Agnes AI 网页版」卡片。",
    "tips": "早期注册赠送 $0.10 余额，现行是否仍赠未核实，以站内额度为准；选自定义服务商填端点即可接入。",
    "officialUrl": "https://agnes-ai.cn",
    "officialUrlAlt": "https://agnes-ai.com",
    "officialUrlLabel": "中国站直达",
    "officialUrlAltLabel": "国际站直达",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://wiki.agnes-ai.com/zh-Hans/docs/pricing"
  },
  {
    "id": "agnes_web",
    "name": "Agnes AI 网页版",
    "sortNames": [
      "AGNES AI WANGYEBAN",
      "AGNES AI WEB"
    ],
    "provider": "agnes-web",
    "category": [
      "daily_claim"
    ],
    "badge": "每日 600 时效积分（过期清零·不叠加）",
    "badgeType": "success",
    "tags": [
      "网页版",
      "每日600·过期不叠加",
      "谷歌/苹果登录",
      "时效/永久分账"
    ],
    "description": "Agnes AI 的网页版对话工作台（app.agnes-ai.com），需谷歌或苹果账号登录。实测每日登录免费领 600 时效积分——**2026-11-03 复测确认：当日 600 当日有效，过期清零、多日不叠加**（11-01 发的 600 已于 11-03「积分过期 -600」清零、同日再发新的 600，连续登录也只有当日 600 可用，攒不了积分）；永久积分另计（普通新号通常为 0，以端内为准）。无邀请活动。",
    "tips": "时效积分过期清零、多日不叠加，领了尽快用；与永久积分分开核算，消耗顺序以站内为准；网页版与 API 平台（另见「Agnes AI」卡）账号互通、福利互不相干。",
    "officialUrl": "https://app.agnes-ai.com",
    "hasInvite": false,
    "checkedAt": "2026-11-03",
    "sourceUrl": "https://app.agnes-ai.com"
  },
  {
    "id": "qwen",
    "name": "阿里百炼 (通义千问 Qwen)",
    "sortNames": [
      "ALIBAILIAN",
      "QWEN"
    ],
    "provider": "alibaba",
    "category": [
      "featured",
      "big_quota"
    ],
    "badge": "在架模型各送 100 万 Tokens（90天）",
    "badgeType": "rose",
    "tags": [
      "阿里大厂",
      "多模型独立送",
      "旧版三方已下架",
      "用完即停安心模式"
    ],
    "description": "阿里云大模型一站式服务平台。按官方规则每个模型均有独立免费额度（通常 100 万 Tokens、90 天有效，不跨模型合并）；2026-10-29 官方下架清单同时涵盖第三方系列（DeepSeek、Kimi、智谱 GLM、MiniMax 等）与 Qwen 旧版本/快照（qwen-max、qwen-plus、qwen3 系列快照等），清单内模型新用户不再获赠、已发放给老用户的额度仍可继续使用，后续新上线模型仍会发放免费额度。",
    "tips": "免费额度默认在华北2（北京）地域实时推理生效；各模型额度相互独立不混用，建议在控制台开启「免费额度用完即停」开关，避免额度耗尽后产生按量扣费。",
    "officialUrl": "https://bailian.console.aliyun.com",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://help.aliyun.com/zh/model-studio/new-free-quota"
  },
  {
    "id": "amd_token_factory",
    "name": "AMD Token Factory (Radeon Cloud)",
    "sortNames": [
      "AMD TOKEN FACTORY",
      "RADEON CLOUD"
    ],
    "provider": "amd",
    "category": [
      "permanent_free",
      "gateway"
    ],
    "badge": "15 款免费模型 API 免费直连（站点共 18 款）",
    "badgeType": "rose",
    "tags": [
      "AMD 官方",
      "OpenAI 兼容 /v1",
      "DeepSeek/Qwen/GLM",
      "国内手机号可注册"
    ],
    "description": "AMD Radeon Cloud 的 Token Factory（BETA）：登录 AMD 开发者账号领取 Key，即可直接调用「Public Free Model APIs」15 款免费模型（站点共 18 款）——DeepSeek-V4.1-Flash-1017 / DeepSeek-V4-Flash-0731、GLM-5.3-Flash、Qwen3.8-Flash-Next / Qwen3.8-27B、Gemma-4-31B-IT、MiMo-V2.6-Flash、MiniCPM-V-4.7 系列与 d3 / d3-flash 决策模型等（2026-11-03 站主端内实测）。接口为 OpenAI 兼容 /v1 双协议，填入任意兼容客户端即可；支持国内手机号注册、国内可直连。模型卡片带实时负载条（Busy/Idle），免费档限速与用量以站内为准。",
    "tips": "BETA 阶段免费模型列表与限时活动可能随时变动，以官网页面为准；调用前先看模型负载与余量，Busy 时段可能排队；不含邀请活动。",
    "officialUrl": "https://developer.amd.com.cn/radeon/modelapis",
    "hasInvite": false,
    "checkedAt": "2026-11-03",
    "sourceUrl": "https://developer.amd.com.cn/radeon/modelapis"
  },
  {
    "id": "ant_ling",
    "name": "蚂蚁百灵 (Ant Ling)",
    "sortNames": [
      "MAYIBAILING",
      "ANT LING"
    ],
    "provider": "ant-ling",
    "category": [
      "monthly_claim"
    ],
    "badge": "每月 1 日自动发 10 元券（实测已到账）",
    "badgeType": "blue",
    "tags": [
      "蚂蚁集团",
      "OpenAI兼容",
      "月度抵扣券",
      "按量计费"
    ],
    "description": "蚂蚁集团百灵大模型开放平台，OpenAI 兼容地址 api.ant-ling.com/v1，API 按量计费。原每日 50 万 Tokens 免费额度已于 2026-10-31 停止按日发放；改为每月 1 日向新计费平台账户自动发放 1 张 10 元 Token 抵扣券（适用于全部模型，2026-11-01 实测到账，账内显示有效期至 2026-11-30）；历史计费账户完成升级另得一次 20 元 Token 消费券（自实际到账之日起 60 天内有效，适用于全部模型）；券仅可抵扣模型调用消费，不可提现或转让。",
    "tips": "到账查看：百灵计费平台 → 财务管理 → 账户充值 → 赠送额度（悬停可见每张券的适用模型/剩余/有效期）；额度按金额抵扣、与原 Token 数量口径不可直接换算；旧模型 Ling-2.6-1T / Ring-2.6-1T / Ling-2.6-flash 将于 2026-11-15 下线，请切换新版模型；新模型 **Ling-3.2-flash（2026-11-05 上线）前两周可经 API 免费调用**（支持文本/图片/视频输入，约 2026-11-19 截止，结束后恢复计费，首次用 API 须绑支付宝）。",
    "officialUrl": "https://developer.ant-ling.com",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://developer.ant-ling.com/zh-CN/docs/models/price"
  },
  {
    "id": "apigoto",
    "name": "APIGOTO",
    "sortNames": [
      "APIGOTO"
    ],
    "provider": "apigoto",
    "category": [
      "featured",
      "big_quota",
      "gateway"
    ],
    "badge": "订阅制改版：PLUS 约6折 / PROX10 约5折",
    "badgeType": "neutral",
    "tags": [
      "聚合网关",
      "DeepSeek官方token",
      "订阅制",
      "邀请返利"
    ],
    "description": "模型聚合网关平台，订阅套餐走 DeepSeek 官方 token 直连，实测速度快、量大。2026-11-01 起订阅制改版（已订阅用户不受影响）：FREE 并发 2、每周约 2,500,000 TCredits、订阅总额度 10,000,000 TCredits（价值约 ¥10）；PLUS ¥29.9 得约 ¥50 额度（约 6 折，并发 5、每周约 12,500,000）；PROX5 ¥142.00 得约 ¥250（约 55 折，并发 10、每周约 62,500,000）；PROX10 ¥255.6 得约 ¥520（约 5 折，并发 30、每周约 130,000,000）。同日起取消「上线后实名赠送会员」活动；有厂商折扣的模型订阅按 125% 比例计算（厂商已有 80% 折扣，再叠订阅折扣属重复折扣，现修正），OpenAI 整体厂商倍率调整为 0.4X 抵消订阅折扣重复计算。邀请计划：日结佣金 8%（被邀请人每日资金消费折算）+ 每日返利 TCredits 消费 1% / Credits 消费 10%（次日自动发放），推广积分 1,000,000 = ¥1，收益有效期自绑定起一年。",
    "tips": "TokenTracker 已内置 APIGOTO 额度卡实时对照；套餐档位与订阅入口在站内「订阅」页，厂商折扣模型的 125% 计费比例以站内模型价目为准，推广收益与提现细则以站内「推广信息」页为准。",
    "inviteUrl": "https://www.apigoto.com/UNCLEDOG",
    "officialUrl": "https://www.apigoto.com",
    "inviteCode": "UNCLEDOG",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://www.apigoto.com"
  },
  {
    "id": "autoclaw",
    "name": "AutoClaw 国内版 (智谱 AutoGLM)",
    "sortNames": [
      "AUTOCLAW GUONEIBAN",
      "AUTOCLAW CN"
    ],
    "provider": "autoclaw",
    "category": [
      "client",
      "daily_claim",
      "big_quota",
      "featured"
    ],
    "badge": "新户领 2 亿 tokens（¥120）+ 每日签到领积分",
    "badgeType": "purple",
    "tags": [
      "智谱出品",
      "一键安装Agent",
      "注册领2亿tokens",
      "邀请积分风暴"
    ],
    "description": "智谱 AI 推出的零门槛一键安装本地版 OpenClaw 智能体客户端（国内版），内置 50+ 技能（Skills）与 AutoGLM 浏览器自动化。**新用户注册免费领 2 亿 tokens（价值 120 元）**；**2026-11-09 至 11-15 登录国内版每号可领一次 5,000 万 Tokens**（11-15 23:59 北京时间统一失效，仅限客户端内使用；2026-11-10 官方页核实）；客户端内支持**每日签到领取免费积分**；受邀注册可得**最高 4,800 积分**，邀请好友双方享**积分风暴奖励**，可调 GLM-5.3 等主力大模型。",
    "tips": "国内版 autoclaw.zhipuai.cn、国际版 autoclaw.z.ai 两套安装互斥，只装一个；新用户在桌面端登录环节填写邀请码即可领奖励；端内积分福利以「我的积分」页实时为准。",
    "inviteUrl": "https://autoglm.zhipuai.cn/misc/autoclaw-invite?activity_id=autoclaw_fission&channel=fission&source_location=sidebar&target_app=autoclaw&target_app_version=2.1.0&os=win&IC=GX4HHVHS",
    "officialUrl": "https://autoclaw.zhipuai.cn",
    "inviteCode": "GX4HHVHS",
    "hasInvite": true,
    "endsAt": "2026-11-15",
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://autoclaw.zhipuai.cn"
  },
  {
    "id": "autoclaw_intl",
    "name": "AutoClaw 国际版 (Z.AI)",
    "sortNames": [
      "AUTOCLAW GUOJIBAN",
      "AUTOCLAW INTERNATIONAL"
    ],
    "provider": "autoclaw",
    "category": [
      "featured",
      "client",
      "daily_claim"
    ],
    "badge": "国际版每日签到 500 credits",
    "badgeType": "purple",
    "tags": [
      "智谱出品",
      "一键安装Agent",
      "每日签到500",
      "国际版独立站"
    ],
    "description": "智谱 AI 推出的零门槛一键安装本地版 OpenClaw 智能体客户端的国际版，内置 50+ 技能（Skills）与 AutoGLM 浏览器自动化。实测每日正常签到得 500 credits（有效期 7 天），且经常叠加活动；官网标注注册可领 200M tokens（价值 ¥120，2026-11-02 首页核对），GLM 5.3 限时可享 150% credit 加成，Coding Plan 按档每月首登赠积分（Lite 5,000 / Pro 10,000 / Max 26,000）。国内版与国际版无法共存，只装一个。",
    "tips": "国际版站点 autoclaw.z.ai 与国内版 autoclaw.zhipuai.cn 账号体系独立、安装互斥；国际版暂未核实有邀请活动，积分福利以端内为准。",
    "officialUrl": "https://autoclaw.z.ai",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://autoclaw.z.ai"
  },
  {
    "id": "bigmodel",
    "name": "智谱开放平台 (BigModel / Z.AI)",
    "sortNames": [
      "ZHIPU KAIFANG PINGTAI",
      "BIGMODEL",
      "Z AI"
    ],
    "provider": "zhipu",
    "category": [
      "featured",
      "permanent_free",
      "big_quota"
    ],
    "badge": "老 Flash 系列免费（至下架）+ 新户赠额",
    "badgeType": "purple",
    "tags": [
      "国内大厂",
      "老Flash免费",
      "免翻直连",
      "兼容OpenAI"
    ],
    "description": "手机号注册即可使用，无需复杂认证。**老 Flash 系列（GLM-4.7-Flash、GLM-4.5-Flash、GLM-4-Flash-250414 等）全系免费开放至下架**，官方承诺长期免费免 Token 费；新用户完成个人或企业认证另赠 **2,000 万 Tokens 初始额度**。",
    "tips": "国内站 bigmodel.cn、国际站 z.ai，两端均可调用 GLM Flash 免费系列；赠额可用于体验 GLM 主力付费模型。",
    "inviteUrl": "https://www.bigmodel.cn/invite?icode=ZaL1bTUfl7pSnDADpfvDjHHEaazDlIZGj9HxftzTbt4%3D",
    "officialUrl": "https://bigmodel.cn",
    "officialUrlLabel": "中国站直达",
    "officialUrlAlt": "https://z.ai",
    "officialUrlAltLabel": "国际站直达",
    "inviteCode": "ZaL1bTUfl7pSnDADpfvDjHHEaazDlIZGj9HxftzTbt4=",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://docs.bigmodel.cn/cn/guide/start/pricing.md"
  },
  {
    "id": "catpaw",
    "name": "美团妙手 (CatPaw)",
    "sortNames": [
      "MEITUAN MIAOSHOU",
      "CATPAW"
    ],
    "provider": "catpaw",
    "category": [
      "big_quota",
      "monthly_claim"
    ],
    "badge": "新户送 1,000 积分（1 年有效）+ 每月 200",
    "badgeType": "blue",
    "tags": [
      "美团出品",
      "AI编程平台",
      "注册送1000积分",
      "每月赠200积分"
    ],
    "description": "美团推出的妙手 (CatPaw) AI 编程平台，积分制计费。**新用户注册奖励 1,000 积分（自发放起 1 年内有效）**；**基础积分每月发放 200（当月有效）**。积分可用于 AI 代码生成、智能补全与工程调试，余额在「用量管理」页查看。",
    "tips": "每月基础积分的发放日与有效期以端内为准；失效积分可在用量管理页切换失效积分查看。",
    "officialUrl": "https://credit.catpaw.meituan.com",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://credit.catpaw.meituan.com/#/usage"
  },
  {
    "id": "cerebras",
    "name": "Cerebras Inference",
    "sortNames": [
      "CEREBRAS INFERENCE"
    ],
    "provider": "cerebras",
    "category": [
      "permanent_free"
    ],
    "badge": "每日 100 万 tokens 免费额度",
    "badgeType": "rose",
    "tags": [
      "晶圆级极速推理",
      "OpenAI 兼容",
      "Llama / GPT-OSS / Qwen",
      "海外网络"
    ],
    "description": "Cerebras Inference：主打晶圆级引擎极速推理的海外平台，官方宣布所有开发者每天可获 100 万 tokens 免费额度（单次输出上限约 8192 tokens，免费档另有速率限制，以控制台为准），可免费调用 Llama、GPT-OSS、Qwen 等开源模型；OpenAI 兼容接口，改 base URL 即可接入任意兼容客户端，实测输出速度普遍达数百 tokens/秒。",
    "tips": "每日额度刷新、超量转付费；免费档与付费档的速率政策可能调整，以官方 Pricing 页为准；国内访问需海外网络。",
    "officialUrl": "https://cloud.cerebras.ai",
    "hasInvite": false,
    "checkedAt": "2026-11-03",
    "sourceUrl": "https://www.cerebras.ai/inference"
  },
  {
    "id": "cloudflare_workers_ai",
    "name": "Cloudflare Workers AI",
    "sortNames": [
      "CLOUDFLARE WORKERS AI"
    ],
    "provider": "cloudflare",
    "category": [
      "permanent_free"
    ],
    "badge": "每日 10,000 neurons 免费算力",
    "badgeType": "blue",
    "tags": [
      "Cloudflare 官方",
      "每日刷新",
      "不绑卡",
      "海外网络"
    ],
    "description": "Cloudflare Workers AI：免费计划每天送 10,000 neurons（官方统一 AI 算力计费单位，按模型折算，**每天北京时间 08:00 重置、不累积**），覆盖 LLM（Llama 等）、图像、语音转写、嵌入等多类模型，REST / OpenAI 兼容方式调用；免费层超出后请求直接失败、不产生扣费。付费 Workers 计划（$5/月）同样含每日 10,000 neurons，超出部分按约 $0.011 / 千 neurons 计费。",
    "tips": "不同模型的 neurons 消耗差异很大，官方每个模型页标注每输入/输出的 neurons 数并有计算器可估算；免费层超量即停不扣费，适合小流量白嫖；国内访问需海外网络。",
    "officialUrl": "https://developers.cloudflare.com/workers-ai/",
    "hasInvite": false,
    "checkedAt": "2026-11-03",
    "sourceUrl": "https://developers.cloudflare.com/workers-ai/platform/pricing/"
  },
  {
    "id": "huawei_codearts",
    "name": "华为 CodeArts Agent (华为云码道)",
    "sortNames": [
      "HUAWEI YUN MADAO",
      "CODEARTS AGENT"
    ],
    "provider": "codearts",
    "category": [
      "featured",
      "client",
      "daily_claim",
      "monthly_claim"
    ],
    "badge": "注册 4,000 + 学生 4,000 + 每日签到 100",
    "badgeType": "rose",
    "tags": [
      "华为云",
      "代码智能体",
      "每日签到100",
      "学生认证4000"
    ],
    "description": "华为云推出的真实软件工程 AI 编码智能体（积分计费）。实测福利总账：注册 4,000 积分 + 学生认证 4,000 + 邀请 1,000 + 个人版每月 2,000 + 每日签到 100，**累计可达万级**。邀请规则（2026-11-09 官方页核实）：首次使用码道的国内新用户经好友邀请链接注册登录**额外得 1,000 积分**（基础 4,000 另算），邀请人每次有效邀请也得 1,000 积分、累计上限 5 万，奖励到账起 1 个月内有效。每日签到领 100 积分（官方另载个人版每月 2,000 积分额度）；另报名 skill 大赛可再得 4,000（赛期与名额以活动页为准），具体到账以端内积分明细为准。历史：2026-09-04 起改为积分计费，旧 Tokens 套餐需先免费切换到积分套餐。（各项可叠加：注册 4,000 + 学生认证 4,000 + 邀请 1,000 + 个人版每月 2,000 + 每日签到 100，累计可达万级；另报名 skill 大赛可再得 4,000，赛期与名额以活动页为准；具体到账以端内积分明细为准。）",
    "tips": "支持 IDE 插件与桌面客户端，多模型智能调度（DeepSeek、Kimi、GLM 等）；官方两页口径不一：签到活动页写「当日领取当日有效」，个人订阅计费说明写「自发放之日起 30 天内有效」（签到活动期至 2026-12-31），以端内积分明细实际到期为准、积分按到期先后优先消耗；签到入口在成长中心，随取随用。",
    "inviteUrl": "https://devcloud.cn-north-4.huaweicloud.com/chat?source=dmzntgwlb&sourcead=dmzntgwlb1&invitecode=INV-taWTH2T2JcL8d0esH15UMseSLiQN99qbfeb5Gp50u21Mt01_mokNPORaI_CxM_LrKuoTZOJThp9prEXpEqLKxJIQWyMC6hxkWSbV1qmMNFT6eQVyw-81VuMzAonD1G1z-NMbHhOWdDYCrxKsgZHxDHIuFrDivfsf0lorAf7go8L-Ug",
    "officialUrl": "https://www.huaweicloud.com/product/codearts.html",
    "hasInvite": true,
    "checkedAt": "2026-11-11",
    "sourceUrl": "https://www.huaweicloud.com/product/codearts.html"
  },
  {
    "id": "cola",
    "name": "Cola (AI 拍档)",
    "sortNames": [
      "COLA"
    ],
    "provider": "cola",
    "category": [
      "client"
    ],
    "badge": "受邀注册得 3 天会员 + 2,000 Auto 积分",
    "badgeType": "blue",
    "tags": [
      "AI拍档",
      "工具调用",
      "3天会员体验",
      "Auto积分"
    ],
    "description": "关心你、记得你、接得住工作和生活的 AI 拍档客户端。受邀新用户经邀请链接注册即得 3 天会员体验和 1,000 Auto 积分，在有效期内填写有效邀请码再得 1,000 Auto 积分（合计 2,000），均在注册后 3 天到期。",
    "tips": "Auto 积分自注册起 3 天到期，记得及时用；会员资格、积分余额与收支明细在站内「余额及用量」查看，也可用礼品卡兑换积分或套餐。",
    "inviteUrl": "https://colaos.ai/invite/6DVMGH",
    "officialUrl": "https://colaos.ai",
    "inviteCode": "6DVMGH",
    "hasInvite": true,
    "checkedAt": "2026-10-31",
    "sourceUrl": "https://colaos.ai"
  },
  {
    "id": "tuanjie_cowork",
    "name": "团结 Cowork (Tuanjie AI)",
    "sortNames": [
      "TUANJIE COWORK",
      "COWORK",
      "TUANJIE AI"
    ],
    "provider": "tuanjie-cowork",
    "category": [
      "client",
      "daily_claim"
    ],
    "badge": "每日签到 300 · 每周活动最高 +900",
    "badgeType": "purple",
    "tags": [
      "Unity中国",
      "游戏引擎AI",
      "每日打卡300分",
      "每周活动+900"
    ],
    "description": "Unity 中国官方打造的智能协作与编程助手。积分任务中心每日签到固定领 300 积分；**2026-11 新增每周活动**，三项各奖 300 积分、每周最高 +900：①连续 7 个活跃日（连续 7 天登录）；②每周三个活跃日（3 个不同自然日各完成 1 次完整对话）；③每周完成 10 个有效任务（一周内累计 10 次对话）。此前的新人注册礼包官网未公开说明，现行是否仍送以站内为准。",
    "tips": "登录网页端管理后台（codely.tuanjie.cn）进入积分任务中心签到并领取每周活动奖励；**每周活动每周一重置**（连续活跃日、活跃日计数与有效任务数都清零重算）；签到积分有效期为 8 天；签到中断一般不累计。",
    "officialUrl": "https://codely.tuanjie.cn",
    "hasInvite": false,
    "checkedAt": "2026-11-11",
    "sourceUrl": "https://codely.tuanjie.cn"
  },
  {
    "id": "cursor",
    "name": "Cursor (AI 代码编辑器)",
    "sortNames": [
      "CURSOR"
    ],
    "provider": "cursor",
    "category": [
      "client",
      "monthly_claim"
    ],
    "badge": "免费档无限期 · 限量 Agent/Chat 额度",
    "badgeType": "success",
    "tags": [
      "Anysphere",
      "AI优先IDE",
      "免费档",
      "Agent编程"
    ],
    "description": "Anysphere 出品的 AI 优先代码编辑器，2026-10 起与 Grok/X 打包（三合一，订阅由 X Subscription Corp 出售）。免费（Free）档 $0/月、无时间限制，含有限额度的 Agent 与 Chat 请求；刷新周期口径不一：官方价格页现写「每周刷新」（原 Hobby 档的每月刷新与 Tab 补全表述已移除），但端内/接口显示按月重置（2026-11-02 站主面板实测 12/1 重置），以端内为准。2026-10 起新定价分层：Plus $8 / Premium $30 / Super $100 / Ultra $200 每月。",
    "tips": "免费档额度在站内用量页查看；定价分层细节以 cursor.com/pricing 实时为准。",
    "officialUrl": "https://cursor.com",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://cursor.com/pricing"
  },
  {
    "id": "deepseek",
    "name": "DeepSeek 官方开放平台",
    "sortNames": [
      "DEEPSEEK"
    ],
    "provider": "deepseek",
    "category": [
      "featured"
    ],
    "badge": "官方极低资费（新户赠额未证实）",
    "badgeType": "success",
    "tags": [
      "官方直达",
      "顶级推理",
      "低廉单价",
      "开源领军"
    ],
    "description": "DeepSeek 官方 API 开放平台，接口兼容 OpenAI 格式，输入定价以官方文档实时发布（缓存命中价远低于未命中价）。新用户是否赠送体验额度官方未公开说明，请以控制台额度中心的实时政策为准。AIHOT 2026-11-11 口径称首次登录 DSH 桌面端的新用户可得约 ¥6 体验额度——该额度属 DSH 客户端，官方 API 文档只承认账户分「赠送余额 / 充值余额」两类并被优先扣减、未公布任何注册赠金数额，充值与赠额一律以控制台额度中心为准。",
    "tips": "官方不设第三方邀请机制，直接前往官网控制台注册即可；如遇官方充值或服务拥堵，可搭配第三方聚合路由作为高可用热备。",
    "officialUrl": "https://platform.deepseek.com",
    "hasInvite": false,
    "checkedAt": "2026-11-11",
    "sourceUrl": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing"
  },
  {
    "id": "doubaowork",
    "name": "豆包工作 (Doubao Work)",
    "sortNames": [
      "DOUBAO GONGZUO",
      "DOUBAO WORK"
    ],
    "provider": "doubao",
    "category": [
      "featured",
      "client",
      "daily_claim"
    ],
    "badge": "30天体验包 + 签到领额度 + 活动 100 额度",
    "badgeType": "rose",
    "tags": [
      "字节大厂",
      "30天体验包",
      "每日签到",
      "活动领100额度",
      "邀请得重置"
    ],
    "description": "首次登录豆包电脑版新用户，可直接领取 **30 天免费体验套餐**（除生视频、Pro 模型外全功能可用，30 天内有效且优先消耗）。新老用户还可参与**每日签到：每天 200 额度、周一翻倍**，累计额度到 500 / 2,000 / 5,000 时再额外奖 200 / 500 / 1,300 额度；活动人人可领 100 额度，官方口径累计签到 30 天合计可得 **8,800 额度（非一次到账）**；签到额度**发放后 30 天有效**；邀请好友双方各得 1 次额度重置机会。",
    "tips": "活动口令经 AI Agent 公益实训营等官方活动渠道发放，以活动页与官方社群为准；下载客户端后通过左下角签到弹窗或头像侧边栏「免费用豆包」参与签到，签到额度立即生效且优先消耗，签到额度的有效期以端内签到页规则为准。",
    "inviteUrl": "https://www.doubao.com/pc/desktop-fission/pro-trial/invited?inviteCode=WIbgDM5zbX",
    "officialUrl": "https://doubao.com/work",
    "inviteCode": "WIbgDM5zbX",
    "hasInvite": true,
    "checkedAt": "2026-10-31",
    "sourceUrl": "https://doubao.com/work"
  },
  {
    "id": "google_ai_studio",
    "name": "Google AI Studio (Gemini)",
    "sortNames": [
      "GOOGLE AI STUDIO",
      "GEMINI"
    ],
    "provider": "google",
    "category": [
      "permanent_free"
    ],
    "badge": "免费 API Key 按模型限速",
    "badgeType": "rose",
    "tags": [
      "谷歌官方",
      "Gemini 系列",
      "免费层数据用于训练",
      "海外网络"
    ],
    "description": "Google AI Studio（Gemini 开发者平台）：谷歌账号登录即可免费领取 API Key，免费档按模型分列速率限制（RPM / TPM / RPD 各模型不同，以控制台 Rate limits 页为准），可零成本调用 Gemini 系列模型。注意：免费层数据可能被用于改进谷歌产品（含训练），介意隐私可选付费层；国内访问需海外网络。",
    "tips": "免费档限额与可用模型随时调整，以控制台显示为准；免费层与付费层数据政策不同，敏感内容走付费层。",
    "officialUrl": "https://aistudio.google.com",
    "hasInvite": false,
    "checkedAt": "2026-11-03",
    "sourceUrl": "https://ai.google.dev/gemini-api/docs/rate-limits"
  },
  {
    "id": "groq",
    "name": "Groq",
    "sortNames": [
      "GROQ"
    ],
    "provider": "groq",
    "category": [
      "permanent_free"
    ],
    "badge": "免费档按模型限速、极速推理",
    "badgeType": "blue",
    "tags": [
      "LPU 极速",
      "Llama / GPT-OSS",
      "OpenAI 兼容",
      "海外网络"
    ],
    "description": "Groq：主打 LPU 极速推理的海外平台，注册即用免费档——无固定金额赠额，改为按模型分列速率限制（每分钟/每日请求数各模型不同，以控制台 Rate Limits 页为准），可免费调用 Llama、GPT-OSS 等开源模型，OpenAI 兼容接口直连客户端。",
    "tips": "免费档没有总金额、只有速率与每日请求数上限，跑量任务注意配额轮换；国内访问需海外网络。",
    "officialUrl": "https://console.groq.com",
    "hasInvite": false,
    "checkedAt": "2026-11-03",
    "sourceUrl": "https://console.groq.com/docs/rate-limits"
  },
  {
    "id": "siliconflow",
    "name": "硅基流动 (SiliconFlow)",
    "sortNames": [
      "GUIJI LIUDONG",
      "SILICONFLOW"
    ],
    "provider": "siliconflow",
    "category": [
      "featured",
      "big_quota",
      "gateway"
    ],
    "badge": "推荐官计划：每邀 1 人实名得 ¥16 代金券",
    "badgeType": "blue",
    "tags": [
      "主流聚合",
      "送2000万Tokens",
      "极速推理",
      "小模型免费"
    ],
    "description": "聚合 DeepSeek、Qwen 等主流开源大模型，部分小参数模型长期免费开放并发调用。**完成实名认证后可手动领一张 ¥16 全平台通用代金券（老用户也能领，领取后 180 天有效；2026-11-10 官方页核实）**；定价页标免费的模型（PaddleOCR-VL、BGE 向量/重排、Kolors 生图、SenseVoiceSmall 语音等）实名后 0 元调用。推荐官计划（2026-11-01 实测）：被邀请人完成注册及实名认证后，邀请人每邀 1 名再得 ¥16 代金券，人数与次数不设上限；注册端新户赠额以站内余额为准。",
    "tips": "代金券全平台模型与服务均可使用；注意使用期限，领取后尽快在有效期内消耗（剩余/有效期以站内「费用明细」为准）；额度支持各类第三方客户端接入，充值亦常设阶梯返赠（活动档位以站内公告为准）。",
    "inviteUrl": "https://cloud.siliconflow.cn/i/667oBtc0",
    "officialUrl": "https://cloud.siliconflow.cn",
    "inviteCode": "667oBtc0",
    "hasInvite": true,
    "checkedAt": "2026-11-01",
    "sourceUrl": "https://www.siliconflow.cn/"
  },
  {
    "id": "scnet",
    "name": "国家超算互联网 (SCNet)",
    "sortNames": [
      "GUOJIA CHAOSUAN HULIANWANG",
      "SCNET"
    ],
    "provider": "scnet",
    "category": [
      "featured",
      "big_quota",
      "gateway"
    ],
    "badge": "新户领 1 亿 Token（30 天）· 0.1 元 5000 万已到期",
    "badgeType": "purple",
    "tags": [
      "国家级算力",
      "0.1元5000万",
      "批处理",
      "新客赠1000万GLM-5.3-Flash"
    ],
    "description": "国家级超算 MaaS 算力与模型聚合平台。现行注册赠额：**新用户在 SCNet 客户端「新人专享」入口可领 1 亿 Token 资源包**（首期默认 GLM-5.3-Flash，到账后 30 天有效，每号限一次；另有 1,000 万 Token 档为限量先到先得，2026-11-10 厂商官方页核实）；限时特惠：**0.1 元秒杀购买 5,000 万 Tokens 资源包**（活动期 2026-08-13 至 2026-11-10，已到期，是否续期以站内为准）。",
    "tips": "国家超算中心算力储备充沛，适合批处理与大规模推理；0.1 元资源包在控制台特惠区认领，赠额与限时权益以站内实时公告为准。",
    "officialUrl": "https://www.scnet.cn",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://www.scnet.cn/home/subject/maas/index.html"
  },
  {
    "id": "volcengine",
    "name": "火山方舟 (字节豆包大模型)",
    "sortNames": [
      "HUOSHAN FANGZHOU",
      "VOLCENGINE"
    ],
    "provider": "volcengine",
    "category": [
      "featured",
      "big_quota",
      "permanent_free"
    ],
    "badge": "新户每模型 50 万 · 个人每日单模型 200 万",
    "badgeType": "success",
    "tags": [
      "字节大厂",
      "多模型赠送",
      "每日限免额度"
    ],
    "description": "新用户注册火山引擎即获赠**每个模型 50 万 Tokens 推理额度**。个人认证权益升级为**每日单模型 200 万免费 tokens**；企业认证升级为**每日单模型 500 万免费 tokens**。开启安心体验模式后仅消耗赠送额度，超额自动暂停不扣费。",
    "tips": "在控制台创建推理接入点 (ep-xxx) 即可使用；赠额有效期与协作奖励档位变动频繁，领取前先看控制台「免费额度」页。",
    "inviteUrl": "https://volcengine.com/L/YPDTLsCOn8k/",
    "officialUrl": "https://www.volcengine.com/product/doubao",
    "inviteCode": "97QSJU7A",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://docs.volcengine.com/docs/ark/model-pricing"
  },
  {
    "id": "spark",
    "name": "讯飞星火 (iFlytek Spark)",
    "sortNames": [
      "XUNFEI XINGHUO",
      "IFLYTEK SPARK"
    ],
    "provider": "spark",
    "category": [
      "featured",
      "permanent_free",
      "big_quota"
    ],
    "badge": "Spark Lite 长期免费 · Spark-X2.6 送 10 亿 Tokens",
    "badgeType": "amber",
    "tags": [
      "1024开发者节",
      "送10亿Tokens",
      "Spark Lite免费",
      "端侧0元"
    ],
    "description": "**自研轻量级模型 Spark Lite 官方永久/长期免费开放调用（0 元/Token，控制台创建应用即用，不占限时额度，支持文本与多轮对话）**。此外 1024 开发者节发布旗舰 Spark-X2.6（293B-A30B 稀疏 MoE、1M 上下文），新老用户实名认证后可在星辰 MaaS **免费领取 10 亿 Tokens 礼包**；端侧 **Spark-X2.6-4B 限时免费（0 元/百万 tokens）**。",
    "tips": "领取入口在星辰 MaaS 首页「Spark-X2.6 赋能开发者」或模型广场；礼包有效期与每人限领次数官网未列明细，领取弹窗为准。",
    "officialUrl": "https://xinghuo.xfyun.cn/spark",
    "hasInvite": false,
    "checkedAt": "2026-10-31",
    "sourceUrl": "https://xinghuo.xfyun.cn/spark"
  },
  {
    "id": "intern_inkstone",
    "name": "书生·端砚 (Intern InkStone)",
    "sortNames": [
      "SHUSHENG DUANYAN",
      "INTERN INKSTONE"
    ],
    "provider": "intern-inkstone",
    "category": [
      "monthly_claim",
      "permanent_free"
    ],
    "badge": "每月 10,000 墨点 · 4 款模型免费直用",
    "badgeType": "blue",
    "tags": [
      "上海AI实验室",
      "科研工作台",
      "每月领墨点",
      "多模型可白嫖"
    ],
    "description": "上海人工智能实验室打造的端到端科研工作台，**「墨点计划」每月可免费领取 10,000 墨点**（约合 5,000 万 Token）。官方提供 **Agents-A1、Atria-Dawn、Sage-A1.5、书生-S2 共 4 款自研模型长期免费直用**。",
    "tips": "支持 OpenAI Chat / OpenAI Responses / Anthropic Messages 三种规范调用（书生-Decision-4B 走 SystemOne）；登录控制台领取当月墨点，各模型墨点单价与上下文长度以「可用模型」页实时为准。",
    "officialUrl": "https://discovery.intern-ai.org.cn",
    "hasInvite": false,
    "checkedAt": "2026-10-31",
    "sourceUrl": "https://discovery.intern-ai.org.cn"
  },
  {
    "id": "joycode",
    "name": "JoyCode (京东智能编码)",
    "sortNames": [
      "JINGDONG ZHINENG BIANMA",
      "JOYCODE"
    ],
    "provider": "joycode",
    "category": [
      "client",
      "monthly_claim"
    ],
    "badge": "席位每月 10,000 免费积分",
    "badgeType": "success",
    "tags": [
      "京东云",
      "AI编程助手",
      "每月万点",
      "上下文引擎"
    ],
    "description": "京东云推出的一体化 AI 智能编码助手与开发环境，具备仓级上下文理解（CSR）与规约驱动编程能力。官方定价页现行口径为团队版限时免费、按席位发放 10,000 积分/月，用于代码预测续写、智能生成与问答。",
    "tips": "支持 VS Code / JetBrains 插件与桌面客户端；个人与团队档额度口径不同，领取前以官方定价页为准。",
    "officialUrl": "https://joycode.jd.com",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://joycode.jd.com/pricing/"
  },
  {
    "id": "tokenrhythm",
    "name": "基元律动 (TokenRhythm)",
    "sortNames": [
      "JIYUAN LVDONG",
      "TOKENRHYTHM"
    ],
    "provider": "tokenrhythm",
    "category": [
      "featured",
      "big_quota",
      "gateway"
    ],
    "badge": "实名送 ¥18 · 充值买一送一",
    "badgeType": "blue",
    "tags": [
      "实名送18元",
      "有效期一个月",
      "充值买一送一",
      "模型特惠"
    ],
    "description": "实名认证即可获得 ¥18 额度（有效期一个月）。限时充值买一送一回归：2026-11-13 截止，充值 ¥50 档及以上本金一比一赠送（¥10 档仅赠 ¥2.50），活动期可多次充值，本金与赠额均永久有效，付费后可体验专属模型。此前的千问系列半价与 DeepSeek 全天谷价调用已随 2026-10-30 档期结束下线，邀请活动现行是否重开以站内公告为准。",
    "tips": "登录后在「我的额度」查看实名赠额是否到账（有效期一个月）；充值买一送一档位与截止以首页横幅当期规则为准。",
    "officialUrl": "https://tokenrhythm.studio",
    "hasInvite": false,
    "endsAt": "2026-11-13",
    "checkedAt": "2026-11-01",
    "sourceUrl": "https://tokenrhythm.studio/"
  },
  {
    "id": "juflowai",
    "name": "飓流AI (JULIU AI)",
    "sortNames": [
      "JULIU AI"
    ],
    "provider": "juflowai",
    "category": [
      "featured",
      "gateway"
    ],
    "badge": "实名核验后领 ¥5 体验金 · 价格对齐官方",
    "badgeType": "success",
    "tags": [
      "国产大模型",
      "阿里云/腾讯云合作",
      "双协议兼容",
      "DeepSeek-Harness教程"
    ],
    "description": "国产大模型调用平台，一站式接入满血版国产大模型：阿里云/腾讯云模型合作伙伴，模型来源均调用自官方合作商，质量满血；OpenAI 与 Claude 双协议兼容，一分钟完成第一次调用。注册并自愿完成实名核验后领 5 元体验金，价格对齐上游官方；站内提供 DeepSeek-harness 一键接入教程、保姆级教程与工单客服。",
    "tips": "选自定义服务商填端点即可接入 TokenTracker；体验额度到账与各模型站内价以控制台实时为准。",
    "inviteUrl": "https://juflowai.com/sign-up?aff=UUlZ",
    "officialUrl": "https://juflowai.com",
    "inviteCode": "UUlZ",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://juflowai.com/api/home_page_content"
  },
  {
    "id": "longcat",
    "name": "美团 LongCat",
    "sortNames": [
      "MEITUAN LONGCAT",
      "LONGCAT"
    ],
    "provider": "longcat",
    "category": [
      "big_quota"
    ],
    "badge": "上新福利老户送 500 万 · 邀请各 1000 万",
    "badgeType": "blue",
    "tags": [
      "美团大厂",
      "送千万Tokens",
      "实名互赠",
      "30天有效"
    ],
    "description": "新户注册赠送 1000 万 Tokens；每次新模型上线另发上线福利（2026-11-02 端内实测，LongCat-2.5 上线）：新用户 1000 万 tokens、老用户 500 万 tokens，自动到账（有效期 30 天，以端内为准），缓存命中持续免费。邀请活动（2026-11-02 端内确认在线）：每成功邀请 1 位新用户完成实名认证，双方各得 1000 万 Tokens，奖励自发放起 30 天内有效；另有拼团返现最高 50%。",
    "tips": "赠额单次发放、30 天内用完；平台仅限个人与企业正常体验，禁止批量脚本调用。API 侧另有按量付费与资源包口径。",
    "inviteUrl": "https://longcat.chat/platform/product?inviteCode=WABCQLL3",
    "officialUrl": "https://longcat.chat",
    "inviteCode": "WABCQLL3",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://longcat.chat/platform/docs/zh/faq"
  },
  {
    "id": "loomy",
    "name": "讯飞 Loomy (桌面 AI 工作搭子)",
    "sortNames": [
      "XUNFEI LOOMY",
      "LOOMY"
    ],
    "provider": "loomy",
    "category": [
      "client",
      "daily_claim"
    ],
    "badge": "每日刷新5000 + 任务送1万 + 邀请送5000",
    "badgeType": "amber",
    "tags": [
      "科大讯飞",
      "桌面Agent",
      "任务1万积分",
      "邀请送5000",
      "每日5000积分"
    ],
    "description": "科大讯飞打造的桌面级 AI 工作搭子。实测新用户注册并完成任务可获得 10,000 积分，每日登录客户端自动刷新为 5,000 算力池（优先消耗）；官方支持邀请机制，官方规则原文：「每个邀请码限 1 人使用，邀请好友您与好友同时获得 5000 积分」，站主专属邀请码为 E5UZR8（限 20 人使用）。",
    "tips": "客户端支持目录级隔离与本地数据隐私保障；复制邀请码后在客户端「设置 → 邀请码」处兑换生效；每日登录赠送积分次日刷新，不跨日累积。",
    "inviteUrl": "https://loomy.xunfei.cn",
    "officialUrl": "https://loomy.xunfei.cn",
    "inviteCode": "E5UZR8",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://loomy.xunfei.cn/docs/user-guide/credits"
  },
  {
    "id": "minimax_code",
    "name": "MiniMax Code (智能编程助手)",
    "sortNames": [
      "MINIMAX CODE"
    ],
    "provider": "minimax-code",
    "category": [
      "featured",
      "client",
      "daily_claim"
    ],
    "badge": "每日登录送积分（第 4/7 天加码）",
    "badgeType": "purple",
    "tags": [
      "国产大厂",
      "M3系列模型",
      "每日签到400",
      "极速代码Agent"
    ],
    "description": "MiniMax 专为开发场景打造的桌面 AI 编程 Agent，搭载 MiniMax M3 与 M3.1-Flash 轻量极速模型。官方积分规则：每日签到得 400 积分，第 4 天与第 7 天各加码 1000，周累计上限 4000，到账积分 30 天内有效。",
    "tips": "登录 MiniMax Code 客户端后在个人中心积分页每日打卡；新用户注册赠额是否仍发放以站内为准。",
    "officialUrl": "https://minimax.io",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://agent.minimaxi.com/about"
  },
  {
    "id": "minimax",
    "name": "MiniMax 开放平台",
    "sortNames": [
      "MINIMAX KAIFANG PINGTAI",
      "MINIMAX OPEN PLATFORM"
    ],
    "provider": "minimax",
    "category": [
      "big_quota"
    ],
    "badge": "注册送 ¥15 代金券（30 天）",
    "badgeType": "blue",
    "tags": [
      "国产大厂",
      "送15元代金券",
      "超逼真语音"
    ],
    "description": "国内自研大模型前沿厂商。此前实测新注册账户赠送 ¥15 代金券（自注册日起 30 天有效）；官方定价页与公开文档现行已无任何代金券规则字样（2026-11-02 核对），现行是否仍赠以站内为准。支持 MiniMax 全系列文本大模型与高拟真 Speech 语音合成 API。",
    "tips": "国内控制台已迁至 platform.minimax.cn；到账代金券请在费用中心查看有效期，逾期不补发。",
    "officialUrl": "https://platform.minimax.cn",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://platform.minimax.cn/docs/pricing/overview"
  },
  {
    "id": "modelscope",
    "name": "魔搭社区 (ModelScope)",
    "sortNames": [
      "MODA SHEQU",
      "MODELSCOPE"
    ],
    "provider": "modelscope",
    "category": [
      "permanent_free"
    ],
    "badge": "每日 200 魔粒调 API（绑阿里云 +50）",
    "badgeType": "blue",
    "tags": [
      "阿里系",
      "国内直连",
      "Qwen 系全家桶",
      "OpenAI 兼容",
      "魔粒计费"
    ],
    "description": "魔搭社区（ModelScope）API-Inference：**每日登录自动获 200 魔粒，绑定阿里云账号再加 50**（2026-11-10 厂商官方页核实口径，原「每日 2,000 次免费调用」已改魔粒计费）；覆盖 Qwen3-Coder、Qwen 系列、GLM、DeepSeek 等带闪电标记的开源模型（老模型陆续下架），国内可直连；OpenAI 兼容接口，绑定魔搭账号访问令牌即可接入任意兼容客户端，国际站同样提供。",
    "tips": "调用 API-Inference 需绑定已实名的阿里云账号、完善个人信息并验证邮箱；轻量、主流、旗舰模型平均每次扣 0.5 / 1 / 2 魔粒，短期魔粒尽量当天用完；官方建议商用采用商业 API，高并发不保证。",
    "officialUrl": "https://www.modelscope.cn",
    "hasInvite": false,
    "checkedAt": "2026-11-11",
    "sourceUrl": "https://modelscope.cn/docs/model-service/API-Inference"
  },
  {
    "id": "nvidia_nim",
    "name": "NVIDIA Build (NIM)",
    "sortNames": [
      "NVIDIA BUILD",
      "NIM"
    ],
    "provider": "nvidia",
    "category": [
      "permanent_free"
    ],
    "badge": "全模型免费试用 · 40 RPM 限速",
    "badgeType": "blue",
    "tags": [
      "英伟达官方",
      "开源模型多",
      "OpenAI 兼容",
      "海外网络"
    ],
    "description": "NVIDIA Build（build.nvidia.com）：官方现行口径是**全模型可免费原型调用、按速率限制免费（free tier runs on rate limits，无 per-token 计费）**，免绑信用卡，只需 NVIDIA 账号并在 settings 生成 API Key（2026-11-11 官方 FAQ/llms.txt 核对）。限额：多数模型 **≤40 RPM**，站点配置另载 **10,000 请求/日**，具体按模型浮动（Rate limits may vary by model），个人上限显示在 dashboard 右上、超限返回 429。接口 OpenAI 兼容：把 base URL 指向 `https://integrate.api.nvidia.com/v1` 即可接入任意 SDK/客户端。历史口径（2024-09 官方论坛员工答复）为注册送 1,000 API credits、目录试用总上限 5,000（再 4,000 需企业邮箱激活 90 天许可），credit→token 换算官方从未公布、现行站点已不再展示 credits，故卡片不写固定额度。",
    "tips": "免费档按 RPM/日请求数限流，不扣费但会 429，长任务建议自己退避重试；个别标「Free Endpoint」的模型 API 可能尚未开放（以站点模型页能否生成 Key 为准）；国内访问需海外网络。",
    "officialUrl": "https://build.nvidia.com",
    "hasInvite": false,
    "checkedAt": "2026-11-11",
    "sourceUrl": "https://build.nvidia.com/faq"
  },
  {
    "id": "opencode",
    "name": "OpenCode Console",
    "sortNames": [
      "OPENCODE CONSOLE"
    ],
    "provider": "opencode",
    "category": [
      "permanent_free"
    ],
    "badge": "Console 限免模型（需走客户端）",
    "badgeType": "purple",
    "tags": [
      "编程专属",
      "限免模型",
      "OpenAI兼容",
      "客户端接入"
    ],
    "description": "面向终端的 AI 编程平台。限时免费模型档期（2026-11-10 官方页核实）：**MiniMax M3.1 Flash Free、LongCat 2.5 Free、DeepSeek V4.1 Flash Free、GLM-5.3-Flash Free、MiMo-V2.6-Flash Free 等指定免费模型，无需账号即可在 OpenCode 内使用**；其中 LongCat 2.5 自 2026-11-09 起限免两周、每天限 100 次；MiniMax/DeepSeek/GLM 输入不保留、不用于训练，Iceman 与 Inkling 2 Small 数据可能用于训练。免费模型需经 OpenCode 客户端接入，不能当通用 API。",
    "tips": "使用 GitHub 或 Google 账号直接登录即可获取 Key，免费模型会定期轮换，接入前先确认当前档期。",
    "officialUrl": "https://console.opencode.ai",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://opencode.ai/v2/docs/console/models"
  },
  {
    "id": "opencode_go",
    "name": "OpenCode GO",
    "sortNames": [
      "OPENCODE GO"
    ],
    "provider": "opencode",
    "category": [
      "featured",
      "gateway"
    ],
    "badge": "$10 享 $100 DeepSeek 额度 · 超高性价比",
    "badgeType": "neutral",
    "tags": [
      "超值付费",
      "DeepSeek高速",
      "10倍杠杆额度",
      "IDE终端接入"
    ],
    "description": "面向重度编码 Agent 的超值订阅服务。**$10/月订阅套餐可享受高达 $100 等值额度** 的 **DeepSeek-V4.1-Flash** 高速推理（官方已将其额度上限永久提升至 $100，享受 10 倍杠杆性价比）。在各大平台免费期陆续结束后，适合作为长期稳定的高性价比主力模型网关。",
    "tips": "付费订阅制（非免费白嫖），按 5 小时滚动限额 20%、周限额 50% 保护并发；获取 Key 后通过 /connect 命令直接连接 OpenCode 终端与各 IDE 插件。",
    "officialUrl": "https://opencode.ai",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://opencode.ai"
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "sortNames": [
      "OPENROUTER"
    ],
    "provider": "openrouter",
    "category": [
      "permanent_free",
      "gateway"
    ],
    "badge": "十余款 :free 免费模型",
    "badgeType": "success",
    "tags": [
      "全球聚合",
      "免绑信用卡",
      "常年免费档",
      "海外直连"
    ],
    "description": "全球领先的统一模型路由平台。官方模型接口实时计数：带 :free 标记的免费模型十余款（2026-11-02 实测 14 款，含 Gemma、Nemotron、Inkling 等开源版本，Llama/DeepSeek/Qwen 系已轮换下架），无需绑定支付方式即可调用；免费模型清单会随上游上下架变动。",
    "tips": "免费档按日限流：累计充值不足 $10 每日约 50 次、累计满 $10 每日 1,000 次（按累计充值金额定档，另有 20 次/分钟限速），适合轻量测试与无成本探索。",
    "officialUrl": "https://openrouter.ai",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://openrouter.ai/docs/api-reference/limits"
  },
  {
    "id": "qwen_work",
    "name": "千问办公 (QwenWork)",
    "sortNames": [
      "QIANWEN BANGONG",
      "QWENWORK"
    ],
    "provider": "qwenwork",
    "category": [
      "client",
      "monthly_claim"
    ],
    "badge": "新户赠 300 积分 · 每月仅 100（福利缩水）",
    "badgeType": "success",
    "tags": [
      "阿里大厂",
      "一站式Agent",
      "直接交付产物",
      "打通钉钉"
    ],
    "description": "阿里巴巴推出的一站式 AI Agent 办公平台，支持直接生成 Word、PPT、Excel 与可用代码。官方口径（2026-11-02 定价页与权益文档核对）：新用户注册赠 300 积分（90 天有效），每月 1 号向符合条件账号赠 100 积分（当月有效，发放条件以端内为准）；此前所记「每日登录 100 积分、00:00 刷新」已无官方依据，现行按月赠送。付费档：个人标准版 ¥78/月（原价 ¥98）、个人高级版 ¥158/月（原价 ¥198），档位内另含每月积分。月赠仅 100 积分，福利力度缩水，不推荐作主力（2026-11-02 评测结论）。",
    "tips": "支持 Windows / Mac 桌面客户端与网页端，手机号或钉钉扫码一键登录；剩余可用与每日刷新明细在端内「设置 → 订阅和用量」查看，其他积分经充值或活动获取、有效期以具体规则为准。",
    "officialUrl": "https://qwenwork.cn",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://docs.qwenwork.cn/benefits/personal"
  },
  {
    "id": "qiniu",
    "name": "七牛云 (Qiniu Cloud)",
    "sortNames": [
      "QINIU YUN",
      "QINIU CLOUD"
    ],
    "provider": "qiniu",
    "category": [
      "featured",
      "permanent_free",
      "big_quota"
    ],
    "badge": "conatus-free 每日 1 亿（活动至 2026-11-30）",
    "badgeType": "rose",
    "tags": [
      "每日一亿Tokens",
      "用完即停不扣费",
      "邀请返300万",
      "充值可提至10亿"
    ],
    "description": "**conatus-free 自研模型每日赠送 1 亿 Tokens 免费推理额度（活动期至 2026-11-30，用完即停不扣费）**。邀请好友注册双方各返 **300 万 Tokens**；充值任意金额可解锁高并发通道。",
    "tips": "qiniu/conatus-free 仅消耗活动额度，每日用尽自动熔断停止，无意外扣费风险；活动结束时间以官方活动页为准。",
    "inviteUrl": "https://s.qiniu.com/INbIn2",
    "officialUrl": "https://www.qiniu.com",
    "hasInvite": true,
    "endsAt": "2026-11-30",
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://www.qiniu.com/ai/free-models/conatus-2026"
  },
  {
    "id": "qoder_cn",
    "retired": true,
    "retiredDeal": {"label":"模型限时免费","detail":"Qoder CN 此前的免费模型调用福利已下线（站主实测）。每日 10:00 领 100 Credits 的签到仍照常，不受影响。"},
    "name": "Qoder CN (国内版)",
    "sortNames": [
      "QODER CN",
      "QODER GUONEIBAN"
    ],
    "provider": "qoder-cn",
    "category": [
      "featured",
      "client",
      "daily_claim"
    ],
    "badge": "每日 10:00 后主动领 100 Credits",
    "badgeType": "rose",
    "tags": [
      "阿里通义系",
      "国内免翻",
      "每日主动领取",
      "CLI 可查额度"
    ],
    "description": "阿里通义系的 Qoder 国内版（官网 qoder.cn）。**每日 10:00 之后主动领取 100 通用 Credits（自到账起 30 天有效）**；新人下载登录送 **300 Credits + 两周 Pro 试用**（高级模型要在 14 天 Pro 试用期内用）；**限时活动：匿名模型 Qoduck 每天限免**（与国际版同规则，选 Qoduck 免费调用、无需领取，用尽后按 0.5× 消耗 Credits）。**邀请活动 2026-11-11 已恢复**（端内活动页核实，三重好礼）：好友注册并下载 Qoder 后 7 天内完成一次对话或任务你得 **50 Credits**；好友注册后 7 天内累计 3 天完成对话或任务你得 **100 Credits**；好友注册后 30 天内完成首次订阅你得 **1,000 Credits**（好友另得 500）。",
    "tips": "⚠️ 端内实测：当前已无免费模型，每日 100 Credits 仍发放但生成排队严重、可用性差，仅作防衰减备份。国内网络直连低延迟，官方 CLI 与 TokenTracker 的 Qoder CN 卡片都能读到实时额度，无需手动填 token；错过 10:00 时段不补发，赠额自到账起 30 天有效；邀请奖励在活动页「邀请好友接着赚」进度查看。速度与排队：2026-11-12 站主实测**速度特别慢、最近用的人多、高峰时段经常排队**，赶时间的任务建议错峰或搭配其他路由。",
    "officialUrl": "https://qoder.cn",
    "inviteUrl": "https://qoder.cn/activities?referral_code=4AeeJV7RcGt85vY11RcIA0Hce70qQ3dG",
    "inviteCode": "4AeeJV7RcGt85vY11RcIA0Hce70qQ3dG",
    "hasInvite": true,
    "checkedAt": "2026-11-11",
    "sourceUrl": "https://docs.qoder.cn/events/invite-friends"
  },
  {
    "id": "qoder",
    "retired": true,
    "retiredDeal": {"label":"模型限时免费","detail":"Qoder 国际版此前的免费模型调用福利已下线（站主实测）；国际版当前的 Qoduck 每日限免以端内为准。"},
    "name": "Qoder (国际版)",
    "sortNames": [
      "QODER GUOJIBAN",
      "QODER INTERNATIONAL"
    ],
    "provider": "qoder",
    "category": [
      "featured",
      "client",
      "daily_claim"
    ],
    "badge": "每日 10:00 后主动领 100 Credits",
    "badgeType": "rose",
    "tags": [
      "AI编程",
      "每日主动领取",
      "30天有效",
      "多模型支持"
    ],
    "description": "面向专业开发者的全流程 AI 编程工具。**每日 10:00 之后需在站内/客户端主动领取 100 Credits（30 天有效）**；新用户注册另赠初始额度；邀请好友注册并在 7 天内完成任务，你得 **50 Credits**。",
    "tips": "⚠️ 端内实测：当前已无免费模型，每日 100 Credits 仍发放但生成排队严重、可用性差，仅作防衰减备份。错过当日 10:00 时段不补发，也不累积；额度构成与消耗明细可在客户端用量页与 TokenTracker 的 Qoder 卡片对照查看。速度与排队：2026-11-12 站主实测**速度特别慢、最近用的人多、高峰时段经常排队**，赶时间的任务建议错峰或搭配其他路由。",
    "inviteUrl": "https://qoder.com/activities?referral_code=gviloqaY80z3XxsS6W78IIy3uMK3qRlc",
    "officialUrl": "https://qoder.com",
    "inviteCode": "gviloqaY80z3XxsS6W78IIy3uMK3qRlc",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://docs.qoder.com/events/100credits"
  },
  {
    "id": "raccoon",
    "name": "商汤小浣熊 (Raccoon)",
    "sortNames": [
      "SHANGTANG XIAOHUANXIONG",
      "RACCOON"
    ],
    "provider": "raccoon",
    "category": [
      "featured",
      "client",
      "daily_claim"
    ],
    "badge": "新号任务最高 12,000 积分",
    "badgeType": "blue",
    "tags": [
      "商汤科技",
      "代码小浣熊",
      "办公小浣熊",
      "每日300积分"
    ],
    "description": "商汤科技旗下全能 AI 助手家族（代码小浣熊 + 办公小浣熊），官网已迁至 xiaohuanxiong.com（旧域名 raccoon.sensetime.com 已解析失败，新站以访问为准）。**新号任务最高 12,000 积分**（2026-11-11 官网任务页）：注册 +3,000、桌面端首登 +3,000、移动端首登 +3,000、受邀专属 +3,000（7 日活跃 1,000 + 首付 2,000）。免费版每日赠 300 积分：端内积分明细原文为「**每日积分每天 00:00 发放，默认当日 24:00 清零，当天登录后有效期延长至 7 天**」，网页/桌面/手机端共用同一账户（官网定价页另写「每日 0 点重置 · 不累计 · 仅限标准模型」，与端内「登录后延至 7 天」口径不同，以端内为准）。免费档没有签到任务（端内「赚取积分」页只有新人任务与邀请）——注意「500 积分/日」是个人升级版额度（¥29.9/月，含 500 积分/日 + 10,000 积分/月，双 11 期间 11.11 元起），不是免费档签到；企业版 1,000/日/人 + 30,000/月。积分到账与到期以端内「积分明细」页为准（2026-11-11 核对）。",
    "tips": "12,000 上限需分别装桌面端与手机端；免费版只有每日 300 积分自动到账，别把个人升级版的 500/日 当免费档；积分在个人中心「用量看板 → 积分明细」查看，以端内任务列表为准。",
    "officialUrl": "https://www.xiaohuanxiong.com",
    "hasInvite": false,
    "checkedAt": "2026-11-11",
    "sourceUrl": "https://xiaohuanxiong.com/events/tasks"
  },
  {
    "id": "sensenova",
    "name": "商汤日日新 (SenseNova)",
    "sortNames": [
      "SHANGTANG RIRIXIN",
      "SENSENOVA"
    ],
    "provider": "sensenova",
    "category": [
      "permanent_free"
    ],
    "badge": "双池各 12 万/5h + 120 万/周",
    "badgeType": "purple",
    "tags": [
      "大厂开放",
      "双池滚动",
      "12万积分/5h",
      "新用户需邀请码",
      "OpenAI兼容"
    ],
    "description": "**双泡池滚动赠送：通用积分池与 Flash-Lite 专属池各自每 5 小时滚动赠送 120,000 积分**（每周可领 120 万通用 + 120 万专属积分），兼容 OpenAI 规范。2026-11-04 起平台暂停公开注册、转入邀请码注册阶段（新用户可在注册页申请通道提交审核），已注册老用户的登录、接口调用与滚动赠送权益不受影响。",
    "tips": "额度按滑动窗口每 5 小时自动逐步恢复，统一 Base URL 为 https://token.sensenova.cn/v1。新用户需凭邀请码注册（可于注册页申请）；平台 2026-11-04 上线 GLM 5.3，旧版 glm-5.2 将于 2026-11-18 正式下线，需及时切换配置。",
    "officialUrl": "https://platform.sensenova.cn",
    "hasInvite": false,
    "checkedAt": "2026-11-09",
    "sourceUrl": "https://www.sensenova.cn/token-plan"
  },
  {
    "id": "teleagent",
    "name": "中国电信 TeleAgent (星辰智能体)",
    "sortNames": [
      "ZHONGGUO DIANXIN",
      "TELEAGENT"
    ],
    "provider": "teleagent",
    "category": [
      "featured",
      "client",
      "daily_claim",
      "monthly_claim"
    ],
    "badge": "四重福利，月最多赠 39,000 积分 + 邀请返积分",
    "badgeType": "rose",
    "tags": [
      "中国电信",
      "天翼AI",
      "执行式Agent",
      "邀请返积分"
    ],
    "description": "中国电信天翼 AI 打造的星辰超级智能体，基于星辰基础大模型，支持智能问答与跨软件自主执行任务。端内实测构成（2026-11-02 积分福利社）：每日登录积分 100（每日单独发放、各约一个月内有效）、月度积分赠礼 3,000（活动期内每月登录再送、当月有效）、首登即赠积分礼 3,000（活动期内首次登录，仅此一项 3 个月内有效）；另有工作日夜间（22:00～次日 8:00）积分消耗 5 折与积分福利社活动（当前含双 11 福利狂欢季 2026-11-01～11-30）。官方宣传「月最多 39,000 积分」与实测构成吻合（日签约 3,000/月 + 月度 3,000 + 首登 3,000 + 邀请上限 30,000，首登仅首月计入）。邀请有礼：好友注册并 7 日内首次登录，邀请人得 500 积分（1 年内有效），被邀请人得 3,000 积分（1 个月内有效），双方积分即时到账；每个账号仅可绑定一位邀请人且绑定后不可更改，当月邀请获得积分累计上限 30,000。",
    "tips": "已深度集成天翼云电脑等生态；积分在「我的权益 → 我的积分」查看明细与有效期（按扣减顺序排列、优先消耗较早到期的积分），邀请进度在端内邀请页跟踪。",
    "inviteUrl": "https://agent.teleai.com.cn/s/GBWCHZRGYA",
    "officialUrl": "https://www.teleai.com.cn",
    "inviteCode": "VLPEAF",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://www.teleai.com.cn/product/teleagent"
  },
  {
    "id": "trae_cn",
    "name": "TRAE CN",
    "sortNames": [
      "TRAE CN"
    ],
    "provider": "trae",
    "category": [
      "featured",
      "client",
      "daily_claim",
      "monthly_claim"
    ],
    "badge": "新户赠 2,000 · 受邀 3,000 · 每月登录 500",
    "badgeType": "rose",
    "tags": [
      "字节出品",
      "整合升级",
      "受邀一次性3000",
      "每月登录送500"
    ],
    "description": "字节跳动旗下 AI 编程平台，已整合 Trae Work CN 与 Trae Solo CN。官方口径（2026-11-02 计费文档核对）：新用户注册一次性赠 2,000 积分（31 个自然日有效，原 2,500 口径已更新）；受邀新人经邀请链接注册并登录桌面端一次性 3,000 积分（活动页口径 500+2,500；计费文档标准邀请为双方各 500）；新增每月登录赠送 500 积分（当月有效，免费与会员档均有）；每日签到免费档 100、会员档 200。大学生实名认证再送 2,000 一项本轮无官方页佐证，待端内确认。采用动态积分计费，可调多款主流模型。",
    "tips": "客户端左下角头像或任务中心每日签到领分；积分自发放起 31 天内有效，签到积分为专属消耗积分，受邀奖励以活动页口径为准，学生认证赠额以端内实测为准。",
    "inviteUrl": "https://www.trae.cn/events/code-fission/4D3RZS33QK4N?utm_source=copy_link&utm_medium=code_fission",
    "officialUrl": "https://www.trae.cn",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://docs.trae.cn/ide_plans-and-billing"
  },
  {
    "id": "trae",
    "name": "TRAE (国际版)",
    "sortNames": [
      "TRAE GUOJIBAN",
      "TRAE INTERNATIONAL"
    ],
    "provider": "trae",
    "category": [
      "client",
      "monthly_claim"
    ],
    "badge": "免费档每月 $1 额度 + 5,000 次自动补全",
    "badgeType": "success",
    "tags": [
      "字节出品",
      "国际版",
      "每月免费额度",
      "自动补全"
    ],
    "description": "字节跳动 AI 编程平台 TRAE 的国际版（trae.ai），与国内版 TRAE CN 账号体系相互独立。免费档每月 $1 模型调用额度与 5,000 次自动补全（2026-11-02 端内 Usage 页实测：Free plan $1.00/月、按月重置；官方价格页已不再标注 $1 字样，以端内实测为准）；无邀请活动。",
    "tips": "用量与重置时间在站内「Usage」页查看；国内版（trae.cn）的新人积分与签到福利另见其卡片，两版账号互不互通。",
    "officialUrl": "https://www.trae.ai",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://www.trae.ai/pricing"
  },
  {
    "id": "unisound_maas",
    "name": "云知声 MaaS (Unisound)",
    "sortNames": [
      "YUNZHISHENG",
      "UNISOUND"
    ],
    "provider": "unisound",
    "category": [
      "permanent_free"
    ],
    "badge": "实名领一个月会员 + Free 档每周 2500 积分",
    "badgeType": "success",
    "tags": [
      "云知声官方",
      "注册+实名一次性会员",
      "语音/OCR/医疗",
      "Agent 工具兼容"
    ],
    "description": "云知声 Token Hub（MaaS 平台）：注册并完成实名认证可免费领取一个月会员（一次性，站主 2026-11-03 端内实测）；Free 档 ¥0/月、每周 2,500 积分（每周刷新），套餐内含 U2-Flash（编程/办公）、U2-Med（专业医疗）及 OCR、语音识别/合成等权益额度——实测 Free 档账号权益参考：u2-ocr 737.5 万 tokens、u2-ocr-med 737.5 万 tokens、u2-radimed 47.5 万 tokens、u2-asr 8 小时、u2-tts 4 万字（均属套餐内权益，非额外赠送）。平台兼容 OpenCode、TRAE、WorkBuddy、Claude 等主流 Agent 工具接入。",
    "tips": "一个月会员为一次性领取，活动口径以站内为准；各模型额度随套餐档位不同，以控制台显示为准。",
    "officialUrl": "https://maas.unisound.com",
    "hasInvite": false,
    "checkedAt": "2026-11-03",
    "sourceUrl": "https://maas.unisound.com/token-plan"
  },
  {
    "id": "vyceai",
    "name": "Vyce AI",
    "sortNames": [
      "VYCE AI"
    ],
    "provider": "vyceai",
    "category": [
      "featured",
      "big_quota",
      "daily_claim",
      "gateway"
    ],
    "badge": "注册送 $50 · 每日签到 $10 · 邀请双方各 $10",
    "badgeType": "success",
    "tags": [
      "海外平台",
      "双协议兼容",
      "OpenCode接入",
      "邀请返利"
    ],
    "description": "海外聚合网关（注册有一定网络门槛），OpenAI 与 Anthropic 双协议兼容，任意客户端/IDE 把 base URL 指向 https://vyceai.com/v1 即用，内置 OpenCode/光标/Cline 一键接入教程。实测模型可用：注册即送 $50 体验金，每日签到再得 $10。免费用户可用 4 款（按牌价计费、消耗注册金/签到金）：Claude Sonnet 4.6、DeepSeek V4.1 Flash、Agnes 3.0 Flash 均无日限额；GPT 6 Luna 单独带日限额 50M。另 Promotional Allowance 每日 10M 统一配额（GLM 5.3 Flash、Beam 1.0、Nemotron，$0，UTC 00:00 重置）。邀请计划：好友经链接注册，双方各得 $10 瞬时到账。稳定性提示（2026-11-11 端内核对）：该站近期服务不稳，多次出现模型不可用/网关报错，且必须海外网络环境，体验波动概率明显高于同价位聚合站；按稳定性折算后档位下调为蓝，建议只作备用线路。",
    "tips": "免费档按牌价计费、消耗注册金与签到金；付费 Lite/Pro 解锁 DeepSeek 4.1 Flash 1017、GPT 5.6 Sol/Terra、GPT 6 Astra（维护中）、Claude Sonnet 4.6 Pro。价格须知：站内牌价为转售价、显著高于官方刊例（如 gpt-6-luna 站内 $2/M、官方刊例 $0.10/M，溢价约 20 倍），注册金与签到金消耗更快；TokenTracker 面板金额按官方刊例折算，与站内账单口径不同属正常。模型列表实时变动，接入前先看「模型列表」页。",
    "inviteUrl": "https://vyceai.com/signup?ref=VYCE_868RV5",
    "officialUrl": "https://vyceai.com",
    "inviteCode": "VYCE_868RV5",
    "hasInvite": true,
    "checkedAt": "2026-11-11",
    "sourceUrl": "https://vyceai.com"
  },
  {
    "id": "workbuddy_intl",
    "retired": true,
    "retiredDeal": {"label":"模型限时免费","detail":"DeepSeek-V4.1-Flash 免费调用已停止（2026-10-31 截止，2026-11-02 站主实测下线）；HY3 模型仍可免费调用，每月积分福利不受影响。"},
    "name": "WorkBuddy AI (国际版)",
    "sortNames": [
      "WORKBUDDY AI GUOJIBAN",
      "WORKBUDDY AI INTERNATIONAL"
    ],
    "provider": "workbuddy-ai",
    "category": [
      "client",
      "daily_claim",
      "monthly_claim"
    ],
    "badge": "每月 1 日送 100 积分 + 每日对话次日送 30（端内实测）",
    "badgeType": "blue",
    "tags": [
      "AI客户端",
      "国际版",
      "独立账号体系",
      "HY3免费调用"
    ],
    "description": "WorkBuddy 国际版（workbuddy.ai），与国内版（workbuddy.cn）账号体系相互独立。现行福利：每月 1 日发放 100 积分，当日完成对话次日 30 积分自动到账（2026-11-01 端内实测，以端内为准；国内版已改为每日签到 100，两版规则不同，勿混用）；DeepSeek-V4.1-Flash 免费调用已停止（2026-11-02 站主实测；此前 2026-10-31 截止口径 11-01 尚在、现已下线）；HY3 模型仍可免费调用（2026-11-02 站主实测）。邀请活动（2026-11-11 端内邀请弹窗核对）：好友经你的邀请链接注册并完成首次提问后，**你得 100 积分、好友得 350 积分（100 邀请积分 + 250 新人积分）**；邀请记录在端内「邀请记录」页查看。",
    "tips": "与国内版（workbuddy.cn）互不共享账号与积分；积分有效期以端内为准，用量与发放记录在站内「余额及用量」页查看。",
    "officialUrl": "https://www.workbuddy.ai",
    "hasInvite": true,
    "inviteUrl": "https://workbuddy.ai/invite?code=A7CYB69E",
    "inviteCode": "A7CYB69E",
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://www.workbuddy.ai"
  },
  {
    "id": "workbuddy",
    "name": "WorkBuddy 国内版",
    "sortNames": [
      "WORKBUDDY GUONEIBAN",
      "WORKBUDDY CN"
    ],
    "provider": "workbuddy",
    "category": [
      "featured",
      "client",
      "daily_claim",
      "monthly_claim"
    ],
        "badge": "注册送 250 Credits + 每月发放 500 基础积分 + 每日签到 100（端内实测）",
    "badgeType": "rose",
    "tags": [
      "AI客户端",
      "每日签到积分",
      "每月基础积分",
      "邀请返利"
    ],
    "description": "全能 AI 工作台国内版：**新用户注册送 250 积分**，**每月发放 500 基础积分**，**每日签到 100 积分**（2026-11-11 端内实测，以端内为准；旧口径「完成对话次日送 30」已废）；新人任务另有大量一次性积分，在端内「任务中心」完成即可领取。积分直接在客户端内抵扣模型消耗。模型侧：**HY3 模型目前仍可免费调用（2026-11-02 站主实测）**。官方现行活动为「双十一限时 · 双倍 Credits」：活动期新购/续费/扩容按账号数与时长赠送等量积分（2026-11-11 官方产品页核对）。",
    "tips": "客户端/工作台形态，适合日常桌面交互；加入 Buddy One 关联产品可把积分共享到腾讯文档、ima、腾讯网盘 AI 功能（限时再送 100 积分，暂不支持解绑）；每日奖励积分约 30 天过期清零、按到期先后优先消耗（以端内显示为准）。国际版 WorkBuddy AI（workbuddy.ai）与本版账号体系相互独立，另见其卡片。",
    "inviteUrl": "https://www.workbuddy.cn/events/invite?inviteCode=hppwvxg4sgqw",
    "officialUrl": "https://www.workbuddy.cn",
    "inviteCode": "hppwvxg4sgqw",
    "hasInvite": true,
    "checkedAt": "2026-11-11",
    "sourceUrl": "https://www.workbuddy.cn"
  },
  {
    "id": "zcode",
    "name": "ZCode (Z.AI 编程智能体)",
    "sortNames": [
      "ZCODE",
      "Z AI"
    ],
    "provider": "zcode",
    "category": [
      "client",
      "featured"
    ],
    "badge": "端内每晚 3 亿 GLM-5.3-Flash（当期活动）",
    "badgeType": "amber",
    "tags": [
      "智谱出品",
      "编程智能体",
      "晚间限时福利",
      "限时3亿额度",
      "邀请有礼"
    ],
    "description": "Z.ai 官方编程智能体客户端，GLM 系列模型直连、登录即用。**2026-11-11 核对：端内正在放送 GLM-5.3-Flash 3 亿 Token 大额额度：每晚限时，国内版与国际版客户端都有**——当期活动、不是长期固定福利；此前的档期为零星放送与每周五晚大额（5 亿级）。常驻：**新用户连接 BigModel 账号后首次使用起 5 天内，每天有 GLM-5.3 300 万 + GLM-5.3-Flash 500 万 Token（两模型独立分额、每日刷新，2026-11-10 官方页核实）**。活动时段与额度一律以端内公告为准（官方文档不收录该类活动）。邀请活动进行中：邀请新用户及每周邀请满 2 位、10 位均有登录卡类梯度奖励（卡型与到账以端内奖励中心为准）。",
    "tips": "限时额度类活动不定期出现，近期每晚都有，建议每天晚间登录客户端查看；配合 TokenTracker Plus 的 ZCode 用量卡片可实时核对到账额度与生成速率。邀请奖励在端内「奖励中心」查看进度。",
    "officialUrl": "https://z.ai",
    "inviteUrl": "https://zcode.z.ai/invite/DU7JA29Y",
    "inviteCode": "DU7JA29Y",
    "hasInvite": true,
    "checkedAt": "2026-11-11",
    "sourceUrl": "https://z.ai"
  },
  {
    "id": "zcode_intl",
    "name": "ZCode 国际版 (Z.AI)",
    "sortNames": [
      "ZCODE GUOJIBAN",
      "ZCODE INTERNATIONAL"
    ],
    "provider": "zcode",
    "category": [
      "client",
      "featured"
    ],
    "badge": "端内每晚 3 亿 GLM-5.3-Flash（国际版当期活动）",
    "badgeType": "amber",
    "tags": [
      "国际版",
      "智谱出品",
      "编程智能体",
      "晚间限时福利",
      "限时3亿额度"
    ],
    "description": "Z.ai 国际版编程智能体客户端（z.ai 国际站账号体系），GLM 系列模型直连、登录即用。**2026-11-12 站主实测：国际版端内同样在放送 GLM-5.3-Flash 3 亿 Token 大额额度，每晚限时**——当期活动、不是长期固定福利；档期与额度以国际版端内公告为准。常驻：新用户连接 Z.AI 账号后首次使用起 5 天内，每天有 GLM-5.3 300 万 + GLM-5.3-Flash 500 万 Token（两模型独立分额、每日刷新）。",
    "tips": "国际版与本地下载的国内版是两套账号体系，邀请与奖励不互通；晚间活动建议两端各登录看一下。",
    "officialUrl": "https://zcode.z.ai",
    "hasInvite": false,
    "checkedAt": "2026-11-12",
    "sourceUrl": "https://zcode.z.ai"
  }
];

PERK_PROVIDERS.sort(comparePerks);
