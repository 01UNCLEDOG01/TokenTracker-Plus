import { afterEach, beforeEach, vi } from "vitest";

/**
 * Local-first builds ship no bundled InsForge instance, so cloud UI suites must
 * pin an explicit deployment exactly like a self-hosted install does. Without
 * it `getInsforgeRemoteUrl()` is "" and every cloud action/request is refused
 * before reaching the behavior under test.
 */
export const TEST_CLOUD_BASE_URL = "https://cloud.example.test";
const TEST_CLOUD_ANON_KEY = "anon_0123456789abcdef0123456789abcdef01234567";

export function useConfiguredCloudInstance() {
  beforeEach(() => {
    vi.stubEnv("VITE_INSFORGE_BASE_URL", TEST_CLOUD_BASE_URL);
    vi.stubEnv("VITE_INSFORGE_ANON_KEY", TEST_CLOUD_ANON_KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
}
