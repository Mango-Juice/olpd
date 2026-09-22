import type { Predicate, Scalar, Truth, WorldState } from "./types";

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
