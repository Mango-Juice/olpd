import type { InstructionProgram, StageId, WorldState } from "../src/campaign/types.js";

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
