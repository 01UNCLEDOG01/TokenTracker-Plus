import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PerkCardDescription } from "./PerkCard.jsx";
import zhDashboard from "../../content/i18n/zh/dashboard.json";

// House style（同 PerksPage.test.jsx）：copy 返回 zh 原始模板
vi.mock("../../lib/copy", () => ({
  copy: vi.fn((key) => zhDashboard[key] || key),
}));

const SHORT = "官方直连，每日签到领额度。"; // 96 字以内（启发式判短）
const LONG = "长".repeat(200); // 96 字以上（启发式判长）

// 在 <p> 原型上 stub 布局几何（jsdom 没有布局引擎），返回恢复函数。
function stubParagraphGeometry({ scrollHeight, clientHeight }) {
  Object.defineProperty(HTMLParagraphElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(HTMLParagraphElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  return () => {
    delete HTMLParagraphElement.prototype.scrollHeight;
    delete HTMLParagraphElement.prototype.clientHeight;
  };
}

describe("PerkCardDescription 展开全文按钮", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete HTMLParagraphElement.prototype.scrollHeight;
    delete HTMLParagraphElement.prototype.clientHeight;
  });

  it("jsdom 兜底（无布局引擎）：短文案不出按钮", () => {
    render(<PerkCardDescription text={SHORT} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("jsdom 兜底：长文案出按钮且可展开/收起", () => {
    render(<PerkCardDescription text={LONG} />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("展开全文");
    fireEvent.click(button);
    expect(screen.getByRole("button")).toHaveTextContent("收起");
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("展开全文");
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("布局实测：clamp 内放得下的超长文案也不出按钮（本次修复核心）", () => {
    const restore = stubParagraphGeometry({ scrollHeight: 40, clientHeight: 40 });
    try {
      render(<PerkCardDescription text={LONG} />);
      expect(screen.queryByRole("button")).toBeNull();
    } finally {
      restore();
    }
  });

  it("布局实测：clamp 截断（scrollHeight > clientHeight）才出按钮", () => {
    const restore = stubParagraphGeometry({ scrollHeight: 100, clientHeight: 40 });
    try {
      render(<PerkCardDescription text={LONG} />);
      const button = screen.getByRole("button");
      expect(button).toHaveTextContent("展开全文");
      // 展开后不再测量，但按钮要留着让人能收回去
      fireEvent.click(button);
      expect(screen.getByRole("button")).toHaveTextContent("收起");
      expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    } finally {
      restore();
    }
  });
});
