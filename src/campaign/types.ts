/** Serializable campaign contracts. World simulation never depends on wall-clock time. */
export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type EntityId = string;
export type Scalar = string | number | boolean;
export type Truth = true | false | "unknown";
export interface Location { region: string; x: number; y: number }
export interface Entity {
  id: EntityId;
  name: string;
  description: string;
  material: "wood" | "cork" | "stone" | "metal" | "glass" | "cloth" | "water" | "light";
  movable: boolean;
  weight: number;
  capacity: number;
  reach: number;
  location: Location;
  /** A carried/loaded object has exactly one parent; never duplicated in inventory. */
  parent: EntityId | null;
  properties: Record<string, Scalar>;
}
export interface Actor {
  id: "hero" | "keeper";
  location: Location;
  holding: EntityId | null;
  carrying: EntityId[];
  riding: EntityId | null;
  capabilities: string[];
}
export interface Fact {
  entity: EntityId;
  property: string;
  value: Scalar;
  attempt: number;
  tick: number;
}
export type Predicate =
  | { kind: "property"; entity: EntityId; property: string; comparison: "eq" | "lt" | "lte" | "gt" | "gte"; value: Scalar; source: "visible" | "remembered" }
  | { kind: "all" | "any"; predicates: Predicate[] }
  | { kind: "not"; predicate: Predicate };
export interface WorldState {
  stageId: StageId;
  segmentId: string;
  /** Logical entry epoch for devices whose initial phase is local to a segment. */
  segmentStartedAt?: number;
  tick: number;
  attempt: number;
  entities: Record<EntityId, Entity>;
  actors: Record<string, Actor>;
  visible: EntityId[];
  facts: Fact[];
}
export type Verb = "move" | "jump" | "duck" | "push" | "pull" | "place" | "take" | "release" | "open" | "close" | "turn" | "tie" | "untie" | "board" | "dismount" | "climb" | "pour" | "hold" | "observe" | "remember";
export interface PhysicalAction {
  kind: "action";
  actor: "hero" | "keeper";
  verb: Verb;
  target: EntityId;
  destination?: EntityId;
  /** Rope, tongs, or another explicitly named tool; never inferred as a puzzle solution. */
  instrument?: EntityId;
  amount?: number;
}
export type ProgramNode = PhysicalAction
  | { kind: "sequence"; children: ProgramNode[] }
  | { kind: "parallel"; children: ProgramNode[] }
  | { kind: "wait"; until: Predicate }
  | { kind: "if"; condition: Predicate; then: ProgramNode; otherwise?: ProgramNode }
  | { kind: "until"; condition: Predicate; body: PhysicalAction };
export interface InstructionProgram {
  version: 2;
  id: string;
  text: string;
  model: string;
  scope: { stageId?: StageId; region?: string };
  condition?: Predicate;
  /** Explicit guard rules may interrupt lower priority programs at atomic boundaries. */
  guard: boolean;
  body: ProgramNode;
}
export interface WorldEvent {
  id: string;
  /** Presentation may compress repeats, but physics is always recomputed. */
  repeated?: boolean;
  signature?: string;
  segmentId?: string;
  tick: number;
  attempt: number;
  instructionId: string | null;
  actor: string | null;
  target: EntityId | null;
  outcome: "safe" | "blocked" | "clarification" | "failure" | "observed" | "interrupted";
  reason: string;
  changes: { entity: EntityId; property: string; before: Scalar | null; after: Scalar | null }[];
}
export interface StageSummary {
  id: StageId;
  slug: string;
  title: string;
  subtitle: string;
  segments: number;
}
