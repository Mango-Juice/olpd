import { STAGNATION_LIMIT } from "./stagnation.js";
import { isStageId, stageSummary } from "./catalog.js";
import { parsePhysicalAction, parseProgram } from "./validation.js";
import type { StagePresentation, StageRun } from "./run";
import type { ProgramCursor } from "./program";
import type { EntityBinding, InstructionProgram, ProgramNode, WorldState } from "./types";

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function name(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function scalar(value: unknown): boolean { return typeof value === "string" || typeof value === "boolean" || finite(value); }
function names(value: unknown): value is string[] { return Array.isArray(value) && value.every(name) && new Set(value).size === value.length; }
function location(value: unknown): boolean { return record(value) && name(value.region) && finite(value.x) && finite(value.y) && (value.z === undefined || finite(value.z)); }
const MAX_MOTION_COORDINATE = 1_000_000;
function motionCoordinate(value: unknown): value is number {
  return finite(value) && Math.abs(value) <= MAX_MOTION_COORDINATE;
}
function validMotion(value: unknown): boolean {
  if (!record(value) || (value.actor !== "hero" && value.actor !== "keeper")
    || !["walk", "jump", "interact", "solid", "spikes", "steam", "heat", "crush", "water", "wind", "fall"].includes(String(value.kind))
    || (value.target !== undefined && !name(value.target))
    || (value.issue !== undefined && value.issue !== "out-of-reach" && value.issue !== "needs-partner")
    || !Array.isArray(value.points) || value.points.length < 1 || value.points.length > 512
    || (value.contact !== undefined && (!record(value.contact) || !motionCoordinate(value.contact.x) || !motionCoordinate(value.contact.y)
      || (value.contact.entity !== undefined && !name(value.contact.entity))
      || (value.contact.surface !== undefined && value.contact.surface !== "ceiling")))) return false;
  let previousTime = 0;
  for (const point of value.points) {
    if (!record(point) || !motionCoordinate(point.x) || !motionCoordinate(point.y)
      || (point.z !== undefined && !motionCoordinate(point.z))
      || !finite(point.t) || point.t < previousTime || point.t > 1) return false;
    previousTime = point.t;
  }
  return true;
}
function cursor(value: unknown, depth = 0): boolean {
  return depth < 64 && record(value) && Array.isArray(value.path) && value.path.every(integer) && ["pending", "running", "done", "blocked"].includes(String(value.status)) && integer(value.index) && (value.branch === null || value.branch === "then" || value.branch === "otherwise") && (value.reason === null || typeof value.reason === "string") && (value.resolvedAction === undefined || (parsePhysicalAction(value.resolvedAction) !== null && !Object.hasOwn(value.resolvedAction as object, "references"))) && Array.isArray(value.children) && value.children.length <= 4096 && value.children.every((child) => cursor(child, depth + 1));
}
function resolvedActionMatches(original: Extract<ProgramNode, { kind: "action" }>, resolved: ProgramCursor["resolvedAction"], bindings?: Record<string, EntityBinding>): boolean {
  if (!resolved) return true;
  if (!original.references || resolved.actor !== original.actor || resolved.verb !== original.verb || resolved.amount !== original.amount || resolved.references !== undefined) return false;
  for (const role of ["target", "destination", "instrument"] as const) {
    if (!original.references[role] && !bindings?.[String(original[role])] && resolved[role] !== original[role]) return false;
    if (original.references[role] && (typeof resolved[role] !== "string" || !resolved[role])) return false;
  }
  return true;
}
/** A structurally valid cursor can still point outside its instruction after damage. */
function cursorMatches(node: ProgramNode, position: ProgramCursor, path: number[] = [], bindings?: Record<string, EntityBinding>): boolean {
  if (position.path.length !== path.length || position.path.some((part, index) => part !== path[index])) return false;
  if (position.status === "pending" && (position.index !== 0 || position.children.length !== 0 || position.branch !== null || position.resolvedAction !== undefined)) return false;
  if (node.kind === "action" || node.kind === "wait" || node.kind === "until") {
    if (position.children.length !== 0 || position.branch !== null) return false;
    if (node.kind === "wait") return position.index === 0 && position.resolvedAction === undefined;
    if (node.kind === "action") return position.index === 0 && resolvedActionMatches(node, position.resolvedAction, bindings);
    return (node.body.verb !== "hold" || position.index <= 1) && resolvedActionMatches(node.body, position.resolvedAction, bindings);
  }
  if (position.resolvedAction !== undefined) return false;
  if (node.kind === "if") {
    if (position.index !== 0 || position.children.length > 1) return false;
    if (position.branch === null) return position.children.length === 0 && position.status !== "done";
    const child = position.branch === "then" ? node.then : node.otherwise;
    if (!child) return position.children.length === 0 && position.status === "done";
    return position.children.length === 1 && cursorMatches(child, position.children[0], [...path, 0], bindings);
  }
  if (position.branch !== null || position.children.length > node.children.length) return false;
  if (!position.children.every((child, index) => cursorMatches(node.children[index], child, [...path, index], bindings))) return false;
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
    if (!record(item) || item.id !== id || !name(item.name) || typeof item.description !== "string" || (item.publicKind !== undefined && (!name(item.publicKind) || [...String(item.publicKind)].length > 100)) || !["wood", "cork", "stone", "metal", "glass", "cloth", "water", "light"].includes(String(item.material)) || typeof item.movable !== "boolean" || !finite(item.weight) || item.weight < 0 || !finite(item.capacity) || item.capacity < 0 || !finite(item.reach) || item.reach < 0 || !location(item.location) || !(item.parent === null || name(item.parent)) || !record(item.properties) || !Object.values(item.properties).every(scalar)) return false;
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
    if (actor.route !== undefined && (!record(actor.route) || !name(actor.route.target) || !Object.hasOwn(entities, actor.route.target) || !integer(actor.route.next) || actor.route.next > 512)) return false;
    for (const target of [...actor.carrying, actor.holding, actor.riding]) if (target !== null && !Object.hasOwn(entities, String(target))) return false;
    for (const carried of actor.carrying) if ((entities[carried] as Record<string, unknown>).parent !== id) return false;
    for (const [entityId, item] of Object.entries(entities)) if ((item as Record<string, unknown>).parent === id && !actor.carrying.includes(entityId)) return false;
  }
  if (value.visible.some((id) => !Object.hasOwn(entities, id))) return false;
  for (const fact of value.facts) if (!record(fact) || !name(fact.entity) || !name(fact.property) || !scalar(fact.value) || !integer(fact.attempt) || fact.attempt < 1 || fact.attempt > value.attempt || !integer(fact.tick)) return false;
  return true;
}
function validWorldEvent(event: unknown, maxAttempt: number): boolean {
  return record(event) && name(event.id) && integer(event.tick) && integer(event.attempt) && event.attempt >= 1 && event.attempt <= maxAttempt
    && (event.motion === undefined || validMotion(event.motion))
    && (event.instructionId === null || name(event.instructionId))
    && (event.actor === null || event.actor === "hero" || event.actor === "keeper")
    && (event.target === null || name(event.target))
    && ["safe", "blocked", "clarification", "failure", "observed", "interrupted"].includes(String(event.outcome))
    && typeof event.reason === "string" && Array.isArray(event.changes)
    && event.changes.every((change) => record(change) && name(change.entity) && name(change.property)
      && (change.before === null || scalar(change.before)) && (change.after === null || scalar(change.after)));
}

function validPresentation(value: unknown, stageId: number): value is StagePresentation {
  if (!record(value) || !name(value.id) || !world(value.before) || !world(value.after)
    || (value.before as WorldState).stageId !== stageId || (value.after as WorldState).stageId !== stageId
    || !Array.isArray(value.events) || !value.events.every((event) => validWorldEvent(event, (value.after as WorldState).attempt))
    || !["safe", "death", "blocked", "revive", "cleared"].includes(String(value.outcome))
    || typeof value.repeated !== "boolean" || !integer(value.life) || value.life < 1
    || !integer(value.attempt) || value.attempt < 1
    || (value.completedSegmentId !== undefined && !name(value.completedSegmentId))
    || (value.nextSegmentId !== undefined && !name(value.nextSegmentId))) return false;
  return true;
}

/** Rejects damaged supported snapshots before constructing a runtime. */
export function parseStageRun(value: unknown): StageRun | null {
  if (!record(value) || value.version !== 3 || (value.contentRevision !== "shared-v1" && value.contentRevision !== "spatial-v1")
    || (value.stagnation !== undefined && (!record(value.stagnation)
      || typeof value.stagnation.key !== "string" || !integer(value.stagnation.count)
      || value.stagnation.count < 1 || value.stagnation.count >= STAGNATION_LIMIT))
    || !Array.isArray(value.waitingStates) || !value.waitingStates.every((item) => typeof item === "string")
    || !name(value.id) || !isStageId(value.stageId) || value.stageId === 1 || !integer(value.revision)
    || !(value.statusReason === null || typeof value.statusReason === "string")
    || !["bookmark", "running", "waiting", "blocked", "failed", "cleared"].includes(String(value.phase))
    || !world(value.world) || !world(value.checkpoint) || !record(value.world) || !record(value.checkpoint)
    || value.world.stageId !== value.stageId || value.checkpoint.stageId !== value.stageId
    || !names(value.clearedSegments) || value.clearedSegments.length > stageSummary(value.stageId).coreSegments
    || !integer(value.seal) || value.seal > (value.stageId === 10 ? 3 : 0) || (value.stageId !== 10 && value.seal !== 0)) return null;
  const book = value.notebook;
  if (!record(book) || !Array.isArray(book.instructions) || book.instructions.some((item) => parseProgram(item) === null)
    || typeof book.canWrite !== "boolean" || typeof book.departed !== "boolean" || typeof book.editing !== "boolean"
    || typeof book.canDelete !== "boolean" || !integer(book.erasers) || book.erasers > 2
    || !integer(book.penaltyDeaths) || book.penaltyDeaths % 3 !== 0 || !integer(book.deaths)) return null;
  const instructionIds = book.instructions.map((item) => (item as Record<string, unknown>).id);
  const instructions = book.instructions as InstructionProgram[];
  if (new Set(instructionIds).size !== instructionIds.length) return null;
  if (book.canDelete !== (value.phase === "failed") || (book.canWrite && value.phase !== "bookmark" && value.phase !== "failed")) return null;
  const execution = value.execution;
  function procedure(input: unknown): boolean {
    if (!record(input) || !instructionIds.includes(input.instructionId) || !cursor(input.cursor)) return false;
    const program = instructions.find((item) => item.id === input.instructionId)!;
    return cursorMatches(program.body, input.cursor as ProgramCursor, [], program.bindings);
  }
  if (!record(execution) || !integer(execution.epoch) || !names(execution.completed) || !record(execution.matches) || !Object.values(execution.matches).every((item) => typeof item === "boolean") || !(execution.active === null || procedure(execution.active)) || !Array.isArray(execution.suspended) || !execution.suspended.every(procedure)) return null;
  if (value.phase === "bookmark" || value.phase === "failed" || value.phase === "blocked" || value.phase === "cleared") {
    if (execution.active !== null || execution.suspended.length > 0) return null;
  }
  if (!Array.isArray(value.events)) return null;
  const eventIds = new Set<string>();
  for (const event of value.events) {
    if (!validWorldEvent(event, Number(value.world.attempt)) || !record(event) || eventIds.has(String(event.id))) return null;
    if (event.verb !== undefined && !parsePhysicalAction({ kind: "action", actor: event.actor, target: event.target, verb: event.verb })) return null;
    eventIds.add(String(event.id));
  }
  if (!record(value.history) || value.history.version !== 1 || !Array.isArray(value.history.initialInstructions)
    || value.history.initialInstructions.some((item) => parseProgram(item) === null) || !Array.isArray(value.history.entries)) return null;
  const activeHighToLow = [...(value.history.initialInstructions as InstructionProgram[])].reverse();
  const knownInstructionIds = new Set(activeHighToLow.map((item) => item.id));
  const historyEventIds: string[] = [];
  let eraserSpend = 0;
  let penaltySpend = 0;
  let priorRevision = 0;
  for (const raw of value.history.entries) {
    if (!record(raw) || !["write", "delete", "reorder", "action", "revive", "abandon"].includes(String(raw.kind))
      || !integer(raw.revision) || raw.revision <= priorRevision || raw.revision > value.revision
      || !integer(raw.life) || raw.life < 1) return null;
    priorRevision = raw.revision;
    if (raw.kind === "write") {
      const instruction = parseProgram(raw.instruction);
      if (!instruction || knownInstructionIds.has(instruction.id)) return null;
      knownInstructionIds.add(instruction.id);
      activeHighToLow.unshift(instruction);
    }
    if (raw.kind === "delete") {
      if (!name(raw.instructionId) || !name(raw.instructionText) || !integer(raw.eraserCost)
        || !integer(raw.deathCost) || !((raw.eraserCost === 1 && raw.deathCost === 0) || (raw.eraserCost === 0 && raw.deathCost === 3))) return null;
      const index = activeHighToLow.findIndex((item) => item.id === raw.instructionId && item.text === raw.instructionText);
      if (index < 0) return null;
      activeHighToLow.splice(index, 1);
      eraserSpend += raw.eraserCost;
      penaltySpend += raw.deathCost;
    }
    if (raw.kind === "reorder") {
      if (!name(raw.instructionId) || !name(raw.instructionText) || !integer(raw.from) || !integer(raw.to)
        || raw.from >= activeHighToLow.length || raw.to >= activeHighToLow.length
        || activeHighToLow[raw.from]?.id !== raw.instructionId || activeHighToLow[raw.from]?.text !== raw.instructionText) return null;
      const [instruction] = activeHighToLow.splice(raw.from, 1);
      activeHighToLow.splice(raw.to, 0, instruction);
    }
    if (raw.kind === "action") {
      if (!Array.isArray(raw.eventIds) || !raw.eventIds.every((id) => name(id) && eventIds.has(id))) return null;
      historyEventIds.push(...raw.eventIds);
    }
  }
  const stageId = value.stageId as Exclude<import("./types").StageId, 1>;
  if (!Array.isArray(value.presentationHistory) || !value.presentationHistory.every((item) => validPresentation(item, stageId))) return null;
  const presentationIds = (value.presentationHistory as StagePresentation[]).map((item) => item.id);
  if (new Set(presentationIds).size !== presentationIds.length) return null;
  if (!(value.presentation === null || validPresentation(value.presentation, stageId))) return null;
  if (value.presentation !== null && !presentationIds.includes((value.presentation as StagePresentation).id)) return null;
  const currentHighToLow = [...instructions].reverse();
  if (activeHighToLow.length !== currentHighToLow.length || activeHighToLow.some((item, index) =>
    item.id !== currentHighToLow[index]?.id || item.text !== currentHighToLow[index]?.text)) return null;
  if (book.erasers !== Math.max(0, 2 - eraserSpend) || book.penaltyDeaths !== penaltySpend) return null;
  const storedEventIds = (value.events as { id: string }[]).map((event) => event.id);
  if (historyEventIds.length !== storedEventIds.length || historyEventIds.some((id, index) => id !== storedEventIds[index])) return null;
  const presentedEventIds = (value.presentationHistory as StagePresentation[]).flatMap((item) => item.events.map((event) => event.id));
  if (presentedEventIds.length !== storedEventIds.length || presentedEventIds.some((id, index) => id !== storedEventIds[index])) return null;
  if ((value.presentationHistory as StagePresentation[]).filter((item) => item.outcome === "death").length !== book.deaths) return null;
  return structuredClone(value) as unknown as StageRun;
}

export function parseWorldState(value: unknown): WorldState | null {
  return world(value) ? structuredClone(value) as WorldState : null;
}
