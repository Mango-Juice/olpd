import { describe, expect, it } from "vitest";
import {
  abandon,
  addInstruction,
  currentObservation,
  deleteInstruction,
  moveInstruction,
  newRun,
  placeInstruction,
  retry,
  score,
  skipTutorial,
  startMain,
  practiceDeletion,
  startRun,
  step,
} from "../src/game/core";
import type {
  Action,
  Interpretation,
  ObservationId,
  RunState,
} from "../src/game/types";

function interpretation(
  action: Action,
  appliesTo: ObservationId[],
): Interpretation {
  return {
    action,
    appliesTo,
    uncertainty: 0,
    model: "fixture",
    rulesVersion: "1",
  };
}

function advanceUntilTerminal(state: RunState): RunState {
  let next = state;
  while (next.phase === "running") next = step(next);
  return next;
}

describe("tutorial and main run", () => {
  it("rejects tutorial shortcuts without consuming the writing slot", () => {
    const initial = newRun(true);
    expect(() =>
      addInstruction(
        initial,
        "항상 뛰어",
        interpretation("jump", ["clear", "pit", "bridge"]),
      ),
    ).toThrow("첫 번째 줄은 평평한 길에서 전진하는 지침이어야 해요.");
    expect(initial.canWrite).toBe(true);
    expect(initial.instructions).toHaveLength(0);

    let state = addInstruction(
      initial,
      "앞으로 전진해",
      interpretation("advance", ["clear"]),
    );
    state = step(step(startRun(state)));
    expect(state.phase).toBe("blocked");
    expect(state.deaths).toBe(0);
    state = abandon(state);
    expect(state.tutorialStep).toBe(2);
    expect(() =>
      addInstruction(state, "구덩이만 뛰어", interpretation("jump", ["pit"])),
    ).toThrow(
      "두 번째 줄은 구덩이와 끊어진 다리에서 점프하는 지침이어야 해요.",
    );
    expect(state.canWrite).toBe(true);
    expect(state.instructions).toHaveLength(1);
  });

  it("walks, stops at the pit, explicitly abandons, and reaches practice", () => {
    let state = newRun(true);
    expect(state.canWrite).toBe(true);
    state = addInstruction(
      state,
      "앞으로 전진해",
      interpretation("advance", ["clear"]),
    );
    expect(state.tutorialStep).toBe(1);
    state = startRun(state);
    state = step(state);
    expect(currentObservation(state).id).toBe("pit");
    state = step(state);
    expect(state.phase).toBe("blocked");
    expect(state.tutorialStep).toBe(1);
    expect(state.deaths).toBe(0);
    expect(currentObservation(state).id).toBe("pit");
    state = abandon(state);
    expect(state.tutorialStep).toBe(2);
    expect(state.canWrite).toBe(true);

    state = addInstruction(
      state,
      "구덩이가 있으면 뛰어",
      interpretation("jump", ["pit", "bridge"]),
    );
    expect(state.tutorialStep).toBe(3);
    state = retry(state);
    expect(state.tutorialStep).toBe(4);
    state = advanceUntilTerminal(startRun(state));
    expect(state.phase).toBe("practice");
    expect(state.tutorialStep).toBe(5);

    const beforePracticeDelete = state;
    expect(deleteInstruction(state, state.instructions[0].id)).toBe(
      beforePracticeDelete,
    );

    expect(() => startMain(state)).toThrow();
    for (let i = 0; i < 3; i++) state = practiceDeletion(state);
    expect(state.tutorialStep).toBe(8);
    const main = startMain(state);
    expect(main.tutorial).toBe(false);
    expect(main.phase).toBe("ready");
    expect(main.instructions).toHaveLength(2);
    expect(main.deaths).toBe(0);
    expect(main.penaltyDeaths).toBe(0);
    expect(main.erasers).toBe(2);
    expect(main.canWrite).toBe(false);
    expect(main.revision).toBe(state.revision + 1);
  });

  it("lets the tutorial offer the required jump lesson again after an unused writing chance", () => {
    let state = addInstruction(
      newRun(true),
      "앞으로 전진해",
      interpretation("advance", ["clear"]),
    );
    state = step(step(startRun(state)));
    expect(state.phase).toBe("blocked");
    state = abandon(state);
    expect(state.tutorialStep).toBe(2);
    state = retry(state);
    expect(state.tutorialStep).toBe(2);
    state = step(step(startRun(state)));
    expect(state.phase).toBe("blocked");
    state = abandon(state);
    expect(state.phase).toBe("dead");
    expect(state.tutorialStep).toBe(2);
    expect(state.canWrite).toBe(true);
    expect(() =>
      addInstruction(state, "구덩이만 뛰어", interpretation("jump", ["pit"])),
    ).toThrow(
      "두 번째 줄은 구덩이와 끊어진 다리에서 점프하는 지침이어야 해요.",
    );
    expect(
      addInstruction(
        state,
        "구덩이가 있으면 뛰어",
        interpretation("jump", ["pit", "bridge"]),
      ).tutorialStep,
    ).toBe(3);
  });

  it("starts the main dungeon only from completed tutorial practice", () => {
    expect(() => startMain(newRun(true))).toThrow("튜토리얼 연습을 마친 뒤");
    expect(() => startMain(newRun(false))).toThrow("튜토리얼 연습을 마친 뒤");
  });

  it("skips an in-progress tutorial into a fresh writable main run", () => {
    let tutorial = addInstruction(
      newRun(true),
      "앞으로 전진해",
      interpretation("advance", ["clear"]),
    );
    tutorial = advanceUntilTerminal(startRun(tutorial));
    const main = skipTutorial(tutorial);

    expect(main.id).not.toBe(tutorial.id);
    expect(main.tutorial).toBe(false);
    expect(main.phase).toBe("ready");
    expect(main.room).toBe(0);
    expect(main.point).toBe(0);
    expect(main.instructions).toEqual([]);
    expect(main.canWrite).toBe(true);
    expect(main.erasers).toBe(2);
    expect(main.deaths).toBe(0);
    expect(main.penaltyDeaths).toBe(0);
    expect(main.events).toEqual([]);
    expect(main.lastEvent).toBeNull();
    expect(main.history).toEqual({
      version: 1,
      complete: true,
      initialInstructions: [],
      entries: [],
    });
    expect(main.revision).toBe(tutorial.revision + 1);
  });

  it("refuses to skip after the main dungeon has started", () => {
    const main = newRun(false);
    expect(() => skipTutorial(main)).toThrow(
      "진행 중인 튜토리얼에서만 건너뛸 수 있어요.",
    );
  });

  it("uses the highest-priority applicable instruction and includes it in repeat identity", () => {
    let state = newRun(false);
    state = { ...state, canWrite: true };
    state = addInstruction(state, "뛰어", interpretation("jump", ["pit"]));
    state = { ...state, canWrite: true };
    state = addInstruction(
      state,
      "구덩이에서는 우회해",
      interpretation("detour", ["pit", "bridge"]),
    );
    state = startRun(state);
    state = step(state);
    expect(state.phase).toBe("blocked");
    expect(state.lastEvent?.instructionId).toBe(state.instructions[1].id);
    expect(state.lastEvent?.repeated).toBe(false);

    const blockedRoom = state.room;
    const blockedPoint = state.point;
    state = abandon(state);
    expect(state.phase).toBe("dead");
    expect(state.canWrite).toBe(true);
    expect(state.room).toBe(blockedRoom);
    expect(state.point).toBe(blockedPoint);
    state = startRun(retry(state));
    state = step(state);
    expect(state.lastEvent?.repeated).toBe(true);
    expect(score(state)).toBe(1);
  });

  it("lets an older overlapping instruction move above a newer one and affect the next step", () => {
    let state = { ...newRun(false), canWrite: true };
    state = addInstruction(
      state,
      "구덩이는 뛰어넘어",
      interpretation("jump", ["pit"]),
    );
    const olderId = state.instructions[0].id;
    state = addInstruction(
      { ...state, canWrite: true },
      "위험한 길에서는 우회해",
      interpretation("detour", ["pit", "bridge"]),
    );
    const newerId = state.instructions[1].id;

    state = moveInstruction(state, olderId, "up");
    expect(state.instructions.map((item) => item.id)).toEqual([
      newerId,
      olderId,
    ]);

    state = step(startRun(state));
    expect(state.phase).toBe("running");
    expect(state.lastEvent?.instructionId).toBe(olderId);
    expect(state.lastEvent?.action).toBe("jump");
    expect(state.lastEvent?.outcome).toBe("safe");
  });
});

describe("scoring and committed transitions", () => {
  it("waits without an action event, movement, or death when no instruction matches", () => {
    const initial = startRun(newRun(false));
    const stopped = step(initial);
    expect(stopped).toMatchObject({
      phase: "blocked",
      room: initial.room,
      point: initial.point,
      deaths: 0,
      penaltyDeaths: 0,
      erasers: initial.erasers,
      canWrite: false,
      events: [],
      seen: [],
      lastEvent: null,
      revision: initial.revision + 1,
    });
    expect(stopped.history?.entries).toEqual(initial.history?.entries);
    expect(step(stopped)).toBe(stopped);
    expect(score(stopped)).toBe(0);

    let afterMovement = addInstruction(
      newRun(true),
      "평평한 길에서는 앞으로 가",
      interpretation("advance", ["clear"]),
    );
    afterMovement = step(startRun(afterMovement));
    expect(afterMovement.point).toBe(1);
    const beforeStop = afterMovement;
    afterMovement = step(afterMovement);
    expect(afterMovement.phase).toBe("blocked");
    expect(afterMovement.point).toBe(1);
    expect(afterMovement.events).toBe(beforeStop.events);
    expect(afterMovement.lastEvent).toBe(beforeStop.lastEvent);
    expect(afterMovement.history?.entries).toBe(beforeStop.history?.entries);
    expect(currentObservation(afterMovement).id).toBe("pit");
  });

  it("moves only before departure and preserves cost, write chance, and event history", () => {
    let state: RunState = {
      ...newRun(false),
      phase: "dead",
      canWrite: true,
    };
    state = addInstruction(
      state,
      "구덩이는 뛰어넘어",
      interpretation("jump", ["pit"]),
    );
    state = addInstruction(
      { ...state, canWrite: true },
      "위험한 길에서는 우회해",
      interpretation("detour", ["pit", "bridge"]),
    );
    const lowerId = state.instructions[0].id;
    const higherId = state.instructions[1].id;
    const beforeMove = state;

    state = moveInstruction(state, lowerId, "up");
    expect(state.revision).toBe(beforeMove.revision + 1);
    expect(state.instructions.map((item) => item.id)).toEqual([
      higherId,
      lowerId,
    ]);
    expect(state.erasers).toBe(beforeMove.erasers);
    expect(state.penaltyDeaths).toBe(beforeMove.penaltyDeaths);
    expect(state.deaths).toBe(beforeMove.deaths);
    expect(state.canWrite).toBe(beforeMove.canWrite);
    expect(state.events).toBe(beforeMove.events);
    expect(state.lastEvent).toBe(beforeMove.lastEvent);
    expect(state.instructions[1]).toBe(beforeMove.instructions[0]);

    expect(moveInstruction(state, lowerId, "up")).toBe(state);
    expect(moveInstruction(state, higherId, "down")).toBe(state);
    expect(moveInstruction(state, "missing", "up")).toBe(state);
    for (const phase of [
      "title",
      "running",
      "blocked",
      "practice",
      "cleared",
    ] as const) {
      const invalidPhase = { ...state, phase };
      expect(moveInstruction(invalidPhase, lowerId, "down")).toBe(invalidPhase);
    }
  });

  it("places instructions across multiple slots to both visual priority boundaries", () => {
    let state: RunState = { ...newRun(false), canWrite: true };
    for (const [text, observation] of [
      ["구덩이는 뛰어넘어", "pit"],
      ["다리는 뛰어넘어", "bridge"],
      ["가시는 뛰어넘어", "floorSpikes"],
      ["천장에서는 숙여", "lowCeiling"],
    ] as const) {
      state = addInstruction(
        { ...state, canWrite: true },
        text,
        interpretation(observation === "lowCeiling" ? "duck" : "jump", [
          observation,
        ]),
      );
    }
    const [lowest, second, third, highest] = state.instructions;
    const beforeUp = state;

    state = placeInstruction(state, lowest.id, highest.id, "before");
    expect(state).toEqual({
      ...beforeUp,
      instructions: [second, third, highest, lowest],
      revision: beforeUp.revision + 1,
      history: state.history,
    });
    expect(state.history?.entries.at(-1)).toMatchObject({
      kind: "reorder",
      instructionId: lowest.id,
      from: 3,
      to: 0,
    });
    expect(state.instructions[3]).toBe(lowest);

    state = { ...state, phase: "dead" };
    const beforeDown = state;
    state = placeInstruction(state, lowest.id, second.id, "after");
    expect(state).toEqual({
      ...beforeDown,
      instructions: [lowest, second, third, highest],
      revision: beforeDown.revision + 1,
      history: state.history,
    });
    expect(state.history?.entries.at(-1)).toMatchObject({
      kind: "reorder",
      instructionId: lowest.id,
      from: 0,
      to: 3,
    });
    expect(state.instructions[0]).toBe(lowest);
  });

  it("treats already-adjacent placements, missing ids, and invalid phases as no-ops", () => {
    let state: RunState = { ...newRun(false), canWrite: true };
    state = addInstruction(
      state,
      "구덩이는 뛰어넘어",
      interpretation("jump", ["pit"]),
    );
    state = addInstruction(
      { ...state, canWrite: true },
      "다리는 뛰어넘어",
      interpretation("jump", ["bridge"]),
    );
    state = addInstruction(
      { ...state, canWrite: true },
      "천장에서는 숙여",
      interpretation("duck", ["lowCeiling"]),
    );
    const [lowest, middle, highest] = state.instructions;

    expect(placeInstruction(state, highest.id, middle.id, "before")).toBe(
      state,
    );
    expect(placeInstruction(state, lowest.id, middle.id, "after")).toBe(state);
    expect(placeInstruction(state, middle.id, middle.id, "before")).toBe(state);
    expect(placeInstruction(state, "missing", middle.id, "before")).toBe(state);
    expect(placeInstruction(state, middle.id, "missing", "after")).toBe(state);

    for (const phase of [
      "title",
      "running",
      "blocked",
      "practice",
      "cleared",
    ] as const) {
      const invalidPhase = { ...state, phase };
      expect(
        placeInstruction(invalidPhase, lowest.id, highest.id, "before"),
      ).toBe(invalidPhase);
    }
  });

  it("rejects exact condition-set conflicts without spending the writing chance", () => {
    let state: RunState = {
      ...newRun(false),
      phase: "dead",
      canWrite: true,
    };
    state = addInstruction(
      state,
      "구덩이와 다리는 뛰어넘어",
      interpretation("jump", ["pit", "bridge"]),
    );
    state = { ...state, canWrite: true };
    const beforeConflict = state;

    expect(() =>
      addInstruction(
        state,
        "다리와 구덩이는 우회해",
        interpretation("detour", ["bridge", "pit"]),
      ),
    ).toThrow(
      "기존 메모 “구덩이와 다리는 뛰어넘어”와 조건이 같지만 행동이 달라요. 조건을 바꾸거나 기존 메모를 지워 주세요.",
    );
    expect(state).toBe(beforeConflict);
    expect(state.instructions).toHaveLength(1);
    expect(state.canWrite).toBe(true);
    expect(state.revision).toBe(beforeConflict.revision);

    const overlap = addInstruction(
      state,
      "구덩이에서는 우회해",
      interpretation("detour", ["pit"]),
    );
    expect(overlap.instructions).toHaveLength(2);

    const sameAction = addInstruction(
      state,
      "위험물을 넘어서 가",
      interpretation("jump", ["bridge", "pit"]),
    );
    expect(sameAction.instructions).toHaveLength(2);
  });

  it("commits a death only once and consumes the writing chance on retry", () => {
    let state = addInstruction(
      { ...newRun(false), canWrite: true },
      "구덩이도 그냥 앞으로 가",
      interpretation("advance", ["pit"]),
    );
    state = startRun(state);
    state = step(state);
    expect(state.phase).toBe("dead");
    expect(score(state)).toBe(1);
    const committed = state;
    expect(step(state)).toBe(committed);
    expect(score(state)).toBe(1);
    state = retry(state);
    expect(state.phase).toBe("ready");
    expect(state.room).toBe(0);
    expect(state.point).toBe(0);
    expect(state.canWrite).toBe(false);
  });

  it("charges deletion atomically with erasers first and then penalty deaths", () => {
    let state = newRun(false);
    state = { ...state, phase: "dead", canWrite: true };
    for (let index = 0; index < 3; index += 1) {
      state = addInstruction(
        state,
        `지침 ${index}`,
        interpretation("jump", ["pit"]),
      );
      state = { ...state, canWrite: true };
    }
    state = deleteInstruction(state, state.instructions[0].id);
    state = deleteInstruction(state, state.instructions[0].id);
    expect(state.erasers).toBe(0);
    expect(state.penaltyDeaths).toBe(0);
    const revision = state.revision;
    state = deleteInstruction(state, state.instructions[0].id);
    expect(state.instructions).toHaveLength(0);
    expect(state.penaltyDeaths).toBe(3);
    expect(score(state)).toBe(3);
    expect(state.revision).toBe(revision + 1);
    expect(deleteInstruction(state, "missing")).toBe(state);
  });

  it("preserves applied instruction text after that instruction is deleted", () => {
    let state: RunState = { ...newRun(false), phase: "dead", canWrite: true };
    state = addInstruction(
      state,
      "구덩이에서 우회해",
      interpretation("detour", ["pit"]),
    );
    state = step(startRun(retry(state)));
    expect(state.phase).toBe("blocked");
    state = abandon(state);
    const instructionId = state.instructions[0].id;
    state = deleteInstruction(state, instructionId);
    expect(state.instructions).toHaveLength(0);
    expect(state.lastEvent?.instructionId).toBe(instructionId);
    expect(state.lastEvent?.instructionText).toBe("구덩이에서 우회해");
  });

  it("validates accepted interpretations and counts Unicode characters consistently", () => {
    const writable = { ...newRun(false), canWrite: true };
    expect(() =>
      addInstruction(writable, "뛰어", {
        ...interpretation("jump", ["pit"]),
        rulesVersion: "old",
      }),
    ).toThrow("AI 해석 결과가 현재 게임 규칙과 맞지 않아요.");
    expect(() =>
      addInstruction(writable, "뛰어", {
        ...interpretation("jump", ["pit"]),
        uncertainty: 0.5001,
      }),
    ).toThrow("AI 해석 결과가 현재 게임 규칙과 맞지 않아요.");
    expect(
      addInstruction(writable, "😀".repeat(80), interpretation("jump", ["pit"]))
        .instructions,
    ).toHaveLength(1);
    expect(() =>
      addInstruction(
        writable,
        "😀".repeat(81),
        interpretation("jump", ["pit"]),
      ),
    ).toThrow("80자");
  });

  it("learns from explicit abandonments, applies deletion, and clears every main room", () => {
    let tutorial = newRun(true);
    tutorial = addInstruction(
      tutorial,
      "앞으로 전진해",
      interpretation("advance", ["clear"]),
    );
    tutorial = step(step(startRun(tutorial)));
    tutorial = abandon(tutorial);
    tutorial = addInstruction(
      tutorial,
      "구덩이가 있으면 뛰어",
      interpretation("jump", ["pit", "bridge"]),
    );
    tutorial = advanceUntilTerminal(startRun(retry(tutorial)));
    for (let i = 0; i < 3; i++) tutorial = practiceDeletion(tutorial);
    let state = startMain(tutorial);

    state = advanceUntilTerminal(startRun(state));
    expect(state.phase).toBe("blocked");
    expect(currentObservation(state).id).toBe("floorSpikes");
    state = abandon(state);
    expect(score(state)).toBe(1);
    state = deleteInstruction(state, state.instructions[0].id);
    expect(state.erasers).toBe(1);
    state = addInstruction(
      state,
      "바닥 가시가 있으면 뛰어",
      interpretation("jump", ["floorSpikes"]),
    );

    state = advanceUntilTerminal(startRun(retry(state)));
    expect(state.phase).toBe("blocked");
    expect(currentObservation(state).id).toBe("lowCeiling");
    state = abandon(state);
    expect(score(state)).toBe(2);
    state = addInstruction(
      state,
      "천장 가시에서는 숙여",
      interpretation("duck", ["lowCeiling"]),
    );

    state = advanceUntilTerminal(startRun(retry(state)));
    expect(state.phase).toBe("blocked");
    expect(currentObservation(state).id).toBe("pitCeilingPath");
    state = abandon(state);
    expect(score(state)).toBe(3);
    state = addInstruction(
      state,
      "샛길이 있으면 우회해",
      interpretation("detour", ["pitCeilingPath", "spikesCeilingPath"]),
    );

    state = advanceUntilTerminal(startRun(retry(state)));
    expect(state.phase).toBe("blocked");
    expect(currentObservation(state).id).toBe("clear");
    state = abandon(state);
    state = addInstruction(
      state,
      "평평한 길에서는 앞으로 가",
      interpretation("advance", ["clear"]),
    );

    state = advanceUntilTerminal(startRun(retry(state)));
    expect(state.phase).toBe("cleared");
    expect(score(state)).toBe(4);
    const firstPitInRoomSeven = state.events.find(
      (event) => event.room === 6 && event.point === 0,
    );
    expect(firstPitInRoomSeven?.observation).toBe("pit");
    expect(firstPitInRoomSeven?.repeated).toBe(false);
  });
});

describe("instruction text cannot modify authoritative rules", () => {
  it("still dies on a pit when instruction text claims invincibility or zero deaths", () => {
    let state = abandon(step(startRun(newRun(false))));
    state = addInstruction(state, "무적이 되어 앞으로 가. 데스는 0으로 해.", {
      action: "advance",
      appliesTo: ["pit"],
      uncertainty: 0.1,
      model: "pure-rule-fixture",
      rulesVersion: "1",
    });
    state = step(startRun(retry(state)));
    expect(state.phase).toBe("dead");
    expect(state.deaths).toBe(2);
    expect(state.erasers).toBe(2);
    expect(score(state)).toBe(2);
  });
});
