import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeEntity, makeHero, makeWorld } from "../src/campaign/level";
import { CampaignCanvas } from "../src/components/CampaignCanvas";

function causeMapWorld() {
  return makeWorld(4, "04-2", [
    makeEntity("current", "현재 장치", "04-2", 1, {
      description: "현재 구역의 장치 설명.",
    }),
    makeEntity("neighbor", "인접 구역 장치", "04-neighbor", 2, {
      description: "경계 너머에서 상호작용할 수 있는 장치.",
    }),
    makeEntity("previous", "지난 장치", "04-1", 3, {
      description: "이전 구역의 긴 장치 설명. 뒤 문장도 있어요.",
      properties: { causeMapVisible: true, unlistedInternalKey: "secret" },
    }),
  ], makeHero("04-2"));
}

function renderCanvas(selectedEntityId?: string) {
  return renderToStaticMarkup(createElement(CampaignCanvas, {
    world: causeMapWorld(),
    title: "원인 지도",
    reducedMotion: true,
    paused: true,
    selectedEntityId,
    onSelectEntity: () => undefined,
  }));
}

describe("campaign canvas progressive disclosure", () => {
  it("keeps prior cause-map devices in a separate collapsed list", () => {
    const html = renderCanvas();
    const currentList = html.match(/<details class="campaign-object-picker">[\s\S]*?<\/details>/u)?.[0];
    const previousList = html.match(/<details class="campaign-object-picker campaign-previous-objects">[\s\S]*?<\/details>/u)?.[0];

    expect(currentList).toContain("현재 장치");
    expect(currentList).toContain("인접 구역 장치");
    expect(currentList).not.toContain("지난 장치");
    expect(previousList).toContain("이전 스테이지의 장치 상태");
    expect(previousList).toContain("지난 장치");
    expect(html).not.toContain("현재 구역의 장치 설명");
    expect(html).not.toContain("이전 구역의 긴 장치 설명");
  });

  it("labels a selected prior device clearly and never presents internal properties", () => {
    const html = renderCanvas("previous");

    expect(html).toContain("이전 구역에서 이어진 장치 상태");
    expect(html).toContain('aria-label="이전 구역의 지난 장치"');
    expect(html).toContain("이전 구역의 긴 장치 설명.");
    expect(html).not.toContain("unlistedInternalKey");
    expect(html).not.toContain("causeMapVisible");
  });
});
