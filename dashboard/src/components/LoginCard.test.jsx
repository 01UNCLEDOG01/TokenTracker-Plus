import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginCard } from "./LoginCard.jsx";

// 站主 2026-11-13：登录框每次都要重敲邮箱。上次成功登录的邮箱应自动回填，
// 会话恢复失败时至少只剩密码要敲一遍。

vi.mock("../lib/copy", () => ({
  copy: (key, vars) => (vars?.host ? `${key}:${vars.host}` : key),
}));

vi.mock("../hooks/useLocale.js", () => ({
  useLocale: () => ({ resolvedLocale: "zh-CN" }),
}));

vi.mock("../lib/native-bridge.js", () => ({
  getNativeOAuthBridge: () => null,
  isNativeApp: () => false,
  isNativeEmbed: () => false,
  isNativeWindowsApp: () => false,
}));

const signInWithPassword = vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null }));
// 稳定引用：LoginCard 的 config effect 依赖 getPublicAuthConfig，每次渲染换新函数
// 会让它无限重挂。
const getPublicAuthConfig = async () => ({ data: { oAuthProviders: [] }, error: null });

vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => authState,
}));

const authState = {
  enabled: true,
  configurationError: null,
  connectionHost: "192.168.100.1:17682",
  signedIn: false,
  refreshUser: async () => {},
  signInWithPassword,
  signUp: async () => ({ data: null, error: null }),
  signInWithOAuth: async () => ({ data: null, error: null }),
  getPublicAuthConfig,
  sendResetPasswordEmail: async () => ({ data: null, error: null }),
  exchangeResetPasswordToken: async () => ({ data: null, error: null }),
  resetPassword: async () => ({ data: null, error: null }),
};

describe("LoginCard remembered email", () => {
  beforeEach(() => {
    window.localStorage.clear();
    signInWithPassword.mockClear();
  });

  it("prefills the last successfully used email", async () => {
    window.localStorage.setItem("tt.login.lastEmail", "1055171903@qq.com");

    render(<LoginCard />);

    const input = await screen.findByLabelText("login.field.email");
    expect(input).toHaveValue("1055171903@qq.com");
  });

  it("falls back to an empty field on a fresh profile", async () => {
    render(<LoginCard />);

    // 没有记忆邮箱时邮箱栏默认收起，先展开再看取值为空。
    (await screen.findByRole("button", { name: "login_modal.continue_email" })).click();

    const input = await screen.findByLabelText("login.field.email");
    expect(input).toHaveValue("");
  });

  it("remembers the email after a successful password sign-in", async () => {
    render(<LoginCard />);

    (await screen.findByRole("button", { name: "login_modal.continue_email" })).click();

    const input = await screen.findByLabelText("login.field.email");
    input.focus();
    // fireEvent-free: set the value the way React sees a real change.
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setValue.call(input, "someone@example.com");
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const password = screen.getByLabelText("login.field.password");
    setValue.call(password, "secret-password");
    password.dispatchEvent(new Event("input", { bubbles: true }));

    screen.getByRole("button", { name: "login.submit.sign_in" }).click();

    await vi.waitFor(() => {
      expect(signInWithPassword).toHaveBeenCalledWith({ email: "someone@example.com", password: "secret-password" });
      expect(JSON.parse(window.localStorage.getItem("tt.login.lastEmail"))).toEqual({
        instance: "",
        email: "someone@example.com",
      });
    });
  });
});
