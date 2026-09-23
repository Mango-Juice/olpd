import { propertyVisibility } from "./presentation.js";
import type { ActionReferenceRole, EntityReference, PhysicalAction, Predicate, Scalar, Truth, WorldState } from "./types";

/** Shared knowledge boundary: neither unknown keys nor hidden properties are evidence. */
export function isPublicProperty(property: string): boolean {
  return propertyVisibility(property) === "shown";
}

export function readPublicProperty(world: WorldState, reference: EntityReference): Scalar | undefined {
  if (!isPublicProperty(reference.property)) return undefined;
  if (reference.source === "visible") {
    return world.visible.includes(reference.entity) ? world.entities[reference.entity]?.properties[reference.property] : undefined;
  }
  return [...world.facts].reverse().find((fact) => fact.attempt === world.attempt && fact.entity === reference.entity && fact.property === reference.property)?.value;
}

export type ReferenceResolution = { outcome: "valid"; action: PhysicalAction } | { outcome: "clarification"; reason: string };

/** A missing observation never falls back to the literal ID or the hidden live relation. */
export function resolveActionReferences(world: WorldState, action: PhysicalAction): ReferenceResolution {
  if (!action.references) return { outcome: "valid", action };
  const resolved = { ...action };
  delete resolved.references;
  for (const role of ["target", "destination", "instrument"] as const satisfies readonly ActionReferenceRole[]) {
    const reference = action.references[role];
    if (!reference) continue;
    const value = readPublicProperty(world, reference);
    if (value === undefined) return { outcome: "clarification", reason: "이 대상을 가리키는 연결을 이번 시도에서 확인하지 못했어요. 다시 관찰하거나 대상을 직접 지목해 주세요." };
    if (typeof value !== "string" || !Object.hasOwn(world.entities, value)) {
      return { outcome: "clarification", reason: "확인한 연결이 하나의 실제 대상을 가리키지 않아요. 어느 대상을 뜻하는지 분명히 해 주세요." };
    }
    resolved[role] = value;
  }
  return { outcome: "valid", action: resolved };
}

function compare(left: Scalar, right: Scalar, comparison: Extract<Predicate, { kind: "property" }>["comparison"]): Truth {
  if (comparison === "eq") return left === right;
  if (typeof left !== "number" || typeof right !== "number") return "unknown";
  switch (comparison) {
    case "lt": return left < right;
    case "lte": return left <= right;
    case "gt": return left > right;
    case "gte": return left >= right;
  }
}

/** Three-valued logic: NOT(unobserved) must never grant knowledge of the opposite. */
export function evaluateCondition(world: WorldState, predicate: Predicate): Truth {
  switch (predicate.kind) {
    case "visible": return world.visible.includes(predicate.entity);
    case "not": {
      const result = evaluateCondition(world, predicate.predicate);
      return result === "unknown" ? result : !result;
    }
    case "all": {
      const results = predicate.predicates.map((item) => evaluateCondition(world, item));
      return results.includes(false) ? false : results.includes("unknown") ? "unknown" : true;
    }
    case "any": {
      const results = predicate.predicates.map((item) => evaluateCondition(world, item));
      return results.includes(true) ? true : results.includes("unknown") ? "unknown" : false;
    }
    case "property": {
      // Existing deterministic predicates may be authored by stage code. The
      // provider validates their public vocabulary before creating a program.
      let value: Scalar | undefined;
      if (predicate.source === "visible") {
        if (!world.visible.includes(predicate.entity)) return "unknown";
        value = world.entities[predicate.entity]?.properties[predicate.property];
      } else {
        value = [...world.facts].reverse().find((fact) => fact.attempt === world.attempt && fact.entity === predicate.entity && fact.property === predicate.property)?.value;
      }
      return value === undefined ? "unknown" : compare(value, predicate.value, predicate.comparison);
    }
  }
}
