// Loopback Host / Origin allowlist helpers shared by the local HTTP surfaces.
// 审计 2026-10-25 P0-1/S2：DNS rebinding 与「同机异端口」的跨源页面都要在这里挡住。

function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

/**
 * Strict Host allowlist for the request entry: the Host header must name a
 * loopback hostname and — when the bound port is known — carry exactly that
 * port. A DNS-rebinding browser puts the rebinded domain into Host, and GET
 * requests carry no Origin to check, so this is the one gate that covers
 * every endpoint (reads and writes alike).
 */
function isAllowedLoopbackHostHeader(hostHeader, boundPort) {
  if (typeof hostHeader !== "string") return false;
  const raw = hostHeader.trim().toLowerCase();
  if (!raw) return false;
  let hostname = raw;
  let port = "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end === -1) return false;
    hostname = raw.slice(1, end);
    port = raw.slice(end + 1).replace(/^:/, "");
  } else {
    const at = raw.lastIndexOf(":");
    if (at !== -1) {
      hostname = raw.slice(0, at);
      port = raw.slice(at + 1);
    }
  }
  if (!isLoopbackHostname(hostname)) return false;
  if (boundPort == null) return true;
  return port === String(boundPort);
}

module.exports = { isLoopbackHostname, isAllowedLoopbackHostHeader };
