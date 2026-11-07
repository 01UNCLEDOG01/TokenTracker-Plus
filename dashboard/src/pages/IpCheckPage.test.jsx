import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copy } from "../lib/copy";
import IpCheckPage from "./IpCheckPage.jsx";

const PROXY_BASE = "/proxy/ipcheck";
const IP_HISTORY_KEY = "claude_ip_history";

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

// Route the page's probe fan to a synthetic upstream: a fixed Claude-facing
// IP with risk + geo answers so saveAndRenderIPHistory() actually runs and
// renders the entry into #ipHistoryContent.
function stubProbes({ claudeIp }) {
  const impl = (url) => {
    const u = String(url);
    if (u.startsWith(`${PROXY_BASE}/api/iprisk/`)) {
      return jsonResponse({
        ip: claudeIp, asn: 12345, asOrganization: "Example ISP",
        country: "United States", countryCode: "US", region: "CA", city: "Example City",
        isResidential: true, isBroadcast: false, trust_score: 42, timezone: "America/Los_Angeles",
      });
    }
    if (u.startsWith(`${PROXY_BASE}/api/geoip/`)) {
      return jsonResponse({ country: "United States", country_code: "US", region: "CA", city: "Example City", isp: "Example ISP" });
    }
    // cdn-cgi traces: text bodies with an ip= line; ip138/ip.cn HTML probes.
    return {
      ok: true, status: 200,
      text: async () => (u.includes("cdn-cgi/trace")
        ? `ip=${claudeIp}\nloc=US\nhttp=o\n tls=TLSv1.3\n`
        : `<html>{"ip":"203.0.113.9"}</html>`),
      json: async () => ({}),
    };
  };
  return vi.stubGlobal("fetch", vi.fn(impl));
}

function historyContainer() {
  return document.querySelector("#ipHistoryContent");
}

// Regression for upstream TT v1.5.11: the IP page wrote/cleared its
// localStorage history unguarded, so a full or blocked storage (quota
// exceeded, private mode) crashed the effect mid-render and the history
// panel stayed stuck on its loading placeholder. The read side already had
// a try/catch — write and clear must degrade the same way: history
// persistence is optional, the page is not.
describe("IpCheckPage IP history storage resilience", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("keeps the history panel alive even when localStorage.setItem throws", async () => {
    stubProbes({ claudeIp: "203.0.113.7" });
    const loading = copy("ipcheck.ip.loading");
    const empty = copy("ipcheck.history.empty");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    render(<IpCheckPage />);
    // The panel must not stay stuck on its loading placeholder: a throwing
    // write must not abort the render that follows it. The entry itself can
    // only live in memory here, so the settled state is the empty copy.
    await vi.waitFor(() => {
      const text = historyContainer()?.textContent || "";
      expect(text).not.toContain(loading);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain(empty);
    });
  });

  it("persists history when storage is healthy", async () => {
    stubProbes({ claudeIp: "203.0.113.7" });
    render(<IpCheckPage />);
    await vi.waitFor(() => {
      const raw = localStorage.getItem(IP_HISTORY_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw)[0].ip).toBe("203.0.113.7");
    });
  });

  it("clearing history survives a throwing localStorage.removeItem", async () => {
    stubProbes({ claudeIp: "203.0.113.7" });
    render(<IpCheckPage />);
    await vi.waitFor(() => {
      expect(localStorage.getItem(IP_HISTORY_KEY)).not.toBeNull();
    });
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    // The clear button routes through containerRef.__clearIPHistory.
    const root = document.querySelector(".font-oai");
    expect(typeof root?.__clearIPHistory).toBe("function");
    expect(() => root.__clearIPHistory()).not.toThrow();
    expect(removeSpy).toHaveBeenCalled();
    removeSpy.mockRestore();
    // renderIPHistory still ran: the panel fell back to its empty-state copy.
    expect(historyContainer()).not.toBeNull();
  });
});
