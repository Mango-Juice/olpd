import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_CASES,
  DEEPSEEK_CASE_FIXTURE_BODIES,
  fixtureProgram,
  type DeepSeekCase,
} from "../scripts/campaign-deepseek-cases";
import { createCursor, stepProgram } from "../src/campaign/program";
import { THEATRE_STAGE } from "../src/campaign/stages/theatre";
import type { InstructionProgram, PhysicalAction, Predicate, ProgramNode, WorldState } from "../src/campaign/types";

function byId(id: string): DeepSeekCase {
  const found = DEEPSEEK_CASES.find((item) => item.id === id);
  if (!found) throw new Error(`missing DeepSeek case ${id}`);
  return found;
}

function withBody(testCase: DeepSeekCase, body: ProgramNode): InstructionProgram {
  const fixture = fixtureProgram(testCase);
  const initial = testCase.world();
  return {
    version: 2,
    id: `test:${testCase.id}`,
    text: testCase.text,
    model: "test",
    scope: { stageId: initial.stageId, region: initial.actors.hero.location.region },
    guard: false,
    ...(fixture ? { ...fixture, id: `test:${testCase.id}`, model: "test" } : {}),
    body,
  };
}

describe("DeepSeek campaign evaluation corpus", () => {
  it("keeps a bounded, unique 27-case corpus and the frozen eight wording", () => {
    expect(DEEPSEEK_CASES).toHaveLength(27);
    expect(new Set(DEEPSEEK_CASES.map((item) => item.id)).size).toBe(27);
    expect(DEEPSEEK_CASES.slice(0, 8).map(({ id, text }) => ({ id, text }))).toEqual([
      { id: "intro-exact", text: "빈 코르크 상자를 물에 띄우고 그 위에 올라 건너편 발판에서 내려" },
      { id: "intro-paraphrase", text: "코르크 상자를 물가로 밀고 상자에 올라탄 뒤 건너편 발판에서 내려" },
      { id: "board-minimal", text: "빈 코르크 상자 위에 올라" },
      { id: "dismount-minimal", text: "빈 코르크 상자에서 건너편 발판으로 내려" },
      { id: "pour-two-participle", text: "세 칸 얕은 대야의 물 두 칸을 떠 있는 빈 통에 부어" },
      { id: "pour-two-plain", text: "세 칸 얕은 대야의 물 두 칸을 빈 통에 부어" },
      { id: "pour-three-plain", text: "세 칸 얕은 대야의 물 세 칸을 빈 통에 부어" },
      { id: "pour-two-arabic", text: "세 칸 얕은 대야에서 물 2칸을 빈 통에 부어" },
    ]);
    expect(DEEPSEEK_CASES.filter((item) => item.expected === "program")).toHaveLength(22);
    expect(DEEPSEEK_CASES.filter((item) => item.expected === "program-or-clarification")).toHaveLength(1);
    expect(DEEPSEEK_CASES.filter((item) => item.expected === "clarification")).toHaveLength(4);
  });

  it("accepts every positive program fixture and its real-world physics decision", () => {
    for (const testCase of DEEPSEEK_CASES) {
      if (testCase.expected === "clarification") {
        expect(fixtureProgram(testCase), testCase.id).toBeNull();
        continue;
      }
      const fixture = fixtureProgram(testCase);
      expect(fixture, testCase.id).not.toBeNull();
      expect(testCase.check(fixture!), `${testCase.id} semantic oracle`).toBe(true);
      if (testCase.physics) expect(testCase.physics(fixture!).pass, `${testCase.id} physics`).toBe(true);
    }
    expect(Object.keys(DEEPSEEK_CASE_FIXTURE_BODIES)).toHaveLength(23);
  });

  it("allows inert sequence nesting but never flattens wait or if controls", () => {
    const pour = byId("pour-two-plain");
    const nestedPour = withBody(pour, {
      kind: "sequence",
      children: [{ kind: "sequence", children: [DEEPSEEK_CASE_FIXTURE_BODIES["pour-two-plain"]] }],
    });
    expect(pour.check(nestedPour)).toBe(true);

    const waitCase = byId("wait-steam-then-move");
    const flattenedWait = withBody(waitCase, { kind: "action", actor: "hero", verb: "move", target: "03-1-exit" });
    expect(waitCase.check(flattenedWait)).toBe(false);
    expect(waitCase.physics?.(flattenedWait)).toMatchObject({ pass: false, detail: { outcome: "failure" } });

    const ifCase = byId("if-steam-false");
    const flattenedIf = withBody(ifCase, { kind: "action", actor: "hero", verb: "move", target: "03-1-exit" });
    expect(ifCase.check(flattenedIf)).toBe(false);
    expect(ifCase.physics?.(flattenedIf)).toMatchObject({ pass: false, detail: { outcome: "failure" } });
  });

  it("preserves the explicit rain arrival condition with wait or if control", () => {
    const testCase = byId("intro-arrival-condition");
    const waiting = fixtureProgram(testCase)!;
    expect(testCase.check(waiting)).toBe(true);
    expect(testCase.physics?.(waiting).pass).toBe(true);

    const conditional = withBody(testCase, {
      kind: "sequence",
      children: [
        { kind: "action", actor: "hero", verb: "push", target: "rain-cork", destination: "rain-launch" },
        { kind: "action", actor: "hero", verb: "board", target: "rain-cork" },
        {
          kind: "if",
          condition: { kind: "property", entity: "rain-cork", property: "landingReachable", comparison: "eq", value: true, source: "visible" },
          then: { kind: "action", actor: "hero", verb: "dismount", target: "rain-cork", destination: "rain-platform" },
        },
      ],
    });
    expect(testCase.check(conditional)).toBe(true);
    expect(testCase.physics?.(conditional).pass).toBe(true);

    const nested = withBody(testCase, {
      kind: "sequence",
      children: [
        {
          kind: "sequence",
          children: [
            { kind: "action", actor: "hero", verb: "push", target: "rain-cork", destination: "rain-launch" },
            { kind: "action", actor: "hero", verb: "board", target: "rain-cork" },
          ],
        },
        {
          kind: "sequence",
          children: [
            { kind: "wait", until: { kind: "not", predicate: { kind: "property", entity: "rain-cork", property: "landingReachable", comparison: "eq", value: false, source: "visible" } } },
            { kind: "action", actor: "hero", verb: "dismount", target: "rain-cork", destination: "rain-platform" },
          ],
        },
      ],
    });
    expect(testCase.check(nested)).toBe(true);
    expect(testCase.physics?.(nested).pass).toBe(true);

    const flattened = withBody(testCase, {
      kind: "sequence",
      children: [
        { kind: "action", actor: "hero", verb: "push", target: "rain-cork", destination: "rain-launch" },
        { kind: "action", actor: "hero", verb: "board", target: "rain-cork" },
        { kind: "action", actor: "hero", verb: "dismount", target: "rain-cork", destination: "rain-platform" },
      ],
    });
    expect(testCase.check(flattened)).toBe(false);
  });

  it("allows only a zero-time landing wait immediately before intro dismount", () => {
    for (const id of ["intro-exact", "intro-paraphrase", "intro-colloquial"]) {
      const testCase = byId(id);
      const first = id === "intro-exact" ? "place" : "push";
      const guarded = withBody(testCase, {
        kind: "sequence",
        children: [
          { kind: "action", actor: "hero", verb: first, target: "rain-cork", destination: "rain-launch" },
          { kind: "action", actor: "hero", verb: "board", target: "rain-cork" },
          { kind: "wait", until: { kind: "not", predicate: { kind: "property", entity: "rain-cork", property: "landingReachable", comparison: "eq", value: false, source: "visible" } } },
          { kind: "action", actor: "hero", verb: "dismount", target: "rain-cork", destination: "rain-platform" },
        ],
      });
      expect(testCase.check(guarded), id).toBe(true);
      const result = testCase.physics?.(guarded);
      expect(result?.pass, id).toBe(true);
      expect(result?.detail).toMatchObject({
        waitBoundary: { conditionBefore: true, outcome: "done", actions: 0, worldUnchanged: true },
      });
      const boundary = (result?.detail as { waitBoundary: { tickBefore: number; tickAfter: number } }).waitBoundary;
      expect(boundary.tickAfter, id).toBe(boundary.tickBefore);
    }

    const exact = byId("intro-exact");
    const wrongWait = (entity: string, name: string): InstructionProgram => withBody(exact, {
      kind: "sequence",
      children: [
        { kind: "action", actor: "hero", verb: "push", target: "rain-cork", destination: "rain-launch" },
        { kind: "action", actor: "hero", verb: "board", target: "rain-cork" },
        { kind: "wait", until: { kind: "property", entity, property: name, comparison: "eq", value: true, source: "visible" } },
        { kind: "action", actor: "hero", verb: "dismount", target: "rain-cork", destination: "rain-platform" },
      ],
    });
    const afloatWait = wrongWait("rain-cork", "afloat");
    const wrongTarget = wrongWait("rain-platform", "landingReachable");
    expect(exact.check(afloatWait)).toBe(false);
    expect(exact.physics?.(afloatWait).pass).toBe(false);
    expect(exact.check(wrongTarget)).toBe(false);
    expect(exact.physics?.(wrongTarget).pass).toBe(false);

    const earlyWait = withBody(exact, {
      kind: "sequence",
      children: [
        { kind: "action", actor: "hero", verb: "push", target: "rain-cork", destination: "rain-launch" },
        { kind: "wait", until: { kind: "property", entity: "rain-cork", property: "landingReachable", comparison: "eq", value: true, source: "visible" } },
        { kind: "action", actor: "hero", verb: "board", target: "rain-cork" },
        { kind: "action", actor: "hero", verb: "dismount", target: "rain-cork", destination: "rain-platform" },
      ],
    });
    expect(exact.check(earlyWait)).toBe(false);
    expect(exact.physics?.(earlyWait).pass).toBe(false);
  });

  it("rejects unsolicited top-level triggers and guards on ordinary commands", () => {
    const testCase = byId("pour-two-plain");
    const fixture = fixtureProgram(testCase)!;
    expect(testCase.check({ ...fixture, guard: true, condition: {
      kind: "property", entity: "reach-barrel", property: "stable", comparison: "eq", value: false, source: "visible",
    } })).toBe(false);
    expect(testCase.check({ ...fixture, condition: {
      kind: "property", entity: "reach-barrel", property: "stable", comparison: "eq", value: false, source: "visible",
    } })).toBe(false);
  });

  it("accepts equivalent boolean negation and either independent parallel clause order", () => {
    const conditional = byId("if-steam-false");
    const notActive = withBody(conditional, {
      kind: "if",
      condition: {
        kind: "not",
        predicate: { kind: "property", entity: "03-1-steam-pipe", property: "active", comparison: "eq", value: true, source: "visible" },
      },
      then: { kind: "action", actor: "hero", verb: "move", target: "03-1-exit" },
    });
    expect(conditional.check(notActive)).toBe(true);

    for (const id of ["parallel-keeper-hold-until-arrival", "parallel-bridge-lock"]) {
      const testCase = byId(id);
      const fixture = fixtureProgram(testCase)!;
      expect(fixture.body.kind).toBe("parallel");
      if (fixture.body.kind !== "parallel") throw new Error("fixture must be parallel");
      const reversed = withBody(testCase, { ...fixture.body, children: [...fixture.body.children].reverse() });
      expect(testCase.check(reversed), id).toBe(true);
      expect(testCase.physics?.(reversed).pass, `${id} reversed physics`).toBe(true);
    }
  });

  it("rejects helpful corrections to explicit direction and dangerous amount", () => {
    const reversed = byId("pour-reversed-source");
    const correctedDirection = withBody(reversed, {
      kind: "action", actor: "hero", verb: "pour", target: "reach-basin", destination: "reach-barrel", amount: 2,
    });
    expect(reversed.check(correctedDirection)).toBe(false);

    const dangerous = byId("pour-three-plain");
    const correctedAmount = withBody(dangerous, {
      kind: "action", actor: "hero", verb: "pour", target: "reach-basin", destination: "reach-barrel", amount: 2,
    });
    expect(dangerous.check(correctedAmount)).toBe(false);
    expect(dangerous.physics?.(correctedAmount).pass).toBe(false);
  });

  it("grades same-actor parallel as a program whose actual runtime asks for clarification", () => {
    const testCase = byId("parallel-same-actor-conflict");
    const fixture = fixtureProgram(testCase)!;
    expect(testCase.expected).toBe("program-or-clarification");
    expect(testCase.check(fixture)).toBe(true);
    expect(testCase.physics?.(fixture)).toMatchObject({
      pass: true,
      detail: { outcome: "clarification", steps: 1, actions: [] },
    });

    const explicitUntil = withBody(testCase, {
      kind: "parallel",
      children: [
        {
          kind: "until",
          body: { kind: "action", actor: "hero", verb: "hold", target: "07-3-pressure" },
          condition: { kind: "property", entity: "07-3-lock", property: "locked", comparison: "eq", value: true, source: "visible" },
        },
        { kind: "action", actor: "hero", verb: "move", target: "07-3-far-rail" },
      ],
    });
    expect(testCase.check(explicitUntil)).toBe(false);

    const flattened = withBody(testCase, {
      kind: "sequence",
      children: [
        { kind: "action", actor: "hero", verb: "hold", target: "07-3-pressure" },
        { kind: "action", actor: "hero", verb: "move", target: "07-3-far-rail" },
      ],
    });
    expect(testCase.check(flattened)).toBe(false);
    expect(testCase.physics?.(flattened).pass).toBe(false);
  });

  it("distinguishes explicit stage and current-room scopes", () => {
    const stage = byId("scope-stage-observe");
    const stageFixture = fixtureProgram(stage)!;
    expect(stage.check(stageFixture)).toBe(true);
    expect(stage.check({ ...stageFixture, scope: { stageId: 3, region: "03-1" } })).toBe(false);

    const room = byId("scope-current-room-observe");
    const roomFixture = fixtureProgram(room)!;
    expect(room.check(roomFixture)).toBe(true);
    expect(room.check({ ...roomFixture, scope: { stageId: 3 } })).toBe(false);
  });

  it("keeps clarification prompts grounded in absent or genuinely unresolved references", () => {
    const plates = byId("ambiguous-plate").world();
    const visiblePlates = plates.visible.filter((id) => plates.entities[id]?.properties.kind === "tray");
    expect(visiblePlates.length).toBeGreaterThanOrEqual(3);
    expect(visiblePlates.map((id) => plates.entities[id].name)).toEqual(expect.arrayContaining([
      "별 테두리 접시", "달 테두리 접시", "잎 테두리 접시",
    ]));

    const unknownWorld = byId("unknown-object").world();
    expect(Object.values(unknownWorld.entities).some((entity) => entity.name.includes("파란 손잡이"))).toBe(false);

    const roles = byId("ambiguous-actor-roles");
    expect(roles.text).not.toContain("용사");
    expect(roles.text).not.toContain("등지기");
  });

  it("proves both assignments in the unnamed theatre roles are physically valid", () => {
    const locked = (): Predicate => ({
      kind: "property", entity: "07-3-lock", property: "locked", comparison: "eq", value: true, source: "visible",
    });
    const command = (actor: "hero" | "keeper", verb: PhysicalAction["verb"], target: string): PhysicalAction => ({
      kind: "action", actor, verb, target,
    });
    const assignment = (holder: "hero" | "keeper", crosser: "hero" | "keeper"): ProgramNode => ({
      kind: "parallel",
      children: [
        { kind: "until", body: command(holder, "hold", "07-3-pressure"), condition: locked() },
        {
          kind: "sequence",
          children: [command(crosser, "move", "07-3-far-rail"), command(crosser, "turn", "07-3-lock")],
        },
      ],
    });
    const definition = THEATRE_STAGE.segments.find((item) => item.id === "07-3")!;
    const run = (body: ProgramNode): WorldState => {
      let world = definition.enter(null);
      let cursor = createCursor();
      for (let index = 0; index < 24; index += 1) {
        const next = stepProgram(world, body, cursor, (state, action) => definition.execute!(state, action));
        expect(["blocked", "clarification", "failure"]).not.toContain(next.outcome);
        world = next.world;
        cursor = next.cursor;
        if (next.actions.length > 0 || next.outcome === "waiting") {
          const advanced = definition.advance(world);
          expect(advanced.failure).toBeUndefined();
          world = advanced.world;
        }
        if (next.outcome === "done") return world;
      }
      throw new Error("role assignment did not finish");
    };

    for (const [holder, crosser] of [["hero", "keeper"], ["keeper", "hero"]] as const) {
      const world = run(assignment(holder, crosser));
      expect(world.entities["07-3-lock"].properties).toMatchObject({ locked: true, lockedBy: crosser });
      expect(world.actors[holder].holding).toBeNull();
      expect(world.actors[crosser].location.x).toBe(5);
    }
  });
});
