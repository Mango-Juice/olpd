import { ApiError } from "./errors.js";

export const PROVIDER_RESPONSE_LIMIT_BYTES = 128 * 1024;

export interface ProviderJsonOptions {
  url: string;
  apiKey: string;
  body: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
  timeoutMessage?: string;
  cancelMessage?: string;
}

export interface ProviderJsonResult {
  payload: unknown;
  latencyMs: number;
}

async function boundedJson(response: Response, limit: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new ApiError(502, "provider", "AI 응답이 너무 큽니다.", true);
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, "provider", "AI 응답이 비어 있습니다.", true);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new ApiError(502, "provider", "AI 응답이 너무 큽니다.", true);
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "provider", "AI 응답을 읽을 수 없습니다.", true);
  } finally {
    reader.releaseLock();
  }
}

/** One bounded paid request. Callers deliberately own model-specific parsing. */
export async function postProviderJson(options: ProviderJsonOptions): Promise<ProviderJsonResult> {
  if (options.signal?.aborted) throw new ApiError(503, "unavailable", options.cancelMessage ?? "뜻 확인을 취소했습니다.", true);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = options.timeoutMs === undefined ? undefined : setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const started = performance.now();
  try {
    const response = await (options.fetchImpl ?? fetch)(options.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: options.body,
      signal: controller.signal,
    });
    if (response.status === 429) throw new ApiError(429, "rate_limited", "AI 제공자 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", true);
    if (response.status === 529) throw new ApiError(503, "unavailable", "AI 제공자가 혼잡합니다. 잠시 후 다시 시도해 주세요.", true);
    if (!response.ok) throw new ApiError(response.status >= 500 ? 503 : 502, response.status >= 500 ? "unavailable" : "provider", "AI 제공자가 요청을 처리하지 못했습니다.", response.status >= 500);
    const payload = await boundedJson(response, options.maxResponseBytes ?? PROVIDER_RESPONSE_LIMIT_BYTES);
    return { payload, latencyMs: performance.now() - started };
  } catch (error) {
    if (controller.signal.aborted) {
      const external = options.signal?.aborted && !timedOut;
      throw new ApiError(503, "unavailable", external
        ? options.cancelMessage ?? "뜻 확인을 취소했습니다."
        : options.timeoutMessage ?? "AI 해석 시간이 초과되었습니다. 다시 시도해 주세요.", true);
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "unavailable", "AI 해석 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.", true);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
