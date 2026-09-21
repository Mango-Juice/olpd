import { REQUESTS_PER_MINUTE } from "./contracts.js";
import { ApiError } from "./errors.js";

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 5_000;
const buckets = new Map<string, { startedAt: number; count: number }>();

function removeExpired(now: number): void {
  for (const [bucketKey, bucket] of buckets) {
    if (now - bucket.startedAt >= WINDOW_MS) buckets.delete(bucketKey);
  }
}

export function enforceRateLimit(ip: string, now = Date.now()): void {
  const key = ip || "unknown";
  const existing = buckets.get(key);
  if (!existing) {
    if (buckets.size >= MAX_BUCKETS) removeExpired(now);
    if (buckets.size >= MAX_BUCKETS) {
      throw new ApiError(
        429,
        "rate_limited",
        "요청 제한 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        true,
      );
    }
    buckets.set(key, { startedAt: now, count: 1 });
    return;
  }
  if (now - existing.startedAt >= WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    return;
  }
  if (existing.count >= REQUESTS_PER_MINUTE) {
    throw new ApiError(
      429,
      "rate_limited",
      "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      true,
    );
  }
  existing.count += 1;
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
