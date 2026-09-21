import { describe, expect, it } from "vitest";
import {
  addInstruction,
  moveInstruction,
  newRun,
  startRun,
  step,
} from "../src/game/core";
import type { Interpretation, RunState } from "../src/game/types";
import {
  STORAGE_KEY,
  loadSave,
  makeSave,
  type StorageLike,
  writeSave,
} from "../src/game/storage";

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const jumpInterpretation: Interpretation = {
  action: "jump",
  appliesTo: ["pit"],
  uncertainty: 0,
  model: "fixture",
  rulesVersion: "1",
};

describe("save validation and preservation", () => {
  it("round trips state, settings, best score, and tutorial completion", () => {
    const storage = new MemoryStorage();
    const save = makeSave(newRun(false), {
      writer: "tab-a",
      settings: { muted: true, reducedMotion: true },
      tutorialCompleted: true,
      best: 7,
      savedAt: 10,
    });
    expect(writeSave(save, { storage, expected: null }).ok).toBe(true);
    expect(loadSave(storage)).toEqual({ ok: true, value: save });
  });

  it("preserves explicit instruction priority order across save and reload", () => {
    const storage = new MemoryStorage();
    let state = { ...newRun(false), canWrite: true };
    state = addInstruction(state, "구덩이는 뛰어넘어", jumpInterpretation);
    const olderId = state.instructions[0].id;
    state = addInstruction(
      { ...state, canWrite: true },
      "위험한 길에서는 우회해",
      {
        ...jumpInterpretation,
        action: "detour",
        appliesTo: ["pit", "bridge"],
      },
    );
    const newerId = state.instructions[1].id;
    state = moveInstruction(state, olderId, "up");
    expect(state.instructions.map((item) => item.id)).toEqual([
      newerId,
      olderId,
    ]);

    const save = makeSave(state, { writer: "tab-a", savedAt: 10 });
    expect(writeSave(save, { storage, expected: null }).ok).toBe(true);
    const loaded = loadSave(storage);
    expect(loaded.ok).toBe(true);
    if (loaded.ok && loaded.value) {
      expect(loaded.value.state.instructions.map((item) => item.id)).toEqual([
        newerId,
        olderId,
      ]);
    }
  });

  it("reports malformed data and never replaces its original bytes", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, "{broken");
    const result = loadSave(storage);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.code).toBe("damaged");

    const write = writeSave(makeSave(newRun(false), { writer: "tab-a" }), {
      storage,
    });
    expect(write.ok).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe("{broken");
  });

  it("distinguishes incompatible and semantically invalid saves", () => {
    const storage = new MemoryStorage();
    const save = makeSave(newRun(false), { writer: "tab-a", savedAt: 1 });
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...save, gameVersion: "old" }),
    );
    let result = loadSave(storage);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.code).toBe("incompatible");

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...save, state: { ...save.state, deaths: -1 } }),
    );
    result = loadSave(storage);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.code).toBe("semantic");
  });

  it("validates current interpretation versions, bounds, event coordinates, and last event content", () => {
    const storage = new MemoryStorage();
    let state = step(startRun(newRun(false)));
    const save = makeSave(state, { writer: "tab-a", savedAt: 1 });
    const corruptions = [
      { ...save, state: { ...state, erasers: 3 } },
      { ...save, state: { ...state, penaltyDeaths: 2 } },
      {
        ...save,
        state: { ...state, events: [{ ...state.events[0], point: 4 }] },
      },
      {
        ...save,
        state: {
          ...state,
          lastEvent: { ...state.lastEvent!, reason: "바뀐 이유" },
        },
      },
    ];
    for (const corrupted of corruptions) {
      storage.setItem(STORAGE_KEY, JSON.stringify(corrupted));
      const result = loadSave(storage);
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.error.code).toBe("semantic");
    }

    state = { ...newRun(false), canWrite: true };
    state = addInstruction(state, "뛰어", jumpInterpretation);
    const wrongRules = makeSave(
      {
        ...state,
        instructions: state.instructions.map((item) => ({
          ...item,
          interpretation: { ...item.interpretation, rulesVersion: "old" },
        })),
      },
      { writer: "tab-a", savedAt: 1 },
    );
    storage.setItem(STORAGE_KEY, JSON.stringify(wrongRules));
    const result = loadSave(storage);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.code).toBe("semantic");
  });

  it("uses Unicode code points for the same 80-character limit as the core", () => {
    const storage = new MemoryStorage();
    let state: RunState = { ...newRun(false), canWrite: true };
    state = addInstruction(state, "😀".repeat(80), jumpInterpretation);
    const save = makeSave(state, { writer: "tab-a", savedAt: 1 });
    expect(writeSave(save, { storage, expected: null }).ok).toBe(true);

    const tooLong = makeSave(
      {
        ...state,
        instructions: state.instructions.map((item) => ({
          ...item,
          text: "😀".repeat(81),
        })),
      },
      { writer: "tab-a", savedAt: 2 },
    );
    const result = writeSave(tooLong, { storage });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.code).toBe("semantic");
  });
});

describe("optimistic concurrency", () => {
  it("rejects a stale writer/revision and preserves the latest save", () => {
    const storage = new MemoryStorage();
    const original = makeSave(newRun(false), { writer: "tab-a", savedAt: 1 });
    expect(writeSave(original, { storage, expected: null }).ok).toBe(true);

    const nextState = { ...original.state, deaths: 1, revision: 1 };
    const fromTabB = makeSave(nextState, { writer: "tab-b", savedAt: 2 });
    expect(
      writeSave(fromTabB, {
        storage,
        expected: {
          writer: original.writer,
          revision: original.state.revision,
        },
      }).ok,
    ).toBe(true);

    const stale = makeSave(
      { ...original.state, revision: 1 },
      { writer: "tab-a", savedAt: 3 },
    );
    const result = writeSave(stale, {
      storage,
      expected: { writer: original.writer, revision: original.state.revision },
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.code).toBe("conflict");
    expect(loadSave(storage)).toEqual({ ok: true, value: fromTabB });
  });

  it("reloads already charged state without charging deletion costs again", () => {
    const storage = new MemoryStorage();
    const died = step(startRun(newRun(false)));
    const state = { ...died, penaltyDeaths: 3, revision: 4 };
    const save = makeSave(state, { writer: "tab-a", savedAt: 1 });
    expect(writeSave(save, { storage, expected: null }).ok).toBe(true);
    const first = loadSave(storage);
    const second = loadSave(storage);
    expect(first.ok && first.value?.state.penaltyDeaths).toBe(3);
    expect(second.ok && second.value?.state.penaltyDeaths).toBe(3);
    expect(second.ok && second.value?.state.revision).toBe(4);
  });
});
