const { performance } = require("node:perf_hooks");

// Process-relative monotonic times, captured by the native host's existing
// stdout log. Fixed labels only: never include paths, URLs or account data.
function markStartupStage(stage) {
  process.stdout.write(`[startup] stage=${stage} elapsedMs=${Math.round(performance.now())}\n`);
}

module.exports = { markStartupStage };
