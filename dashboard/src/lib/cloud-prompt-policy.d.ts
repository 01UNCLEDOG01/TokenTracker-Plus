// Minimal account shapes observed by the shared cloud-prompt state. The
// former cloud-billing module is gone (no billing UI ships in this fork), so
// only the fields this module and its consumers read are described here.
export type CloudPromptScene = "sync" | "view" | "history" | "devices";
export type CloudPromptFailure = { code: string; source: string };
export type CloudPromptMembership = {
  status?: string;
  hosting_mode?: "hosted" | "self_hosted";
};
export type CloudPromptState = {
  membership?: CloudPromptMembership;
  intent?: CloudPromptScene | null;
  failure?: CloudPromptFailure | null;
  machineCount?: number;
};
export function subscribeCloudPrompts(listener: () => void): () => void;
export function cloudPromptRevision(): number;
export function clearCloudPromptBackendState(): void;
export function readCloudPromptState(userId: string): CloudPromptState;
export function cloudPromptOwnerFromToken(token: string | undefined): string | null;
export function recordCloudPromptIntent(userId: string, scene: CloudPromptScene): void;
export function recordCloudPromptFailure(userId: string, code: string, membership: unknown, source: string,
  details?: { machineCount?: number }): void;
export function clearCloudPromptFailure(userId: string, source: string): void;
