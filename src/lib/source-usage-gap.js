"use strict";

// 三态用量门禁（站主 2026-11-22 拍板，双 AI 合议判据；案例=Qoder CN 终谳，
// 见 2026-11-22 错误台账 ㉔/㉕）。
//
// 背景：上游会话文件停写用量（Qoder CN 2026-11-02T06:57Z 起 usage 消失）时，
// TT-plus 面板只会静默显示 0/「用量不完整」——这类断供此前两次都靠站主肉眼
// 发现。本模块把「源头断供」变成可自动检测的显式提示。
//
// 三态彼此解耦（对抗「用额度侧信号证会话侧断供」的跨通道误判）：
//   源断供（State A）—— 最近 GAP_WINDOW_DAYS 个本地日（含今天）里，
//     该源 transcript 有新增会话活动（session.ended_at 落在窗口）而用量行
//     （queue.hour_start 落在窗口）为 0 → 判定断供，返回 last_usage_day
//     供横幅渲染「自 <日期> 之后不再上报用量」。证据同通道：会话侧证据
//     （session analytics 行）证会话侧断言（用量行缺失），绝不读额度、
//     cookie、余额。
//   认证失效（State B）—— 不在本模块判定。cookie/账本过期由各额度卡自身
//     的 error/auth 态呈现（LimitsPage 每卡已有），本模块没有额度输入，
//     结构上不可能把认证失效混报成断供。
//   无使用（State C）—— 窗口内没有会话活动 → 不提示（用没用是用户自由，
//     不是故障）。
//
// 防误报基线：
//   - 该源历史（活动日 ∪ 用量日）≥ MIN_BASELINE_DAYS 个不同日才参评——
//     天然低频源（装了偶尔用一次）不该亮黄字。
//   - 该源历史上必须上报过用量（usageDays 非空）才参评——从未上报过的源
//     没有「断供」可言（TT-plus 从一开始就无 token 可显示，属于形态而非
//     故障，见 Qoder「token 恒 0 是形态非 bug」裁定）。
//
// 日界纪律（台账㉕「先按源拆开、再按天对齐」的时间轴半边）：
//   - 一律按记录时间戳（ended_at / hour_start）的本地日分桶；文件 mtime
//     假新活例：CN 11-21 的 transcript 里 usage 全是 ≤11-02 的旧行。
//   - 窗口=含今天的连续 windowDays 个本地日。今天参评是实测裁决而非疏忽：
//     活跃源的用量行当日入队（2026-11-22 实测 4 个活跃源队列 lastUsage=
//     当天），而亮出条件是整个窗口三天用量全零——≤2 天的同步滞后会被
//     窗口其余天吸收，不影响判定。排除今天反而让 UTC 傍晚的会话（本地
//     次日凌晨）漏出窗口，Qoder CN 真实案例因此晚亮一天（实测复现）。
//
// 检测时延：真实断供最晚在窗口滚满 windowDays 个本地日后亮出（Qoder CN
// 若早有此门禁，2026-11-05 起即会亮出，横幅日期=11-02）。

const GAP_WINDOW_DAYS = 3;
const MIN_BASELINE_DAYS = 14;

const fs = require("node:fs");
const readline = require("node:readline");

// 本地日键（YYYY-MM-DD）。timeZone（IANA 名）优先，其次显式 offsetMinutes，
// 都缺省时用进程本地时区（桌面端=用户本机，正确）。en-CA 的 Intl 格式恰好
// 是 YYYY-MM-DD；失败（老 Node/异常 tz）回落到偏移量计算。
function dayKeyFromTs(tsMs, { timeZone, offsetMinutes } = {}) {
  const date = new Date(tsMs);
  if (!Number.isFinite(date.getTime())) return null;
  if (timeZone && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    } catch {
      /* 异常时区名回落 offsetMinutes */
    }
  }
  if (Number.isFinite(offsetMinutes)) {
    const shifted = new Date(tsMs + offsetMinutes * 60_000);
    return shifted.toISOString().slice(0, 10);
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetweenKeys(fromKey, toKey) {
  // 两个 YYYY-MM-DD 的日历差（to - from，按 UTC 解析避免夏令时漂移——
  // 日键本身已经是用户时区的日，差值只需要日历数）。
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

// 日键纯日历平移（deltaDays 可负）——在「日键空间」里做加减，而不是对
// 时间戳减 24h 倍数：后者跨夏令时边界会把窗口日错标一天（23h/25h 日）。
// 日键本身已是本地日的标签，平移标签 = 平移日历日，对一切时区稳健。
function shiftDayKey(key, deltaDays) {
  const base = Date.parse(`${key}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;
  return new Date(base + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

function collectDaySets(rows, tsField, dayCtx) {
  const bySource = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const source = typeof row?.source === "string" ? row.source : "";
    if (!source) continue;
    // 显式类型门：Number(null)===0、Number("")===0 会把空值伪装成 epoch 0
    // （2026-11-20 台账坑），非 string/number 一律视为无时间戳。
    const raw = row?.[tsField];
    let ts = NaN;
    if (typeof raw === "string") ts = raw.trim() ? Date.parse(raw) : NaN;
    else if (typeof raw === "number") ts = raw;
    if (!Number.isFinite(ts)) continue;
    const key = dayKeyFromTs(ts, dayCtx);
    if (!key) continue;
    let set = bySource.get(source);
    if (!set) {
      set = new Set();
      bySource.set(source, set);
    }
    set.add(key);
  }
  return bySource;
}

// 核心判据（纯函数）：输入按源分桶的「活动日集合」与「用量日集合」。
// 返回 State A 源列表（按断供起始日升序、同日起按源名排序）。
function computeSourceUsageGapsFromSets({
  activityBySource,
  usageBySource,
  nowMs = Date.now(),
  dayCtx = {},
  windowDays = GAP_WINDOW_DAYS,
  baselineDays = MIN_BASELINE_DAYS,
} = {}) {
  const todayKey = dayKeyFromTs(nowMs, dayCtx);
  if (!todayKey) return [];

  const gaps = [];
  for (const [source, activityDays] of activityBySource) {
    const usageDays = usageBySource.get(source);
    // 从未上报过用量的源不参评：没有过用量就没有「断供」。
    if (!usageDays || usageDays.size === 0) continue;
    // 低频源基线：历史天数不足不参评。
    let unionDays = usageDays.size;
    for (const key of activityDays) if (!usageDays.has(key)) unionDays += 1;
    if (unionDays < baselineDays) continue;

    // 窗口 = 含今天的连续 windowDays 个本地日，升序（日键平移，免疫夏令时）。
    const windowKeys = [];
    for (let back = windowDays - 1; back >= 0; back -= 1) {
      const key = shiftDayKey(todayKey, -back);
      if (key) windowKeys.push(key);
    }
    if (windowKeys.length === 0) continue;

    let windowActivity = 0;
    let windowUsage = 0;
    let lastActivityDay = null;
    for (const key of windowKeys) {
      if (activityDays.has(key)) {
        windowActivity += 1;
        if (!lastActivityDay || key > lastActivityDay) lastActivityDay = key;
      }
      if (usageDays.has(key)) windowUsage += 1;
    }
    // 无使用（State C）→ 不提示；窗口内有用量 → 不是断供。
    if (windowActivity === 0 || windowUsage > 0) continue;

    let lastUsageDay = null;
    for (const key of usageDays) if (!lastUsageDay || key > lastUsageDay) lastUsageDay = key;
    gaps.push({
      source,
      last_usage_day: lastUsageDay,
      last_activity_day: lastActivityDay,
      window_days: windowDays,
      window_activity_day_count: windowActivity,
      baseline_day_count: unionDays,
    });
  }
  gaps.sort((a, b) =>
    String(a.last_usage_day || "").localeCompare(String(b.last_usage_day || ""))
    || String(a.source).localeCompare(String(b.source)),
  );
  return gaps;
}

// 主入口。sessions = session analytics 行（至少含 source + ended_at）；
// queueRows = 用量队列行（至少含 source + hour_start）。两边都用原始行，
// 由调用方决定会话索引的新鲜度（横幅是日级提示，容忍分钟级陈旧）。
// 输入不可用时抛错由调用方兜底——门禁故障不能拖垮限额载荷。
function computeSourceUsageGaps({
  sessions,
  queueRows,
  nowMs = Date.now(),
  timeZone = null,
  offsetMinutes = null,
  windowDays = GAP_WINDOW_DAYS,
  baselineDays = MIN_BASELINE_DAYS,
} = {}) {
  const dayCtx = { timeZone: timeZone || null, offsetMinutes: Number.isFinite(offsetMinutes) ? Math.trunc(offsetMinutes) : null };
  return computeSourceUsageGapsFromSets({
    activityBySource: collectDaySets(sessions, "ended_at", dayCtx),
    usageBySource: collectDaySets(queueRows, "hour_start", dayCtx),
    nowMs,
    dayCtx,
    windowDays,
    baselineDays,
  });
}

// CLI 专用的用量日抽取：字节级只抠 source/hour_start 两个字段、不做整行
// JSON.parse——队列可达数百 MB，status 主路径付不起全量解析；完整读入仍走
// local-api 的 readQueueData（完整性契约在 reader 层，本函数不替代它）。
// 可选源语义：路径不存在返回空 Map 而不是抛错；读取中途出错返回已收集的
// 部分（日级提示可容忍，绝不反向污染成「有用量」——只会漏报不会误报）。
// 返回 Map<source, Set<dayKey>>。
async function scanQueueUsageDays(queuePath, { timeZone = null, offsetMinutes = null } = {}) {
  const dayCtx = { timeZone: timeZone || null, offsetMinutes: Number.isFinite(offsetMinutes) ? Math.trunc(offsetMinutes) : null };
  const usageBySource = new Map();
  if (!queuePath || !fs.existsSync(queuePath)) return usageBySource;
  const input = fs.createReadStream(queuePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.includes('"source"') || !line.includes('"hour_start"')) continue;
      const source = extractJsonStringField(line, "source");
      const hourStart = extractJsonStringField(line, "hour_start");
      if (!source || !hourStart) continue;
      const ts = Date.parse(hourStart);
      if (!Number.isFinite(ts)) continue;
      const key = dayKeyFromTs(ts, dayCtx);
      if (!key) continue;
      let set = usageBySource.get(source);
      if (!set) {
        set = new Set();
        usageBySource.set(source, set);
      }
      set.add(key);
    }
  } catch {
    // 半途失败：返回已收集部分（只可能漏报，不可能误报）。
  }
  return usageBySource;
}

function extractJsonStringField(line, field) {
  const needle = `"${field}":"`;
  const start = line.indexOf(needle);
  if (start < 0) return "";
  const valueStart = start + needle.length;
  const end = line.indexOf('"', valueStart);
  if (end < 0) return "";
  return line.slice(valueStart, end);
}

// CLI/横幅共用的日期缩写（YYYY-MM-DD → MM-DD）；非预期形态原样返回。
function shortDay(dayKey) {
  const key = String(dayKey || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key.slice(5) : key;
}

module.exports = {
  GAP_WINDOW_DAYS,
  MIN_BASELINE_DAYS,
  computeSourceUsageGaps,
  computeSourceUsageGapsFromSets,
  collectDaySets,
  scanQueueUsageDays,
  dayKeyFromTs,
  daysBetweenKeys,
  shiftDayKey,
  shortDay,
};
