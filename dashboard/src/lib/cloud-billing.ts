// Cloud billing was removed from this fork: no subscription, checkout or
// membership state is fetched, rendered or sold. These types survive only
// because cloud-prompt-policy.d.ts still describes the cloud prompt state.

export type CloudProvider = "waffo" | "paddle" | "wechat" | "alipay";
export type CloudPrice = {
  sku: string;
  currency: "CNY" | "USD";
  amount_cents: number;
  term_months: number;
  billing_mode: "recurring" | "fixed";
};
export type CloudMembership = {
  status:
    "legacy_free" | "active" | "trial" | "transition" | "expired" | "free" | "self_hosted";
  hosting_mode?: "hosted" | "self_hosted";
  expires_at?: string | null;
  access_source?: "payment" | "gift" | "mixed" | "none";
  has_gift?: boolean;
  gift_expires_at?: string | null;
  trial_ends_at?: string | null;
  trial_available: boolean;
  transition_ends_at?: string | null;
  read_only_until?: string | null;
  can_read_cloud: boolean;
  can_upload_cloud: boolean;
  machine_limit: number | null;
  sync_interval_seconds: number;
};
export type CloudCatalog = {
  environment: "sandbox" | "live";
  policy: { phase: "preview" | "active"; launch_at: string | null; hosting_mode?: "hosted" | "self_hosted" };
  checkout_verified?: boolean;
  prices: CloudPrice[];
  providers: { waffo: boolean } & Partial<Record<Exclude<CloudProvider, "waffo">, boolean>>;
  limits: {
    machines: number | null;
    sync_minutes: number;
    hourly_history_days: number | null;
    daily_history_months: number | null;
    trial_days: number;
  };
};
export type CloudOrder = {
  id: string;
  provider: CloudProvider;
  sku: string;
  currency: "CNY" | "USD";
  amount_cents: number;
  billing_mode?: "recurring" | "fixed";
  status: string;
  payment_state?: "unpaid" | "paid" | "partially_refunded" | "refunded";
  checkout_url?: string | null;
  expires_at?: string | null;
  retry_payment_conflict_at?: string | null;
};
export type CloudGift = {
  id: string;
  duration_days: 30 | 90 | 365;
  redeemed_at: string;
  starts_at: string;
  ends_at: string;
  revoked_at: string | null;
  state: "active" | "pending" | "expired" | "revoked";
};
export type CloudAccount = {
  environment?: "sandbox" | "live";
  membership: CloudMembership;
  /** Active registered sync devices; used for targeted Cloud sales CTAs. */
  machine_count?: number;
  gift_redemption_available?: boolean;
  redemption_restriction?: string | null;
  gifts?: CloudGift[];
  payments: {
    id: string;
    provider: CloudProvider;
    currency: "CNY" | "USD";
    amount_cents: number;
    refunded_cents: number;
    starts_at: string;
    ends_at: string;
    paid_at: string;
  }[];
  subscriptions: {
    provider?: CloudProvider;
    provider_subscription_id: string;
    status: string;
    cancel_at_period_end: boolean;
    next_billed_at?: string | null;
  }[];
  pending_orders?: CloudOrder[];
  conflict_orders?: CloudOrder[];
};
