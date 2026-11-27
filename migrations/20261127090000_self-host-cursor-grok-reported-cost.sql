-- Preserve Cursor's provider-reported Grok Bot charge across later CSV replays.
--
-- Cursor exposes two feeds for the same request. The usage-event feed carries
-- totalCents, while a later CSV export can describe the same tokens with
-- Cost=0. The client keeps the event amount for its local bucket; ingest must
-- apply the same rule or a later replay overwrites the cloud amount.
--
-- Only an exact token/conversation snapshot can inherit the earlier amount.
-- Changed usage is authoritative and clears the old cost as before.

DO $patch$
DECLARE
  fn text;
  old_cost text;
  keep_cost text;
  replacement text;
BEGIN
  fn := pg_get_functiondef(
    'public.cloud_ingest_usage(text,text,jsonb,jsonb,text)'::regprocedure
  );

  -- Idempotent for operators who rerun the step manually.
  IF strpos(fn, 'cursor-grok-reported-cost-v1') > 0 THEN
    RETURN;
  END IF;

  old_cost := 'total_cost_usd=excluded.total_cost_usd,';
  IF strpos(fn, old_cost) = 0 THEN
    RAISE EXCEPTION 'Unexpected cloud_ingest_usage cost assignment';
  END IF;

  keep_cost := $predicate$
    h.source = 'cursor'
    AND lower(h.model) LIKE 'grok-bot-%'
    AND ROW(
      h.input_tokens,
      h.cached_input_tokens,
      h.cache_creation_input_tokens,
      h.output_tokens,
      h.reasoning_output_tokens,
      h.total_tokens,
      h.conversations,
      h.cache_observed_input_tokens
    ) IS NOT DISTINCT FROM ROW(
      excluded.input_tokens,
      excluded.cached_input_tokens,
      excluded.cache_creation_input_tokens,
      excluded.output_tokens,
      excluded.reasoning_output_tokens,
      excluded.total_tokens,
      excluded.conversations,
      excluded.cache_observed_input_tokens
    )
    AND coalesce(h.total_cost_usd, 0) > 0
    AND coalesce(excluded.total_cost_usd, 0) = 0
  $predicate$;

  replacement :=
    'total_cost_usd=CASE WHEN ' || keep_cost ||
    ' THEN h.total_cost_usd ELSE excluded.total_cost_usd END,'
    || ' /* cursor-grok-reported-cost-v1 */';

  fn := replace(fn, old_cost, replacement);
  EXECUTE fn;
END
$patch$;
