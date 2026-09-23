export type Action = "advance" | "jump" | "duck" | "detour";
export type ObservationId =
  | "clear"
  | "pit"
  | "bridge"
  | "floorSpikes"
  | "lowCeiling"
  | "pitCeilingPath"
  | "spikesCeilingPath";
export interface Observation {
  id: ObservationId;
  label: string;
  description: string;
  pit: boolean;
  floorSpikes: boolean;
  ceilingSpikes: boolean;
  sidePath: boolean;
}
export interface Interpretation {
  action: Action;
  appliesTo: ObservationId[];
  uncertainty: number;
  model: string;
  rulesVersion: string;
}
export interface Instruction {
  id: string;
  text: string;
  interpretation: Interpretation;
  createdAt: number;
}
export type Outcome = "safe" | "death" | "blocked";
export interface ExecutionEvent {
  id: string;
  room: number;
  point: number;
  observation: ObservationId;
  action: Action;
  instructionId: string | null;
  instructionText?: string | null;
  outcome: Outcome;
  reason: string;
  repeated: boolean;
}
export interface HistoryEntryBase {
  revision: number;
  life: number;
}
export type HistoryEntry =
  | (HistoryEntryBase & { kind: "write"; instruction: Instruction })
  | (HistoryEntryBase & {
      kind: "delete";
      instructionId: string;
      instructionText: string;
      eraserCost: number;
      deathCost: number;
    })
  | (HistoryEntryBase & {
      kind: "reorder";
      instructionId: string;
      instructionText: string;
      /** Zero-based position in the high-to-low priority order shown in the UI. */
      from: number;
      /** Zero-based position in the high-to-low priority order shown in the UI. */
      to: number;
    })
  | (HistoryEntryBase & { kind: "action"; eventId: string })
  | (HistoryEntryBase & { kind: "revive" })
  | (HistoryEntryBase & { kind: "abandon" });
export interface RunHistory {
  version: 1;
  /** False only when reconstructed from a save created before history existed. */
  complete: boolean;
  initialInstructions: Instruction[];
  entries: HistoryEntry[];
}
export type Phase =
  "title" | "ready" | "running" | "dead" | "blocked" | "practice" | "cleared";
export interface RunState {
  id: string;
  /** Missing or 1 means the original eight-room chapter; 2 means the integrated six-room chapter. */
  layoutVersion?: 1 | 2;
  phase: Phase;
  tutorial: boolean;
  tutorialStep: number;
  /** Saved from lowest to highest priority; UI renders the reverse. createdAt is not priority. */
  instructions: Instruction[];
  room: number;
  point: number;
  deaths: number;
  penaltyDeaths: number;
  erasers: number;
  canWrite: boolean;
  events: ExecutionEvent[];
  seen: string[];
  lastEvent: ExecutionEvent | null;
  revision: number;
  /** Optional so saves created before per-life history remain loadable. */
  history?: RunHistory;
}
export interface Settings {
  muted: boolean;
  reducedMotion: boolean;
}
export interface SaveData {
  gameVersion: string;
  dungeonVersion: string;
  rulesVersion: string;
  state: RunState;
  settings: Settings;
  tutorialCompleted: boolean;
  best: number | null;
  savedAt: number;
  writer: string;
}
export interface Room {
  name: string;
  subtitle: string;
  points: ObservationId[];
}
