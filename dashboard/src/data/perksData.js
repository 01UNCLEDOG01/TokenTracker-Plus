/**
 * 服务商福利指南数据源
 * 包含各个可以免费试用、领取初始额度、每日刷新、签到或具备邀请福利的 AI 服务商与客户端。
 * 每个卡片均配备「专属邀请/优惠注册」与「官网直达」双链接。
 * 所有服务商卡片按标准中文拼音与英文首字母分类归桶排序（A-Z），不分先后。
 *
 * 每行必须带 checkedAt（核对日期）与 sourceUrl（该轮核对所依据的页面），
 * 由 `npm run validate:perks` 校验结构与时效措辞。查不到官方公开口径的数字
 * 一律写「以站内为准」，不许编造具体额度。
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
    "id": "gateway",
    "label": "聚合平台"
  },
  {
    "id": "client",
    "label": "客户端/工作台"
  }
];

export const PERK_PROVIDERS = [  {
    "id": "qwen",
    "name": "阿里百炼 (通义千问 Qwen)",
    "provider": "alibaba",
    "category": [
          "featured",
          "big_quota"
    ],
    "badge": "在架模型各送 100 万 Tokens（90天）",
    "badgeType": "amber",
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
    "id": "doubaowork",
    "name": "豆包工作 (Doubao Work)",
    "provider": "doubao",
    "category": [
          "client",
          "daily_claim"
    ],
    "badge": "30天体验包 + 签到领额度 + 活动 100 额度",
    "badgeType": "success",
    "tags": [
      "字节大厂",
      "30天体验包",
      "每日签到",
      "活动领100额度",
      "邀请得重置"
    ],
    "description": "首次登录豆包电脑版或豆包工作电脑版的新用户，可直接领取 30 天免费体验套餐（除生视频、Pro 模型外全功能可用，30 天内有效且优先消耗）。新老用户还可参与每日签到：每天 200 额度、周一翻倍，累计 500 / 2000 / 5000 额度里程碑再额外奖 200 / 500 / 1300 额度。「豆包来了·免费领额度」活动：人人可领 100 额度，每用户限领 1 次，登录「豆包电脑版」激活，先输入活动口令可升级额度；连续签到 30 天合计可得 8,800 额度；邀请好友使用豆包电脑版，双方各得 1 次额度重置机会，最多可邀请 20 人。",
    "tips": "活动口令经 AI Agent 公益实训营等官方活动渠道发放，以活动页与官方社群为准；下载客户端后通过左下角签到弹窗或头像侧边栏「免费用豆包」参与签到，签到额度立即生效且优先消耗，签到额度的有效期以端内签到页规则为准。",
    "inviteUrl": "https://www.doubao.com/pc/desktop-fission/pro-trial/invited?inviteCode=WIbgDM5zbX",
    "officialUrl": "https://doubao.com/work",
    "inviteCode": "WIbgDM5zbX",
    "hasInvite": true,
    "checkedAt": "2026-10-31",
    "sourceUrl": "https://doubao.com/work"
  },
  {
    "id": "agnes",
    "name": "Agnes AI",
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
    "id": "siliconflow",
    "name": "硅基流动 (SiliconFlow)",
    "provider": "siliconflow",
    "category": [
      "featured",
      "big_quota",
      "gateway"
    ],
    "badge": "推荐官计划：每邀 1 人实名得 ¥16 代金券",
    "badgeType": "amber",
    "tags": [
      "主流聚合",
      "送2000万Tokens",
      "极速推理",
      "小模型免费"
    ],
    "description": "聚合 DeepSeek、Qwen 等主流开源大模型，部分小参数模型长期免费开放并发调用。推荐官计划（2026-11-01 实测）：已完成实名认证的用户可作推荐官，被邀请人完成注册及实名认证后，邀请人每邀 1 名得面值 ¥16 的全平台通用代金券 1 张，邀请人数与奖励次数不设上限、极速到账可追踪；注册端新户赠额的现行口径未核实（早期为注册送 ¥14），以站内余额为准。",
    "tips": "代金券全平台模型与服务均可使用；注意使用期限，领取后尽快在有效期内消耗（剩余/有效期以站内「费用明细」为准）；额度支持各类第三方客户端接入，充值亦常设阶梯返赠（活动档位以站内公告为准）。",
    "inviteUrl": "https://cloud.siliconflow.cn/i/667oBtc0",
    "officialUrl": "https://cloud.siliconflow.cn",
    "inviteCode": "667oBtc0",
    "hasInvite": true,
    "checkedAt": "2026-11-01",
    "sourceUrl": "https://www.siliconflow.cn/"
  },
  {
    "id": "agnes_web",
    "name": "Agnes AI 网页版",
    "provider": "agnes-web",
    "category": [
          "daily_claim"
    ],
    "badge": "每日登录领 600 时效积分",
    "badgeType": "success",
    "tags": [
      "网页版",
      "每日600时效积分",
      "谷歌/苹果登录",
      "时效/永久分账"
    ],
    "description": "Agnes AI 的网页版对话工作台（app.agnes-ai.com），需谷歌或苹果账号登录。实测每日登录免费领 600 时效积分（2026-11-01 到账，时效积分与永久积分分账核算）；无邀请活动。",
    "tips": "时效积分与永久积分分开核算，消耗顺序以站内为准；网页版与 API 平台（另见「Agnes AI」卡）账号互通、福利互不相干。",
    "officialUrl": "https://app.agnes-ai.com",
    "hasInvite": false,
    "checkedAt": "2026-11-01",
    "sourceUrl": "https://app.agnes-ai.com"
  },
  {
    "id": "scnet",
    "name": "国家超算互联网 (SCNet)",
    "provider": "scnet",
    "category": [
      "big_quota",
      "gateway"
    ],
    "badge": "0.1 元购 5000 万 Tokens + 新客赠 1000 万 GLM-5.3-Flash",
    "badgeType": "purple",
    "tags": [
      "国家级算力",
      "0.1元5000万",
      "批处理",
      "新客赠1000万GLM-5.3-Flash"
    ],
    "description": "MaaS 特惠：新用户 0.1 元秒杀购买 5000 万 Tokens 资源包（活动期 2026-08-13 至 2026-11-10，含 DeepSeek-V4.1-Flash-1017 与 GLM-5.3-Flash，每天 10:00 开启、每账号合计限购 1 次、售完即止）。现行注册赠额为官方「新客尝鲜」1000 万 GLM-5.3-Flash 量包（每账号限领 1 次，到账后 30 天有效，官方注明实际发放模型可能按供应调整）；夜间 21:00–09:00 免费调用 Auto 模型的限时权益已于 2026-10-30 结束。",
    "tips": "国家超算中心算力储备充沛，适合批处理与大规模推理；0.1 元资源包在控制台特惠区认领，赠额与限时权益以站内实时公告为准。",
    "officialUrl": "https://www.scnet.cn",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://www.scnet.cn/home/subject/maas/index.html"
  },
  {
    "id": "juflowai",
    "name": "飓流AI (JULIU AI)",
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
    "id": "huawei_codearts",
    "name": "华为 CodeArts Agent (华为云码道)",
    "provider": "codearts",
    "category": [
      "client",
      "daily_claim",
      "monthly_claim"
    ],
    "badge": "注册 4000 + 学生认证 4000 + 每日签到 100",
    "badgeType": "rose",
    "tags": [
      "华为云",
      "代码智能体",
      "每日签到100",
      "学生认证4000"
    ],
    "description": "华为云推出的真实软件工程 AI 编码智能体，2026-09-04 起改为积分计费。实测福利：新用户注册可领 4,000 积分，学生认证再领 4,000，个人版每日签到领 100 积分（官方另载个人版每月 2,000 积分额度）。官网落地页现挂「邀请好友领积分」入口（2026-11-02 核对，规则未公开，以端内为准）。",
    "tips": "支持 IDE 插件与桌面客户端，多模型智能调度（DeepSeek、Kimi、GLM 等）；官方两页口径不一：签到活动页写「当日领取当日有效」，个人订阅计费说明写「自发放之日起 30 天内有效」（签到活动期至 2026-12-31），以端内积分明细实际到期为准、积分按到期先后优先消耗；签到入口在成长中心，随取随用。",
    "inviteUrl": "https://devcloud.cn-north-4.huaweicloud.com/chat?source=dmzntgwlb&sourcead=dmzntgwlb1&invitecode=INV-taWTH2T2JcL8d0esH15UMseSLiQN99qbfeb5Gp50u21Mt01_mokNPORaI_CxM_LrKuoTZOJThp9prEXpEqLKxJIQWyMC6hxkWSbV1qmMNFT6eQVyw-81VuMzAonD1G1z-NMbHhOWdDYCrxKsgZHxDHIuFrDivfsf0lorAf7go8L-Ug",
    "officialUrl": "https://www.huaweicloud.com/product/codearts.html",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://www.huaweicloud.com/product/codearts.html"
  },
  {
    "id": "ant_ling",
    "name": "蚂蚁百灵 (Ant Ling)",
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
    "tips": "到账查看：百灵计费平台 → 财务管理 → 账户充值 → 赠送额度（悬停可见每张券的适用模型/剩余/有效期）；额度按金额抵扣、与原 Token 数量口径不可直接换算；旧模型 Ling-2.6-1T / Ring-2.6-1T / Ling-2.6-flash 将于 2026-11-15 下线，请切换新版模型。",
    "officialUrl": "https://developer.ant-ling.com",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://developer.ant-ling.com/zh-CN/docs/models/price"
  },
  {
    "id": "volcengine",
    "name": "火山方舟 (字节豆包大模型)",
    "provider": "volcengine",
    "category": [
          "featured",
          "big_quota",
          "permanent_free"
    ],
    "badge": "新户每模型 50 万 · 个人每日单模型 200 万",
    "badgeType": "blue",
    "tags": [
      "字节大厂",
      "多模型赠送",
      "每日限免额度"
    ],
    "description": "新用户注册火山引擎即获赠每个模型 50 万 Tokens 推理额度。协作奖励计划分级（2026-11-01 官方页核对）：领取个人权益 = 每日单模型 200 万免费 tokens；领取企业权益 = 完成认证后升级每日单模型 500 万免费 tokens。安心体验模式开启后仅消耗赠送额度、按量付费不产生额外费用，额度耗尽对应模型自动暂停；具体模型清单与有效期以控制台额度页实时为准。Coding Plan 可叠加折扣。另：Managed Agents 首次开通即赠免费额度包（30 小时 Agent 运行时 + 500 次 web_search 调用，每账号限一次、有效期 2 年，2026-11-02 官方价格文档核对）。",
    "tips": "在控制台创建推理接入点 (ep-xxx) 即可使用；赠额有效期与协作奖励档位变动频繁，领取前先看控制台「免费额度」页。",
    "inviteUrl": "https://volcengine.com/L/YPDTLsCOn8k/",
    "officialUrl": "https://www.volcengine.com/product/doubao",
    "inviteCode": "97QSJU7A",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
        "sourceUrl": "https://docs.volcengine.com/docs/ark/model-pricing"
  },
  {
    "id": "apigoto",
    "name": "APIGOTO",
    "provider": "apigoto",
    "category": [
      "featured",
      "big_quota",
      "gateway"
    ],
    "badge": "订阅制改版：PLUS 约6折 / PROX10 约5折",
    "badgeType": "success",
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
    "id": "tokenrhythm",
    "name": "基元律动 (TokenRhythm)",
    "provider": "tokenrhythm",
    "category": [
      "featured",
      "big_quota",
      "gateway"
    ],
    "badge": "实名送 ¥18 · 充值买一送一",
    "badgeType": "purple",
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
    "checkedAt": "2026-11-01",
    "sourceUrl": "https://tokenrhythm.studio/"
  },
  {
    "id": "autoclaw_intl",
    "name": "AutoClaw 国际版 (Z.AI)",
    "provider": "autoclaw",
    "category": [
          "client",
          "daily_claim"
    ],
    "badge": "国际版每日签到 500 credits",
    "badgeType": "success",
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
    "id": "autoclaw",
    "name": "AutoClaw 国内版 (智谱 AutoGLM)",
    "provider": "autoclaw",
    "category": [
      "client",
      "big_quota"
    ],
    "badge": "新户领 2 亿 tokens（¥120）+ 邀请最高赚 15000",
    "badgeType": "success",
    "tags": [
      "智谱出品",
      "一键安装Agent",
      "注册领2亿tokens",
      "邀请积分风暴"
    ],
    "description": "智谱 AI 推出的零门槛一键安装本地版 OpenClaw 智能体客户端（国内版），内置 50+ 技能（Skills）与 AutoGLM 浏览器自动化。2026-11-02 官网核对改版口径：新用户注册领取 2 亿 tokens（价值 120 元）；每日登录积分改为订阅档权益——连续包月基础 100/日、进阶 300/日、旗舰 600/日（入门档无），Coding Plan 按档每月首登赠积分（Lite 5,000/¥29、Pro 10,000/¥58、Max 26,000/¥109）。邀请活动在线（2026-11-02 活动页核对）：受邀新用户注册最高得 4,800 积分；邀请人每成功邀请 1 位好友注册并发起成功任务得 1,000 积分（最多 15 位、累计上限 15,000），好友付费月卡/加油包双方按购买积分（不含日积分）得 8%（百元以下档）～12%（百元及以上档）、可累积无上限；活动下线后邀请码即失效。",
    "tips": "国内版 autoclaw.zhipuai.cn、国际版 autoclaw.z.ai 两套安装互斥，只装一个；新用户在桌面端登录环节填写邀请码即可领奖励；端内积分福利以「我的积分」页实时为准。",
    "inviteUrl": "https://autoglm.zhipuai.cn/misc/autoclaw-invite?activity_id=autoclaw_fission&channel=fission&source_location=sidebar&target_app=autoclaw&target_app_version=2.1.0&os=win&IC=GX4HHVHS",
    "officialUrl": "https://autoclaw.zhipuai.cn",
    "inviteCode": "GX4HHVHS",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://autoclaw.zhipuai.cn"
  },
  {
    "id": "bigmodel",
    "name": "智谱开放平台 (BigModel / Z.AI)",
    "provider": "zhipu",
    "category": [
          "featured",
          "permanent_free",
          "big_quota"
    ],
    "badge": "老 Flash 系列免费（至下架）+ 新户赠额",
    "badgeType": "success",
    "tags": [
      "国内大厂",
      "老Flash免费",
      "免翻直连",
      "兼容OpenAI"
    ],
    "description": "手机号注册即可使用，无需复杂认证。老 Flash 系列（GLM-4.7-Flash、GLM-4.5-Flash、GLM-4-Flash-250414 等）免费开放，官方口径是免费至模型下架，而非承诺永久；新一代 GLM-5.3-Flash/FlashX 已按量计费（约 0.8–7 元/百万 Tokens，2026-11-02 定价页核对），勿与免费老 Flash 混淆。新用户体验礼包以站内额度中心为准（官方明确公开的是邀请双方各赠 2000 万 GLM-4.5-Air）。",
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
    "id": "longcat",
    "name": "美团 LongCat",
    "provider": "longcat",
    "category": [
          "big_quota"
    ],
    "badge": "上新福利老户送 500 万 · 邀请各 1000 万",
    "badgeType": "amber",
    "tags": [
      "美团大厂",
      "送千万Tokens",
      "实名互赠",
      "30天有效"
    ],
    "description": "新户注册赠送 1000 万 Tokens；每次新模型上线另发上线福利（2026-11-02 端内实测，LongCat-2.5 上线）：新用户 1000 万 tokens、老用户 500 万 tokens，自动到账（站主作为老户实收 500 万、有效期 30 天），缓存命中持续免费。邀请活动（2026-11-02 端内确认在线）：每成功邀请 1 位新用户完成实名认证，双方各得 1000 万 Tokens，奖励自发放起 30 天内有效；另有拼团返现最高 50%。",
    "tips": "赠额单次发放、30 天内用完；平台仅限个人与企业正常体验，禁止批量脚本调用。API 侧另有按量付费与资源包口径。",
    "inviteUrl": "https://longcat.chat/platform/product?inviteCode=WABCQLL3",
    "officialUrl": "https://longcat.chat",
    "inviteCode": "WABCQLL3",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://longcat.chat/platform/docs/zh/faq"
  },
  {
    "id": "qiniu",
    "name": "七牛云 (Qiniu Cloud)",
    "provider": "qiniu",
    "category": [
          "featured",
          "permanent_free",
          "big_quota"
    ],
    "badge": "conatus-free 每日 1 亿（活动至 2026-11-30）",
    "badgeType": "success",
    "tags": [
      "每日一亿Tokens",
      "用完即停不扣费",
      "邀请返300万",
      "充值可提至10亿"
    ],
    "description": "七牛云 AI 推理限免活动（2026-10-24 至 2026-11-30）：完成认证后每日 1 亿 Token 免费额度，单次充值超过 ¥100 可将每日额度提升至 10 亿 Token。免费端点 qiniu/conatus-free 用完即停，绝不暗扣余额。专属邀请：好友经链接首次体验得 300 万 Token，邀请人立返 300 万。",
    "tips": "qiniu/conatus-free 仅消耗活动额度，每日用尽自动熔断停止，无意外扣费风险；活动结束时间以官方活动页为准。",
    "inviteUrl": "https://s.qiniu.com/INbIn2",
    "officialUrl": "https://www.qiniu.com",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://www.qiniu.com/ai/free-models/conatus-2026"
  },
  {
    "id": "catpaw",
    "name": "美团妙手 (CatPaw)",
    "provider": "catpaw",
    "category": [
          "big_quota",
          "monthly_claim"
    ],
    "badge": "新户送 1,000 积分（1 年有效）+ 每月 200",
    "badgeType": "amber",
    "tags": [
      "美团出品",
      "AI编程平台",
      "注册送1000积分",
      "每月赠200积分"
    ],
    "description": "美团推出的妙手 (CatPaw) 平台，积分制计费。站主端内实测（2026-11-02 用量管理页）：新用户注册奖励 1,000 积分（自发放起一年内有效）；基础积分每月发放 200（当月有效）。积分余额与到账明细在「用量管理」页查看，套餐档位与升级入口在「套餐管理」页；积分适用范围与消耗规则以站内为准。",
    "tips": "每月基础积分的发放日与有效期以端内为准；失效积分可在用量管理页切换失效积分查看。",
    "officialUrl": "https://credit.catpaw.meituan.com",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://credit.catpaw.meituan.com/#/usage"
  },
  {
    "id": "cola",
    "name": "Cola (AI 拍档)",
    "provider": "cola",
    "category": [
          "client"
    ],
    "badge": "受邀注册得 3 天会员 + 2,000 Auto 积分",
    "badgeType": "amber",
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
    "id": "qwen_work",
    "name": "千问办公 (QwenWork)",
    "provider": "qwenwork",
    "category": [
          "client",
          "monthly_claim"
    ],
    "badge": "新户赠 300 积分 · 每月仅 100（福利缩水）",
    "badgeType": "amber",
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
    "id": "tuanjie_cowork",
    "name": "团结 Cowork (Tuanjie AI)",
    "provider": "tuanjie-cowork",
    "category": [
          "client",
          "daily_claim"
    ],
    "badge": "每日签到 300 积分",
    "badgeType": "blue",
    "tags": [
      "Unity中国",
      "游戏引擎AI",
      "每日打卡300分"
    ],
    "description": "Unity 中国官方打造的智能协作与编程助手。官方社区口径：积分任务中心每日签到固定领 300 积分，用于兑换 AI 助手 Codely 的模型额度；此前的新人注册礼包官网未公开说明，现行是否仍送以站内为准。",
    "tips": "登录网页端管理后台（codely.tuanjie.cn）进入积分任务中心即可一键签到领取；签到积分有效期为 8 天；签到中断一般不累计。",
    "officialUrl": "https://codely.tuanjie.cn",
    "hasInvite": false,
    "checkedAt": "2026-10-31",
    "sourceUrl": "https://codely.tuanjie.cn"
  },
  {
    "id": "sensenova",
    "name": "商汤日日新 (SenseNova)",
    "provider": "sensenova",
    "category": [
          "permanent_free"
    ],
    "badge": "双池各 12 万/5h + 120 万/周",
    "badgeType": "amber",
    "tags": [
      "大厂开放",
      "双池滚动",
      "12万积分/5h",
      "OpenAI兼容"
    ],
    "description": "双积分池 + 5 小时滑动窗口：通用积分池与 Flash-Lite 专属积分池各自每 5 小时 120,000 积分、每周 1,200,000 积分上限（合计每 5 小时 24 万、每周 240 万）。数值由 TokenTracker 直连官方额度接口实测，支持 SenseNova 6.7/6.8 Flash-Lite 等轻量多模态模型。",
    "tips": "额度按滑动窗口每 5 小时自动逐步恢复，无需手动重置；统一 Base URL 为 https://token.sensenova.cn/v1，完全兼容 OpenAI / Anthropic 规范。",
    "officialUrl": "https://platform.sensenova.cn",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://www.sensenova.cn/token-plan"
  },
  {
    "id": "cursor",
    "name": "Cursor (AI 代码编辑器)",
    "provider": "cursor",
    "category": [
      "client",
      "monthly_claim"
    ],
    "badge": "免费档无限期 · 限量 Agent/Chat 额度",
    "badgeType": "blue",
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
    "id": "raccoon",
    "name": "商汤小浣熊 (Raccoon)",
    "provider": "raccoon",
    "category": [
          "client",
          "daily_claim"
    ],
    "badge": "新号首登任务最多 6000 积分",
    "badgeType": "purple",
    "tags": [
      "商汤科技",
      "代码小浣熊",
      "办公小浣熊",
      "每日300积分"
    ],
    "description": "商汤科技旗下全能 AI 助手家族（代码小浣熊 + 办公小浣熊）。实测新号完成任务最多可得 6,000 积分：首次登录电脑端 +3,000、首次登录手机端 +3,000（2026-10-14 结算到账）。免费版每日赠 300 积分：每天 00:00 发放，默认当日 24:00 清零，当天登录后有效期延长至 7 天（2026-11-02 端内积分明细实测：11-02 发放 +300、有效期至 11-08）；官网定价页另有「每日 0 点重置 · 不累计 · 仅限标准模型」字样，与端内机制不一致，以端内为准。另官网定价页已上线积分订阅体系（个人升级版 ¥29.9/月含 500 积分/日 + 10,000 积分/月、加油包 ¥9.9/500 分等，未端内核实）。",
    "tips": "首登两端都要装才有 6,000；积分在个人中心「用量看板 → 积分明细」查看，每日积分当天登录才延长至 7 天有效期，以端内任务列表为准。",
    "officialUrl": "https://www.xiaohuanxiong.com",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://xiaohuanxiong.com/pricing"
  },
  {
    "id": "deepseek",
    "name": "DeepSeek 官方开放平台",
    "provider": "deepseek",
    "category": [
          "featured"
    ],
    "badge": "官方极低资费（新户赠额未证实）",
    "badgeType": "blue",
    "tags": [
      "官方直达",
      "顶级推理",
      "低廉单价",
      "开源领军"
    ],
    "description": "DeepSeek 官方 API 开放平台，接口兼容 OpenAI 格式，输入定价以官方文档实时发布（缓存命中价远低于未命中价）。新用户是否赠送体验额度官方未公开说明，请以控制台额度中心的实时政策为准。",
    "tips": "官方不设第三方邀请机制，直接前往官网控制台注册即可；如遇官方充值或服务拥堵，可搭配第三方聚合路由作为高可用热备。",
    "officialUrl": "https://platform.deepseek.com",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing"
  },
  {
    "id": "intern_inkstone",
    "name": "书生·端砚 (Intern InkStone)",
    "provider": "intern-inkstone",
    "category": [
      "monthly_claim",
      "permanent_free"
    ],
    "badge": "每月 10,000 墨点 · 4 款模型免费直用",
    "badgeType": "purple",
    "tags": [
      "上海AI实验室",
      "科研工作台",
      "每月领墨点",
      "多模型可白嫖"
    ],
    "description": "上海人工智能实验室打造的端到端科研工作台，「墨点计划」每月可免费领取 10,000 墨点。现可调用 10 款模型：Agents-A1、Atria-Dawn、Sage-A1.5、书生-S2 共 4 款免费直用；DeepSeek-V4.1-Flash-1017、GLM-5.3、Kimi-K2.6、MiniMax-M3、Qwen3.8-27B、书生-Decision-4B 共 6 款按墨点计价，上下文长度覆盖 256K～1M，按原主力模型 deepseek-v4.1-flash-1017 口径 10,000 墨点约合 5,000 万 Token。",
    "tips": "支持 OpenAI Chat / OpenAI Responses / Anthropic Messages 三种规范调用（书生-Decision-4B 走 SystemOne）；登录控制台领取当月墨点，各模型墨点单价与上下文长度以「可用模型」页实时为准。",
    "officialUrl": "https://discovery.intern-ai.org.cn",
    "hasInvite": false,
    "checkedAt": "2026-10-31",
    "sourceUrl": "https://discovery.intern-ai.org.cn"
  },
  {
    "id": "spark",
    "name": "讯飞星火 (iFlytek Spark)",
    "provider": "spark",
    "category": [
          "permanent_free",
          "big_quota"
    ],
    "badge": "Spark Lite 长期免费 · Spark-X2.6 送 10 亿 Tokens",
    "badgeType": "blue",
    "tags": [
      "1024开发者节",
      "送10亿Tokens",
      "Spark Lite免费",
      "端侧0元"
    ],
    "description": "自研轻量级模型 Spark Lite 官方永久/长期免费开放调用（0 元/Token，个人开发者控制台创建应用即用，不占限时额度，支持文本与多轮对话）。此外 1024 开发者节发布旗舰 Spark-X2.6（293B-A30B 稀疏 MoE、1M 上下文），新老用户实名认证后可在星辰 MaaS 领取 10 亿 Tokens 礼包；端侧 Spark-X2.6-4B 限时免费（0 元/百万 tokens）。",
    "tips": "领取入口在星辰 MaaS 首页「Spark-X2.6 赋能开发者」或模型广场；礼包有效期与每人限领次数官网未列明细，领取弹窗为准。",
    "officialUrl": "https://xinghuo.xfyun.cn/spark",
    "hasInvite": false,
    "checkedAt": "2026-10-31",
    "sourceUrl": "https://xinghuo.xfyun.cn/spark"
  },
  {
    "id": "loomy",
    "name": "讯飞 Loomy (桌面 AI 工作搭子)",
    "provider": "loomy",
    "category": [
          "client",
          "daily_claim"
    ],
    "badge": "每日刷新5000 + 任务送1万 + 邀请送5000",
    "badgeType": "success",
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
    "id": "joycode",
    "name": "JoyCode (京东智能编码)",
    "provider": "joycode",
    "category": [
          "client",
          "monthly_claim"
    ],
    "badge": "席位每月 10,000 免费积分",
    "badgeType": "amber",
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
    "id": "teleagent",
    "name": "中国电信 TeleAgent (星辰智能体)",
    "provider": "teleagent",
    "category": [
      "client",
      "daily_claim",
      "monthly_claim"
    ],
    "badge": "四重福利，月最多赠 39,000 积分 + 邀请返积分",
    "badgeType": "blue",
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
    "id": "minimax",
    "name": "MiniMax 开放平台",
    "provider": "minimax",
    "category": [
          "big_quota"
    ],
    "badge": "注册送 ¥15 代金券（30 天）",
    "badgeType": "amber",
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
    "id": "minimax_code",
    "name": "MiniMax Code (智能编程助手)",
    "provider": "minimax-code",
    "category": [
          "client",
          "daily_claim"
    ],
    "badge": "每日登录送积分（第 4/7 天加码）",
    "badgeType": "amber",
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
    "id": "opencode",
    "name": "OpenCode Console",
    "provider": "opencode",
    "category": [
          "permanent_free"
    ],
    "badge": "Console 限免模型（需走客户端）",
    "badgeType": "neutral",
    "tags": [
      "编程专属",
      "限免模型",
      "OpenAI兼容",
      "客户端接入"
    ],
    "description": "面向终端的 AI 编程平台。通过 Console（原 Zen，2026-11-02 官网已更名）开放限时免费模型，兼容 OpenAI 接口规范并轮换开放多款编程强化开源模型；官方口径是免费模型需经 OpenCode 客户端接入，直接当通用 API 用可能不被支持；免费档另有用量与速率限制，以官方档期与端内提示为准。",
    "tips": "使用 GitHub 或 Google 账号直接登录即可获取 Key，免费模型会定期轮换，接入前先确认当前档期。",
    "officialUrl": "https://opencode.ai",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://opencode.ai/v2/docs/console/models"
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "provider": "openrouter",
    "category": [
      "permanent_free",
      "gateway"
    ],
    "badge": "十余款 :free 免费模型",
    "badgeType": "neutral",
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
    "id": "qoder",
    "name": "Qoder (国际版)",
    "provider": "qoder",
    "category": [
          "client",
          "daily_claim"
    ],
    "badge": "每日 10:00 后主动领 100 Credits",
    "badgeType": "blue",
    "tags": [
      "AI编程",
      "每日主动领取",
      "30天有效",
      "多模型支持"
    ],
    "description": "面向专业开发者的全流程 AI 编程工具。每日 10:00 之后需在站内/客户端主动领取 100 Credits（不是登录自动到账），单笔赠额自到账起 30 天有效；新用户注册另赠初始额度，档位以站内为准。邀请三重礼：好友注册并下载后 7 天内完成一次对话或任务，你得 50 Credits；好友注册后 7 天内累计 3 天完成对话或任务，你得 100 Credits；好友注册后 30 天内完成首次订阅，你得 1,000 Credits（好友另得 500 Credits）。站内另有「Credits 买一送一」首购限时福利，档期以活动页为准。模型侧：Qwen3.8-Flash 个人版限时每日免费使用（2026-11-02 站主实测仍免费，白天高峰易排队）。",
    "tips": "错过当日 10:00 时段不补发，也不累积；额度构成与消耗明细可在客户端用量页与 TokenTracker 的 Qoder 卡片对照查看。",
    "inviteUrl": "https://qoder.com/activities?referral_code=gviloqaY80z3XxsS6W78IIy3uMK3qRlc",
    "officialUrl": "https://qoder.com",
    "inviteCode": "gviloqaY80z3XxsS6W78IIy3uMK3qRlc",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://docs.qoder.com/events/100credits"
  },
  {
    "id": "qoder_cn",
    "name": "Qoder CN (国内版)",
    "provider": "qoder-cn",
    "category": [
          "client",
          "daily_claim"
    ],
    "badge": "每日 10:00 后主动领 100 Credits",
    "badgeType": "blue",
    "tags": [
      "阿里通义系",
      "国内免翻",
      "每日主动领取",
      "CLI 可查额度"
    ],
    "description": "阿里通义系的 Qoder 国内版（官网 qoder.cn，openapi.qoder.com.cn）。每日 10:00 之后主动领取 100 通用 Credits（自到账起 30 天有效），与国际版同为「手动领、不自动到账」的规则；邀请三重礼 2026-10-29 起与国际版同规则：好友注册后 7 天内完成任务你得 50 Credits、7 天内活跃 3 天得 100 Credits、30 天内首购你得 1,000 Credits（好友另得 500），单友上限 1,150、最多邀 50 人；新用户注册赠额以站内为准；新客首次订阅低至 19.9 元，档位以端内为准。模型侧：Qwen3.8-Flash 个人版限时每日免费使用（2026-11-02 站主实测仍免费，白天高峰易排队）。",
    "tips": "国内网络直连低延迟，官方 CLI 与 TokenTracker 的 Qoder CN 卡片都能读到实时额度，无需手动填 token；错过 10:00 时段不补发，赠额自到账起 30 天有效。",
    "officialUrl": "https://qoder.cn",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://docs.qoder.cn/events/invite-friends"
  },
  {
    "id": "trae",
    "name": "TRAE (国际版)",
    "provider": "trae",
    "category": [
      "client",
      "monthly_claim"
    ],
    "badge": "免费档每月 $1 额度 + 5,000 次自动补全",
    "badgeType": "blue",
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
    "id": "trae_cn",
    "name": "TRAE CN",
    "provider": "trae",
    "category": [
      "client",
      "daily_claim",
      "monthly_claim"
    ],
    "badge": "新户赠 2,000 · 受邀 3,000 · 每月登录 500",
    "badgeType": "blue",
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
    "id": "vyceai",
    "name": "Vyce AI",
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
    "description": "海外聚合网关（注册有一定网络门槛），OpenAI 与 Anthropic 双协议兼容，任意客户端/IDE 把 base URL 指向 https://vyceai.com/v1 即用，内置 OpenCode/光标/Cline 一键接入教程。实测模型可用：注册即送 $50 体验金，每日签到再得 $10。免费用户可用 4 款（按牌价计费、消耗注册金/签到金）：Claude Sonnet 4.6、DeepSeek V4.1 Flash、Agnes 3.0 Flash 均无日限额；GPT 6 Luna 单独带日限额 50M。另 Promotional Allowance 每日 10M 统一配额（GLM 5.3 Flash、Beam 1.0、Nemotron，$0，UTC 00:00 重置）。邀请计划：好友经链接注册，双方各得 $10 瞬时到账。",
    "tips": "免费档按牌价计费、消耗注册金与签到金；付费 Lite/Pro 解锁 DeepSeek 4.1 Flash 1017、GPT 5.6 Sol/Terra、GPT 6 Astra（维护中）、Claude Sonnet 4.6 Pro。价格须知：站内牌价为转售价、显著高于官方刊例（如 gpt-6-luna 站内 $2/M、官方刊例 $0.10/M，溢价约 20 倍），注册金与签到金消耗更快；TokenTracker 面板金额按官方刊例折算，与站内账单口径不同属正常。模型列表实时变动，接入前先看「模型列表」页。",
    "inviteUrl": "https://vyceai.com/signup?ref=VYCE_868RV5",
    "officialUrl": "https://vyceai.com",
    "inviteCode": "VYCE_868RV5",
    "hasInvite": true,
    "checkedAt": "2026-11-01",
    "sourceUrl": "https://vyceai.com"
  },
  {
    "id": "workbuddy",
    "name": "WorkBuddy 国内版",
    "provider": "workbuddy",
    "category": [
      "client",
      "daily_claim",
      "monthly_claim"
    ],
    "badge": "注册送 250 + 每月 100 + 每日送 30",
    "badgeType": "purple",
    "tags": [
      "AI客户端",
      "每日活跃积分",
      "每月基础积分",
      "邀请返利"
    ],
    "description": "全能 AI 工作台国内版：新用户注册送 250 积分，每月发放 100 基础积分，每日完成对话次日赠送 30 积分；积分直接在客户端内抵扣模型消耗。模型侧：HY3 模型目前仍可免费调用（2026-11-02 站主实测）。",
    "tips": "客户端/工作台形态，适合日常桌面交互；官方订阅政策口径：每日奖励积分约 30 天过期清零、按到期先后优先消耗短有效期积分（以端内显示为准）；邀请返利与连续签到加码以端内活动页为准。国际版 WorkBuddy AI（workbuddy.ai）与本版账号体系相互独立，另见其卡片。",
    "inviteUrl": "https://www.workbuddy.cn/events/invite?inviteCode=hppwvxg4sgqw",
    "officialUrl": "https://www.workbuddy.cn",
    "inviteCode": "hppwvxg4sgqw",
    "hasInvite": true,
    "checkedAt": "2026-10-31",
    "sourceUrl": "https://www.workbuddy.cn"
  },
  {
    "id": "workbuddy_intl",
    "name": "WorkBuddy AI (国际版)",
    "provider": "workbuddy",
    "category": [
      "client",
      "daily_claim",
      "monthly_claim"
    ],
    "badge": "每月 1 日送 100 积分 + 每日对话次日送 30",
    "badgeType": "blue",
    "tags": [
      "AI客户端",
      "国际版",
      "独立账号体系",
      "HY3免费调用"
    ],
    "description": "WorkBuddy 国际版（workbuddy.ai），与国内版（workbuddy.cn）账号体系相互独立。现行福利：每月 1 日发放 100 积分，当日完成对话次日 30 积分自动到账（2026-11-01 实测）；DeepSeek-V4.1-Flash 免费调用已停止（2026-11-02 站主实测；此前 2026-10-31 截止口径 11-01 尚在、现已下线）；HY3 模型仍可免费调用（2026-11-02 站主实测）。",
    "tips": "与国内版（workbuddy.cn）互不共享账号与积分；积分有效期以端内为准，用量与发放记录在站内「余额及用量」页查看。",
    "officialUrl": "https://www.workbuddy.ai",
    "hasInvite": false,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://www.workbuddy.ai"
  },
  {
    "id": "zcode",
    "name": "ZCode (Z.AI 编程智能体)",
    "provider": "zcode",
    "category": [
          "client",
          "featured"
    ],
    "badge": "周五晚常有限时 GLM-5.3-Flash 3 亿额度",
    "badgeType": "amber",
    "tags": [
      "智谱出品",
      "编程智能体",
      "周五晚间福利",
      "限时3亿额度",
      "邀请有礼"
    ],
    "description": "Z.ai 官方编程智能体客户端，GLM 系列模型直连、登录即用。长期观察每逢周五晚间登录，客户端经常有限时 GLM-5.3-Flash 3 亿 Token 大额额度放送；额度数值与活动档期以端内公告为准。邀请活动进行中：邀请新用户及每周邀请满 2 位、10 位均有登录卡类梯度奖励（卡型与到账以端内奖励中心为准）。",
    "tips": "限时额度类活动不定期出现，建议每周五晚上登录客户端查看；配合 TokenTracker Plus 的 ZCode 用量卡片可实时核对到账额度与生成速率。邀请奖励在端内「奖励中心」查看进度。",
    "officialUrl": "https://z.ai",
    "inviteUrl": "https://zcode.z.ai/invite/DU7JA29Y",
    "inviteCode": "DU7JA29Y",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://z.ai"  },
  {
    "id": "agent2api",
    "name": "Agent2API (开源本地网关)",
    "provider": "agent2api",
    "category": [
      "gateway",
      "client"
    ],
    "badge": "开源本地网关 · 多端账号聚合 · 自动签到打卡",
    "badgeType": "success",
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
    "provider": "agentrouter",
    "category": [
      "big_quota",
      "daily_claim",
      "gateway"
    ],
    "badge": "⚠️ 2026-11-02 实测仍全模型无流量",
    "badgeType": "rose",
    "tags": [
      "实测仍不可用",
      "美元赠额",
      "多模型路由",
      "海外网络"
    ],
    "description": "⚠️ 2026-10-31 站内实测：本账号模型列表 3/3 显示「无流量」、调用空回；官方 Discord 社区同报多数账号无流量、少数账号仍正常（分账号/分节点现象，非全站故障）。签到入口不受影响，每日签到得 $25（站内计价口径、非官方美元价，实际可用量以站内为准；签到积分有效期以端内为准）。历史注册与签到额度按官方说法保留，恢复前建议改用其他高可用路由。2026-11-02 复查：官方侧正常——站点与 API 正常响应，公告称折扣倍率已恢复标准价、将按使用规范持续补足额度、每成功邀请得 $100 用量额度，公开价目仅列 gpt-5.6-sol / gpt-6-astra / gpt-6.1-sol / claude-opus-5-5（后者限 svip/test 组）；但同日站主账号实测 3/3 模型仍显示「无流量」，不可用延续。",
    "tips": "此前流传的「注册送 $125 / 每日签到 $25」每日签到 $25 实测可得（站内计价口径、非官方美元价，实际可用量以站内为准）；不可用来源在列表中沉底展示，账号侧实测恢复后回 A 桶；一律以官方公告与站内额度页为准。",
    "inviteUrl": "https://agentrouter.org/register?aff=tt0I",
    "officialUrl": "https://agentrouter.org",
    "inviteCode": "tt0I",
    "hasInvite": true,
    "checkedAt": "2026-11-02",
    "sourceUrl": "https://agentrouter.org/api/status"
  }
];
