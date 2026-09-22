import { isStageId, stageSummary } from "./catalog";
import { parsePhysicalAction, parseProgram } from "./validation";
import type { StageRun } from "./run";
import type { ProgramCursor } from "./program";
import type { InstructionProgram, ProgramNode, WorldState } from "./types";

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function name(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function scalar(value: unknown): boolean { return typeof value === "string" || typeof value === "boolean" || finite(value); }
function names(value: unknown): value is string[] { return Array.isArray(value) && value.every(name) && new Set(value).size === value.length; }
function location(value: unknown): boolean { return record(value) && name(value.region) && finite(value.x) && finite(value.y); }
function cursor(value: unknown, depth = 0): boolean {
  return depth < 64 && record(value) && Array.isArray(value.path) && value.path.every(integer) && ["pending", "running", "done", "blocked"].includes(String(value.status)) && integer(value.index) && (value.branch === null || value.branch === "then" || value.branch === "otherwise") && (value.reason === null || typeof value.reason === "string") && (value.resolvedAction === undefined || (parsePhysicalAction(value.resolvedAction) !== null && !Object.hasOwn(value.resolvedAction as object, "references"))) && Array.isArray(value.children) && value.children.length <= 4096 && value.children.every((child) => cursor(child, depth + 1));
}
function resolvedActionMatches(original: Extract<ProgramNode, { kind: "action" }>, resolved: ProgramCursor["resolvedAction"]): boolean {
  if (!resolved) return true;
  if (!original.references || resolved.actor !== original.actor || resolved.verb !== original.verb || resolved.amount !== original.amount || resolved.references !== undefined) return false;
  for (const role of ["target", "destination", "instrument"] as const) {
    if (!original.references[role] && resolved[role] !== original[role]) return false;
    if (original.references[role] && (typeof resolved[role] !== "string" || !resolved[role])) return false;
  }
  return true;
}
/** A structurally valid cursor can still point outside its instruction after damage. */
function cursorMatches(node: ProgramNode, position: ProgramCursor, path: number[] = []): boolean {
  if (position.path.length !== path.length || position.path.some((part, index) => part !== path[index])) return false;
  if (position.status === "pending" && (position.index !== 0 || position.children.length !== 0 || position.branch !== null || position.resolvedAction !== undefined)) return false;
  if (node.kind === "action" || node.kind === "wait" || node.kind === "until") {
    if (position.children.length !== 0 || position.branch !== null) return false;
    if (node.kind === "wait") return position.index === 0 && position.resolvedAction === undefined;
    if (node.kind === "action") return position.index === 0 && resolvedActionMatches(node, position.resolvedAction);
    return (node.body.verb !== "hold" || position.index <= 1) && resolvedActionMatches(node.body, position.resolvedAction);
  }
  if (position.resolvedAction !== undefined) return false;
  if (node.kind === "if") {
    if (position.index !== 0 || position.children.length > 1) return false;
    if (position.branch === null) return position.children.length === 0 && position.status !== "done";
    const child = position.branch === "then" ? node.then : node.otherwise;
    if (!child) return position.children.length === 0 && position.status === "done";
    return position.children.length === 1 && cursorMatches(child, position.children[0], [...path, 0]);
  }
  if (position.branch !== null || position.children.length > node.children.length) return false;
  if (!position.children.every((child, index) => cursorMatches(node.children[index], child, [...path, index]))) return false;
  if (node.kind === "parallel") return position.index === 0 && (position.status !== "done" || (position.children.length === node.children.length && position.children.every((child) => child.status === "done")));
  if (position.index > node.children.length || position.children.length < position.index || position.children.length > position.index + 1) return false;
  if (position.children.slice(0, position.index).some((child) => child.status !== "done")) return false;
  return position.status === "done" ? position.index === node.children.length : position.index < node.children.length;
}
function world(value: unknown): boolean {
  if (!record(value) || !isStageId(value.stageId) || value.stageId === 1 || !name(value.segmentId) || !integer(value.tick) || (value.segmentStartedAt !== undefined && (!integer(value.segmentStartedAt) || value.segmentStartedAt > value.tick)) || !integer(value.attempt) || value.attempt < 1 || !record(value.entities) || !record(value.actors) || !record(value.actors.hero) || !names(value.visible) || !Array.isArray(value.facts)) return false;
  const entities = value.entities;
  const actors = value.actors;
  for (const [id, item] of Object.entries(entities)) {
    if (!record(item) || item.id !== id || !name(item.name) || typeof item.description !== "string" || !["wood", "cork", "stone", "metal", "glass", "cloth", "water", "light"].includes(String(item.material)) || typeof item.movable !== "boolean" || !finite(item.weight) || item.weight < 0 || !finite(item.capacity) || item.capacity < 0 || !finite(item.reach) || item.reach < 0 || !location(item.location) || !(item.parent === null || name(item.parent)) || !record(item.properties) || !Object.values(item.properties).every(scalar)) return false;
    if (item.propertyOptions !== undefined && (!record(item.propertyOptions) || Object.keys(item.propertyOptions).length > 64 || Object.entries(item.propertyOptions).some(([key, values]) => !name(key) || !Array.isArray(values) || values.length === 0 || values.length > 64 || !values.every(scalar)))) return false;
    if (item.parent !== null && !Object.hasOwn(entities, item.parent as string) && !Object.hasOwn(actors, item.parent as string)) return false;
    const visited = new Set<string>([id]);
    let parent: unknown = item.parent;
    while (typeof parent === "string" && Object.hasOwn(entities, parent)) {
      if (visited.has(parent)) return false;
      visited.add(parent);
      const ancestor = entities[parent];
      if (!record(ancestor)) return false;
      parent = ancestor.parent;
    }
  }
  for (const [id, actor] of Object.entries(actors)) {
    if (Object.hasOwn(entities, id)) return false;
    if (!record(actor) || !["hero", "keeper"].includes(id) || actor.id !== id || !location(actor.location) || !names(actor.carrying) || !names(actor.capabilities) || !(actor.holding === null || name(actor.holding)) || !(actor.riding === null || name(actor.riding))) return false;
    for (const target of [...actor.carrying, actor.holding, actor.riding]) if (target !== null && !Object.hasOwn(entities, String(target))) return false;
    for (const carried of actor.carrying) if ((entities[carried] as Record<string, unknown>).parent !== id) return false;
    for (const [entityId, item] of Object.entries(entities)) if ((item as Record<string, unknown>).parent === id && !actor.carrying.includes(entityId)) return false;
  }
  if (value.visible.some((id) => !Object.hasOwn(entities, id))) return false;
  for (const fact of value.facts) if (!record(fact) || !name(fact.entity) || !name(fact.property) || !scalar(fact.value) || !integer(fact.attempt) || fact.attempt < 1 || fact.attempt > value.attempt || !integer(fact.tick)) return false;
  return true;
}
/** Rejects damaged snapshots before constructing a runtime; physical victory is checked by the stage authority. */
export function parseStageRun(value: unknown): StageRun | null {
  if (!record(value) || value.version !== 2 || (value.contentRevision !== undefined && value.contentRevision !== "quiet-v1") || !Array.isArray(value.waitingStates) || !value.waitingStates.every((item) => typeof item === "string") || !name(value.id) || !isStageId(value.stageId) || value.stageId === 1 || !integer(value.revision) || !(value.statusReason === null || typeof value.statusReason === "string") || !["bookmark", "running", "waiting", "blocked", "failed", "cleared"].includes(String(value.phase)) || !world(value.world) || !world(value.checkpoint) || !record(value.world) || !record(value.checkpoint) || value.world.stageId !== value.stageId || value.checkpoint.stageId !== value.stageId || !names(value.clearedSegments) || value.clearedSegments.length > stageSummary(value.stageId).coreSegments || !integer(value.seal) || value.seal > (value.contentRevision === "quiet-v1" && value.stageId === 10 ? 3 : 2) || (value.stageId !== 10 && value.seal !== 0)) return null;
  if (value.learning !== undefined) {
    const learning = value.learning;
    if (!record(learning) || !names(learning.completedSegmentIds) || !Array.isArray(learning.attemptedSentences) || learning.attemptedSentences.some((attempt) => !record(attempt) || !name(attempt.segmentId) || !name(attempt.text) || [...String(attempt.text)].length > 500)) return null;
  }
  if (value.sceneNotes !== undefined && (!Array.isArray(value.sceneNotes) || value.sceneNotes.some((note) =>
    !record(note) || !name(note.segmentId) || !name(note.text) || [...String(note.text)].length > 500))) return null;
  const book = value.notebook;
  if (!record(book) || !Array.isArray(book.instructions) || book.instructions.some((item) => parseProgram(item) === null) || typeof book.canWrite !== "boolean" || typeof book.departed !== "boolean" || typeof book.editing !== "boolean" || !integer(book.erasers) || book.erasers > 2 || !integer(book.bells) || !names(book.visitedBookmarks) || (book.scratch !== undefined && typeof book.scratch !== "boolean")) return null;
  if (book.scratch === true && (book.instructions.length > 1 || book.erasers !== 2 || book.bells !== 0)) return null;
  const instructionIds = book.instructions.map((item) => (item as Record<string, unknown>).id);
  const instructions = book.instructions as InstructionProgram[];
  if (new Set(instructionIds).size !== instructionIds.length || !book.visitedBookmarks.includes(String(value.world.segmentId))) return null;
  if (book.clarificationId !== undefined && (!name(book.clarificationId) || !instructionIds.includes(book.clarificationId) || value.phase !== "bookmark" || !book.canWrite || !book.editing)) return null;
  if (book.writeCosts !== undefined && (!record(book.writeCosts) || Object.entries(book.writeCosts).some(([id, cost]) => !instructionIds.includes(id) || !record(cost) || !integer(cost.erasers) || cost.erasers > 1 || !integer(cost.bells) || (cost.bells !== 0 && cost.bells !== 3) || (cost.erasers > 0 && cost.bells > 0)))) return null;
  const execution = value.execution;
  function procedure(input: unknown): boolean {
    if (!record(input) || !instructionIds.includes(input.instructionId) || !cursor(input.cursor)) return false;
    const program = instructions.find((item) => item.id === input.instructionId)!;
    return cursorMatches(program.body, input.cursor as ProgramCursor);
  }
  if (!record(execution) || !integer(execution.epoch) || !names(execution.completed) || !record(execution.matches) || !Object.values(execution.matches).every((item) => typeof item === "boolean") || !(execution.active === null || procedure(execution.active)) || !Array.isArray(execution.suspended) || !execution.suspended.every(procedure)) return null;
  if (book.clarificationId && (execution.active !== null || execution.suspended.length > 0)) return null;
  if (!Array.isArray(value.events)) return null;
  const eventIds = new Set<string>();
  for (const event of value.events) {
    if (!record(event) || !name(event.id) || eventIds.has(event.id) || !integer(event.tick) || !integer(event.attempt) || event.attempt < 1 || event.attempt > Number(value.world.attempt) || !(event.instructionId === null || name(event.instructionId)) || !(event.actor === null || event.actor === "hero" || event.actor === "keeper") || !(event.target === null || name(event.target)) || !["safe", "blocked", "clarification", "failure", "observed", "interrupted"].includes(String(event.outcome)) || typeof event.reason !== "string" || !Array.isArray(event.changes) || !event.changes.every((change) => record(change) && name(change.entity) && name(change.property) && (change.before === null || scalar(change.before)) && (change.after === null || scalar(change.after)))) return null;
    if (event.verb !== undefined && !parsePhysicalAction({ kind: "action", actor: event.actor, target: event.target, verb: event.verb })) return null;
    eventIds.add(event.id);
  }
  return structuredClone(value) as unknown as StageRun;
}

export function parseWorldState(value: unknown): WorldState | null {
  return world(value) ? structuredClone(value) as WorldState : null;
}
