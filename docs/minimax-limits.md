# MiniMax limits

TokenTracker reads MiniMax Coding Plan quota (5-hour + weekly) or the API
account balance with the user's own MiniMax API key. Nothing is sent anywhere
except MiniMax's official endpoints.

## Configure

Create `~/.tokentracker/minimax-credentials.json` (on Windows:
`C:\Users\<you>\.tokentracker\minimax-credentials.json`):

```json
{
  "api_key": "your-minimax-api-key",
  "region": "cn",
  "billing_mode": "token-plan"
}
```

`region` is `cn` (default), `en`, or `auto`; `billing_mode` is `token-plan`
(default, 5-hour + weekly quota) or `api` (wallet balance).

The key may also come from `MINIMAX_CODING_API_KEY`; `MINIMAX_API_REGION` and
`MINIMAX_BILLING_MODE` override the file. With no key the card stays hidden
(not an error).

## Sources

| Mode | Endpoint | Rendered as |
|---|---|---|
| `token-plan` | `GET https://api.minimaxi.com/v1/token_plan/remains` (CN) / `api.minimax.io` (EN); legacy `/v1/api/openplatform/coding_plan/remains` fallback | 5-hour + weekly bars from `data.model_remains[].model_name === "general"` |
| `api` | `GET https://api.minimaxi.com/account/query_balance` | currency balance line from `available_amount` |

The implementation is ported from Token Monitor's MiniMax provider
(`Javis603/token-monitor`, `src/shared/providers/minimax/limits.js`), including
the `status == 3` placeholder guard and CN/EN fallback.
