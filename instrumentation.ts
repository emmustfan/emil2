export async function register() {
  // Build-time rendering must not need database credentials. Validate at server boot.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { getEnv } = await import("./lib/env");
    getEnv();
  }
}
