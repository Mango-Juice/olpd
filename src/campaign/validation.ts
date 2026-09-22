import { isStageId } from "./catalog";
import { CAMPAIGN_INPUT_LIMIT } from "./notebook";
import type { InstructionProgram } from "./types";

const verbs = new Set(["move", "jump", "duck", "push", "pull", "place", "take", "release", "open", "close", "turn", "tie", "untie", "board", "dismount", "climb", "pour", "hold", "observe", "remember"]);
const comparisons = new Set(["eq", "lt", "lte", "gt", "gte"]);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function scalar(value: unknown): boolean {
  return typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}
function name(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function exact(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
/** JSON boundary validation is independent of whether the intended action is physically safe. */
export function parseProgram(value: unknown): InstructionProgram | null {
  // The generous structural budget is a transport safety boundary, not a per-stage action limit.
  let remaining = 4096;
  function predicate(input: unknown, depth: number): boolean {
    if (--remaining < 0 || depth > 64 || !record(input)) return false;
    if (input.kind === "not") return exact(input, ["kind", "predicate"]) && predicate(input.predicate, depth + 1);
    if (input.kind === "all" || input.kind === "any") return exact(input, ["kind", "predicates"]) && Array.isArray(input.predicates) && input.predicates.length > 0 && input.predicates.every((item) => predicate(item, depth + 1));
    return input.kind === "property" && exact(input, ["kind", "entity", "property", "comparison", "value", "source"]) && name(input.entity) && name(input.property) && comparisons.has(String(input.comparison)) && scalar(input.value) && (input.source === "visible" || input.source === "remembered");
  }
  function node(input: unknown, depth: number): boolean {
    if (--remaining < 0 || depth > 64 || !record(input)) return false;
    if (input.kind === "action") return exact(input, ["kind", "actor", "verb", "target"], ["destination", "instrument", "amount"]) && (input.actor === "hero" || input.actor === "keeper") && verbs.has(String(input.verb)) && name(input.target) && (input.destination === undefined || name(input.destination)) && (input.instrument === undefined || name(input.instrument)) && (input.amount === undefined || (typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount > 0));
    if (input.kind === "sequence" || input.kind === "parallel") return exact(input, ["kind", "children"]) && Array.isArray(input.children) && input.children.length > 0 && input.children.every((item) => node(item, depth + 1));
    if (input.kind === "wait") return exact(input, ["kind", "until"]) && predicate(input.until, depth + 1);
    if (input.kind === "until") return exact(input, ["kind", "condition", "body"]) && predicate(input.condition, depth + 1) && record(input.body) && input.body.kind === "action" && node(input.body, depth + 1);
    if (input.kind === "if") return exact(input, ["kind", "condition", "then"], ["otherwise"]) && predicate(input.condition, depth + 1) && node(input.then, depth + 1) && (input.otherwise === undefined || node(input.otherwise, depth + 1));
    return false;
  }
  if (!record(value) || !exact(value, ["version", "id", "text", "model", "scope", "guard", "body"], ["condition"]) || value.version !== 2 || !name(value.id) || !name(value.text) || [...value.text.trim()].length > CAMPAIGN_INPUT_LIMIT || !name(value.model) || typeof value.guard !== "boolean" || !record(value.scope) || !exact(value.scope, [], ["stageId", "region"]) || (value.scope.stageId !== undefined && !isStageId(value.scope.stageId)) || (value.scope.region !== undefined && !name(value.scope.region)) || (value.condition !== undefined && !predicate(value.condition, 0)) || !node(value.body, 0)) return null;
  return { ...structuredClone(value), text: value.text.trim() } as unknown as InstructionProgram;
}
