import type { IncomingMessage, ServerResponse } from "node:http";
import { clientIp } from "./http.js";
import { ApiError, asApiError } from "./errors.js";
import { logApiError, recordError } from "./metrics.js";
import { CAMPAIGN_HTTP_BODY_LIMIT, interpretCampaign, type CampaignInterpretOptions } from "./campaign-service.js";

type CampaignHttpOptions = Pick<CampaignInterpretOptions, "interpret" | "resolveStage">;

/** Dev QA is reachable only from the machine running the server. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  const octets = ipv4.split(".");
  return octets.length === 4
    && octets[0] === "127"
    && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255);
}

export async function handleCampaignInterpret(req: IncomingMessage, res: ServerResponse, options: CampaignHttpOptions = {}): Promise<void> {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const controller = new AbortController();
  const onAborted = () => controller.abort();
  const onClosed = () => { if (!res.writableEnded) controller.abort(); };
  req.on("aborted", onAborted);
  res.on("close", onClosed);
  try {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); throw new ApiError(405, "input", "POST 요청만 지원합니다."); }
    if (Number(req.headers["content-length"] ?? 0) > CAMPAIGN_HTTP_BODY_LIMIT) throw new ApiError(413, "input", "요청 본문이 너무 큽니다.");
    let body: unknown = (req as IncomingMessage & { body?: unknown }).body;
    if (body === undefined) {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > CAMPAIGN_HTTP_BODY_LIMIT) throw new ApiError(413, "input", "요청 본문이 너무 큽니다.");
        chunks.push(buffer);
      }
      body = Buffer.concat(chunks).toString("utf8");
    }
    const serialized = typeof body === "string" ? body : JSON.stringify(body);
    if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > CAMPAIGN_HTTP_BODY_LIMIT) throw new ApiError(413, "input", "요청 본문이 너무 큽니다.");
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { throw new ApiError(400, "input", "올바른 JSON 요청 본문이 필요합니다."); } }
    const result = await interpretCampaign(body, clientIp(req), { ...options, signal: controller.signal });
    res.statusCode = 200; res.end(JSON.stringify(result));
  } catch (error) {
    const apiError = asApiError(error); recordError(apiError.code); logApiError(apiError.code);
    res.statusCode = apiError.status;
    if (apiError.status === 429) res.setHeader("Retry-After", "60");
    res.end(JSON.stringify(apiError.toJSON()));
  } finally { req.off("aborted", onAborted); res.off("close", onClosed); }
}
