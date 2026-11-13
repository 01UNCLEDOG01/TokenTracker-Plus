import { postNativeMessage } from "./native-bridge.js";

const reported = new Set();

// Local performance marks plus the existing native diagnostic log only.
// No telemetry event, API request, URL, user identity or persisted browser state.
export function markStartupStage(stage) {
  if (stage !== "shell-visible" && stage !== "dashboard-data-ready") return;
  if (reported.has(stage)) return;
  reported.add(stage);
  try {
    performance.mark(`tokentracker:${stage}`);
    postNativeMessage({ type: "startupTiming", stage, elapsedMs: performance.now() });
  } catch { /* diagnostics must not affect rendering */ }
}
