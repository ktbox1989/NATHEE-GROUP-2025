export type RuntimeChecks = {
  authentication: boolean;
  database: boolean;
  storage: boolean;
};

export function runtimeReadiness(checks: RuntimeChecks) {
  const healthy = Object.values(checks).every(Boolean);
  return {
    statusCode: healthy ? 200 : 503,
    payload: {
      status: healthy ? "healthy" as const : "degraded" as const,
      checks,
    },
  };
}
