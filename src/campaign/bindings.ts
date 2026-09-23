import { evaluateCondition } from "./conditions";
import type { EntityBinding, InstructionProgram, PhysicalAction, Predicate, ProgramNode, WorldState } from "./types";

export type ProgramBindingResolution =
  | { kind: "resolved"; program: InstructionProgram; condition: true | false | "unknown" }
  | { kind: "dormant"; reason: "scope" | "missing" | "literal" }
  | { kind: "clarification"; reason: string };

function bindingMatches(world: WorldState, binding: EntityBinding): string[] {
  return world.visible.filter((id) => world.entities[id]?.publicKind === binding.value);
}

function boundId(bindings: InstructionProgram["bindings"], resolved: ReadonlyMap<string, string>, id: string): string {
  return bindings?.[id] ? resolved.get(id) ?? id : id;
}

function bindPredicate(predicate: Predicate, bindings: InstructionProgram["bindings"], resolved: ReadonlyMap<string, string>): Predicate {
  if (predicate.kind === "not") return { ...predicate, predicate: bindPredicate(predicate.predicate, bindings, resolved) };
  if (predicate.kind === "all" || predicate.kind === "any") return { ...predicate, predicates: predicate.predicates.map((item) => bindPredicate(item, bindings, resolved)) };
  if (predicate.kind === "property" || predicate.kind === "visible") return { ...predicate, entity: boundId(bindings, resolved, predicate.entity) };
  return predicate;
}

function bindAction(action: PhysicalAction, bindings: InstructionProgram["bindings"], resolved: ReadonlyMap<string, string>): PhysicalAction {
  const references = action.references && Object.fromEntries(Object.entries(action.references).map(([role, reference]) => [role, {
    ...reference,
    entity: boundId(bindings, resolved, reference!.entity),
  }]));
  return {
    ...action,
    target: boundId(bindings, resolved, action.target),
    ...(action.destination === undefined ? {} : { destination: boundId(bindings, resolved, action.destination) }),
    ...(action.instrument === undefined ? {} : { instrument: boundId(bindings, resolved, action.instrument) }),
    ...(references ? { references } : {}),
  };
}

function bindNode(node: ProgramNode, bindings: InstructionProgram["bindings"], resolved: ReadonlyMap<string, string>): ProgramNode {
  if (node.kind === "action") return bindAction(node, bindings, resolved);
  if (node.kind === "wait") return { ...node, until: bindPredicate(node.until, bindings, resolved) };
  if (node.kind === "until") return { ...node, condition: bindPredicate(node.condition, bindings, resolved), body: bindAction(node.body, bindings, resolved) };
  if (node.kind === "if") return {
    ...node,
    condition: bindPredicate(node.condition, bindings, resolved),
    then: bindNode(node.then, bindings, resolved),
    ...(node.otherwise ? { otherwise: bindNode(node.otherwise, bindings, resolved) } : {}),
  };
  return { ...node, children: node.children.map((child) => bindNode(child, bindings, resolved)) };
}

function literalReferencesPresent(world: WorldState, node: ProgramNode): boolean {
  if (node.kind === "action") return [node.target, node.destination, node.instrument].every((id) => id === undefined || Object.hasOwn(world.entities, id));
  if (node.kind === "wait") return true;
  if (node.kind === "until") return literalReferencesPresent(world, node.body);
  if (node.kind === "if") return literalReferencesPresent(world, node.then) && (!node.otherwise || literalReferencesPresent(world, node.otherwise));
  return node.children.every((child) => literalReferencesPresent(world, child));
}

/** Rebinds only authored public categories in the current visible world. */
export function resolveProgramBindings(world: WorldState, program: InstructionProgram): ProgramBindingResolution {
  if (program.scope.stageId !== undefined && program.scope.stageId !== world.stageId) return { kind: "dormant", reason: "scope" };
  if (program.scope.region !== undefined && program.scope.region !== world.actors.hero?.location.region) return { kind: "dormant", reason: "scope" };
  const bindings = program.bindings;
  if (!bindings) {
    if (!literalReferencesPresent(world, program.body)) return { kind: "dormant", reason: "literal" };
    const condition = program.condition ? evaluateCondition(world, program.condition) : true;
    return { kind: "resolved", program, condition };
  }
  const resolved = new Map<string, string>();
  for (const [placeholder, binding] of Object.entries(bindings)) {
    const matches = bindingMatches(world, binding);
    if (matches.length === 0) return { kind: "dormant", reason: "missing" };
    if (matches.length > 1) return {
      kind: "clarification",
      reason: "메모가 가리키는 물건이 여러 개예요. 대상을 더 구체적으로 적어 주세요.",
    };
    resolved.set(placeholder, matches[0]);
  }
  const bound: InstructionProgram = {
    ...program,
    body: bindNode(program.body, bindings, resolved),
    ...(program.condition ? { condition: bindPredicate(program.condition, bindings, resolved) } : {}),
  };
  if (!literalReferencesPresent(world, bound.body)) return { kind: "dormant", reason: "literal" };
  const condition = bound.condition ? evaluateCondition(world, bound.condition) : true;
  return { kind: "resolved", program: bound, condition };
}
