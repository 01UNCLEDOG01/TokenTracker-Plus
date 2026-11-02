// Shared helpers for the live edge functions. Payment-provider helpers (amount
// parsing, payment events, provider JSON) were removed with the commercial
// surface: this fork has no checkout, orders or provider webhooks.

export class CloudRequestError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CloudRequestError("invalid_provider_payload");
  return value as Record<string, unknown>;
}

export function text(value: unknown, maxLength = 200): string {
  if (typeof value !== "string" || !value || value.length > maxLength) throw new CloudRequestError("invalid_provider_field");
  return value;
}

export function uuid(value: unknown): string {
  const id = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new CloudRequestError("invalid_id");
  return id;
}
