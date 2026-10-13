#!/usr/bin/env node
"use strict";

// Join another computer to a private TokenTracker instance.
//
// The standard `tracker device-login` flow needs a browser approval page the
// self-host backend does not serve, so this script performs the same device
// flow programmatically: sign in with the account, authorize a device code,
// grant it with the user token, then poll for the device token and write the
// tracker config. Run it on the new machine with that machine's Node:
//
//   node join-machine.cjs --base-url https://ttj2900.gd.ddnsto.com \
//        --email me@local.test --password '...' [--name "My Laptop"]
//
// The anon key is read from the instance's public config (a role=anon JWT,
// public by design). Re-running replaces this machine's registration.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

function argValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const baseUrl = String(argValue("--base-url", "") || "").replace(/\/$/, "");
const email = argValue("--email");
const password = argValue("--password");
const displayName = argValue("--name", os.hostname());
if (!baseUrl || !email || !password) {
  console.error("usage: node join-machine.cjs --base-url <url> --email <email> --password <password> [--name <device name>]");
  process.exit(1);
}
if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(baseUrl)) {
  console.error("base-url must be HTTPS (or loopback HTTP): the client rejects other forms");
  process.exit(1);
}

const json = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};

(async () => {
  // 1) Instance metadata (anon key).
  const cfg = await json(baseUrl + "/api/auth/public-config");
  const anonKey = cfg.body && cfg.body.anonKey;
  if (!anonKey) {
    console.error("instance did not return an anon key from public-config; is the backend deployed?");
    process.exit(1);
  }

  // 2) Sign in.
  const login = await json(baseUrl + "/api/auth/sessions", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const accessToken = login.body && (login.body.accessToken || login.body.access_token);
  if (!accessToken) {
    console.error("sign-in failed:", login.status, JSON.stringify(login.body).slice(0, 200));
    process.exit(1);
  }

  // 3) Authorize + grant the device code with this machine's identity.
  const machineId = crypto.randomUUID();
  const auth = await json(baseUrl + "/functions/tokentracker-device-flow-authorize", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, apikey: anonKey },
    body: JSON.stringify({
      client_info: `${os.platform()}-${os.arch()} ${displayName}`,
      machine_id: machineId,
    }),
  });
  const userCode = auth.body && auth.body.user_code;
  if (!userCode) {
    console.error("device authorize failed:", auth.status, JSON.stringify(auth.body).slice(0, 200));
    process.exit(1);
  }
  const grant = await json(baseUrl + "/functions/tokentracker-device-flow-grant", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, apikey: anonKey },
    body: JSON.stringify({ user_code: userCode }),
  });
  if (grant.status !== 200) {
    console.error("device grant failed:", grant.status, JSON.stringify(grant.body).slice(0, 200));
    process.exit(1);
  }

  // 4) Poll for the approved device token.
  let device = null;
  for (let attempt = 0; attempt < 12 && !device; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const poll = await json(baseUrl + "/functions/tokentracker-device-flow-poll", {
      method: "POST",
      headers: { apikey: anonKey },
      body: JSON.stringify({ device_code: auth.body.device_code }),
    });
    const status = poll.body && poll.body.status;
    if (status === "approved" && poll.body.device_token) {
      device = poll.body;
      break;
    }
    if (status === "expired" || status === "unknown") {
      console.error("device code", status, "- re-run the script");
      process.exit(1);
    }
  }
  if (!device) {
    console.error("device approval did not complete in time");
    process.exit(1);
  }

  // 5) Write the tracker config for this machine (existing values survive).
  const trackerDir = path.join(os.homedir(), ".tokentracker", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true, mode: 0o700 });
  const configPath = path.join(trackerDir, "config.json");
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (_e) { /* fresh install */ }
  const next = {
    ...config,
    baseUrl,
    anonKey,
    dashboardUrl: baseUrl,
    machineId,
    user_id: device.user_id || (login.body.user && login.body.user.id) || null,
    deviceToken: device.device_token,
    deviceTokenBaseUrl: baseUrl,
    deviceId: device.device_id || config.deviceId || null,
    device_login_at: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), { mode: 0o600 });

  console.log("joined the instance.");
  console.log("  device   :", displayName);
  console.log("  base URL :", baseUrl);
  console.log("  config   :", configPath);
  console.log("next: start (or restart) TokenTracker on this machine, then sign in once in the dashboard.");
})().catch((error) => {
  console.error("join failed:", error && error.message ? error.message : error);
  process.exit(1);
});
