import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPublicVisibility } from "./api";

// 面板保存链路的层级守卫（2026-11-12）：setPublicVisibility 的解构参数
// 曾经漏掉 avatar_url——上传的 data URL 在这一层被静默丢弃，服务端收到的
// body 里根本没有头像字段，界面却提示保存成功。直连 edge function 的
// E2E 测不到这层，必须在这里锁住字段透传。

vi.mock("./insforge-config", () => ({
  getInsforgeRemoteUrl: () => "https://config.example.insforge.app",
  getInsforgeAnonKey: () => "anon-key",
}));
vi.mock("./mock-data", () => ({ isMockEnabled: () => false }));

function jwt(sub = "one", exp = Date.now() / 1000 + 3600) {
  const encode = (value: any) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256" })}.${encode({ sub, exp })}.signature`;
}
const json = (value: any, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});

let fetchMock: ReturnType<typeof vi.fn>;
function lastVisibilityBody(): any {
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes("tokentracker-public-visibility"));
  expect(calls.length).toBeGreaterThan(0);
  return JSON.parse(calls[calls.length - 1][1].body);
}

describe("setPublicVisibility avatar passthrough", () => {
  beforeEach(() => {
    fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("上传的 data URL 进入请求 body（不再被解构丢弃）", async () => {
    const dataUrl = "data:image/jpeg;base64," + "A".repeat(600);
    await setPublicVisibility({ accessToken: jwt(), avatar_url: dataUrl });
    expect(lastVisibilityBody().avatar_url).toBe(dataUrl);
  });

  it("null 显式清除头像（保留 null 语义，不当作缺失）", async () => {
    await setPublicVisibility({ accessToken: jwt(), avatar_url: null });
    const body = lastVisibilityBody();
    expect(body.avatar_url).toBeNull();
  });

  it("未传 avatar_url 时 body 不携带该字段", async () => {
    await setPublicVisibility({ accessToken: jwt(), display_name: "x" });
    expect("avatar_url" in lastVisibilityBody()).toBe(false);
  });
});
