import { describe, expect, it } from "vitest";
import { deepSeekPublicWorld } from "../server/campaign-deepseek";
import { makeEntity, makeWorld } from "../src/campaign/level";

describe("campaign AI public context", () => {
  it("shares presentation schema, omits empty fields, and preserves actor inventory state", () => {
    const world = makeWorld(8, "08-context", [
      makeEntity("plain", "돌", "08-context", 0),
      makeEntity("left", "왼쪽 손잡이", "08-context", 1, { description: "한 번 당기는 고정 손잡이", properties: { actuator: true, open: false } }),
      makeEntity("right", "오른쪽 손잡이", "08-context", 2, { properties: { actuator: true, open: true } }),
    ]);
    world.actors.hero.riding = "plain";
    world.actors.keeper = { id: "keeper", location: { region: "08-context", x: 0, y: 0 }, holding: null, carrying: [], riding: null, capabilities: ["rail-only"] };
    const context = deepSeekPublicWorld(world);
    expect(context.propertySchema).toMatchObject({
      actuator: { label: expect.any(String), booleanMeanings: { true: expect.any(String), false: expect.any(String) } },
      open: { label: "열림", booleanMeanings: { true: expect.any(String), false: expect.any(String) } },
    });
    expect(context.entities.every((entity) => !("propertyLabels" in entity) && !("booleanMeanings" in entity))).toBe(true);
    expect(context.entities.find((entity) => entity.id === "plain")).not.toHaveProperty("description");
    expect(context.entities.find((entity) => entity.id === "plain")).not.toHaveProperty("parent");
    expect(context.entities.find((entity) => entity.id === "plain")).not.toHaveProperty("properties");
    expect(context.actors[0]).toMatchObject({ name: "용사", carrying: ["letter"], riding: "plain" });
    expect(context.actors[0]).not.toHaveProperty("holding");
    expect(context.actors[1]).toMatchObject({ id: "keeper", name: "등지기", capabilities: ["rail-only"] });
  });

  it("keeps only the latest public fact per entity property in the current attempt", () => {
    const world = makeWorld(8, "08-context", [
      makeEntity("window", "관측창", "08-context", 0, { properties: { connectedTo: "east", kind: "internal" } }),
      makeEntity("east", "동쪽 손잡이", "08-context", 1),
      makeEntity("west", "서쪽 손잡이", "08-context", 2),
    ]);
    world.attempt = 2;
    world.facts = [
      { entity: "window", property: "connectedTo", value: "west", attempt: 1, tick: 1 },
      { entity: "window", property: "connectedTo", value: "west", attempt: 2, tick: 2 },
      { entity: "window", property: "connectedTo", value: "east", attempt: 2, tick: 3 },
      { entity: "window", property: "kind", value: "secret", attempt: 2, tick: 3 },
    ];
    const context = deepSeekPublicWorld(world);
    expect(context.facts).toEqual([{ entity: "window", property: "connectedTo", value: "east" }]);
    expect(JSON.stringify(context)).not.toContain("secret");
    expect(JSON.stringify(context)).not.toContain("tick");
    expect(JSON.stringify(context)).not.toContain("attempt");
  });
});
