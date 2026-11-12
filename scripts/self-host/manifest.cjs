const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname,"../..");
const read = name => fs.readFileSync(path.join(root,name),"utf8");
function functionSql(source,name) {
  const matchName = source.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\(`));
  const start = matchName?.index ?? -1;
  if (start < 0) throw Error(`Missing reviewed function ${name}`);
  const match = source.slice(start).match(/AS (\$\w*\$)/);
  if (!match) throw Error(`Missing function delimiter ${name}`);
  const body = source.indexOf(match[1],start)+match[1].length;
  const end = source.indexOf(match[1]+";",body);
  if (end < 0) throw Error(`Missing function end ${name}`);
  return source.slice(start,end+match[1].length+1).replace(/^CREATE FUNCTION/,"CREATE OR REPLACE FUNCTION");
}
const privateFunctions = [
  "tokentracker-device-flow-authorize","tokentracker-device-flow-grant","tokentracker-device-flow-poll",
  "tokentracker-device-token-issue","tokentracker-device-rename","tokentracker-ingest",
  "tokentracker-account-summary","tokentracker-account-daily","tokentracker-account-hourly",
  "tokentracker-account-monthly","tokentracker-account-heatmap","tokentracker-account-model-breakdown",
  "tokentracker-account-devices",
  // Public face: leaderboard + profile + visibility + likes + the pet/embed
  // SVGs and the CLI telemetry heartbeat. The signed refresh pipeline
  // (tokentracker-leaderboard-refresh) stays hosted-only; on a private
  // instance the backend refreshes the snapshot table itself.
  "tokentracker-leaderboard","tokentracker-leaderboard-profile",
  "tokentracker-public-visibility","tokentracker-profile-likes",
  "tokentracker-telemetry","tokentracker-embed-svg","tokentracker-community-models",
];
function steps() {
  const sessions=read("migrations/20260817120000_account-session-states.sql");
  const concurrent=read("migrations/20260719152022_harden-backend-concurrency.sql");
  const hotPaths=read("migrations/20260717013000_harden-backend-hot-paths.sql");
  return [
    {id:"01-private-baseline",sql:read("scripts/self-host/baseline.sql")},
    {id:"02-account-sessions",sql:sessions.slice(0,sessions.indexOf("-- Leaderboard: account-level sources")) + `
CREATE TRIGGER self_host_sessions_insert_cache AFTER INSERT ON public.tokentracker_account_session_states
  REFERENCING NEW TABLE AS changed_new FOR EACH STATEMENT EXECUTE FUNCTION public.self_host_invalidate_usage_cache();
CREATE TRIGGER self_host_sessions_update_cache AFTER UPDATE ON public.tokentracker_account_session_states
  REFERENCING OLD TABLE AS changed_old NEW TABLE AS changed_new FOR EACH STATEMENT EXECUTE FUNCTION public.self_host_invalidate_usage_cache();
CREATE TRIGGER self_host_sessions_delete_cache AFTER DELETE ON public.tokentracker_account_session_states
  REFERENCING OLD TABLE AS changed_old FOR EACH STATEMENT EXECUTE FUNCTION public.self_host_invalidate_usage_cache();` },
    {id:"03-device-identity",sql:functionSql(concurrent,"refresh_tokentracker_device_identity")},
    {id:"04-private-aggregation",sql:[
      read("scripts/self-host/aggregation.sql"),
      functionSql(read("migrations/20260904090000_promote-single-scan-account-usage.sql"),"account_usage_grouped_v2"),
      functionSql(concurrent,"account_usage_grouped_cached"),
      read("migrations/20260918041500_fold-account-summary-and-heatmap-aggregation.sql"),
      read("migrations/20260918043000_fold-account-model-breakdown-aggregation.sql"),
      read("migrations/20260918050000_fold-account-daily-aggregation.sql"),
      read("migrations/20261002090000_compact-account-model-wire.sql"),
      read("migrations/20261003093000_compact-account-summary-model-wire.sql"),
      read("scripts/self-host/private-rpc-access.sql"),
    ].join("\n\n")},
    {id:"04b-deepseek-time-priced-patterns",sql:read("migrations/20261013203000_self-host-deepseek-v41-time-priced-patterns.sql")},
    {id:"04c-self-host-public-face",sql:[
      read("migrations/20261014020000_self-host-public-face.sql"),
      functionSql(hotPaths,"upsert_tokentracker_telemetry_daily"),
    ].join("\n\n")},
    {id:"04d-public-views-revoke",sql:read("migrations/20261014020500_self-host-public-views-revoke.sql")},
    {id:"04e-achievement-badges",sql:read("migrations/20261014030000_achievement-badges.sql")},
    {id:"04f-user-settings-name",sql:read("migrations/20261014040000_self-host-user-settings-name.sql")},
    // Free Cloud contract only: membership/trial policy and machine admission.
    // This fork sells nothing, so there is no order/payment/gift step to install.
    ...["20261003120000_cloud-subscriptions.sql","20261004120000_cloud-machine-access.sql"]
      .map(name=>({id:name.slice(0,-4),sql:read("migrations/"+name)})),
    {id:"10-self-hosted-policy",sql:read("migrations/20261008120000_self-hosted-access.sql")},
    {id:"11-token-environment-validation",sql:read("migrations/20261008120001_validate-cloud-token-environment.sql")},
    {id:"13-machine-alias-cascade",sql:read("migrations/20261012120000_cloud-machine-alias-cascade.sql")},
    // trae-cn joins the machine-level hourly arm: its local-store feed writes
    // tokentracker_hourly rows (like every other source), while the old third
    // arm read tokentracker_account_session_states — which only ever held the
    // retired cloud-bill sessions (9 models / 17.2亿), so the account views
    // under-counted hourly-backed surfaces by the whole local-feed volume
    // (hero 396.6亿 vs leaderboard 400.2亿; 10-19 daily -2.11亿). Reading
    // hourly unifies trae-cn with every other machine-level source.
    {id:"14-trae-cn-hourly-account",sql:read("migrations/20261020120000_self-host-trae-cn-hourly.sql")},
    // Badge wave 2: nine cloud badges (phoenix .. grand_slam) + catalog
    // hidden flag; rewrites user_badges_refresh/user_badges_full.
    {id:"15-badge-wave-2",sql:read("migrations/20261021120000_self-host-badge-wave-2.sql")},
    // claude_survivor thresholds 50M/500M/5B/50B → 1M/10M/100M/1B.
    {id:"16-claude-survivor-recalibrate",sql:read("migrations/20261021121000_self-host-claude-survivor-recalibrate.sql")},
    // Per-device leaderboard rows: snapshots gain device_id and a
    // (period, window, user, device) unique key. Without it the snapshot writer
    // fails on a fresh installation ("column s.device_id does not exist").
    {id:"17-leaderboard-device-rows",sql:read("migrations/20261112120000_self-host-leaderboard-device-rows.sql")},
  ];
}
module.exports={root,read,functionSql,privateFunctions,steps};
