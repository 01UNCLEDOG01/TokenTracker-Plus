import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PerksPage } from "./PerksPage.jsx";
import { ToastProvider } from "../ui/components/Toast.jsx";
import zhCore from "../content/i18n/zh/core.json";

// Mock copy helper using real zh strings
vi.mock("../lib/copy", () => ({
  copy: vi.fn((key) => zhCore[key] || key),
}));

describe("PerksPage", () => {
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

    // 40 家收录（2026-10-31：AutoClaw/WorkBuddy 拆卡 + 新增 ZCode、TRAE 国际版、Cola、Cursor、蚂蚁百灵、飓流AI、APIGOTO、Vyce AI、Agnes 网页版），每行一条 provenance。
    expect(screen.getAllByText("核对 {{date}}")).toHaveLength(42);
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

    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("永久免费")).toBeInTheDocument();
    expect(screen.getByText("每月福利")).toBeInTheDocument();
    expect(screen.getByText("每日可领取积分")).toBeInTheDocument();
    expect(screen.getByText("永久免费").closest("button")).toHaveTextContent("11");
    expect(screen.getByText("每日可领取积分").closest("button")).toHaveTextContent("19");
  });

  it("所有服务商卡片均包含简明清晰的官网直达入口且文案统一", () => {
    render(
      <ToastProvider>
        <PerksPage />
      </ToastProvider>
    );

    const directLinks = screen.getAllByText("官网直达");
    expect(directLinks).toHaveLength(41);
    // Agnes 双站：主按钮改国际站直达，另有中国站直达按钮
    expect(screen.getByText("国际站直达")).toBeInTheDocument();
    expect(screen.getByText("中国站直达")).toBeInTheDocument();
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

    fireEvent.click(screen.getAllByText("标记已领取")[0]);
    expect(screen.getAllByText("已领取（{{date}}）")).toHaveLength(1);
    // 公平排序（中英文名取较前）下首卡为阿里百炼（中文拼音 rank 0）
    expect(Object.keys(JSON.parse(localStorage.getItem("tokentracker.perks.claims.v1")))).toEqual(["qwen"]);

    fireEvent.click(screen.getAllByText("已领取（{{date}}）")[0]);
    expect(screen.queryByText("已领取（{{date}}）")).not.toBeInTheDocument();
    expect(localStorage.getItem("tokentracker.perks.claims.v1")).toBe("{}");
  });
});
