import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeHero, makeWorld, type CampaignStageDefinition } from "../src/campaign/level";
import {
  createStageRun,
  type StagePresentation,
} from "../src/campaign/run";
import type { InstructionProgram, WorldEvent } from "../src/campaign/types";
import { buildCampaignChronicleModel } from "../src/components/CampaignChronicle";
import {
  Chronicle,
  groupChronicleEntries,
  type ChronicleEntry,
} from "../src/components/Chronicle";

const instruction: InstructionProgram = {
  version: 2,
  id: "note-1",
  text: "비가 오면 우산을 들어.",
  model: "fixture",
  scope: { stageId: 2 },
  guard: false,
  body: {
    kind: "action",
    actor: "hero",
    verb: "take",
    target: "umbrella",
  },
};

function action(id: string, repeated: boolean): ChronicleEntry<string> {
  return {
    id,
    kind: "action",
    life: 1,
    title: "첫 장면",
    quote: instruction.text,
    description: "무사히 지나갔어요.",
    outcome: "safe",
    repeated,
    replay: {
      id,
      title: "첫 장면",
      quote: instruction.text,
      description: "무사히 지나갔어요.",
      payload: id,
    },
  };
}

describe("shared chronicle presentation", () => {
  it("folds only adjacent repeated actions within the same life", () => {
    const lives = groupChronicleEntries([
      action("first", false),
      action("repeat-1", true),
      action("repeat-2", true),
      { id: "revive", kind: "change", life: 1, change: "revive", text: "다시 태어남" },
      { ...action("next-life", true), life: 2 },
    ], 2);

    expect(lives.map((life) => [life.number, life.escaped])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(lives[0].rows.map((row) => [row.repeated, row.entries.map((entry) => entry.id)])).toEqual([
      [false, ["first"]],
      [true, ["repeat-1", "repeat-2"]],
      [false, ["revive"]],
    ]);
    expect(lives[1].rows[0].entries.map((entry) => entry.id)).toEqual(["next-life"]);
  });

  it("adapts campaign history to the same lives, edits, notes, and replay model", () => {
    const before = makeWorld(2, "rain-door", [], makeHero("rain-door"));
    const after = { ...structuredClone(before), tick: 1 };
    const event = (id: string): WorldEvent => ({
      id,
      segmentId: "rain-door",
      tick: 1,
      attempt: 1,
      instructionId: instruction.id,
      actor: "hero",
      target: "umbrella",
      outcome: "safe",
      reason: "우산을 들어 빗물을 막았어요.",
      changes: [],
    });
    const presentations: StagePresentation[] = ["event-1", "event-2"].map((id) => ({
      id: `presentation-${id}`,
      before,
      after,
      events: [event(id)],
      outcome: "safe",
      repeated: true,
      life: 1,
      attempt: 1,
    }));
    const base = createStageRun("run-1", before);
    const run = {
      ...base,
      phase: "cleared" as const,
      events: presentations.flatMap((item) => item.events),
      presentationHistory: presentations,
      notebook: {
        ...base.notebook,
        deaths: 1,
        penaltyDeaths: 1,
        instructions: [instruction],
      },
      history: {
        version: 1 as const,
        initialInstructions: [],
        entries: [
          { kind: "write" as const, revision: 1, life: 1, instruction },
          { kind: "action" as const, revision: 2, life: 1, eventIds: ["event-1"] },
          { kind: "action" as const, revision: 3, life: 1, eventIds: ["event-2"] },
          { kind: "delete" as const, revision: 4, life: 1, instructionId: instruction.id, instructionText: instruction.text, eraserCost: 1, deathCost: 0 },
          { kind: "reorder" as const, revision: 5, life: 1, instructionId: instruction.id, instructionText: instruction.text, from: 1, to: 0 },
          { kind: "abandon" as const, revision: 6, life: 1 },
          { kind: "revive" as const, revision: 7, life: 2 },
        ],
      },
    };
    const stage = {
      id: 2,
      title: "비에 잠긴 회랑",
      segments: [{ id: "rain-door", title: "비 내리는 문" }],
    } as unknown as CampaignStageDefinition;

    const model = buildCampaignChronicleModel(run, stage);

    expect(model.summary).toBe("2데스 · 사망·부활 1 + 삭제 비용 1 · 2번의 행동");
    expect(model.lives.map((life) => [life.number, life.escaped])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(model.lives[0].rows[1]).toMatchObject({
      repeated: true,
      entries: [{ id: "presentation-event-1" }, { id: "presentation-event-2" }],
    });
    expect(model.lives[0].rows.flatMap((row) => row.entries).map((entry) =>
      entry.kind === "change" ? entry.text : entry.quote,
    )).toEqual(expect.arrayContaining([
      "새로 남긴 말: “비가 오면 우산을 들어.”",
      "지운 말: “비가 오면 우산을 들어.” · 지우개 1개",
      "“비가 오면 우산을 들어.” 우선순위 변경 · 위에서 2번째 → 1번째",
      "막힌 길에서 돌아오기로 했어요. · +1데스",
    ]));
    expect(model.lives[1].rows[0].entries[0]).toMatchObject({
      kind: "change",
      change: "revive",
    });
    expect(model.finalNotes.items).toEqual([instruction]);
  });

  it("renders the common life timeline and folded repeat controls", () => {
    const entries = [
      action("first", false),
      action("repeat-1", true),
      action("repeat-2", true),
      { id: "write", kind: "change" as const, life: 1, change: "write" as const, text: "새로 남긴 말" },
    ];
    const html = renderToStaticMarkup(createElement(Chronicle<string>, {
      model: {
        title: "모험 기록",
        summary: "0데스 · 3번의 행동",
        finalNotes: { label: "마지막 메모장", items: [{ id: "note", text: instruction.text }] },
        lives: groupChronicleEntries(entries, 1),
      },
      settings: { muted: true, reducedMotion: true },
      musicStageId: "rain-corridor",
      renderReplay: () => null,
    }));

    expect(html).toContain("첫 번째 생");
    expect(html).toContain("익숙한 길 2장면 무사히 통과");
    expect(html).toContain("던전 탈출");
    expect(html).toContain("chronicle-change write");
    expect(html).toContain("마지막 메모장");
  });
});
