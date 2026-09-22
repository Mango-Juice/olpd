import { describe, expect, it } from "vitest";
import { evaluateCondition } from "../src/campaign/conditions";
import type { Predicate, WorldState } from "../src/campaign/types";

const condition: Predicate = { kind: "property", entity: "signal", property: "route", value: "left", comparison: "eq", source: "remembered" };
function world(): WorldState {
  return { stageId: 8, segmentId: "08-1", tick: 4, attempt: 2, entities: {}, actors: {}, visible: [], facts: [
    { entity: "signal", property: "route", value: "left", attempt: 1, tick: 1 },
  ] };
}
describe("attempt-scoped observation logic", () => {
  it("does not reuse knowledge from a rewound attempt", () => {
    expect(evaluateCondition(world(), condition)).toBe("unknown");
    expect(evaluateCondition(world(), { kind: "not", predicate: condition })).toBe("unknown");
  });
  it("uses the latest actual observation in this attempt", () => {
    const state = world();
    state.facts.push({ entity: "signal", property: "route", value: "left", attempt: 2, tick: 2 });
    expect(evaluateCondition(state, condition)).toBe(true);
    state.facts.push({ entity: "signal", property: "route", value: "right", attempt: 2, tick: 3 });
    expect(evaluateCondition(state, condition)).toBe(false);
  });
  it("does not reveal a hidden physical property", () => {
    const state = world();
    state.entities.signal = { id: "signal", name: "신호", description: "화물 선로", material: "metal", movable: false, weight: 1, capacity: 0, reach: 1, location: { region: "yard", x: 0, y: 0 }, parent: null, properties: { route: "left" } };
    const visible: Predicate = { ...condition, source: "visible" };
    expect(evaluateCondition(state, visible)).toBe("unknown");
    state.visible.push("signal");
    expect(evaluateCondition(state, visible)).toBe(true);
  });
  it("keeps unknown distinct through conjunction and disjunction", () => {
    expect(evaluateCondition(world(), { kind: "all", predicates: [condition] })).toBe("unknown");
    expect(evaluateCondition(world(), { kind: "any", predicates: [condition] })).toBe("unknown");
    expect(evaluateCondition(world(), { kind: "all", predicates: [] })).toBe(true);
    expect(evaluateCondition(world(), { kind: "any", predicates: [] })).toBe(false);
  });
});
