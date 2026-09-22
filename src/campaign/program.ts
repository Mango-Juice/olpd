import { evaluateCondition } from "./conditions";
import type { PhysicalAction, Predicate, ProgramNode, WorldState } from "./types";

/** Cursor is persisted with the world; waiting never restarts an earlier action. */
export interface ProgramCursor {
  path: number[];
  status: "pending" | "running" | "done" | "blocked";
  index: number;
  children: ProgramCursor[];
  branch: "then" | "otherwise" | null;
  reason: string | null;
}
export interface ActionResult {
  world: WorldState;
  /** Progress keeps the same atomic action active across deterministic movement ticks. */
  outcome: "done" | "progress" | "blocked" | "clarification" | "failure";
  reason: string;
}
export type ActionExecutor = (world: WorldState, action: PhysicalAction) => ActionResult;
export interface ProgramStep {
  world: WorldState;
  cursor: ProgramCursor;
  actions: PhysicalAction[];
  outcome: "progress" | "waiting" | "done" | "blocked" | "clarification" | "failure";
  reason: string | null;
}
export function createCursor(path: number[] = []): ProgramCursor {
  return { path, status: "pending", index: 0, children: [], branch: null, reason: null };
}
function result(world: WorldState, cursor: ProgramCursor, outcome: ProgramStep["outcome"], actions: PhysicalAction[] = [], reason: string | null = null): ProgramStep {
  return { world, cursor: { ...cursor, status: outcome === "done" ? "done" : outcome === "blocked" || outcome === "clarification" || outcome === "failure" ? "blocked" : "running", reason }, actions, outcome, reason };
}
function waiting(world: WorldState, cursor: ProgramCursor, condition: Predicate, boundaryWorld = world): ProgramStep {
  const value = evaluateCondition(boundaryWorld, condition);
  return value === true ? result(world, cursor, "done") : result(world, cursor, "waiting", [], value === "unknown" ? "아직 확인하지 못한 조건을 기다리고 있어요." : "조건이 달라지기를 기다리고 있어요.");
}

interface AtomicPreview {
  verb: PhysicalAction["verb"] | null;
  priority: number;
}

const UNRESOLVED_BRANCH_PRIORITY = -1;

function verbPriority(verb: PhysicalAction["verb"] | null): number {
  if (verb === "hold") return 0;
  if (verb === "release") return 2;
  return 1;
}

/**
 * Read-only lookahead for one logical boundary. It never prepares a cursor for
 * an unexecuted branch; actual control flow persists its own branch selection.
 */
function nextAtomic(world: WorldState, node: ProgramNode, cursor: ProgramCursor): AtomicPreview {
  if (cursor.status === "done" || cursor.status === "blocked") return { verb: null, priority: verbPriority(null) };
  switch (node.kind) {
    case "action":
      return { verb: node.verb, priority: verbPriority(node.verb) };
    case "wait":
      return { verb: null, priority: verbPriority(null) };
    case "until": {
      if (evaluateCondition(world, node.condition) === true) {
        const verb = cursor.index > 0 && node.body.verb === "hold" ? "release" : null;
        return { verb, priority: verbPriority(verb) };
      }
      const verb = cursor.index > 0 && node.body.verb === "hold" ? null : node.body.verb;
      return { verb, priority: verbPriority(verb) };
    }
    case "if": {
      let branch = cursor.branch;
      if (branch === null) {
        const condition = evaluateCondition(world, node.condition);
        // Keep an unresolved branch ahead of mutations, so its execution sees the same boundary state.
        if (condition === "unknown") return { verb: null, priority: UNRESOLVED_BRANCH_PRIORITY };
        branch = condition ? "then" : "otherwise";
      }
      const child = branch === "then" ? node.then : node.otherwise;
      if (!child) return { verb: null, priority: verbPriority(null) };
      return nextAtomic(world, child, cursor.children[0] ?? createCursor([...cursor.path, 0]));
    }
    case "sequence": {
      if (cursor.index >= node.children.length) return { verb: null, priority: verbPriority(null) };
      const index = cursor.index;
      return nextAtomic(world, node.children[index], cursor.children[index] ?? createCursor([...cursor.path, index]));
    }
    case "parallel": {
      let first: Pick<AtomicPreview, "verb" | "priority"> = { verb: null, priority: verbPriority(null) };
      let found = false;
      for (let index = 0; index < node.children.length; index++) {
        const childCursor = cursor.children[index] ?? createCursor([...cursor.path, index]);
        const preview = nextAtomic(world, node.children[index], childCursor);
        if (childCursor.status === "done") continue;
        if (!found || preview.priority < first.priority) {
          first = { verb: preview.verb, priority: preview.priority };
          found = true;
        }
      }
      return first;
    }
  }
}
/** One atomic action per sequential branch. Tick advancement belongs to the world scheduler. */
export function stepProgram(world: WorldState, node: ProgramNode, cursor: ProgramCursor, execute: ActionExecutor, boundaryWorld: WorldState = world): ProgramStep {
  if (cursor.status === "done") return result(world, cursor, "done");
  if (cursor.status === "blocked") return result(world, cursor, "blocked", [], cursor.reason);
  switch (node.kind) {
    case "action": {
      const next = execute(world, node);
      return result(next.world, cursor, next.outcome, [node], next.reason);
    }
    case "wait": return waiting(world, cursor, node.until, boundaryWorld);
    case "until": {
      if (evaluateCondition(boundaryWorld, node.condition) === true) {
        if (cursor.index > 0 && node.body.verb === "hold") {
          const release: PhysicalAction = { ...node.body, verb: "release" };
          const next = execute(world, release);
          return result(next.world, cursor, next.outcome, [release], next.reason);
        }
        return result(world, cursor, "done");
      }
      // A held role is established once; other actions repeat until the stated endpoint.
      if (cursor.index > 0 && node.body.verb === "hold") return waiting(world, cursor, node.condition, boundaryWorld);
      const next = execute(world, node.body);
      return result(next.world, { ...cursor, index: cursor.index + 1 }, next.outcome === "done" ? node.body.verb === "hold" ? "waiting" : "progress" : next.outcome, [node.body], next.reason);
    }
    case "if": {
      let branch = cursor.branch;
      if (branch === null) {
        const condition = evaluateCondition(boundaryWorld, node.condition);
        if (condition === "unknown") return result(world, cursor, "waiting", [], "조건을 먼저 관찰해야 해요.");
        branch = condition ? "then" : "otherwise";
      }
      const child = branch === "then" ? node.then : node.otherwise;
      if (!child) return result(world, { ...cursor, branch }, "done");
      const next = stepProgram(world, child, cursor.children[0] ?? createCursor([...cursor.path, 0]), execute, boundaryWorld);
      return result(next.world, { ...cursor, branch, children: [next.cursor] }, next.outcome, next.actions, next.reason);
    }
    case "sequence": {
      if (cursor.index >= node.children.length) return result(world, cursor, "done");
      const next = stepProgram(world, node.children[cursor.index], cursor.children[cursor.index] ?? createCursor([...cursor.path, cursor.index]), execute, boundaryWorld);
      const children = [...cursor.children];
      children[cursor.index] = next.cursor;
      const index = cursor.index + (next.outcome === "done" ? 1 : 0);
      return result(next.world, { ...cursor, index, children }, next.outcome === "done" ? index === node.children.length ? "done" : "progress" : next.outcome, next.actions, next.reason);
    }
    case "parallel": {
      // A single actor cannot occupy two simultaneous roles. Validate before either mutates.
      const actorSets = node.children.map(actorsIn);
      const assigned = new Set<string>();
      for (const actors of actorSets) for (const actor of actors) {
        if (assigned.has(actor)) return result(world, cursor, "clarification", [], "같은 주체에게 동시에 다른 역할을 맡길 수 없어요.");
        assigned.add(actor);
      }
      let currentWorld = world;
      // Materialize only pristine direct-child cursors so reordered execution never creates sparse arrays.
      const children = node.children.map((_, index) => cursor.children[index] ?? createCursor([...cursor.path, index]));
      const actions: PhysicalAction[] = [];
      let progressed = false;
      const order = node.children.map((child, index) => {
        const preview = nextAtomic(boundaryWorld, child, children[index] ?? createCursor([...cursor.path, index]));
        return { index, priority: preview.priority };
      }).sort((left, right) => left.priority - right.priority || left.index - right.index);
      for (const { index } of order) {
        if (children[index]?.status === "done") continue;
        const next = stepProgram(currentWorld, node.children[index], children[index] ?? createCursor([...cursor.path, index]), execute, boundaryWorld);
        currentWorld = next.world;
        children[index] = next.cursor;
        actions.push(...next.actions);
        if (next.outcome === "failure" || next.outcome === "blocked" || next.outcome === "clarification") return result(currentWorld, { ...cursor, children }, next.outcome, actions, next.reason);
        if (next.outcome !== "waiting" || next.actions.length > 0) progressed = true;
      }
      return result(currentWorld, { ...cursor, children }, children.length === node.children.length && children.every((child) => child.status === "done") ? "done" : progressed ? "progress" : "waiting", actions);
    }
  }
}
function actorsIn(node: ProgramNode): Set<string> {
  if (node.kind === "action") return new Set([node.actor]);
  if (node.kind === "wait") return new Set();
  if (node.kind === "until") return new Set([node.body.actor]);
  if (node.kind === "if") return new Set([...actorsIn(node.then), ...(node.otherwise ? actorsIn(node.otherwise) : [])]);
  return new Set(node.children.flatMap((child) => [...actorsIn(child)]));
}
