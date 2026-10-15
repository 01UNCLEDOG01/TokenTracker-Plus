# SenseNova (商汤日日新) quota API — recon

Reverse-engineered 2026-10-15 from `platform.sensenova.cn/console` (free public
beta), because there is **no documented balance/quota API** and the console's
login form is slider-captcha-gated (no password automation, same wall as
APIGOTO).

## What the console does

The console is a Next.js app that authenticates against an Ory Hydra instance:

| Step | Endpoint |
| --- | --- |
| authorize (PKCE S256) | `https://platform.sensenova.cn/oauth2/auth?client_id=nova&response_type=code&code_challenge=…&code_challenge_method=S256&redirect_uri=https%3A%2F%2Fplatform.sensenova.cn&state=…&scope=openid+offline+offline_access` |
| token (code / refresh) | `POST https://signin.sensecore.cn/oauth2/token` (form-encoded) |
| logout | `https://signin.sensecore.cn/oauth2/sessions/logout` |

- `client_id` is the literal `nova`; `redirect_uri` is exactly
  `https://platform.sensenova.cn` (no path).
- The access token is a JWT valid **3 hours** (`expires_in: 10799`,
  `session_duration: 10800`); it is kept in `localStorage.access_token` and used
  as `Authorization: Bearer <token>`.
- The SDK keeps its login record in memory only — the refresh token is **not**
  persisted anywhere the page can read (localStorage, sessionStorage, cookies
  and IndexedDB were all checked), so a page reload falls back to a silent
  `prompt`-less authorize in a hidden frame using the SSO cookie.

## Refresh tokens are single-use

Verified against the live service:

```
POST /oauth2/token grant_type=refresh_token & refresh_token=<R0>  → 200, returns <R1>
POST /oauth2/token grant_type=refresh_token & refresh_token=<R0>  → 401   (R0 consumed)
```

So `src/lib/sensenova-limits.js` adopts `R1` on every refresh and writes it back
atomically (`tmp` + `rename`, mode 0600) — a dropped write means a re-capture.

## Quota endpoint

```
GET https://platform.sensenova.cn/lite/console/v1/tokenplan/pool-usage
Authorization: Bearer <access_token>
```

```json
{
  "plan": { "id": "free", "name": "Free Plan", "type": "TOKEN_PLAN_PLAN_TYPE_FREE" },
  "pools": [
    {
      "id": "pool_…", "name": "通用积分池", "pool_type": "default",
      "model_ids": ["…"],
      "window_5h": { "limit": "60000",  "used": "0", "remaining": "60000",  "reset_at": "1792069830" },
      "window_7d": { "limit": "600000", "used": "0", "remaining": "600000", "reset_at": "1792577430" },
      "grant_balance": "519.696", "nearest_grant_expiry": "1794222000",
      "nearest_grant_expiring_balance": "519.696"
    },
    { "name": "Flash-Lite积分池", "pool_type": "dedicated", "…": "same shape" }
  ]
}
```

Notes:

- Every number is a **string**; `reset_at` / `nearest_grant_expiry` are **unix
  seconds** (string). Verified against the console: `1792069830` → 5h reset
  `10月15日 21:10`, `1792577430` → weekly reset `10月21日 18:10` (+08:00).
- `used_percent` in the provider is `used/limit`; the console's "100.0%" labels
  the *available* share, so a fresh window is 0% used here.
- `grant_balance` is quoted in **thousands** (`519.696` where the console prints
  `519,696`), while the window limits are plain credits — the provider scales
  grants by 1000 so the shown number matches the console. This is the one field
  whose unit is inferred rather than documented.
- Other console endpoints seen: `/lite/console/v1/tokenplan/credit-usage-trend`
  (the 24h chart) and `/lite/console/v1/metered/models`.
- `/lite/console/v1/openapi/list` answers 401 without a console session, and the
  docs page carries no balance/quota wording — there is no AK/SK quota API.

## How the credentials were captured (no user interaction needed)

The SSO cookie survives, so a **script-less sandboxed iframe** can run the
authorize leg without letting the console's own JS consume the code:

1. Build PKCE (S256) + state in the console page.
2. `<iframe sandbox="allow-same-origin" src="/oauth2/auth?…">` — the flow
   redirects back to `https://platform.sensenova.cn/?code=…&state=…` and, with
   scripts disabled in that frame, nothing exchanges the code.
3. Read the code from the iframe's URL, then (from Node, no cookies required)
   `POST /oauth2/token` with `grant_type=authorization_code`, `client_id=nova`,
   `redirect_uri`, `code_verifier`.
4. Store the returned `refresh_token` in
   `~/.tokentracker/sensenova-credentials.json` (0600).

Re-capture is the same recipe; the provider never needs it unless the chain is
broken (dead token, log-out, or a lost credentials write).

## Verified end to end

- `fetchSensenovaLimits()` against the live endpoint returns
  `plan_name: "Free Plan"`, 5h `0%` (limit 60000), weekly `0%` (limit 600000),
  both Flash-Lite windows, `grant_credits: 519696`,
  `grant_expires_at: 2026-11-09T11:00:00.000Z` — matching the console page.
- The module also runs the whole path from Node (refresh → Bearer → pool-usage)
  with no browser in the loop.
