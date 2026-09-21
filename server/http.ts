import type { IncomingMessage, ServerResponse } from "node:http";
import { API_BODY_LIMIT_BYTES } from "./contracts.js";
import { ApiError, asApiError } from "./errors.js";
import { getMetrics } from "./metrics.js";
import { logApiError, recordError } from "./metrics.js";
import {
  JEV_MODEL,
  SUPPORTED_DUNGEON_VERSION,
  SUPPORTED_RULES_VERSION,
} from "./contracts.js";
import { interpret } from "./service.js";

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > API_BODY_LIMIT_BYTES)
    throw new ApiError(413, "input", "요청 본문이 너무 큽니다.");
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined) {
    let encoded: string;
    try {
      encoded =
        typeof preParsed === "string" ? preParsed : JSON.stringify(preParsed);
    } catch {
      throw new ApiError(400, "input", "올바른 JSON 요청 본문이 필요합니다.");
    }
    if (typeof encoded !== "string")
      throw new ApiError(400, "input", "올바른 JSON 요청 본문이 필요합니다.");
    if (Buffer.byteLength(encoded, "utf8") > API_BODY_LIMIT_BYTES)
      throw new ApiError(413, "input", "요청 본문이 너무 큽니다.");
    if (typeof preParsed !== "string") return preParsed;
    try {
      return JSON.parse(preParsed);
    } catch {
      throw new ApiError(400, "input", "올바른 JSON 요청 본문이 필요합니다.");
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > API_BODY_LIMIT_BYTES)
      throw new ApiError(413, "input", "요청 본문이 너무 큽니다.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "input", "올바른 JSON 요청 본문이 필요합니다.");
  }
}

export function clientIp(req: IncomingMessage): string {
  if (process.env.VERCEL === "1") {
    const forwarded = req.headers["x-forwarded-for"];
    const first = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded?.split(",")[0];
    if (first?.trim()) return first.trim();
  }
  return req.socket.remoteAddress || "unknown";
}

export async function handleInterpret(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    const error = new ApiError(405, "input", "POST 요청만 지원합니다.");
    recordError(error.code);
    logApiError(error.code);
    send(res, error.status, error.toJSON());
    return;
  }
  try {
    send(res, 200, await interpret(await readJson(req), clientIp(req)));
  } catch (error) {
    const apiError = asApiError(error);
    recordError(apiError.code);
    logApiError(apiError.code);
    if (apiError.status === 429) res.setHeader("Retry-After", "60");
    send(res, apiError.status, apiError.toJSON());
  }
}

export function handleStatus(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    send(
      res,
      405,
      new ApiError(400, "input", "GET 요청만 지원합니다.").toJSON(),
    );
    return;
  }
  const aiEnabled = process.env.AI_ENABLED?.toLowerCase() !== "false";
  const configured = Boolean(process.env.TYPESAFE_API_KEY);
  send(res, 200, {
    aiEnabled,
    configured,
    ready: aiEnabled && configured,
    provider: "typesafe",
    model: JEV_MODEL,
    dungeonVersion: SUPPORTED_DUNGEON_VERSION,
    rulesVersion: SUPPORTED_RULES_VERSION,
    metrics: getMetrics(),
  });
}
