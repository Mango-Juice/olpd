import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeEntity, makeWorld, stillWorld, type CampaignStageDefinition } from "../src/campaign/level";
import { createStageRun } from "../src/campaign/run";
import type { InstructionProgram } from "../src/campaign/types";
import { CampaignPlay } from "../src/components/CampaignPlay";

const world = makeWorld(2, "02-v2-1", [
  makeEntity("crate", "나무 상자", "02-v2-1", 2),
  makeEntity("door", "돌문", "02-v2-1", 7),
]);

const segment: CampaignStageDefinition["segments"][number] = {
  id: "02-v2-1",
  title: "상자와 돌문",
  goal: "나무 상자를 옮겨 돌문까지 길을 만드세요.",
  description: "화면에 표시하지 않는 긴 내부 설명",
  hints: ["상자를 보세요.", "문 앞 공간을 보세요.", "상자를 돌문 앞으로 옮겨 줘."],
  scene: { floors: [{ from: 0, to: 10, y: 0 }] },
  enter: () => structuredClone(world),
  advance: stillWorld,
  complete: () => false,
};

const stage: CampaignStageDefinition = {
  id: 2,
  title: "비에 잠긴 회랑",
  objective: "편지를 가지고 회랑을 건너야 해요.",
  contentRevision: "quiet-v1",
  segments: [segment],
  practice: segment,
  story: { afterSegment: "never", object: "crate", text: "이야기" },
};

const memo: InstructionProgram = {
  version: 2,
  id: "memo-1",
  text: "나무 상자를 돌문 앞으로 옮겨 줘",
  model: "fixture",
  scope: { stageId: 2 },
  guard: false,
  body: { kind: "action", actor: "hero", verb: "move", target: "crate", destination: "door", amount: 7 },
};

function renderQuietPlay() {
  const base = createStageRun("quiet-ui", world);
  const run = {
    ...base,
    notebook: { ...base.notebook, scratch: true as const, instructions: [memo] },
  };
  return renderToStaticMarkup(createElement(CampaignPlay, {
    run,
    stage,
    settings: { muted: true, reducedMotion: true },
    onCommit: async () => true,
    interpret: async () => memo,
    onRoadmap: () => undefined,
    onPractice: () => undefined,
  }));
}

describe("quiet campaign play UI", () => {
  it("keeps the scene, memo and composer while hiding campaign ledgers and costs", () => {
    const html = renderQuietPlay();

    expect(html).toContain("나무 상자를 옮겨 돌문까지 길을 만드세요.");
    expect(html).toContain("편지를 가지고 회랑을 건너야 해요.");
    expect(html).toContain("나무 상자를 돌문 앞으로 옮겨 줘");
    expect(html).toContain("무엇을 할까요?");
    expect(html).toContain("기억하고 출발");
    expect(html).toContain("Enter ↵ 한 번이면 읽고 바로 출발해요.");
    expect(html).not.toContain("이번 목표");
    expect(html).not.toContain("뜻 확인하기");
    expect(html).not.toContain("이 뜻으로 남기기");
    expect(html).not.toContain("이 메모로 시작하기");
    expect(html).not.toContain("남은 지우개");
    expect(html).not.toContain("이번 시도의 관찰과 발자국");
    expect(html).not.toContain("플레이 도구");
    expect(html).not.toContain("지난 장의 메모");
    expect(html.indexOf("campaign-goal")).toBeLessThan(html.indexOf("composer"));
    expect(html.indexOf("composer")).toBeLessThan(html.indexOf("play-stage-progress"));
  });

  it("keeps direct memo controls visible without another disclosure", () => {
    const html = renderQuietPlay();
    expect(html).toContain('<div class="campaign-note-actions"><button');
    expect(html).toContain(">수정</button>");
    expect(html).toContain(">삭제</button>");
  });
});
