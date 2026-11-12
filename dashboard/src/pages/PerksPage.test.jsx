import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { PerksPage, buildPerksFeedbackUrl, albumBrightnessTier, ALBUM_PAGE_SIZE, perkDaysLeft, cardRarity } from "./PerksPage.jsx";
import { ToastProvider } from "../ui/components/Toast.jsx";
import zhCore from "../content/i18n/zh/core.json";
import zhDashboard from "../content/i18n/zh/dashboard.json";
import { PERK_PROVIDERS } from "../data/perksData.js";
import { localizePerk } from "../data/perks-i18n-en.js";
import { getCopyLocale } from "../lib/copy";
import { PERKS_CLAIMS_KEY, PERKS_LEGACY_CLAIMS_KEY, getPerkClaimDay } from "../lib/perks-claims.mjs";

const ORDERED_IDS = [
  "agent2api", "agentrouter", "agnes", "agnes_web", "qwen", "amd_token_factory", "ant_ling", "apigoto",
  "autoclaw", "autoclaw_intl", "bigmodel", "catpaw", "cerebras", "cloudflare_workers_ai", "huawei_codearts",
  "cola", "tuanjie_cowork", "cursor", "deepseek", "doubaowork", "google_ai_studio", "groq", "siliconflow",
  "scnet", "volcengine", "spark", "intern_inkstone", "joycode", "tokenrhythm", "juflowai", "longcat", "loomy",
  "minimax_code", "minimax", "modelscope", "nvidia_nim", "opencode", "opencode_go", "openrouter",
  "qwen_work", "qiniu", "qoder_cn", "qoder", "raccoon", "sensenova", "teleagent", "trae_cn", "trae",
  "unisound_maas", "vyceai", "workbuddy_intl", "workbuddy", "zcode",
];

// Mock copy helper using real zh strings (raw templates — the house style here
// asserts the template text, not interpolated values)
vi.mock("../lib/copy", () => ({
  copy: vi.fn((key) => zhCore[key] || zhDashboard[key] || key),
  getCopyLocale: vi.fn(() => "zh"),
}));

describe("PerksPage", () => {
  beforeEach(() => {
    localStorage.clear();
    getCopyLocale.mockReturnValue("zh");
    // AIHOT 快照是后台补充：默认给个失败响应，别让 jsdom 真去发请求。
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false })));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("renders all providers in bilingual A-Z order including usable Agent cards", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    const names = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(names).toEqual(ORDERED_IDS.map((id) => PERK_PROVIDERS.find((row) => row.id === id).name));
    expect(names.filter((name) => name === "Agent Router")).toHaveLength(1);
    expect(names.filter((name) => name === "Agent2API (开源本地网关)")).toHaveLength(1);
  });

  it("renders page header and provider cards", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    expect(screen.getByText("福利指南")).toBeInTheDocument();
    expect(screen.getByText("全部服务商")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /智谱开放平台/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /硅基流动/ })).toBeInTheDocument();
  });

  it("shows the AIHOT freshness badge once the snapshot arrives, and a delisting hint when dropped", async () => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("aihot-free-tokens")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            schema: 1,
            items: [
              { id: "doubao-daily-200", provider: "豆包", verified_at: "2026-11-10T02:00:00.000Z" },
              { id: "trae-cn-monthly", provider: "字节 TRAE", verified_at: "2026-11-09T02:00:00.000Z" },
            ],
            dropped_providers: [],
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );
    // 豆包工作 + TRAE CN + TRAE 国际版 三张卡拿到角标（copy 模板原文断言）
    await waitFor(() => expect(screen.getAllByText("AIHOT 核对 {{date}}").length).toBe(3));
    // 没覆盖的卡（如 Agent2API）不打角标 —— 缺席不算下架，不误报
    const agent2apiCard = screen.getByRole("heading", { level: 3, name: "Agent2API (开源本地网关)" }).closest("div.group");
    expect(agent2apiCard.textContent).not.toContain("AIHOT 核对");
  });

  it("flags a delisted provider only when AIHOT covered it last snapshot and not now", async () => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("aihot-free-tokens")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            schema: 1,
            items: [
              { id: "doubao-daily-200", provider: "豆包", verified_at: "2026-11-10T02:00:00.000Z" },
            ],
            dropped_providers: ["字节 TRAE"],
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );
    // 字节 TRAE 上轮在架本轮消失 → TRAE 两张卡出下架提示；豆包还在架不出
    await waitFor(() => expect(screen.getAllByText("AIHOT 最新快照已无此家福利").length).toBe(2));
    const doubaoCard = screen.getByText("豆包工作 (Doubao Work)").closest("div.group");
    expect(doubaoCard.textContent).not.toContain("AIHOT 最新快照已无此家福利");
  });

  it("builds a prefilled GitHub issue URL for a perk card", () => {
    const url = buildPerksFeedbackUrl({
      id: "apigoto",
      name: "APIGOTO",
      badge: "订阅制改版：PLUS 约6折 / PROX10 约5折",
      checkedAt: "2026-11-02",
      sourceUrl: "https://www.apigoto.com",
    });
    expect(url.startsWith("https://github.com/01UNCLEDOG01/TokenTracker-Plus/issues/new?title=")).toBe(true);
    expect(url).toContain(encodeURIComponent("[福利口径反馈] APIGOTO（apigoto）"));
    expect(url).toContain(encodeURIComponent("- 当前徽标：订阅制改版：PLUS 约6折 / PROX10 约5折"));
    expect(url).toContain(encodeURIComponent("- 卡片核对日期：2026-11-02"));
  });

  it("renders a per-card feedback link that opens a prefilled issue", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );
    const links = screen.getAllByText(zhCore["perks.card.feedback"]).map((node) => node.closest("a"));
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].getAttribute("href")).toContain("github.com/01UNCLEDOG01/TokenTracker-Plus/issues/new");
    expect(links[0].getAttribute("href")).toContain(encodeURIComponent("id: "));
  });

  it("filters providers by search query", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    const input = screen.getByPlaceholderText(/搜索服务商/);
    fireEvent.change(input, { target: { value: "硅基流动" } });

    expect(screen.getByRole("heading", { level: 3, name: /硅基流动/ })).toBeInTheDocument();
    expect(screen.queryByText(/智谱开放平台/)).not.toBeInTheDocument();
  });

  it("applies search and claimed state together", () => {
    localStorage.setItem("tokentracker.perks.claims.v1", JSON.stringify({ agentrouter: getPerkClaimDay() }));
    render(<ToastProvider><PerksPage /></ToastProvider>);
    fireEvent.click(screen.getByText("已领取").closest("button"));
    expect(screen.queryByRole("heading", { name: "Agent2API (开源本地网关)" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/搜索服务商/), { target: { value: "Agent" } });
    expect(screen.getByRole("heading", { name: "Agent Router" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Agent2API (开源本地网关)" })).not.toBeInTheDocument();
    localStorage.clear();
  });

  it("filters providers by category tab", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    const clientTab = screen.getByText("客户端/工作台");
    fireEvent.click(clientTab);

    expect(screen.getAllByText(/WorkBuddy/)[0]).toBeInTheDocument();
    expect(screen.queryByText(/DeepSeek 官方开放平台/)).not.toBeInTheDocument();
  });

  it("每行卡片都标注核对日期与可回原文核对的来源链", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    // 53 家收录（2026-11-03：+AMD/Cloudflare/Google/Groq/NVIDIA/云知声/Cerebras/魔搭；2026-11-02 批 +CatPaw 等），每行一条 provenance。
    expect(screen.getAllByText("核对 {{date}}")).toHaveLength(53);
    const links = screen.getAllByText("来源").map((node) => node.closest("a"));
    links.forEach((link) => {
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("target")).toBe("_blank");
    });
  });

  it("每个分类标签均带上数量徽标，与服务商实际统计对齐", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    expect(screen.getByText(/共收录 \{\{count\}\} 家服务商/)).toBeInTheDocument();
    // 分类签文案以 i18n 为准：permanent_free 的现行标签是「长期免费」
    expect(screen.getByText("长期免费")).toBeInTheDocument();
    expect(screen.getByText("每月福利")).toBeInTheDocument();
    expect(screen.getByText("每日可领取积分")).toBeInTheDocument();
    // 2026-11-11：NVIDIA Build 改用「按速率免费的长期免费档」，从 big_quota 迁入 permanent_free（16→17）。
    expect(screen.getByText("长期免费").closest("button")).toHaveTextContent("17");
    expect(screen.getByText("每日可领取积分").closest("button")).toHaveTextContent("17");
  });

  it("所有服务商卡片均包含简明清晰的官网直达入口且文案统一", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    const directLinks = screen.getAllByText("官网直达");
    expect(directLinks).toHaveLength(51);
    // agnes 与 bigmodel 为双站卡：主按钮「中国站直达」×2 + 分站「国际站直达」×2
    expect(screen.getAllByText("中国站直达")).toHaveLength(2);
    expect(screen.getAllByText("国际站直达")).toHaveLength(2);
    expect(screen.queryByText(/官方无邀请/)).not.toBeInTheDocument();
    expect(screen.queryByText(/官网直达通道/)).not.toBeInTheDocument();
  });

  it("领取写入 localStorage；已领取后按钮禁用，再点不能取消或重刷（AIHOT 口径）", () => {
    localStorage.clear();
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    const agnesCard = screen.getByRole("heading", { name: "Agnes AI" }).closest(".group");
    fireEvent.click(within(agnesCard).getByRole("button", { name: "标记已领取" }));
    expect(screen.getAllByText("已领取（{{date}}）")).toHaveLength(1);
    // 领取记录绑定卡片 id，卡片排序变化不影响已保存的记录。
    expect(JSON.parse(localStorage.getItem(PERKS_CLAIMS_KEY)).providers).toEqual({ agnes: { once: { last: getPerkClaimDay(), count: 1 } } });

    // 已领取 = 禁用（站主 2026-11-12：点了就不能再点；once 永不刷新）——
    // 重复点击不改状态、不写存储，×N 无法靠来回切换刷次数。
    const claimedButton = screen.getAllByText("已领取（{{date}}）")[0].closest("button");
    expect(claimedButton).toBeDisabled();
    fireEvent.click(claimedButton);
    expect(screen.getAllByText("已领取（{{date}}）")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(PERKS_CLAIMS_KEY)).providers)
      .toEqual({ agnes: { once: { last: getPerkClaimDay(), count: 1 } } });
  });

  it("领取状态筛选按钮能过滤已领取与未标记卡片", () => {
    localStorage.clear();
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    // 标记指定卡片，避免把领取功能与列表位置绑在一起。
    const agnesCard = screen.getByRole("heading", { name: "Agnes AI" }).closest(".group");
    fireEvent.click(within(agnesCard).getByRole("button", { name: "标记已领取" }));
    expect(screen.getAllByText("已领取（{{date}}）")).toHaveLength(1);

    // 切到「已领取」：只剩被标记的那张卡（其他卡不可见）
    fireEvent.click(screen.getByText("已领取").closest("button"));
    expect(screen.getAllByText("Agnes AI").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByText(/硅基流动/).length).toBe(0);

    // 切到「未标记」：标记过的卡隐藏
    fireEvent.click(screen.getByText("待领取").closest("button"));
    expect(screen.queryAllByText("Agnes AI").length).toBe(0);
    expect(screen.getAllByText(/硅基流动/).length).toBeGreaterThanOrEqual(1);

    // 回到「全部」：全量恢复
    fireEvent.click(screen.getByText("全部").closest("button"));
    expect(screen.getAllByText("Agnes AI").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps daily and monthly marks independent and filters the selected cycle", () => {
    render(<ToastProvider><PerksPage /></ToastProvider>);
    const card = screen.getByRole("heading", { name: "WorkBuddy 国内版" }).closest(".group");
    fireEvent.click(within(card).getByRole("button", { name: "本月未领取 · 标记已领取" }));
    fireEvent.click(within(card).getByRole("button", { name: "今日未领取 · 标记已领取" }));
    // 两个周期各自独立：已领取的禁用（不可取消），另一个仍可点
    expect(within(card).getByRole("button", { name: "今日已领取（{{date}}）" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "本月已领取（{{date}}）" })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByRole("button", { name: "本月已领取（{{date}}）" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/搜索服务商/), { target: { value: "WorkBuddy" } });
    fireEvent.click(screen.getByText("每月福利").closest("button"));
    fireEvent.click(screen.getByText("已领取").closest("button"));
    expect(screen.getAllByRole("heading", { name: "WorkBuddy 国内版" }).length).toBeGreaterThanOrEqual(1);
    // daily 也已领取（禁用态）：每日+已领取筛选同样命中——两个周期各自独立记账
    fireEvent.click(screen.getByText("每日可领取积分").closest("button"));
    expect(screen.getAllByRole("heading", { name: "WorkBuddy 国内版" }).length).toBeGreaterThanOrEqual(1);
  });

  it("updates open pages across Beijing midnight without clearing monthly marks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T15:59:59Z"));
    localStorage.setItem(PERKS_LEGACY_CLAIMS_KEY, JSON.stringify({ schema: 2, providers: {
      workbuddy: { daily: "2026-11-03", monthly: "2026-11-01" },
    } }));
    render(<ToastProvider><PerksPage /></ToastProvider>);
    const card = screen.getByRole("heading", { name: "WorkBuddy 国内版" }).closest(".group");
    expect(within(card).getByRole("button", { name: "今日已领取（{{date}}）" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(within(card).getByRole("button", { name: "今日未领取 · 标记已领取" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "本月已领取（{{date}}）" })).toBeInTheDocument();
  });

  it("refreshes monthly marks on the first and catches up after sleep on focus", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T15:59:59Z"));
    localStorage.setItem(PERKS_LEGACY_CLAIMS_KEY, JSON.stringify({ schema: 2, providers: {
      ant_ling: { monthly: "2026-10-10" }, agentrouter: { daily: "2026-10-31" },
    } }));
    render(<ToastProvider><PerksPage /></ToastProvider>);
    const ant = screen.getByRole("heading", { name: "蚂蚁百灵 (Ant Ling)" }).closest(".group");
    expect(within(ant).getByRole("button", { name: "本月已领取（{{date}}）" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(within(ant).getByRole("button", { name: "本月未领取 · 标记已领取" })).toBeInTheDocument();
    const router = screen.getByRole("heading", { name: "Agent Router" }).closest(".group");
    fireEvent.click(within(router).getByRole("button", { name: "今日未领取 · 标记已领取" }));
    vi.setSystemTime(new Date("2026-11-03T08:00:00Z"));
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(within(router).getByRole("button", { name: "今日未领取 · 标记已领取" })).toBeInTheDocument();
  });

  it("migrates legacy dates and preserves the original record", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T08:00:00Z"));
    const legacy = JSON.stringify({ workbuddy: "2026-11-01", agnes: "2026-10-01", retired: "2026-11-03" });
    localStorage.setItem("tokentracker.perks.claims.v1", legacy);
    render(<ToastProvider><PerksPage /></ToastProvider>);
    const card = screen.getByRole("heading", { name: "WorkBuddy 国内版" }).closest(".group");
    expect(within(card).getByRole("button", { name: "今日未领取 · 标记已领取" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "本月已领取（{{date}}）" })).toBeInTheDocument();
    expect(localStorage.getItem("tokentracker.perks.claims.v1")).toBe(legacy);
    const migrated = JSON.parse(localStorage.getItem(PERKS_CLAIMS_KEY));
    expect(migrated.schema).toBe(3);
    expect(migrated.providers.agnes.once).toEqual({ last: "2026-10-01", count: 1 });
    expect(migrated.providers.retired).toBeUndefined();
  });

  it("observes other windows and keeps unrelated cycle updates", () => {
    render(<ToastProvider><PerksPage /></ToastProvider>);
    localStorage.setItem(PERKS_LEGACY_CLAIMS_KEY, JSON.stringify({ schema: 2, providers: {
      workbuddy: { monthly: getPerkClaimDay() },
    } }));
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: PERKS_CLAIMS_KEY })); });
    const card = screen.getByRole("heading", { name: "WorkBuddy 国内版" }).closest(".group");
    fireEvent.click(within(card).getByRole("button", { name: "今日未领取 · 标记已领取" }));
    expect(JSON.parse(localStorage.getItem(PERKS_CLAIMS_KEY)).providers.workbuddy).toEqual({
      daily: { last: getPerkClaimDay(), count: 1 },
      monthly: { last: getPerkClaimDay(), count: 1 },
    });
  });

  it("preserves both marks in memory when writes are blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota reached"); });
    render(<ToastProvider><PerksPage /></ToastProvider>);
    const card = screen.getByRole("heading", { name: "WorkBuddy 国内版" }).closest(".group");
    fireEvent.click(within(card).getByRole("button", { name: "今日未领取 · 标记已领取" }));
    fireEvent.click(within(card).getByRole("button", { name: "本月未领取 · 标记已领取" }));
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(within(card).getByRole("button", { name: "今日已领取（{{date}}）" })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByRole("button", { name: "本月已领取（{{date}}）" })).toHaveAttribute("aria-pressed", "true");
  });

  it("英文界面下国际卡显示英文内容（纯中国卡保持中文）", async () => {
    const { getCopyLocale } = await import("../lib/copy");
    getCopyLocale.mockReturnValue("en");
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    // 国际卡（有英文 overlay）：智谱双站卡显示英文卡名与英文描述
    expect(screen.getByText(/Zhipu Open Platform/)).toBeInTheDocument();
    expect(screen.getByText(/An AI-first code editor by Anysphere/)).toBeInTheDocument();
    expect(screen.getByText(/DeepSeek-V4\.1-Flash free calls ended/)).toBeInTheDocument();
    expect(screen.getByText(/HY3 remains available for free/)).toBeInTheDocument();
    // 纯中国卡无 overlay，保持中文
    expect(screen.getByRole("heading", { level: 3, name: /阿里百炼/ })).toBeInTheDocument();
    const names = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(names).toEqual(ORDERED_IDS.map((id) => localizePerk(PERK_PROVIDERS.find((row) => row.id === id), "en").name));
    getCopyLocale.mockReturnValue("zh");
  });

  it("AIHOT 式卡册：常驻页首、统计头、暗卡悬念、收卡进度、圆点翻页", () => {
    localStorage.setItem("tokentracker.perks.claims.v3", JSON.stringify({
      schema: 3,
      providers: {
        // minimax_code：连领 31 次（tier 4）且今天领过 → 翻成正面揭示（图3）
        minimax_code: { daily: { last: getPerkClaimDay(), count: 31 } },
        // qoder_cn：免费调用已下线（retired）→ 绝版纸卡 + 章 + ×8
        qoder_cn: { daily: { last: "2020-01-01", count: 8 } },
        // agentrouter：领过 1 次、今天没领 → 青色卡背等待态（图2，×1）
        agentrouter: { daily: { last: "2020-01-01", count: 1 } },
      },
    }));
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    // 卡册常驻：不需要切换按钮，页首直接有「我的卡册」+ 统计头
    expect(screen.getByText("我的卡册")).toBeInTheDocument();
    expect(screen.getByText("今天还能领")).toBeInTheDocument();
    expect(screen.getByText("本月已领到")).toBeInTheDocument();
    expect(screen.getByText("下次刷新")).toBeInTheDocument();
    expect(screen.getByText(/{{collected}} \/ {{total}} 张已收/)).toBeInTheDocument();
    // qoder_cn retired → 统计行 + 玻璃柜各带一份绝版计数
    expect(screen.getAllByText(/绝版 \{\{count\}\} 张/).length).toBeGreaterThanOrEqual(1);
    // 倒计时按 HH:MM:SS 每秒跳
    expect(document.body.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);

    // 卡牌带：按价值档位色从琥珀排到灰（站主 2026-11-12），不管领取状态；
    // 绝版卡移出主卡册进玻璃柜
    const album = screen.getByText("我的卡册").closest("div.mb-8");
    const cards = [...album.querySelectorAll(".perk-mini")];
    expect(cards.length).toBe(18); // 每页 18 张（两排×9）
    // 档位排序不变式：任意相邻两张，前者的档位权重不低于后者（琥珀→灰）
    const TIER_RANK = { amber: 5, rose: 4, purple: 3, blue: 2, success: 1, neutral: 0 };
    const rankOf = (card) => {
      const id = card.getAttribute("aria-label").split(" — ")[0];
      const row = PERK_PROVIDERS.find((r) => r.name === id);
      return TIER_RANK[row?.badgeType] ?? 0;
    };
    for (let idx = 1; idx < cards.length; idx += 1) {
      expect(rankOf(cards[idx - 1])).toBeGreaterThanOrEqual(rankOf(cards[idx]));
    }
    // 琥珀档并列时 A-Z 收尾：Agent Router 在 AutoClaw 国内版之前
    expect(cards[0].getAttribute("aria-label")).toContain("Agent Router");
    expect(cards[1].getAttribute("aria-label")).toContain("AutoClaw 国内版");
    // qoder_cn 已绝版 → 主卡册不再出现
    expect(cards.find((card) => card.getAttribute("aria-label").includes("Qoder CN"))).toBeUndefined();
    // 今天领过 = 翻成正面揭示（AIHOT 图3），×31 画在正面右下
    //（minimax 是蓝档，档位排序后落在后面的页——逐页找）
    const dotsForSearch = [...album.querySelectorAll("button")].filter(function (b) { return b.className.includes("rounded-full") && !b.querySelector("svg"); });
    let minimaxCard = null;
    for (let page = 0; page < dotsForSearch.length && !minimaxCard; page += 1) {
      fireEvent.click(dotsForSearch[page]);
      minimaxCard = [...album.querySelectorAll(".perk-mini")].find(function (card) { return card.textContent.includes("×31"); }) || null;
    }
    expect(minimaxCard).toBeTruthy();
    expect(minimaxCard.className).toContain("is-collected");
    expect(minimaxCard.querySelector(".perk-card-front")).toBeTruthy();
    expect(minimaxCard.querySelector(".perk-card-back")).toBeNull();
    // 以前领过、今天没领 = 青色卡背等待态（AIHOT 图2），×N 在卡背
    const waitingBack = cards.find((card) => card.className.includes("is-uncollected") && card.querySelector(".perk-card-back"));
    expect(waitingBack).toBeTruthy();
    expect(waitingBack.textContent).toContain("×");
    // retired 卡（qoder_cn 免费调用下线）= 玻璃柜里的纸卡 + 绝版章 + ×8
    const sealedCard = [...document.querySelectorAll(".perk-mini")].find((card) => card.textContent.includes("×8") && card.querySelector(".perk-seal"));
    expect(sealedCard).toBeTruthy();
    expect(sealedCard.closest(".relative.overflow-hidden.rounded-2xl")).toBeTruthy(); // 玻璃柜容器

    // 圆点翻页：53 张 / 18 = 3 页 → 3 个圆点 + 左右箭头
    const dots = [...album.querySelectorAll("button")].filter(function (b) { return b.className.includes("rounded-full") && !b.querySelector("svg"); });
    expect(dots.length).toBe(3);
    fireEvent.click(dots[2]);
    // 翻到第 3 页仍然有小卡（尾页是 A-Z 尾部品牌）
    expect(album.querySelectorAll(".perk-mini").length).toBeGreaterThan(0);
  });

  it("albumBrightnessTier：AIHOT 式 7/15/30 分档，once 领过即亮", () => {
    expect(albumBrightnessTier(0)).toBe(0);
    expect(albumBrightnessTier(1)).toBe(1);
    expect(albumBrightnessTier(6)).toBe(1);
    expect(albumBrightnessTier(7)).toBe(2);
    expect(albumBrightnessTier(14)).toBe(2);
    expect(albumBrightnessTier(15)).toBe(3);
    expect(albumBrightnessTier(29)).toBe(3);
    expect(albumBrightnessTier(30)).toBe(4);
    expect(albumBrightnessTier(999)).toBe(4);
    expect(albumBrightnessTier(-1)).toBe(0);
    expect(albumBrightnessTier(NaN)).toBe(0);
    expect(ALBUM_PAGE_SIZE).toBe(18);
  });

  it("卡册小卡点击联动：平滑滚动到下方详情卡并闪烁高亮，1.3s 后摘除", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const scrollSpy = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function spy() { scrollSpy(this); };
    try {
      render(
        <ToastProvider>
          <PerksPage />
        </ToastProvider>
      );

      // 卡册第一页 18 张全是 button；暗卡文本为空（悬念设计），品牌名走 aria-label
      const albumJumpButtons = screen.getAllByTitle("跳到下方卡片");
      // 主卡册第一页 18 张 + 玻璃柜里的已领绝版卡（qoder_cn）都可点
      expect(albumJumpButtons.length).toBeGreaterThanOrEqual(18);
      const firstCard = albumJumpButtons[0];
      const miniName = firstCard.getAttribute("aria-label").split(" — ")[0];
      expect(miniName.length).toBeGreaterThan(0);

      // 点击 → 滚动触发 + 通过品牌名反查详情卡（卡册与详情同源，必须能跳）
      fireEvent.click(firstCard);
      // jumpToCard 走 requestAnimationFrame：fake timers 下手动推进一帧
      act(() => { vi.advanceTimersByTime(16); });
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      const matched = PERK_PROVIDERS.find((row) => row.name === miniName);
      expect(matched).toBeTruthy();
      const detailCard = document.getElementById(`perk-${matched.id}`);
      expect(detailCard).toBeTruthy();
      expect(detailCard.className).toContain("perk-card-flash");

      // 1.3s 后摘除，动画不残留
      act(() => { vi.advanceTimersByTime(1400); });
      expect(detailCard.className).not.toContain("perk-card-flash");
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("领取翻面：等待态青背（图2）翻成正面揭示（图3），flip-key 递增且按钮禁用", async () => {
    localStorage.setItem("tokentracker.perks.claims.v3", JSON.stringify({
      schema: 3,
      providers: {
        // agentrouter 已收 ×3（daily 今天未领）→ 等待态青背（图2）
        agentrouter: { daily: { last: "2020-01-01", count: 3 } },
      },
    }));
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    // 卡册里的等待卡（×3 青背）在第一页，data-flip-key 初始 0
    const album = screen.getByText("我的卡册").closest("div.mb-8").parentElement;
    const miniWithStreak = [...album.querySelectorAll(".perk-mini")]
      .find((node) => node.textContent.includes("×3"));
    expect(miniWithStreak).toBeTruthy();
    expect(miniWithStreak.className).toContain("is-uncollected");
    expect(miniWithStreak.querySelector(".perk-card-back")).toBeTruthy();
    expect(miniWithStreak.getAttribute("data-flip-key")).toBe("0");

    // 明细卡上标记今日已领取 → streak +1 → 正面节点重建（翻面：图2→图3）
    const detail = screen.getByRole("heading", { name: "Agent Router" }).closest(".group");
    fireEvent.click(within(detail).getByRole("button", { name: "今日未领取 · 标记已领取" }));
    // 翻面延迟 500ms 等滚动到位（站主要求滚回卡册后才翻），断言等它落地
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
    expect(miniWithStreak.getAttribute("data-flip-key")).toBe("1");

    // 已领取按钮禁用（AIHOT 口径：领了就是领了）——streak 不变 → 不重播，
    // 正面保持（今天领过 = 揭示态，直到次日自动翻回等待青背）
    expect(within(detail).getByRole("button", { name: "今日已领取（{{date}}）" })).toBeDisabled();
    fireEvent.click(within(detail).getByRole("button", { name: "今日已领取（{{date}}）" }));
    expect(miniWithStreak.className).toContain("is-collected");
    expect(miniWithStreak.querySelector(".perk-card-front")).toBeTruthy();
    expect(miniWithStreak.getAttribute("data-flip-key")).toBe("1");
  });


  it("明细卡标记已领取后视口滚回卡册对应小卡（翻面动画要被看见）", () => {
    // （此块内 scrollIntoView 用 this 包装，见下方赋值）
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const scrollSpy = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function spy() { scrollSpy(this); };
    try {
      localStorage.clear();
      render(
        <ToastProvider>
          <PerksPage />
        </ToastProvider>
      );

      // 未领取时点明细卡的标记按钮 → 滚到卡册里那张小卡
      const detail = screen.getByRole("heading", { name: "Agnes AI" }).closest(".group");
      fireEvent.click(within(detail).getByRole("button", { name: "标记已领取" }));
      // 页码切换 + 双 rAF 后平滑滚动到 data-perk-id 小卡（翻面在那里）
      act(() => { vi.advanceTimersByTime(32); });
      expect(scrollSpy).toHaveBeenCalled();
      // 多个调用者可能碰 scrollIntoView：锁定滚到 agnes 小卡的那次
      const targets = scrollSpy.mock.calls.map((call) => call[0]).filter((el) => el && typeof el.getAttribute === "function");
      const scrolledTo = targets.find((el) => el.getAttribute("data-perk-id") === "agnes");
      expect(scrolledTo).toBeTruthy();
      expect(scrolledTo.className).toContain("perk-mini");

      // 取消领取不触发滚动（只有标记才滚）
      scrollSpy.mockClear();
      fireEvent.click(within(detail).getByRole("button", { name: "已领取（{{date}}）" }));
      act(() => { vi.advanceTimersByTime(32); });
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("绝版卡点击弹窗：展示已下线福利详情（面值条写限时福利，非 faceValue）", async () => {
    localStorage.setItem("tokentracker.perks.claims.v3", JSON.stringify({
      schema: 3,
      providers: {
        qoder_cn: { daily: { last: "2020-01-01", count: 8 } },
      },
    }));
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    // 玻璃柜里的绝版卡：面值条显示 retiredDeal.label 而非 AIHOT faceValue
    const sealedMini = [...document.querySelectorAll(".perk-mini")].find((card) => card.querySelector(".perk-seal"));
    expect(sealedMini).toBeTruthy();
    expect(sealedMini.textContent).toContain("模型限时免费");
    expect(sealedMini.querySelector(".perk-card-aged")).toBeTruthy();

    // 初始无弹窗 → 点击绝版卡 → 弹窗出现（标题=卡名 + 详情文案）
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(sealedMini);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Qoder CN (国内版)");
    expect(dialog.textContent).toContain("模型限时免费");
    expect(dialog.textContent).toContain("已下线");

    // 点背景关闭
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("价值等级筛选：点六色 chip 后只保留该档卡片，计数与数据一致", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    const legendButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.getAttribute("aria-pressed") !== null && /小额免费|中等免费/.test(btn.textContent));
    expect(legendButtons.length).toBeGreaterThan(0);
    const successChip = legendButtons.find((btn) => btn.textContent.includes("小额免费"));
    fireEvent.click(successChip);

    const expected = PERK_PROVIDERS.filter((row) => row.badgeType === "success").length;
    expect(expected).toBeGreaterThan(0);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(expected);

    // 再点一次同一 chip 回到全部档位
    fireEvent.click(successChip);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(PERK_PROVIDERS.length);
  });

  it("卡册小卡带价值等级色条，与六档一一对应", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    const album = screen.getByText("我的卡册").closest("div.mb-8").parentElement;
    const cards = [...album.querySelectorAll(".perk-mini")];
    expect(cards.length).toBe(ALBUM_PAGE_SIZE);
    const strip = [...cards[0].querySelectorAll("span[aria-hidden='true']")].find((node) =>
      node.className.includes("bottom-0"),
    );
    expect(strip).toBeTruthy();
    // 色条只用六档实色之一
    const tiers = ["bg-oai-gray-400", "bg-emerald-500", "bg-sky-500", "bg-purple-500", "bg-rose-500", "bg-amber-500"];
    expect(tiers.some((cls) => strip.className.includes(cls))).toBe(true);
  });

  it("perkDaysLeft：按北京时间自然日算剩余天数，过期判定为已结束", () => {
    const now = Date.parse("2026-11-12T01:00:00+08:00");
    expect(perkDaysLeft(undefined, now)).toBeNull();
    expect(perkDaysLeft("2026-11-13", now)).toEqual({ ended: false, days: 2 });
    expect(perkDaysLeft("2026-11-30", now)).toEqual({ ended: false, days: 19 });
    expect(perkDaysLeft("2026-11-11", now)).toEqual({ ended: true, days: 0 });
    expect(perkDaysLeft("not-a-date", now)).toBeNull();
  });

  it("cardRarity：AIHOT 官方阈值（daily 7/15/30、monthly 1/2/3、once 按价值 → 蓝/金/闪）", () => {
    // 每天能领的：7/15/30 → 蓝/金/闪（官方规则原文）
    expect(cardRarity({ daily: 6 })).toBeNull();
    expect(cardRarity({ daily: 7 })).toBe("blue");
    expect(cardRarity({ daily: 14 })).toBe("blue");
    expect(cardRarity({ daily: 15 })).toBe("gold");
    expect(cardRarity({ daily: 29 })).toBe("gold");
    expect(cardRarity({ daily: 30 })).toBe("holo");
    // 每月能领的：1/2/3
    expect(cardRarity({ monthly: 1 })).toBe("blue");
    expect(cardRarity({ monthly: 2 })).toBe("gold");
    expect(cardRarity({ monthly: 3 })).toBe("holo");
    // 只能领一次的：看这一次价值 ¥10/¥50/¥100
    expect(cardRarity({ once: 1 }, 9)).toBeNull();
    expect(cardRarity({ once: 1 }, 10)).toBe("blue");
    expect(cardRarity({ once: 1 }, 50)).toBe("gold");
    expect(cardRarity({ once: 1 }, 100)).toBe("holo");
    // 多周期取最高档
    expect(cardRarity({ daily: 20, monthly: 3 })).toBe("holo");
  });

  it("活动截止日：详情卡渲染「还剩 N 天」，未写截止日的卡不渲染", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    const withDeadline = PERK_PROVIDERS.filter((row) => row.endsAt);
    expect(withDeadline.length).toBeGreaterThan(0);
    // 本文件的 copy mock 返回未插值模板（house style），所以断言模板文本
    expect(screen.getAllByText("还剩 {{days}} 天")).toHaveLength(withDeadline.length);

    // 三张卡暂无过期（均为未来活动），所以统计头不出现「绝版」
    expect(screen.queryByText(/^绝版 \{\{count\}\} 张$/)).not.toBeInTheDocument(); // 暂无过期活动
  });

  it("稀有度与绝版：等待态卡背按连击挂金档，活动过期即绝版（未领也盖章）并计数", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-20T10:00:00+08:00"));
    // 先定假时钟再种数据：last=2020 → 等待态青背，金档材质刻在卡背上
    //（qoder_cn 已 retired，换 agentrouter 承载稀有度断言）。
    localStorage.setItem("tokentracker.perks.claims.v3", JSON.stringify({
      schema: 3,
      providers: {
        agentrouter: { daily: { last: "2020-01-01", count: 15 } },
        // autoclaw 活动已过期：领过 → 玻璃柜陈列 + 盖章（没领过的绝版不陈列）
        autoclaw: { daily: { last: getPerkClaimDay(), count: 1 } },
      },
    }));
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    const album = screen.getByText("我的卡册").closest("div.mb-8").parentElement;
    // 金档：15 次连击的等待卡背挂 perk-rarity-gold
    const goldBack = album.querySelector(".perk-rarity-gold");
    expect(goldBack).toBeTruthy();

    // autoclaw 的活动 2026-11-15 已结束（站主口径：活动结束即绝版，与领取无关）
    // → 绝版卡移入玻璃柜独立陈列，纸面盖红章；统计头/玻璃柜各有一份计数
    expect(document.querySelector(".perk-seal")).toBeTruthy();
    expect(screen.getAllByText(/绝版 \{\{count\}\} 张/).length).toBeGreaterThanOrEqual(1);
  });
});
