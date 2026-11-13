// 福利卡片 ↔ AIHOT「Token 羊毛」信源映射（2026-11-10 人工核对）。
// key = perksData 卡片 id，value = AIHOT deals[].provider 的名称（等值匹配，
// AIHOT 改名时只需改这张表）。没列出的卡片 = AIHOT 未覆盖（AIHOT 明确不收
// 邀请返利类，两站口径不同），不打 AIHOT 角标；想找 AIHOT 有而我们没有的
// 卡片候选，跑 scripts/aihot-perks-candidates.mjs。
export const PERKS_AIHOT_PROVIDERS = {
  // —— AIHOT 2026-11-13 吸收的新卡（provider 名为快照原值）——
  officeace: ["华为云 OfficeAce"],
  meoo: ["秒悟 Meoo"],
  tencent_ima: ["腾讯 ima"],
  ace_music: ["ACE Music"],
  astudio: ["科大讯飞 AStudio"],
  wps_lingxi: ["WPS 灵犀"],
  wenxin: ["百度文心"],
  qianfan: ["百度千帆"],
  rime: ["Rime"],
  drex: ["Nace AI"],
  livekit: ["LiveKit"],
  edgeone: ["腾讯 EdgeOne"],
  tencent_adp: ["腾讯云 ADP"],
  elevenlabs: ["ElevenLabs"],
  zed: ["Zed"],
  tokenhub: ["腾讯云 TokenHub"],
  wechat_miniprogram: ["腾讯云开发"],
  devin: ["Devin Desktop"],
  minicpm_ocr: ["面壁智能 MiniCPM"],
  stepaudio: ["阶跃星辰"],
  somark: ["SoMark"],

  doubaowork: ["豆包"],
  modelscope: ["魔搭社区"],
  raccoon: ["商汤小浣熊"],
  cloudflare_workers_ai: ["Cloudflare"],
  minimax_code: ["MiniMax"],
  minimax: ["MiniMax"],
  qoder_cn: ["阿里云 Qoder"],
  qoder: ["阿里云 Qoder"],
  trae_cn: ["字节 TRAE"],
  trae: ["字节 TRAE"],
  // workbuddy_cn 曾在此（僵尸 id，perksData 里不存在）——AIHOT 映射表取每个
  // provider 的首个卡 id 做「已领判定」，首项指向空卡会让腾讯 WorkBuddy 永远
  // 判不出已领、永远计入「今天还能领」（2026-11-13 对抗性审查发现，已删）。
  workbuddy_intl: ["腾讯 WorkBuddy"],
  workbuddy: ["腾讯 WorkBuddy"],
  ant_ling: ["蚂蚁百灵"],
  intern_inkstone: ["书生·端砚"],
  scnet: ["超算互联网"],
  siliconflow: ["硅基流动"],
  qwen: ["阿里云百炼"],
  deepseek: ["DeepSeek"],
  volcengine: ["火山方舟"],
  huawei_codearts: ["华为云码道"],
  autoclaw: ["智谱 AutoClaw"],
  zcode: ["智谱 ZCode"],
  opencode: ["OpenCode"],
  opencode_go: ["OpenCode"],
};
