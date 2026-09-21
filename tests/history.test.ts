import { describe, expect, it } from "vitest";
import {
  abandon,
  addInstruction,
  deleteInstruction,
  moveInstruction,
  newRun,
  practiceDeletion,
  retry,
  startMain,
  startRun,
  step,
} from "../src/game/core";
import { getRunHistory } from "../src/game/history";
import {
  STORAGE_KEY,
  loadSave,
  makeSave,
  type StorageLike,
  writeSave,
} from "../src/game/storage";
import type {
  Action,
  Interpretation,
  ObservationId,
  RunState,
  SaveData,
} from "../src/game/types";

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

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

describe("run history", () => {
  it("records notebook edits, action results, death, and the next-life revival", () => {
    let state: RunState = { ...newRun(false), canWrite: true };
    state = addInstruction(
      state,
      "구덩이는 뛰어넘어",
      interpretation("jump", ["pit"]),
    );
    const jumpId = state.instructions[0].id;
    state = addInstruction(
      { ...state, canWrite: true },
      "천장에서는 숙여",
      interpretation("duck", ["lowCeiling"]),
    );
    const duckId = state.instructions[1].id;
    state = moveInstruction(state, jumpId, "up");

    state = step(startRun(state));
    expect(state.phase).toBe("running");
    state = step(state);
    expect(state.phase).toBe("dead");
    state = deleteInstruction(state, duckId);
    state = addInstruction(
      state,
      "끊어진 다리는 뛰어넘어",
      interpretation("jump", ["bridge"]),
    );
    state = retry(state);

    const history = getRunHistory(state);
    expect(history.complete).toBe(true);
    expect(history.entries.map((entry) => entry.kind)).toEqual([
      "write",
      "write",
      "reorder",
      "action",
      "action",
      "delete",
      "write",
      "revive",
    ]);
    expect(history.entries.map((entry) => entry.life)).toEqual([
      1, 1, 1, 1, 1, 2, 2, 2,
    ]);
    expect(history.entries.map((entry) => entry.revision)).toEqual([
      1, 2, 3, 5, 6, 7, 8, 9,
    ]);
    expect(history.entries[2]).toMatchObject({
      kind: "reorder",
      instructionId: jumpId,
      from: 1,
      to: 0,
    });
    expect(history.entries[5]).toMatchObject({
      kind: "delete",
      instructionId: duckId,
      eraserCost: 1,
      deathCost: 0,
    });
    expect(
      history.entries
        .filter((entry) => entry.kind === "action")
        .map((entry) => entry.eventId),
    ).toEqual(state.events.map((event) => event.id));

    const storage = new MemoryStorage();
    const save = makeSave(state, { writer: "tab-a", savedAt: 1 });
    expect(writeSave(save, { storage, expected: null }).ok).toBe(true);
    expect(loadSave(storage)).toEqual({ ok: true, value: save });
  });

  it("records abandon on the ending life and ignores rejected or no-op transitions", () => {
    let state: RunState = { ...newRun(false), canWrite: true };
    state = addInstruction(
      state,
      "구덩이에서는 우회해",
      interpretation("detour", ["pit"]),
    );
    state = step(startRun(state));
    expect(state.phase).toBe("blocked");
    const blocked = state;
    expect(step(state)).toBe(blocked);
    expect(retry(state)).toBe(blocked);
    expect(deleteInstruction(state, "missing")).toBe(blocked);

    state = abandon(state);
    const history = getRunHistory(state);
    expect(history.entries.at(-1)).toMatchObject({
      kind: "abandon",
      life: 1,
    });
    expect(history.entries).toHaveLength(3);
  });

  it("starts main with a clean complete chronicle and the two actual tutorial notes", () => {
    let tutorial = newRun(true);
    tutorial = addInstruction(
      tutorial,
      "앞으로 전진해",
      interpretation("advance", ["clear"]),
    );
    tutorial = step(step(startRun(tutorial)));
    tutorial = addInstruction(
      tutorial,
      "구덩이가 있으면 뛰어",
      interpretation("jump", ["pit", "bridge"]),
    );
    tutorial = retry(tutorial);
    tutorial = startRun(tutorial);
    while (tutorial.phase === "running") tutorial = step(tutorial);
    for (let index = 0; index < 3; index += 1) {
      tutorial = practiceDeletion(tutorial);
    }

    const main = startMain(tutorial);
    expect(main.history).toEqual({
      version: 1,
      complete: true,
      initialInstructions: main.instructions,
      entries: [],
    });
    expect(main.history?.initialInstructions).not.toBe(main.instructions);
    expect(main.history?.initialInstructions.map((item) => item.id)).toEqual(
      tutorial.instructions.map((item) => item.id),
    );
  });

  it("loads old saves, reconstructs only actions, and keeps later history incomplete", () => {
    let current = step(startRun(newRun(false)));
    current = step(startRun(retry(current)));
    const { history: _history, ...withoutHistory } = current;
    const legacyState: RunState = withoutHistory;
    const storage = new MemoryStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify(makeSave(legacyState, { writer: "old", savedAt: 1 })),
    );

    const loaded = loadSave(storage);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || !loaded.value) throw new Error("legacy save did not load");
    const reconstructed = getRunHistory(loaded.value.state);
    expect(reconstructed.complete).toBe(false);
    expect(reconstructed.initialInstructions).toEqual(
      loaded.value.state.instructions,
    );
    expect(reconstructed.entries).toEqual(
      loaded.value.state.events.map((event, index) => ({
        kind: "action",
        revision: index + 1,
        life: index + 1,
        eventId: event.id,
      })),
    );

    const continued = addInstruction(
      loaded.value.state,
      "구덩이는 뛰어넘어",
      interpretation("jump", ["pit"]),
    );
    expect(continued.history?.complete).toBe(false);
    expect(continued.history?.entries.at(-1)).toMatchObject({
      kind: "write",
      life: 3,
    });
  });

  it("rejects invalid optional history references without replacing saved bytes", () => {
    const storage = new MemoryStorage();
    const state = step(startRun(newRun(false)));
    const original = makeSave(state, { writer: "tab-a", savedAt: 1 });
    expect(writeSave(original, { storage, expected: null }).ok).toBe(true);
    const originalBytes = storage.getItem(STORAGE_KEY);
    const damaged = {
      ...original,
      state: {
        ...state,
        history: {
          ...state.history!,
          entries: state.history!.entries.map((entry) =>
            entry.kind === "action"
              ? { ...entry, eventId: "missing-event" }
              : entry,
          ),
        },
      },
    } as SaveData;

    const result = writeSave(damaged, { storage });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("semantic");
    expect(storage.getItem(STORAGE_KEY)).toBe(originalBytes);
  });
});
