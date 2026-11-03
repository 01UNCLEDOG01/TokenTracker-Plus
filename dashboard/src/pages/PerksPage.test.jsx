import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PerksPage, buildPerksFeedbackUrl } from "./PerksPage.jsx";
import { ToastProvider } from "../ui/components/Toast.jsx";
import zhCore from "../content/i18n/zh/core.json";
import { PERK_PROVIDERS } from "../data/perksData.js";
import { localizePerk } from "../data/perks-i18n-en.js";

const ORDERED_IDS = [
  "agent2api", "agentrouter", "agnes", "agnes_web", "qwen", "amd_token_factory", "ant_ling", "apigoto",
  "autoclaw", "autoclaw_intl", "bigmodel", "catpaw", "cerebras", "cloudflare_workers_ai", "huawei_codearts",
  "cola", "tuanjie_cowork", "cursor", "deepseek", "doubaowork", "google_ai_studio", "groq", "siliconflow",
  "scnet", "volcengine", "spark", "intern_inkstone", "joycode", "tokenrhythm", "juflowai", "longcat", "loomy",
  "minimax_code", "minimax", "modelscope", "nvidia_nim", "opencode", "opencode_go", "openrouter",
  "qwen_work", "qiniu", "qoder_cn", "qoder", "raccoon", "sensenova", "teleagent", "trae_cn", "trae",
  "unisound_maas", "vyceai", "workbuddy_intl", "workbuddy", "zcode",
];

// Mock copy helper using real zh strings
vi.mock("../lib/copy", () => ({
  copy: vi.fn((key) => zhCore[key] || key),
  getCopyLocale: vi.fn(() => "zh"),
}));

describe("PerksPage", () => {
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
    expect(screen.getByText(/智谱开放平台/)).toBeInTheDocument();
    expect(screen.getByText(/硅基流动/)).toBeInTheDocument();
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

    expect(screen.getByText(/硅基流动/)).toBeInTheDocument();
    expect(screen.queryByText(/智谱开放平台/)).not.toBeInTheDocument();
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
    expect(screen.getByText("长期免费").closest("button")).toHaveTextContent("16");
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

  it("支持把卡片标记为已领取并写入 localStorage，再次点击取消", () => {
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
    expect(Object.keys(JSON.parse(localStorage.getItem("tokentracker.perks.claims.v1")))).toEqual(["agnes"]);

    fireEvent.click(screen.getAllByText("已领取（{{date}}）")[0]);
    expect(screen.queryByText("已领取（{{date}}）")).not.toBeInTheDocument();
    expect(localStorage.getItem("tokentracker.perks.claims.v1")).toBe("{}");
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
    expect(screen.getByText("Agnes AI")).toBeInTheDocument();
    expect(screen.queryByText(/硅基流动/)).not.toBeInTheDocument();

    // 切到「未标记」：标记过的卡隐藏
    fireEvent.click(screen.getByText("未标记").closest("button"));
    expect(screen.queryByText("Agnes AI")).not.toBeInTheDocument();
    expect(screen.getByText(/硅基流动/)).toBeInTheDocument();

    // 回到「全部」：全量恢复
    fireEvent.click(screen.getByText("全部").closest("button"));
    expect(screen.getByText("Agnes AI")).toBeInTheDocument();
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
    // 纯中国卡无 overlay，保持中文
    expect(screen.getByText(/阿里百炼/)).toBeInTheDocument();
    const names = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(names).toEqual(ORDERED_IDS.map((id) => localizePerk(PERK_PROVIDERS.find((row) => row.id === id), "en").name));
    getCopyLocale.mockReturnValue("zh");
  });
});
