import type { Interpretation } from "../src/game/types.js";

export const API_BODY_LIMIT_BYTES = 2_048;
export const INSTRUCTION_MAX_CHARS = 80;
export const REQUEST_TIMEOUT_MS = 15_000;
export const REQUESTS_PER_MINUTE = 30;
export const SUPPORTED_DUNGEON_VERSION = "1";
export const SUPPORTED_RULES_VERSION = "1";
export const JEV_MODEL = "jev-1.13.0";
export const MIN_ACTION_PROBABILITY = 0.6;
export const MIN_APPLICABILITY_CERTAINTY = 0.6;

export interface InterpretRequest {
  text: string;
  dungeonVersion: string;
  rulesVersion: string;
}

export interface ApiErrorBody {
  error: {
    code:
      | "input"
      | "unsupported"
      | "uncertain"
      | "rate_limited"
      | "provider"
      | "unavailable";
    message: string;
    retryable: boolean;
  };
}

export type InterpretResponse = Interpretation;

export interface ApiMetrics {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMsTotal: number;
  errors: Record<ApiErrorBody["error"]["code"], number>;
}
