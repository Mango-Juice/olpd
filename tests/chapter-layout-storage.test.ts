import { newRun } from "./fixtures/legacy-run";
import { describe, expect, it } from "vitest";
import { campaignAuthority } from "../src/campaign/authority";
import { resolveStage } from "../src/campaign/registry";
import { roomsForRun, LEGACY_ROOMS } from "../src/game/chapter-layout";
import { ROOMS } from "../src/game/content";

import { loadSave, makeSave, STORAGE_KEY } from "../src/game/storage";
import type { SaveData } from "../src/game/types";

function read(save: SaveData) {
  return loadSave({ getItem: (key) => key === STORAGE_KEY ? JSON.stringify(save) : null, setItem: () => undefined });
}

describe("chapter one layout compatibility", () => {
  it("keeps unmarked active and completed eight-room saves readable", () => {
    const lastEvent = {
      id: "old-final-detour", room: 7, point: 4, observation: "spikesCeilingPath" as const,
      action: "detour" as const, instructionId: null, outcome: "safe" as const,
      reason: "표지판을 따라 안전한 샛길로 지나갔다.", repeated: false,
    };
    const { layoutVersion: _layoutVersion, history: _history, ...oldState } = newRun(false);
    const active = makeSave({
      ...oldState, room: 7, point: 5,
      events: [lastEvent], lastEvent,
    }, { writer: "old-tab" });
    const cleared = makeSave({ ...active.state, phase: "cleared", point: 6 }, { writer: "old-tab" });
    expect(roomsForRun(active.state)).toBe(LEGACY_ROOMS);
    expect(read(active)).toEqual({ ok: true, value: active });
    expect(read(cleared)).toEqual({ ok: true, value: cleared });
    expect(campaignAuthority(resolveStage).parse({ kind: "legacy", save: cleared })).toEqual({ kind: "legacy", save: cleared });
    const altered = read({ ...active, state: { ...active.state, events: [{ ...lastEvent, observation: "pit" }] } });
    expect(altered.ok).toBe(false);
  });

  it("validates integrated saves against their own six-room route", () => {
    expect(ROOMS).toHaveLength(6);
    const state = { ...newRun(false), layoutVersion: 3 as const, room: 5, point: ROOMS[5].points.length, phase: "cleared" as const };
    const save = makeSave(state, { writer: "new-tab" });
    expect(roomsForRun(state)).toBe(ROOMS);
    expect(read(save)).toEqual({ ok: true, value: save });
  });

  it("rejects unknown layouts and integrated tutorial saves", () => {
    const baseline = makeSave(newRun(false), { writer: "tab" });
    const unknown = read({ ...baseline, state: { ...baseline.state, layoutVersion: 4 } } as unknown as SaveData);
    const tutorial = read(makeSave({ ...newRun(true), layoutVersion: 2 }, { writer: "tab" }));
    expect(unknown.ok).toBe(false);
    expect(tutorial.ok).toBe(false);
  });
});
