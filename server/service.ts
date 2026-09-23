import type { InterpretRequest, InterpretResponse } from "./contracts.js";
import {
  INSTRUCTION_MAX_CHARS,
  SUPPORTED_DUNGEON_VERSION,
  SUPPORTED_RULES_VERSION,
} from "./contracts.js";
import { ApiError } from "./errors.js";
import { interpretWithJev } from "./jev.js";
import { enforceRateLimit } from "./rate-limit.js";

export function validateRequest(value: unknown): InterpretRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "input", "JSON 요청 본문이 필요합니다.");
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (keys.join(",") !== "dungeonVersion,rulesVersion,text")
    throw new ApiError(
      400,
      "input",
      "text, dungeonVersion, rulesVersion만 보내 주세요.",
    );
  if (
    typeof body.text !== "string" ||
    typeof body.dungeonVersion !== "string" ||
    typeof body.rulesVersion !== "string"
  ) {
    throw new ApiError(400, "input", "요청 필드 형식이 올바르지 않습니다.");
  }
  const text = body.text.trim();
  const length = Array.from(text).length;
  if (length === 0 || length > INSTRUCTION_MAX_CHARS)
    throw new ApiError(
      400,
      "input",
      `지침은 1~${INSTRUCTION_MAX_CHARS}자로 적어 주세요.`,
    );
  if (/[\u0000-\u001f\u007f]/u.test(text))
    throw new ApiError(400, "input", "지침에 제어 문자를 사용할 수 없습니다.");
  if (
    body.dungeonVersion !== SUPPORTED_DUNGEON_VERSION ||
    body.rulesVersion !== SUPPORTED_RULES_VERSION
  ) {
    throw new ApiError(
      400,
      "input",
      "지원하지 않는 던전 또는 해석 규칙 버전입니다.",
    );
  }
  return {
    text,
    dungeonVersion: body.dungeonVersion,
    rulesVersion: body.rulesVersion,
  };
}

export async function interpret(
  body: unknown,
  ip: string,
  options: { signal?: AbortSignal } = {},
): Promise<InterpretResponse> {
  if (process.env.AI_ENABLED?.toLowerCase() === "false")
    throw new ApiError(
      503,
      "unavailable",
      "AI 해석 기능이 잠시 중단되었습니다.",
      true,
    );
  const request = validateRequest(body);
  enforceRateLimit(ip);
  return (await interpretWithJev(request.text, request.rulesVersion, { signal: options.signal }))
    .interpretation;
}
