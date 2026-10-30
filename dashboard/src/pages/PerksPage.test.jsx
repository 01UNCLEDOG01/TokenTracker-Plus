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

    expect(screen.getByText(/WorkBuddy/)).toBeInTheDocument();
    expect(screen.queryByText(/DeepSeek 官方开放平台/)).not.toBeInTheDocument();
  });
});
