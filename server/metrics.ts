import type { ApiErrorBody, ApiMetrics } from "./contracts.js";

const metrics: ApiMetrics = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  latencyMsTotal: 0,
  errors: {
    input: 0,
    unsupported: 0,
    uncertain: 0,
    rate_limited: 0,
    provider: 0,
    unavailable: 0,
  },
};

export function recordCall(
  latencyMs: number,
  inputTokens = 0,
  outputTokens = 0,
): void {
  metrics.calls += 1;
  metrics.latencyMsTotal += Math.max(0, Math.round(latencyMs));
  metrics.inputTokens += Math.max(0, Math.round(inputTokens));
  metrics.outputTokens += Math.max(0, Math.round(outputTokens));
}

export function recordError(code: ApiErrorBody["error"]["code"]): void {
  metrics.errors[code] += 1;
}

export function getMetrics(): ApiMetrics & { averageLatencyMs: number } {
  return {
    ...metrics,
    errors: { ...metrics.errors },
    averageLatencyMs:
      metrics.calls === 0
        ? 0
        : Math.round(metrics.latencyMsTotal / metrics.calls),
  };
}

export function logAiCall(event: {
  model: string;
  rulesVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error: string | null;
}): void {
  if (process.env.AI_STRUCTURED_LOGS === "false") return;
  console.info(JSON.stringify({ event: "jev_call", ...event }));
}

export function logApiError(code: ApiErrorBody["error"]["code"]): void {
  if (process.env.AI_STRUCTURED_LOGS === "false") return;
  console.warn(JSON.stringify({ event: "interpret_error", error: code }));
}
