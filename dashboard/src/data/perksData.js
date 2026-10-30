/**
 * 服务商福利指南数据源
 * 包含各个可以免费试用、领取初始额度、每日刷新、签到或具备邀请福利的 AI 服务商与客户端。
 * 每个卡片均配备「专属邀请/优惠注册」与「官网直达」双链接。
 * 所有服务商卡片按标准中文拼音与英文首字母分类归桶排序（A-Z），不分先后。
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
    "id": "free_tier",
    "label": "永久/每日免费"
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
    "id": "agentrouter",
    "name": "Agent Router",
    "provider": "agentrouter",
    "category": [
      "big_quota",
      "free_tier"
    ],
    "badge": "⚠️ 服务维护中 / 暂时不可用",
    "badgeType": "rose",
    "tags": [
      "美元赠额",
      "每日签到",
      "多模型路由",
      "海外网络"
    ],
    "description": "⚠️ 近期服务接口暂时不可用或维护中，官方正在排查恢复中。新注册或历史用户额度保留，建议关注官方恢复公告；日常开发可选用其他高可用路由备用。",
    "tips": "恢复后新用户注册送 $125 额度，每日签到可领 $25 额度，邀请双方各得 $50 无限累计，额度不过期。",
    "inviteUrl": "https://agentrouter.org/register?aff=tt0I",
    "officialUrl": "https://agentrouter.org",
    "inviteCode": "tt0I",
    "hasInvite": true
  },
  {
    "id": "agnes",
    "name": "agnes AI",
    "provider": "agnes",
    "category": [
      "free_tier"
    ],
    "badge": "自研三大主力无限期免费",
    "badgeType": "success",
    "tags": [
      "无限期免费",
      "20 RPM 限速",
      "长上下文",
      "多模态"
    ],
    "description": "自研文本、图像、视频三大主力模型无限期免费开放，支持 512K 超长上下文窗口。免费档享有 20 RPM 速率，中文理解与生成表现扎实。",
    "tips": "选自定义服务商输入端点即可接入，官方无限期免费，适合长期稳定跑任务。",
    "officialUrl": "https://agnes-ai.com",
    "hasInvite": false
  },
  {
    "id": "qwen",
    "name": "阿里百炼 (通义千问 Qwen)",
    "provider": "alibaba",
    "category": [
      "featured",
      "big_quota"
    ],
    "badge": "各模型各送 100 万 Tokens（90天）",
    "badgeType": "amber",
    "tags": [
      "阿里大厂",
      "多模型独立送",
      "用完即停安心模式",
      "全系覆盖"
    ],
    "description": "阿里云大模型一站式服务平台。新用户首次开通后，针对 Qwen 各个不同版本规格（Max、Plus、Flash 等）均独立赠送 100 万 Tokens 免费体验额度（自开通起 90 天有效）。",
    "tips": "免费额度默认在华北2（北京）地域实时推理生效；建议在控制台开启「免费额度用完即停」开关，避免额度耗尽后产生按量扣费。",
    "officialUrl": "https://bailian.console.aliyun.com",
    "hasInvite": false
  },
  {
    "id": "bai",
    "name": "B.AI",
    "provider": "bai",
    "category": [
      "client"
    ],
    "badge": "⚠️ 需充值或会员（无初始免费）",
    "badgeType": "rose",
    "tags": [
      "多模型体验",
      "需充值使用",
      "Plan Pro",
      "网页轻量"
    ],
    "description": "⚠️ 官方规则实测核实：平台目前所有渠道注册与邀请均不赠送免费积分与体验额度，必须充值 Credits 或订阅会员（Plan Pro $200/月）后才能发起调用。",
    "tips": "平台无初始免费赠额，采用严格预付费制；预算充沛的高频用户可开通会员，轻量体验开发者建议选用其他具有免费档的服务商。",
    "inviteUrl": "https://chat.b.ai/chat?invite_code=FBRP3G",
    "officialUrl": "https://chat.b.ai",
    "inviteCode": "FBRP3G",
    "hasInvite": true
  },
  {
    "id": "deepseek",
    "name": "DeepSeek 官方开放平台",
    "provider": "deepseek",
    "category": [
      "featured",
      "big_quota"
    ],
    "badge": "官方极低资费 + 新户体验额度",
    "badgeType": "blue",
    "tags": [
      "官方直达",
      "顶级推理",
      "低廉单价",
      "开源领军"
    ],
    "description": "DeepSeek 官方 API 开放平台。新注册并通过实名认证用户通常可获赠体验额度（以官方额度中心实时政策为准）。API 兼容 OpenAI 格式，输入定价低至 ¥0.14~¥0.27/百万 Tokens，推理性能业界领先。",
    "tips": "官方不设第三方邀请机制，直接前往官网控制台注册即可；如遇官方充值或服务拥堵，可搭配第三方聚合路由作为高可用热备。",
    "officialUrl": "https://platform.deepseek.com",
    "hasInvite": false
  },
  {
    "id": "doubaowork",
    "name": "豆包工作 (Doubao Work)",
    "provider": "doubao",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "首次登录送30天体验包 + 签到领8800额度",
    "badgeType": "success",
    "tags": [
      "字节大厂",
      "30天体验包",
      "每日签到翻倍",
      "AI办公Agent",
      "优先消耗"
    ],
    "description": "首次登录豆包电脑版或豆包工作电脑版的新用户，可直接领取 30 天免费体验套餐（除生视频、Pro 模型外全功能可用，30 天内有效且优先消耗）。所有新老用户还可参与每日签到活动：每天签到得 200 额度，周一额度翻倍；累计达 500、2000、5000 额度里程碑再分别额外奖 200、500、1300 额度，累计签到 30 天最高可领 8800 额度。",
    "tips": "下载豆包电脑版或豆包工作电脑版后，通过左下角签到弹窗或点击头像侧边栏「免费用豆包」即可参与；签到额度立即生效且优先消耗。官方直达体验，无第三方邀请机制。",
    "officialUrl": "https://doubao.com/work",
    "hasInvite": false
  },
  {
    "id": "siliconflow",
    "name": "硅基流动 (SiliconFlow)",
    "provider": "siliconflow",
    "category": [
      "featured",
      "big_quota"
    ],
    "badge": "注册送 ¥14 额度 + 邀请送 ¥14",
    "badgeType": "amber",
    "tags": [
      "主流聚合",
      "送2000万Tokens",
      "极速推理",
      "小模型免费"
    ],
    "description": "注册即送 ¥14 额度（约 2000 万 Tokens），填写邀请码双方再各得 ¥14（2000 万 Tokens）。聚合 DeepSeek、Qwen 等主流开源大模型，部分小参数模型永久免费开放并发调用。",
    "tips": "额度支持各类第三方客户端接入；新注册建议填写邀请码获得双倍额度，充值亦常设阶梯返赠。",
    "inviteUrl": "https://cloud.siliconflow.cn/i/667oBtc0",
    "officialUrl": "https://cloud.siliconflow.cn",
    "inviteCode": "667oBtc0",
    "hasInvite": true
  },
  {
    "id": "scnet",
    "name": "国家超算互联网 (SCNet)",
    "provider": "scnet",
    "category": [
      "big_quota",
      "free_tier"
    ],
    "badge": "注册送 1000 万 + 0.1 元购 5000 万",
    "badgeType": "purple",
    "tags": [
      "国家级算力",
      "送1000万Tokens",
      "0.1元5000万",
      "夜间限免"
    ],
    "description": "MaaS 特惠活动升级：注册即送 GLM-5-Base 模型 10,000,000 Tokens；新用户更可享 0.1 元秒杀购买 5000 万 Tokens（含 DeepSeek-V4.1-Flash-1017 与 GLM-5.3-Flash）；Token Plan 订阅用户享有限时夜间权益（每晚 21:00 至次日 09:00 免费调用 Auto 模型）。",
    "tips": "国家超算中心算力储备充沛，适合批处理与大规模推理；0.1 元资源包建议在控制台特惠区及时认领；Token Plan 限时夜间免费权益（21:00-09:00）今晚（10 月 30 日）为活动期最后一天。",
    "officialUrl": "https://www.scnet.cn",
    "hasInvite": false
  },
  {
    "id": "huawei_codearts",
    "name": "华为 CodeArts Agent (华为云码道)",
    "provider": "codearts",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "开通送积分 + 成长中心每日签到",
    "badgeType": "rose",
    "tags": [
      "华为云",
      "代码智能体",
      "每日签到",
      "Spec驱动编程"
    ],
    "description": "华为云全新推出的真实软件工程 AI 编码智能体。采用新版积分计费制，首次开通或注册即可获得新人体验积分；个人版用户每日在成长中心打卡签到可领取专属福利积分。",
    "tips": "支持 IDE 插件与桌面客户端，多模型智能调度（DeepSeek、Kimi、GLM 等），签到积分随取随用。",
    "officialUrl": "https://www.huaweicloud.com/product/codearts.html",
    "hasInvite": false
  },
  {
    "id": "volcengine",
    "name": "火山方舟 (字节豆包大模型)",
    "provider": "volcengine",
    "category": [
      "featured",
      "big_quota"
    ],
    "badge": "每模型送 50 万 Tokens（长期有效）",
    "badgeType": "blue",
    "tags": [
      "字节大厂",
      "多模型赠送",
      "长期不过期"
    ],
    "description": "新用户注册火山引擎即可获赠每个模型 50 万 Tokens 推理额度，长期不过期；Coding Plan 可叠加 9.5 折优惠。覆盖全系列豆包与开源模型。",
    "tips": "在控制台创建推理接入点 (ep-xxx) 即可使用；若需要每日 200~500 万额度可按需申请协作奖励计划。",
    "inviteUrl": "https://volcengine.com/L/YPDTLsCOn8k/",
    "officialUrl": "https://www.volcengine.com/product/doubao",
    "inviteCode": "97QSJU7A",
    "hasInvite": true
  },
  {
    "id": "tokenrhythm",
    "name": "基元律动 (TokenRhythm)",
    "provider": "tokenrhythm",
    "category": [
      "featured",
      "big_quota"
    ],
    "badge": "实名送 ¥18 + 充值买一送一（多项10.30截止）",
    "badgeType": "purple",
    "tags": [
      "实名送18元",
      "邀请送18元",
      "充值买一送一",
      "模型特惠"
    ],
    "description": "实名认证即可获得 ¥18 额度；专属邀请双方均可额外获得 ¥18 额度（邀请活动 10 月 30 日截止）。限时活动：充值买一送一（11 月 13 日截止）；千问系列大模型半价，DeepSeek 全天谷价调用（10 月 30 日截止）。",
    "tips": "专属邀请各得 ¥18、千问模型半价、DeepSeek 全天谷价优惠将于今晚（10月30日 24:00）截止！实名认证获得的 ¥18 永久有效；充值买一送一活动持续至 11 月 13 日。",
    "inviteUrl": "https://tokenrhythm.studio/i/rf_tr_TPDUG7S1rl1vDrDMfcbY0dcC",
    "officialUrl": "https://tokenrhythm.studio",
    "hasInvite": true
  },
  {
    "id": "joycode",
    "name": "JoyCode (京东智能编码)",
    "provider": "joycode",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "每月免费送 10,000 积分",
    "badgeType": "amber",
    "tags": [
      "京东云",
      "AI编程助手",
      "每月万点",
      "上下文引擎"
    ],
    "description": "京东云推出的一体化 AI 智能编码助手与开发环境。具备仓级上下文理解（CSR）与规约驱动编程能力，个人开发者每个月固定赠送 10,000 免费积分，用于代码预测续写、智能生成与问答。",
    "tips": "支持 VS Code / JetBrains 插件与桌面客户端，每月积分自动充盈发放。",
    "officialUrl": "https://joycode.vip",
    "hasInvite": false
  },
  {
    "id": "longcat",
    "name": "美团 LongCat",
    "provider": "longcat",
    "category": [
      "big_quota"
    ],
    "badge": "注册送 1000 万 Tokens（双方互赠）",
    "badgeType": "amber",
    "tags": [
      "美团大厂",
      "送千万Tokens",
      "超长上下文"
    ],
    "description": "新户注册即享 1000 万 Tokens（30 天有效期）；使用邀请码注册双方各增 1000 万，叠加新人礼包最高可得 2000 万 Tokens。",
    "tips": "额度单次发放 30 天有效，请在有效期内使用；平台仅限个人与企业正常体验，禁止批量脚本调用。",
    "inviteUrl": "https://longcat.chat/platform/product?inviteCode=WABCQLL3",
    "officialUrl": "https://longcat.chat",
    "inviteCode": "WABCQLL3",
    "hasInvite": true
  },
  {
    "id": "minimax",
    "name": "MiniMax 开放平台",
    "provider": "minimax",
    "category": [
      "big_quota"
    ],
    "badge": "注册送 ¥15 代金券",
    "badgeType": "amber",
    "tags": [
      "国产大厂",
      "送15元代金券",
      "超逼真语音"
    ],
    "description": "国内自研大模型前沿厂商。新注册账户即送 ¥15 代金券（30 天有效），支持 MiniMax 全系列文本大模型以及行业领先的高拟真 Speech 语音合成 API。",
    "tips": "¥15 额度自注册日起 30 天内有效，建议尽早体验其文本与音色模型。",
    "officialUrl": "https://platform.minimaxi.com",
    "hasInvite": false
  },
  {
    "id": "minimax_code",
    "name": "MiniMax Code (智能编程助手)",
    "provider": "minimax",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "注册送初始额度 + 每日签到领积分",
    "badgeType": "amber",
    "tags": [
      "国产大厂",
      "M3系列模型",
      "每日签到",
      "极速代码Agent"
    ],
    "description": "MiniMax 专为开发场景打造的桌面 AI 编程 Agent。搭载 MiniMax M3 与 M3.1-Flash 轻量极速模型，新用户注册即赠送初始额度包，客户端支持每日签到累积 AI 积分与 Token 配额。",
    "tips": "下载 MiniMax Code 客户端登录账户，在个人中心积分页面每日打卡签到即可领分。",
    "officialUrl": "https://minimax.io",
    "hasInvite": false
  },
  {
    "id": "opencode",
    "name": "OpenCode Zen",
    "provider": "opencode",
    "category": [
      "free_tier"
    ],
    "badge": "Zen 计划限时免费 API",
    "badgeType": "neutral",
    "tags": [
      "编程专属",
      "限免模型",
      "OpenAI兼容"
    ],
    "description": "面向终端的 AI 编程平台。通过 Zen 计划开放了限时免费 API 接口，完全兼容 OpenAI 接口规范，轮换开放多款编程强化开源模型。",
    "tips": "使用 GitHub 或 Google 账号直接登录即可获取 Key，免费模型会定期轮换。",
    "officialUrl": "https://opencode.ai",
    "hasInvite": false
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "provider": "openrouter",
    "category": [
      "free_tier"
    ],
    "badge": "50+ 款免费开源模型",
    "badgeType": "neutral",
    "tags": [
      "全球聚合",
      "免绑信用卡",
      "永久免费档",
      "海外直连"
    ],
    "description": "全球领先的统一模型路由平台。聚合 50 多款带有 :free 标记的免费模型（包含 Llama、DeepSeek、Qwen 等开源版本），无需绑定支付方式即可直接调用。",
    "tips": "免费档每日有约 50 次基础速率限流，适合轻量测试与无成本探索。",
    "officialUrl": "https://openrouter.ai",
    "hasInvite": false
  },
  {
    "id": "qiniu",
    "name": "七牛云 (Qiniu Cloud)",
    "provider": "qiniu",
    "category": [
      "featured",
      "free_tier",
      "big_quota"
    ],
    "badge": "conatus-free 每天一亿免费额度",
    "badgeType": "success",
    "tags": [
      "每日一亿Tokens",
      "用完即停不扣费",
      "邀请返300万",
      "限免至11月底"
    ],
    "description": "七牛云 AI 推理限免福利：完成认证每日可享 1 亿 Token 免费额度，活动限时开放至 11 月底；免费模型端点 qiniu/conatus-free 用完即停绝不暗扣余额。专属邀请福利：好友通过链接首次体验即得 300 万 Token，邀请人立返 300 万 Token。",
    "tips": "专属模型 qiniu/conatus-free 仅消耗活动额度，每日用尽自动熔断停止，无意外扣费风险。",
    "inviteUrl": "https://s.qiniu.com/INbIn2",
    "officialUrl": "https://www.qiniu.com",
    "hasInvite": true
  },
  {
    "id": "qwen_work",
    "name": "千问办公 (QwenWork)",
    "provider": "alibaba",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "新用户注册送分 + 每日活跃与签到",
    "badgeType": "amber",
    "tags": [
      "阿里大厂",
      "一站式Agent",
      "直接交付产物",
      "打通钉钉"
    ],
    "description": "阿里巴巴推出的一站式 AI Agent 办公平台。支持直接生成 Word、PPT、Excel 与可用代码，新用户注册即享初始体验额度，日常支持登录、日常活跃任务与签到活动领取免费积分。",
    "tips": "支持 Windows / Mac 桌面客户端与网页端，可用手机号或钉钉扫码一键登录。",
    "officialUrl": "https://qwenwork.cn",
    "hasInvite": false
  },
  {
    "id": "qoder",
    "name": "Qoder (国际版)",
    "provider": "qoder",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "注册送积分 + 每日登录领积分",
    "badgeType": "blue",
    "tags": [
      "AI编程",
      "每日登录送分",
      "多模型支持"
    ],
    "description": "面向专业开发者的全流程 AI 编程工具。新用户注册即可领取初始额度积分；每日登录客户端即可领取登录奖励积分，支持持续积攒用于模型编写与代码补全。",
    "tips": "登录客户端即可自动签到领取积分；官方提供灵活的积分包与订阅方案。",
    "officialUrl": "https://qoder.com",
    "hasInvite": false
  },
  {
    "id": "qoder_cn",
    "name": "Qoder CN (腾讯云)",
    "provider": "qoder-cn",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "腾讯云注册送积分 + 每日签到",
    "badgeType": "blue",
    "tags": [
      "腾讯云",
      "国内免翻",
      "每日登录领分"
    ],
    "description": "腾讯云专为国内开发者打造的 Qoder 国内版。支持微信或腾讯云账号一键登录，新用户注册即可获赠初始体验积分，每日登录客户端或打卡即可领取日常额度。",
    "tips": "国内网络直连低延迟，支持配合腾讯云资源包与优惠活动使用。",
    "officialUrl": "https://qoder.cloud.tencent.com",
    "hasInvite": false
  },
  {
    "id": "sensenova",
    "name": "商汤日日新 (SenseNova)",
    "provider": "sensenova",
    "category": [
      "free_tier"
    ],
    "badge": "双积分池每5小时滚动12万积分",
    "badgeType": "amber",
    "tags": [
      "大厂开放",
      "双池滚动",
      "12万积分/5h",
      "OpenAI兼容"
    ],
    "description": "全新升级双积分池与 5 小时滑动窗口机制：通用积分池每 5 小时刷新 60,000 积分（周上限 60 万），Flash-Lite 专属积分池每 5 小时刷新 60,000 积分（周上限 60 万），合计每 5 小时可享 120,000 积分。支持 SenseNova 6.7/6.8 Flash-Lite 等轻量多模态模型。",
    "tips": "额度按滑动窗口每 5 小时自动逐步恢复，无需手动重置；统一 Base URL 为 https://token.sensenova.cn/v1，完全兼容 OpenAI / Anthropic 规范。",
    "officialUrl": "https://platform.sensenova.cn",
    "hasInvite": false
  },
  {
    "id": "raccoon",
    "name": "商汤小浣熊 (Raccoon)",
    "provider": "raccoon",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "注册送积分 + 每日签到与任务领额度",
    "badgeType": "purple",
    "tags": [
      "商汤科技",
      "代码小浣熊",
      "办公小浣熊",
      "每日签到"
    ],
    "description": "商汤科技旗下全能 AI 助手家族（包含代码小浣熊与办公小浣熊）。新用户注册即赠送 3000~6000 初始积分，客户端与网页端支持每日签到与活跃任务，持续积攒模型对话与代码生成额度。",
    "tips": "支持 IDE 插件与独立桌面客户端，在个人中心「用量看板」即可每日签到打卡。",
    "officialUrl": "https://www.xiaohuanxiong.com",
    "hasInvite": false
  },
  {
    "id": "intern_inkstone",
    "name": "书生·端砚 (Intern InkStone)",
    "provider": "intern_inkstone",
    "category": [
      "free_tier"
    ],
    "badge": "每月免费领 10,000 墨点",
    "badgeType": "purple",
    "tags": [
      "上海AI实验室",
      "科研工作台",
      "每月领墨点",
      "OpenAI兼容"
    ],
    "description": "上海人工智能实验室（Shanghai AI Lab）打造的端到端全链路科学发现与科研工作台。推出「墨点计划」（Token Plan），用户每月可免费领取 10,000 墨点，可折算兑换数千万 Token，调用多元科研大模型与工具。",
    "tips": "支持兼容 OpenAI / Anthropic 规范的 API 接口，登录控制台即可领取当月墨点。",
    "officialUrl": "https://discovery.intern-ai.org.cn",
    "hasInvite": false
  },
  {
    "id": "trae_cn",
    "name": "TRAE CN",
    "provider": "trae",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "注册送 5000 积分 + 每日签到 200",
    "badgeType": "blue",
    "tags": [
      "字节出品",
      "整合升级",
      "学生认证送2000"
    ],
    "description": "字节跳动旗下 AI 编程平台，现已全面整合 Trae Work CN 与 Trae Solo CN 为全新 TRAE CN。专属邀请注册送 5,000 积分，每日签到领 200 积分，大学生实名认证额外送 2,000 积分。采用动态积分计费制，支持调用多款主流模型。",
    "tips": "客户端左下角头像或任务中心每日签到即可领分；积分自发放起 31 天内有效，签到积分为专属消耗积分。",
    "inviteUrl": "https://www.trae.cn/work-fission/QDQFB68Z8AUM?utm_source=copy_link&utm_medium=friends_invite",
    "officialUrl": "https://www.trae.cn",
    "hasInvite": true
  },
  {
    "id": "tuanjie_cowork",
    "name": "团结 Cowork (Tuanjie AI)",
    "provider": "tuanjie-cowork",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "每日领 300 积分 + 注册送新人礼",
    "badgeType": "blue",
    "tags": [
      "Unity中国",
      "游戏引擎AI",
      "每日打卡300分"
    ],
    "description": "Unity 中国官方打造的智能协作与编程助手。新用户注册即赠送初始体验积分包；在积分任务中心每日完成打卡签到可固定领 300 积分，用于兑换 AI 助手 Codely 的模型额度。",
    "tips": "登录网页端管理后台（codely.tuanjie.cn）进入积分任务中心即可一键签到领取。",
    "officialUrl": "https://codely.tuanjie.cn",
    "hasInvite": false
  },
  {
    "id": "workbuddy",
    "name": "WorkBuddy",
    "provider": "workbuddy",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "注册送 5000 积分 + 每日签到（月入 3000+）",
    "badgeType": "purple",
    "tags": [
      "AI客户端",
      "打卡签到",
      "积分无上限"
    ],
    "description": "全能 AI 工作台。注册立享 5,000 积分；每日打卡签到得 100 积分，连续签到第 7 天直接送 1,000 积分；每月 1 号再发 500 积分；邀请双方各赠 500 积分且无上限。",
    "tips": "客户端/工作台形态，适合日常桌面交互；积分直接可在客户端内消耗多款主流模型。",
    "inviteUrl": "https://www.workbuddy.cn/events/invite?inviteCode=8li3k29hyh",
    "officialUrl": "https://www.workbuddy.cn",
    "inviteCode": "8li3k29hyh",
    "hasInvite": true
  },
  {
    "id": "spark",
    "name": "讯飞星火 (iFlytek Spark)",
    "provider": "spark",
    "category": [
      "free_tier",
      "big_quota"
    ],
    "badge": "Spark-X2.6 送 10 亿 Tokens + 端侧限免",
    "badgeType": "blue",
    "tags": [
      "1024开发者节",
      "送10亿Tokens",
      "Spark Lite永久免费",
      "端侧0元"
    ],
    "description": "1024 开发者节发布旗舰 Spark-X2.6（293B-A30B 稀疏 MoE、1M 上下文、全国产算力训练），新老用户注册+实名认证即可在星辰 MaaS 首页或模型广场免费领 10 亿 Tokens（开通后 31 天有效，每人限领一次）；端侧 Spark-X2.6-4B 限时免费（0 元/百万 tokens），与 10 亿互不占用；Spark Lite 规格 API 永久免费。",
    "tips": "进入星辰 MaaS 首页「Spark-X2.6 赋能开发者」或模型广场领取 10 亿大礼包；Lite 模型 API 零成本长期调用。",
    "officialUrl": "https://xinghuo.xfyun.cn/spark",
    "hasInvite": false
  },
  {
    "id": "loomy",
    "name": "讯飞 Loomy (桌面 AI 工作搭子)",
    "provider": "loomy",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "每日登录送 5000 积分 + 注册大礼",
    "badgeType": "success",
    "tags": [
      "科大讯飞",
      "桌面Agent",
      "每日5000积分",
      "本地办公安全"
    ],
    "description": "科大讯飞打造的桌面级 AI 工作搭子，主打本地化执行式智能体。新用户注册登录即可获得大量新人积分，每日登录客户端再固定赠送 5,000 积分；完成内置日常任务还可叠加丰厚积分奖励。",
    "tips": "客户端支持目录级隔离与本地数据隐私保障，支持接入微信/飞书/钉钉远程下发任务。",
    "officialUrl": "https://loomy.xunfei.cn",
    "hasInvite": false
  },
  {
    "id": "bigmodel",
    "name": "智谱开放平台 (BigModel / Z.AI)",
    "provider": "zhipu",
    "category": [
      "featured",
      "free_tier",
      "big_quota"
    ],
    "badge": "新户送 2000 万 + 全系 Flash 免费",
    "badgeType": "success",
    "tags": [
      "国内大厂",
      "Flash全系免费",
      "免翻直连",
      "兼容OpenAI"
    ],
    "description": "手机号注册即可使用，无需复杂认证。新用户赠送 2000 万 Tokens 体验大礼包；GLM 系列 Flash 模型全家桶（包含 GLM-4.7-Flash、GLM-4.5-Flash、GLM-4-Flash-250414 等）永久完全免费开放，速度极快、支持超长上下文。",
    "tips": "国内站为 bigmodel.cn，国际站为 z.ai，两端均全面支持 GLM Flash 系列免费调用；赠送的 2000 万额度可用于无缝体验 GLM-4 主力旗舰付费模型。",
    "inviteUrl": "https://www.bigmodel.cn/invite?icode=ZaL1bTUfl7pSnDADpfvDjHHEaazDlIZGj9HxftzTbt4%3D",
    "officialUrl": "https://bigmodel.cn",
    "inviteCode": "ZaL1bTUfl7pSnDADpfvDjHHEaazDlIZGj9HxftzTbt4=",
    "hasInvite": true
  },
  {
    "id": "autoclaw",
    "name": "智谱 AutoClaw (本地养龙虾)",
    "provider": "autoclaw",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "注册送体验额度 + 每日签到送 200 积分",
    "badgeType": "success",
    "tags": [
      "智谱出品",
      "一键安装Agent",
      "每日签到200",
      "国内/国际双版本"
    ],
    "description": "智谱 AI 推出的首款零门槛一键安装本地版 OpenClaw 智能体客户端。新用户提供初始体验额度，客户端支持每日签到领 200 免费积分，内置 50+ 技能（Skills）与 AutoGLM 浏览器自动化操作。",
    "tips": "国内版直达 autoclaw.zhipuai.cn（适合国内网络）；国际版为 autoclaw.z.ai（适配海外 IM 工具）。用户专属邀请链接稍后补充。",
    "officialUrl": "https://autoclaw.zhipuai.cn",
    "hasInvite": false
  },
  {
    "id": "teleagent",
    "name": "中国电信 TeleAgent (星辰智能体)",
    "provider": "teleagent",
    "category": [
      "client",
      "free_tier"
    ],
    "badge": "注册送 3000 积分 + 每日签到任务",
    "badgeType": "blue",
    "tags": [
      "中国电信",
      "天翼AI",
      "执行式Agent",
      "每日打卡"
    ],
    "description": "中国电信天翼 AI 打造的星辰超级智能体。基于星辰基础大模型，不仅支持智能问答，更能跨软件自主执行任务。新注册赠送初始积分，日常支持每日打卡签到与积分任务持续领额度。",
    "tips": "已深度集成天翼云电脑等生态，登录天翼 AI 开放平台个人中心即可参与每日签到。",
    "officialUrl": "https://www.teleai.com.cn",
    "hasInvite": false
  }
];
