import type { InstructionProgram, StageId, WorldState } from "../src/campaign/types.js";

export const CAMPAIGN_JEV_MODEL = "jev-1.13.0";
export const CAMPAIGN_JEV_TIMEOUT_MS = 15_000;
export const CAMPAIGN_JEV_MAX_INPUT_CODEPOINTS = 500;
export const CAMPAIGN_JEV_MAX_TOKENS = 250;
export const CAMPAIGN_JEV_MAX_CHOICES = 255;
export const CAMPAIGN_JEV_MAX_REQUEST_BYTES = 768 * 1024;
export const CAMPAIGN_JEV_MIN_CONFIDENCE = 0.6;

export type CampaignJevPhase = "anchor" | "verb_scope" | "roles" | "joint";
export type CampaignJevTraceEvent =
  | { kind: "request"; phase: CampaignJevPhase; state: unknown; questions: unknown }
  | { kind: "response"; phase: CampaignJevPhase; response: unknown }
  | { kind: "rejection"; phase: CampaignJevPhase | "compiler"; field: string; code: string; message: string };

export interface CampaignInterpretRequest {
  text: string;
  stageId: StageId;
  runId: string;
  revision: number;
  attempt: number;
  /** Client snapshot; the route must validate it against the canonical public stage catalog. */
  world: WorldState;
}

export type CampaignInterpretInvocation = CampaignInterpretRequest;

export interface CampaignSourceSpan {
  text: string;
  chars: [number, number];
  tokens: [number, number];
}

export interface CampaignActionSource {
  anchor: CampaignSourceSpan;
  clause: CampaignSourceSpan;
  actor: CampaignSourceSpan | null;
  target: CampaignSourceSpan | null;
  destination: CampaignSourceSpan | null;
  instrument: CampaignSourceSpan | null;
  amount: CampaignSourceSpan | null;
}

export interface CampaignInterpretResult {
  program: InstructionProgram;
  /** null when the provider supplies no calibrated interpretation probability. */
  confidence: number | null;
  sourceSpans: {
    actions: CampaignActionSource[];
    condition: null | {
      clause: CampaignSourceSpan;
      subject: CampaignSourceSpan;
      value: CampaignSourceSpan;
    };
    scope?: CampaignSourceSpan | null;
  };
  needsConfirmation: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseCampaignInterpretRequest(value: unknown): CampaignInterpretRequest | null {
  if (!record(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 6 || !["text", "stageId", "runId", "revision", "attempt", "world"].every((key) => keys.includes(key))) return null;
  if (typeof value.text !== "string" || typeof value.runId !== "string" || value.runId.trim().length === 0) return null;
  if (!Number.isInteger(value.stageId) || Number(value.stageId) < 1 || Number(value.stageId) > 10) return null;
  if (!Number.isInteger(value.revision) || Number(value.revision) < 0 || !Number.isInteger(value.attempt) || Number(value.attempt) < 1) return null;
  if (!record(value.world) || value.world.stageId !== value.stageId || value.world.attempt !== value.attempt) return null;
  return {
    text: value.text,
    stageId: value.stageId as StageId,
    runId: value.runId,
    revision: Number(value.revision),
    attempt: Number(value.attempt),
    world: value.world as unknown as WorldState,
  };
}
