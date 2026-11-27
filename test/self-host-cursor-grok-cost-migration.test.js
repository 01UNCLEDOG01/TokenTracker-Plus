"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { PGlite } = require("@electric-sql/pglite");

const migration = fs.readFileSync(
  path.join(__dirname, "../migrations/20261127090000_self-host-cursor-grok-reported-cost.sql"),
  "utf8",
);

function row(tokens = 120, cost = 0) {
  return {
    hour_start: "2026-11-25T00:00:00Z",
    source: "cursor",
    model: "grok-bot-automation",
    input_tokens: tokens - 20,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 20,
    reasoning_output_tokens: 0,
    total_tokens: tokens,
    billable_total_tokens: tokens,
    total_cost_usd: cost,
    conversations: 1,
    cache_observed_input_tokens: 0,
  };
}

test("ingest preserves a reported Cursor Grok Bot amount only for the same snapshot", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE public.tokentracker_hourly(
      user_id uuid NOT NULL,
      device_id uuid NOT NULL,
      hour_start timestamptz NOT NULL,
      source text NOT NULL,
      model text NOT NULL,
      input_tokens bigint,
      cached_input_tokens bigint,
      cache_creation_input_tokens bigint,
      output_tokens bigint,
      reasoning_output_tokens bigint,
      total_tokens bigint,
      billable_total_tokens bigint,
      total_cost_usd numeric,
      conversations integer,
      cache_observed_input_tokens bigint,
      updated_at timestamptz,
      PRIMARY KEY(user_id, device_id, hour_start, source, model)
    );

    CREATE FUNCTION public.cloud_ingest_usage(
      p_token_hash text,
      p_environment text,
      p_rows jsonb,
      p_states jsonb,
      p_upload_id text DEFAULT NULL
    ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
    BEGIN
      INSERT INTO public.tokentracker_hourly AS h(
        user_id,device_id,hour_start,source,model,input_tokens,
        cached_input_tokens,cache_creation_input_tokens,output_tokens,
        reasoning_output_tokens,total_tokens,billable_total_tokens,
        total_cost_usd,conversations,cache_observed_input_tokens,updated_at
      )
      SELECT
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        x.hour_start,x.source,x.model,x.input_tokens,
        x.cached_input_tokens,x.cache_creation_input_tokens,x.output_tokens,
        x.reasoning_output_tokens,x.total_tokens,x.billable_total_tokens,
        x.total_cost_usd,x.conversations,x.cache_observed_input_tokens,now()
      FROM jsonb_to_recordset(p_rows) AS x(
        hour_start timestamptz,source text,model text,input_tokens bigint,
        cached_input_tokens bigint,cache_creation_input_tokens bigint,
        output_tokens bigint,reasoning_output_tokens bigint,total_tokens bigint,
        billable_total_tokens bigint,total_cost_usd numeric,conversations integer,
        cache_observed_input_tokens bigint
      )
      ON CONFLICT(user_id,device_id,hour_start,source,model) DO UPDATE SET
        input_tokens=excluded.input_tokens,
        cached_input_tokens=excluded.cached_input_tokens,
        cache_creation_input_tokens=excluded.cache_creation_input_tokens,
        output_tokens=excluded.output_tokens,
        reasoning_output_tokens=excluded.reasoning_output_tokens,
        total_tokens=excluded.total_tokens,
        billable_total_tokens=excluded.billable_total_tokens,
        total_cost_usd=excluded.total_cost_usd,
        conversations=excluded.conversations,
        cache_observed_input_tokens=excluded.cache_observed_input_tokens,
        updated_at=excluded.updated_at;
      RETURN jsonb_build_object('ok',true);
    END;
    $fn$;
  `);
  await db.exec(migration);
  await db.exec(migration);

  const ingest = (payload) => db.query(
    "SELECT cloud_ingest_usage('token','sandbox',$1::jsonb,'[]'::jsonb,NULL) AS result",
    [JSON.stringify([payload])],
  );
  const readCost = async () => Number((await db.query(
    "SELECT total_cost_usd FROM tokentracker_hourly",
  )).rows[0].total_cost_usd);

  await ingest(row(120, 0.081732));
  await ingest(row(120, 0));
  assert.equal(await readCost(), 0.081732);

  await ingest(row(110, 0));
  assert.equal(await readCost(), 0);
});
