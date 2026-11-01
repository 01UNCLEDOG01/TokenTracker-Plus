// Cloud billing was removed from this fork: no subscription, checkout or
// membership state is fetched, rendered or sold. These types survive only
// because cloud-prompt-policy.d.ts still describes the cloud prompt state.
// 2026-11-01 痕迹清扫：上游支付通道与结账/定价类型一并退役，
// 只保留自建云账号、礼包、订阅合同与设备仍在读取的字段形状。

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
};
export type CloudOrder = {
  id: string;
  status: string;
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
  /** Active registered sync devices; used for targeted Cloud prompts. */
  machine_count?: number;
  gift_redemption_available?: boolean;
  redemption_restriction?: string | null;
  gifts?: CloudGift[];
  subscriptions: {
    provider?: string;
    provider_subscription_id: string;
    status: string;
    cancel_at_period_end: boolean;
    next_billed_at?: string | null;
  }[];
  pending_orders?: CloudOrder[];
  conflict_orders?: CloudOrder[];
};
