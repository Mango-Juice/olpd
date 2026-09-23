import { describe, expect, it, vi } from "vitest";

import { makeEntity, makeHero, makeWorld } from "../src/campaign/level";
import type { WorldState } from "../src/campaign/types";
import { interpretCampaignWithJev, type CampaignJevTraceEvent } from "./fixtures/campaign-jev";
import { parseCampaignInterpretRequest } from "../server/campaign-contracts";
import { ApiError } from "../server/errors";

type RequestBody = {
  state?: Record<string, unknown>;
  questions: Record<string, { type: "choice" | "noul"; instructions?: unknown; criteria?: Record<string, unknown> }>;
};

function providerResponse(
  body: RequestBody,
  picks: Record<string, string>,
  nouls: Record<string, number> = {},
): Response {
  const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
    if (question.type === "noul") return [id, { type: "noul", noul: nouls[id] ?? 0.05 }];
    const options = Object.keys(question.criteria ?? {});
    const selected = picks[id] ?? options[0];
    if (!options.includes(selected)) throw new Error(`test pick ${id}=${selected} not in ${options.join(",")}`);
    const selectedProbability = options.length === 1 ? 1 : 0.95;
    const remainder = options.length === 1 ? 0 : 0.05 / (options.length - 1);
    return [id, {
      type: "choice",
      choice: selected,
      confidence: 0.95,
      probabilities: Object.fromEntries(options.map((option) => [option, option === selected ? selectedProbability : remainder])),
    }];
  }));
  return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 120, output_tokens: 20 } }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function verificationResponse(body: RequestBody, overrides: Record<string, number> = {}): Response {
  return providerResponse(body, {}, { ...Object.fromEntries(Object.keys(body.questions).map((id) => [id, 0.95])), ...overrides });
}

function simpleWorld(): WorldState {
  return makeWorld(2, "02-test", [
    makeEntity("door", "문", "02-test", 1, { description: "열고 닫는 문", properties: { open: false } }),
  ]);
}

describe("campaign Jev compiler", () => {
  it("compiles a provider-typed action into the validated campaign AST with source spans", async () => {
    const trace: CampaignJevTraceEvent[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      if (fetchImpl.mock.calls.length === 1) {
        return providerResponse(body, {
          validity: "playable", action_count: "1", composition: "single", condition_count: "0",
        }, { action_T1: 0.95 });
      }
      if (fetchImpl.mock.calls.length === 2) return providerResponse(body, { scope_mode: "current_actor_region", verb_T1: "open" });
      if (fetchImpl.mock.calls.length === 3) return providerResponse(body, {
        a_T1_clause: "S0_1", a_T1_actor_source: "NONE", a_T1_actor: "hero", a_T1_verb: "open",
        a_T1_target_source: "S0_0", a_T1_target: "door",
      }, { a_T1_actor_explicit: 0.05 });
      return verificationResponse(body);
    });

    const result = await interpretCampaignWithJev("  문을 열어  ", simpleWorld(), { apiKey: "test", fetchImpl: fetchImpl as typeof fetch, trace: (event) => trace.push(event) });

    expect(result.program).toMatchObject({
      version: 2,
      text: "문을 열어",
      model: "jev-1.13.0",
      scope: { stageId: 2, region: "02-test" },
      body: { kind: "action", actor: "hero", verb: "open", target: "door" },
    });
    expect(result.sourceSpans.actions[0]).toMatchObject({
      anchor: { text: "열어", chars: [3, 5] },
      clause: { text: "문을 열어" },
      target: { text: "문을" },
      actor: null,
    });
    expect(result.needsConfirmation).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(trace.filter((event) => event.kind === "request").map((event) => event.phase)).toEqual(["anchor", "verb_scope", "roles", "joint"]);
    expect(trace.filter((event) => event.kind === "response")).toHaveLength(4);
    expect(JSON.stringify(trace)).not.toContain("Authorization");
  });

  it("keeps non-contiguous actors on their predicate anchors and never asks destination for hold/board/move", async () => {
    const world = makeWorld(7, "07-test", [
      makeEntity("plate", "왼쪽 발판", "07-test", 0, { properties: { holdable: true } }),
      makeEntity("door", "문", "07-test", 1, { properties: { open: true } }),
    ]);
    world.actors.keeper = { ...makeHero("07-test"), id: "keeper", capabilities: ["weight:0.3"] };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      if (fetchImpl.mock.calls.length === 1) {
        return providerResponse(body, {
          validity: "playable", action_count: "2", composition: "parallel", condition_count: "0",
        }, { has_parallel: 0.96, action_T3: 0.95, action_T7: 0.95 });
      }
      if (fetchImpl.mock.calls.length === 2) {
        expect(body.state).toMatchObject({ actors: expect.arrayContaining([expect.objectContaining({ id: "keeper", location: expect.any(Object), riding: null })]) });
        return providerResponse(body, { scope_mode: "current_actor_region", verb_T3: "hold", verb_T7: "move" });
      }
      expect(Object.keys(body.questions).some((id) => id.includes("destination"))).toBe(false);
      if (fetchImpl.mock.calls.length === 3) {
        expect(body.state).toMatchObject({ actors: expect.arrayContaining([expect.objectContaining({ id: "keeper", location: expect.any(Object) })]) });
        return providerResponse(body, {
          a_T3_clause: "S0_3", a_T3_actor_source: "S0_0", a_T3_actor: "keeper", a_T3_verb: "hold",
          a_T3_target_source: "S1_2", a_T3_target: "plate", a_T3_instrument_source: "S6_6", a_T3_instrument: "door",
          a_T7_clause: "S5_7", a_T7_actor_source: "S5_5", a_T7_actor: "hero", a_T7_verb: "move",
          a_T7_target_source: "S6_6", a_T7_target: "door",
        }, {
          a_T3_actor_explicit: 0.95, a_T3_instrument_explicit: 0.05, a_T7_actor_explicit: 0.95,
        });
      }
      return verificationResponse(body);
    });

    const result = await interpretCampaignWithJev("인형이 왼쪽 발판을 누르는 동안 나는 문을 건너", world, { apiKey: "test", fetchImpl: fetchImpl as typeof fetch });

    expect(result.program.body).toEqual({ kind: "parallel", children: [
      { kind: "action", actor: "keeper", verb: "hold", target: "plate" },
      { kind: "action", actor: "hero", verb: "move", target: "door" },
    ] });
    expect(result.sourceSpans.actions.map((item) => item.actor?.text)).toEqual(["인형이", "나는"]);
  });

  it("places a mid-sequence wait before only the controlled action and never duplicates it as a program guard", async () => {
    const world = makeWorld(2, "02-2", [
      makeEntity("gate", "수문", "02-2", 0, { properties: { open: false } }),
      makeEntity("tank", "수위 수조", "02-2", 1, { material: "water", properties: { level: 0, upperMark: 3 } }),
    ]);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      if (fetchImpl.mock.calls.length === 1) {
        return providerResponse(body, {
          validity: "playable", action_count: "2", composition: "sequence", condition_count: "1",
        }, { has_condition: 0.95, condition_T3: 0.95, action_T1: 0.95, action_T4: 0.95 });
      }
      if (fetchImpl.mock.calls.length === 2) return providerResponse(body, { scope_mode: "current_actor_region", verb_T1: "open", verb_T4: "close" });
      if (fetchImpl.mock.calls.length === 3) return providerResponse(body, {
        a_T1_clause: "S0_1", a_T1_actor_source: "NONE", a_T1_actor: "hero", a_T1_verb: "open", a_T1_target_source: "S0_0", a_T1_target: "gate",
        a_T4_clause: "S4_4", a_T4_actor_source: "NONE", a_T4_actor: "hero", a_T4_verb: "close", a_T4_target_source: "S0_0", a_T4_target: "gate",
        condition_clause: "S2_3", condition_subject_source: "S2_2", condition_value_source: "S3_3",
        condition_field: "C4_5_tank_level", condition_comparison: "gte", condition_value: "V3",
        condition_mode: "wait_before", condition_controls: "T4",
      }, { a_T1_actor_explicit: 0.05, a_T4_actor_explicit: 0.05 });
      return verificationResponse(body);
    });

    const result = await interpretCampaignWithJev("수문을 열고 수위가 3이면 닫아", world, { apiKey: "test", fetchImpl: fetchImpl as typeof fetch });

    expect(result.program.condition).toBeUndefined();
    expect(result.program.body).toEqual({ kind: "sequence", children: [
      { kind: "action", actor: "hero", verb: "open", target: "gate" },
      { kind: "wait", until: { kind: "property", entity: "tank", property: "level", comparison: "gte", value: 3, source: "visible" } },
      { kind: "action", actor: "hero", verb: "close", target: "gate" },
    ] });
  });

  it("preserves an explicit pour amount and its source span", async () => {
    const world = makeWorld(2, "02-pour", [
      makeEntity("basin", "얕은 대야", "02-pour", 0, { properties: { amount: 3 } }),
      makeEntity("barrel", "빈 통", "02-pour", 1, { properties: { amount: 0 } }),
    ]);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      if (fetchImpl.mock.calls.length === 1) {
        return providerResponse(body, {
          validity: "playable", action_count: "1", composition: "single", condition_count: "0",
        }, { action_T11: 0.95 });
      }
      if (fetchImpl.mock.calls.length === 2) return providerResponse(body, { scope_mode: "current_actor_region", verb_T11: "pour" });
      if (fetchImpl.mock.calls.length === 3) {
        const roleQuestions = JSON.stringify(body.questions);
        expect(roleQuestions).toContain("source vessel");
        expect(roleQuestions).toContain("receiving vessel");
        expect(roleQuestions).toContain("source vessel에서 receiving vessel로 이동할 명시 수량");
        return providerResponse(body, {
          a_T11_clause: "S4_11", a_T11_actor_source: "NONE", a_T11_actor: "hero", a_T11_verb: "pour",
          a_T11_target_source: "S3_4", a_T11_target: "basin",
          a_T11_destination_source: "S9_10", a_T11_destination: "barrel",
          a_T11_amount_source: "S5_6", a_T11_amount: "2",
        }, { a_T11_actor_explicit: 0.05 });
      }
      return verificationResponse(body);
    });

    const result = await interpretCampaignWithJev("세 칸 얕은 대야의 물 두 칸을 떠 있는 빈 통에 부어", world, { apiKey: "test", fetchImpl: fetchImpl as typeof fetch });

    expect(result.program.body).toEqual({ kind: "action", actor: "hero", verb: "pour", target: "basin", destination: "barrel", amount: 2 });
    expect(result.sourceSpans.actions[0].amount?.text).toBe("두 칸을");
  });

  it("allows a pure condition wait with zero physical actions", async () => {
    const world = makeWorld(2, "02-wait", [
      makeEntity("tank", "수위 수조", "02-wait", 0, { material: "water", properties: { level: 0, upperMark: 3 } }),
    ]);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      if (fetchImpl.mock.calls.length === 1) {
        return providerResponse(body, {
          validity: "playable", action_count: "0", composition: "single", condition_count: "1",
        }, { has_condition: 0.95, condition_T2: 0.95 });
      }
      if (fetchImpl.mock.calls.length === 2) return providerResponse(body, { scope_mode: "current_actor_region" });
      if (fetchImpl.mock.calls.length === 3) return providerResponse(body, {
        condition_clause: "S0_3", condition_subject_source: "S0_0", condition_value_source: "S1_1",
        condition_field: "C4_5_tank_level", condition_comparison: "gte", condition_value: "V3", condition_mode: "pure_wait",
      });
      return verificationResponse(body);
    });

    const result = await interpretCampaignWithJev("수위가 3이 될 때까지 기다려", world, { apiKey: "test", fetchImpl: fetchImpl as typeof fetch });

    expect(result.program.body).toEqual({ kind: "wait", until: { kind: "property", entity: "tank", property: "level", comparison: "gte", value: 3, source: "visible" } });
    expect(result.sourceSpans.actions).toEqual([]);
  });

  it("rejects a candidate when the joint typed ownership pass finds a contradiction", async () => {
    const trace: CampaignJevTraceEvent[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      if (fetchImpl.mock.calls.length === 1) return providerResponse(body, {
        validity: "playable", action_count: "1", composition: "single", condition_count: "0",
      }, { action_T1: 0.95 });
      if (fetchImpl.mock.calls.length === 2) return providerResponse(body, { scope_mode: "current_actor_region", verb_T1: "open" });
      if (fetchImpl.mock.calls.length === 3) return providerResponse(body, {
        a_T1_clause: "S0_1", a_T1_actor_source: "NONE", a_T1_actor: "hero", a_T1_verb: "open",
        a_T1_target_source: "S0_0", a_T1_target: "door",
      }, { a_T1_actor_explicit: 0.05 });
      return verificationResponse(body, { overall_consistency: 0.2 });
    });

    await expect(interpretCampaignWithJev("문을 열어", simpleWorld(), { apiKey: "test", fetchImpl: fetchImpl as typeof fetch, trace: (event) => trace.push(event) })).rejects.toMatchObject({ code: "uncertain" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(trace).toContainEqual(expect.objectContaining({ kind: "rejection", phase: "joint", field: "overall_consistency", code: "uncertain" }));
  });

  it("uses action Noul anchors and keeps a conflicting action count as confirmation uncertainty", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      if (fetchImpl.mock.calls.length === 1) return providerResponse(body, {
        validity: "playable", action_count: "2", composition: "single", condition_count: "0",
      }, { action_T1: 0.95 });
      if (fetchImpl.mock.calls.length === 2) {
        expect(Object.keys(body.questions).filter((id) => id.startsWith("verb_"))).toEqual(["verb_T1"]);
        return providerResponse(body, { scope_mode: "current_actor_region", verb_T1: "open" });
      }
      if (fetchImpl.mock.calls.length === 3) return providerResponse(body, {
        a_T1_clause: "S0_1", a_T1_actor_source: "NONE", a_T1_actor: "hero",
        a_T1_target_source: "S0_0", a_T1_target: "door",
      }, { a_T1_actor_explicit: 0.05 });
      return verificationResponse(body);
    });

    const result = await interpretCampaignWithJev("문을 열어", simpleWorld(), { apiKey: "test", fetchImpl: fetchImpl as typeof fetch });

    expect(result.program.body).toMatchObject({ verb: "open", target: "door" });
    expect(result.needsConfirmation).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("rejects malformed provider responses, oversized input, and non-canonical request envelopes", async () => {
    const malformed = vi.fn(async () => new Response(JSON.stringify({ model: "wrong", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200 }));
    await expect(interpretCampaignWithJev("문을 열어", simpleWorld(), { apiKey: "test", fetchImpl: malformed as typeof fetch })).rejects.toMatchObject({ code: "provider" });
    await expect(interpretCampaignWithJev("가".repeat(501), simpleWorld(), { apiKey: "test", fetchImpl: malformed as typeof fetch })).rejects.toMatchObject({ code: "input" });

    const world = simpleWorld();
    expect(parseCampaignInterpretRequest({ text: "문을 열어", stageId: 2, runId: "run", revision: 0, attempt: 1, world })).toMatchObject({ stageId: 2, world });
    expect(parseCampaignInterpretRequest({ text: "문을 열어", stageId: 3, runId: "run", revision: 0, attempt: 1, world })).toBeNull();
    expect(new ApiError(422, "uncertain", "x").code).toBe("uncertain");
  });
});
