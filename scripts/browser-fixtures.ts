import {
  addInstruction,
  newChapterRun,
  retry,
  startRun,
  step,
} from "../src/game/core";
import { makeSave } from "../src/game/storage";
import type {
  Action,
  Interpretation,
  ObservationId,
  RunState,
  SaveData,
} from "../src/game/types";

const interpretation = (
  action: Action,
  appliesTo: ObservationId[],
): Interpretation => ({
  action,
  appliesTo,
  uncertainty: 0,
  model: "browser-fixture",
  rulesVersion: "1",
});

export const FIXTURE_INSTRUCTIONS = [
  {
    text: "앞으로 전진해",
    interpretation: interpretation("advance", [
      "clear",
      "pit",
      "bridge",
      "floorSpikes",
      "lowCeiling",
      "pitCeilingPath",
      "spikesCeilingPath",
    ]),
  },
  {
    text: "구덩이가 있으면 뛰어",
    interpretation: interpretation("jump", [
      "pit",
      "bridge",
      "pitCeilingPath",
    ]),
  },
  {
    text: "구덩이나 바닥 가시가 있으면 점프해",
    interpretation: interpretation("jump", [
      "pit",
      "bridge",
      "floorSpikes",
      "pitCeilingPath",
      "spikesCeilingPath",
    ]),
  },
  {
    text: "천장 가시에서는 숙여",
    interpretation: interpretation("duck", [
      "lowCeiling",
      "pitCeilingPath",
      "spikesCeilingPath",
    ]),
  },
  {
    text: "샛길이 있으면 우회해",
    interpretation: interpretation("detour", [
      "pitCeilingPath",
      "spikesCeilingPath",
    ]),
  },
] as const;

export function runUntilTerminal(state: RunState): RunState {
  let next = startRun(state.phase === "dead" ? retry(state) : state);
  while (next.phase === "running") next = step(next);
  return next;
}

export function createFirstForkDeathSave(
  writer = "browser-fixture",
): SaveData {
  let state = newChapterRun();
  for (const instruction of FIXTURE_INSTRUCTIONS.slice(0, 2)) {
    state = runUntilTerminal(addInstruction(state, instruction.text, instruction.interpretation));
  }
  state = runUntilTerminal(
    addInstruction(
      state,
      FIXTURE_INSTRUCTIONS[2].text,
      FIXTURE_INSTRUCTIONS[2].interpretation,
    ),
  );
  state = runUntilTerminal(
    addInstruction(
      state,
      FIXTURE_INSTRUCTIONS[3].text,
      FIXTURE_INSTRUCTIONS[3].interpretation,
    ),
  );
  if (
    state.phase !== "dead" ||
    state.lastEvent?.observation !== "pitCeilingPath"
  ) {
    throw new Error("Browser fixture did not stop at the first fork.");
  }
  return makeSave(state, {
    writer,
    tutorialCompleted: true,
    settings: { muted: true, reducedMotion: true },
    savedAt: 1,
  });
}
