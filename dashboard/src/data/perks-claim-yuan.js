// 每张卡「每周期单次领取」的核算价值（¥）——审计表 perks-value-audit.md 的
// 机器可读版（2026-11-12/13 站主定谳口径）。站主 2026-11-13 拍板：**我们的
// 审计定价是标准**，AIHOT 的 yuan 不再是唯一依据（他们 2026-11-13 的快照 56 条
// deal 只剩 17 条带 ¥ 换算，且恰好我们映射的卡全被摘价）。
//
// 计价规则（与审计表一致）：
//   - daily 周期 = 单日领取价值（审计表「X/日」，没有明写的用「月合计 ÷ 30」）；
//   - monthly 周期 = 单次月领价值（只计该周期独有的权益，与日签同池的不重复计价）；
//   - once 周期 = 一次标记对应的整体价值（永久免费卡记审计表月价值，一次性券记券面）；
//   - 区间估计一律取保守下限；轻量免费/纯付费/无单价（如七牛超大额）不入表 = 0。
// 改价必须先改审计表，再同步这张表——审计表是唯一真源。
export const PERKS_CLAIM_YUAN = {
  // 🟡 amber
  zcode: { once: 24.53 },           // 17 亿/周 ÷7 × ¥0.101/M ≈ ¥24.53/晚（审计 §6）
  zcode_intl: { once: 24.53 },
  loomy: { daily: 19.9 },           // 每日 5,000 积分（¥19.9/5000 分，审计 §7）
  spark: { once: 596 },             // Spark-X2.6 送 10 亿 Token ≥¥596（一次性）
  // 🔴 rose
  teleagent: { daily: 14.95 },      // 月最高 39,000 分 = ¥448.50 ÷30（月礼与日签同池，月领不重复计价）
  agentrouter: { daily: 102.88 },   // $25 × 56.9% 官牌算力 ≈¥102.88/日（审计 §1）
  qoder_cn: { daily: 7.2 },         // ¥216/月 ÷30
  qoder: { daily: 7.2 },
  amd_token_factory: { once: 216 }, // ≈¥216/月（永久免费直连）
  doubaowork: { daily: 6.48 },      // 200 额度 × ¥0.03238（审计 §5 直给）
  workbuddy: { daily: 4.95, monthly: 24.75 },       // 日签 100 分 × ¥0.0495；月 500 基础分
  workbuddy_intl: { daily: 1.49, monthly: 4.95 },   // 日签 30 分；月 100 基础分
  google_ai_studio: { once: 180 },  // ≈¥180/月（永久免费）
  trae_cn: { daily: 5.0, monthly: 25.0 },           // 日 100 分 × ¥0.05；月 500 分
  cerebras: { once: 170 },          // ≈¥170/月（永久免费）
  huawei_codearts: { daily: 4.9, monthly: 98 },     // 日签 100 分 × ¥0.049（§4）；月领=Skill 赛报名礼 2,000 分 ≈¥98
  qiniu: {},                        // 超大额（每日 1 亿 Token 活动），无单价不入表
  // 🟣 purple
  minimax_code: { daily: 3.56 },    // ¥106.88/月（含周期加码）÷30
  tuanjie_cowork: { daily: 2.57 },  // ¥77.18/月 ÷30
  scnet: { once: 60 },              // 新户 1 亿 Token = ¥60（一次性）
  sensenova: { once: 60 },          // ≈¥60/月（永久免费）
  // opencode：日签卡（站主 2026-11-13 定谳：5 个限免模型各自独立日额度、可叠加，
  // 「一天肯定不止 ¥1」——按 LongCat 100 次/日 + 其余 4 模型保守各 30-50 次 ≈ 250 次/日，
  // 编程单次约 10-15k tokens ≈ 2.5-4M tokens/日，Flash 类混合价 ≈¥2/M ≈ ¥5-8/日，取 ¥6。
  // 月化 ≈¥180 已触 rose 门槛——改档需站主拍板，暂维持 purple 挂账。
  // once ¥30 仅供 AIHOT limited deal 的「今天还能领」估值（deal kind=limited→once）。
  opencode: { daily: 6, once: 30 },
  opencode_go: {},                  // 纯付费渠道，无免费额度
  autoclaw: { daily: 1.0 },         // 站主折扣口径 ≈¥30/月 ÷30（新户礼数额不锚定，不入单次）
  autoclaw_intl: { daily: 1.2 },    // ≈¥36/月 ÷30
  bigmodel: { once: 30 },           // ¥30–60，取保守下限
  qwen: { once: 60 },               // 在架模型 ≈1 亿 Token/90 天 ≈¥60
  // 🔵 blue
  modelscope: { once: 45 },         // 日签 250 魔粒 ≈¥1.5/日，月 ¥45（卡为 once 周期）
  groq: { once: 35 },               // ≈¥35/月（永久免费）
  intern_inkstone: { monthly: 25 }, // ¥25–50，10% 常态口径取保守下限
  cloudflare_workers_ai: { once: 23.76 }, // 每日 10,000 neurons ≈¥23.76/月
  nvidia_nim: { once: 15 },         // ¥15–30 取下限
  cola: { once: 15 },               // ¥15–20 取下限
  tokenrhythm: { once: 18 },        // 实名送 ¥18 代金券
  siliconflow: { once: 16 },        // 每邀 1 人 ¥16
  minimax: { once: 15 },            // 注册送 ¥15
  raccoon: { daily: 0.48 },         // 每日 300 分 × ¥0.001596（§7 直给）
  apigoto: { once: 10 },            // 月 1000 万 TCredits = ¥10
  longcat: { once: 10 },            // ¥10–30/次 取下限
  ant_ling: { monthly: 10 },        // 每月 1 日自动发 ¥10 券
  // 🟢 success
  agnes_web: { daily: 0.3 },        // ¥9–18/月 取下限 ÷30
  trae: { monthly: 7.2 },           // 免费档每月 $1 额度
  joycode: { monthly: 6.8 },        // 月 10,000 积分 = ¥6.80
  deepseek: { once: 6 },            // 官方赠额 ≈¥6
  juflowai: { once: 5 },            // 实名领 ¥5 体验金
  unisound_maas: { once: 4 },       // ¥4–8 取下限
  volcengine: { once: 1.2 },        // ≈¥1.20/月（永久免费）
  qwen_work: { monthly: 1 },        // 每月 100 积分 = ¥1
  catpaw: { monthly: 1 },           // ¥1–2 取下限
  // —— AIHOT 2026-11-13 吸收的新卡（估值按我方口径保守下限，待站主复核）——
  officeace: { daily: 2 },         // 100 积分/日 × ¥0.02/分（果办无公开单价，保守）
  meoo: { daily: 2 },              // 2000 积分/日，单价未公开 → 保守 ¥2/日
  tencent_ima: { daily: 0.5 },     // 50 算力/日
  ace_music: { daily: 0.3 },       // 20 积分/日 · 10 首歌
  astudio: { daily: 0.4 },         // 100 积分/日 × ¥0.004/分
  wps_lingxi: { daily: 0.5 },      // 100 智点/日（第 7 天起 200）
  wenxin: { daily: 0.5 },          // ERNIE 5.5 Flash 共享 50 次/日
  qianfan: { once: 20 },           // 新户 20 元代金券
  rime: { monthly: 333 },          // $50/月 × 官方汇率 6.6683 ≈ ¥333
  drex: { monthly: 33 },           // $5/月 ≈ ¥33
  livekit: { monthly: 17 },        // $2.5/月 ≈ ¥17
  edgeone: { monthly: 0.3 },       // 50 万 Token/月 ≈ ¥0.3
  tencent_adp: { monthly: 2 },     // 1.5 万 PU/月，PU 无公开价 → 保守
  elevenlabs: { monthly: 5 },      // 1 万积分/月，语音积分保守
  zed: { monthly: 67 },            // 学生 $10/月 ≈ ¥67（试用 $5≈¥33 并入卡面）
  tokenhub: { once: 2.4 },         // 100 万 Token/新户 ≈ ¥2.4
  wechat_miniprogram: { once: 200 }, // 10 亿 Token 单次但限云开发场景，保守 ¥200（待核）
  devin: {},                       // 限时免费模型，无单价
  minicpm_ocr: {},                 // 免费 API，无单价
  stepaudio: {},                   // 限时预览模型，无单价
  somark: {},                      // 免费解析 API，无单价
};
