import { describe, expect, it, vi } from "vitest";
import { restoreInsforgeUser } from "./insforge-session-recovery.mjs";

// 站主 2026-11-13：Mac 开面板每次都要重输邮箱密码。旧实现只在挂载时恢复一次，
// 冷启动撞上本地服务还在起（代理 502/503）或实例一时不可达就直接判定未登录，
// 之后整窗都停在登录表单。这里钉死"瞬时失败要重试、真 401 直接走刷新"。

const noWait = async () => {};

function authStub({ currentUser = [], refresh = [] }) {
  const getCurrentUser = vi.fn(async () => {
    const next = currentUser.length > 1 ? currentUser.shift() : currentUser[0];
    return next ?? { data: { user: null }, error: null };
  });
  const refreshSession = vi.fn(async () => {
    const next = refresh.length > 1 ? refresh.shift() : refresh[0];
    return next ?? { data: null, error: null };
  });
  return { getCurrentUser, refreshSession };
}

const user = { id: "fixture-user" };

describe("restoreInsforgeUser", () => {
  it("transient proxy 502 on refresh is retried until the session comes back", async () => {
    const auth = authStub({
      currentUser: [{ data: { user: null }, error: null }, { data: { user }, error: null }],
      refresh: [
        { data: null, error: Object.assign(new Error("bad gateway"), { status: 502 }) },
        { data: { accessToken: "token" }, error: null },
      ],
    });

    const result = await restoreInsforgeUser(auth, { settleDelayMs: 0, wait: noWait });

    expect(auth.refreshSession).toHaveBeenCalledTimes(2);
    expect(result?.data?.user).toEqual(user);
  });

  it("a lost refresh response (no status) is never replayed — rotation may already have happened", async () => {
    const auth = authStub({
      currentUser: [{ data: { user: null }, error: null }],
      refresh: [{ data: null, error: new Error("fetch failed") }],
    });

    const result = await restoreInsforgeUser(auth, { settleDelayMs: 0, wait: noWait });

    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(result?.data?.user ?? null).toBeNull();
  });

  it("a real 401 refresh failure is not retried (dead session must not hammer the instance)", async () => {
    const auth = authStub({
      currentUser: [{ data: { user: null }, error: null }],
      refresh: [{ data: null, error: Object.assign(new Error("unauthorized"), { status: 401 }) }],
    });

    const result = await restoreInsforgeUser(auth, { settleDelayMs: 0, wait: noWait });

    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(result?.data?.user ?? null).toBeNull();
  });

  it("gives up after the bounded retry budget when the failure is persistent", async () => {
    const auth = authStub({
      currentUser: [{ data: { user: null }, error: null }],
      refresh: [{ data: null, error: Object.assign(new Error("bad gateway"), { status: 503 }) }],
    });

    const result = await restoreInsforgeUser(auth, {
      settleDelayMs: 0,
      wait: noWait,
      retryDelaysMs: [10, 20],
    });

    expect(auth.refreshSession).toHaveBeenCalledTimes(3); // first attempt + 2 retries
    expect(result?.data?.user ?? null).toBeNull();
  });

  it("stops retrying once the caller is no longer active", async () => {
    let active = true;
    const auth = authStub({
      currentUser: [{ data: { user: null }, error: null }],
      refresh: [{ data: null, error: Object.assign(new Error("bad gateway"), { status: 502 }) }],
    });

    const result = await restoreInsforgeUser(auth, {
      settleDelayMs: 0,
      isActive: () => active,
      wait: async () => {
        active = false;
      },
      retryDelaysMs: [10, 20, 30],
    });

    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(result?.data?.user ?? null).toBeNull();
  });

  it("a transient read failure (server still booting) is retried before giving up", async () => {
    const auth = authStub({
      currentUser: [
        { data: null, error: Object.assign(new Error("bad gateway"), { status: 503 }) },
        { data: { user }, error: null },
      ],
      refresh: [{ data: {}, error: null }],
    });

    const result = await restoreInsforgeUser(auth, { settleDelayMs: 0, wait: noWait });

    expect(auth.getCurrentUser).toHaveBeenCalledTimes(2);
    expect(result?.data?.user).toEqual(user);
  });

  it("a healthy cookie session skips the refresh entirely", async () => {
    const auth = authStub({ currentUser: [{ data: { user }, error: null }], refresh: [{ data: {}, error: null }] });

    const result = await restoreInsforgeUser(auth, { settleDelayMs: 0, wait: noWait });

    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(result?.data?.user).toEqual(user);
  });
});
