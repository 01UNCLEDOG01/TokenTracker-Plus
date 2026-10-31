import { createClient } from "npm:@insforge/sdk@1.4.5";
import { BillingError, object, type BillingEnvironment } from "./contracts.ts";
import { billingUserId } from "./auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { ...cors, "Cache-Control": "no-store" } });
}

export function billingEnvironment(): BillingEnvironment {
  const value = Deno.env.get("TOKENTRACKER_BILLING_ENVIRONMENT") || "live";
  if (value !== "sandbox" && value !== "live") throw new BillingError("billing_configuration_invalid", 503);
  return value;
}

export function billingSiteUrl(): string {
  // No bundled default: this fork ships no hosted site, so a self-hoster must
  // point this at their own deployment instead of silently reaching a domain
  // nobody in this project operates.
  const value = Deno.env.get("TOKENTRACKER_BILLING_SITE_URL");
  if (!value) throw new BillingError("billing_configuration_invalid", 503);
  const url = new URL(value);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new BillingError("billing_configuration_invalid", 503);
  }
  return url.origin;
}

export function billingClient() {
  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  const edgeFunctionToken = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("INSFORGE_ANON_KEY") || Deno.env.get("ANON_KEY");
  if (!baseUrl || !edgeFunctionToken || !anonKey) throw new BillingError("billing_not_configured", 503);
  return createClient({ baseUrl, edgeFunctionToken, anonKey, headers: { apikey: anonKey } });
}

export async function signedInUser(req: Request): Promise<string> {
  return await billingUserId(req.headers.get("Authorization"), {
    jwtSecret: Deno.env.get("JWT_SECRET"), jwtPublicKey: Deno.env.get("JWT_PUBLIC_KEY"),
  });
}

export async function rpc(client: ReturnType<typeof billingClient>, name: string, data: Record<string, unknown>) {
  const result = await client.database.rpc(name, data);
  if (result.error) {
    const message = result.error.message || "";
    const code = message.includes("self-hosted access is free") ? "self_hosted_free"
      : message.includes("gift_membership_active") ? "gift_membership_active"
      : message.includes("payment conflict must be resolved") ? "payment_conflict"
      : (message.includes("previous retry order has a successful payment") ||
      message.includes("(removed) order cannot be restarted")) ? "checkout_already_paid"
      : message.includes("existing checkout") ? "pending_checkout_exists"
      : message.includes("existing subscription") ? "subscription_already_exists"
      : message.includes("fixed membership term") ? "fixed_term_still_active"
      : message.includes("before the first purchase") ? "trial_unavailable"
      : message.includes("trial has not launched") ? "trial_not_launched"
      : (message.includes("different purchase") || message.includes("retry request already belongs")) ? "checkout_request_conflict"
      : "billing_operation_failed";
    throw new BillingError(code, code === "billing_operation_failed" ? 503 : 409);
  }
  return object(result.data);
}

export function failure(error: unknown): Response {
  if (error instanceof BillingError) return json({ error: error.code }, error.status);
  // Never expose or log upstream bodies, payment credentials, or customer data.
  console.error("cloud-billing: operation failed");
  return json({ error: "billing_operation_failed" }, 503);
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers.get("Content-Length") || 0);
  if (contentLength > 16_384) throw new BillingError("request_too_large", 413);
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > 16_384) throw new BillingError("request_too_large", 413);
  try { return object(JSON.parse(raw)); }
  catch { throw new BillingError("invalid_request"); }
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response(null, { status: 204, headers: cors }) : null;
}
