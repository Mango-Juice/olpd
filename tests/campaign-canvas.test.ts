import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeEntity, makeHero, makeWorld } from "../src/campaign/level";
import { CampaignCanvas } from "../src/components/CampaignCanvas";

function sceneWorld() {
  return makeWorld(4, "04-v2-ui", [
    makeEntity("current", "현재 장치", "04-v2-ui", 3, {
      description: "캔버스 밖에 반복하지 않는 설명",
      properties: { kind: "handle", open: false, capacity: 9, unlistedInternalKey: "secret" },
    }),
    makeEntity("exit", "짧은 출구", "04-v2-ui", 9, {
      properties: { kind: "exit", safe: true },
    }),
    makeEntity("previous", "지난 장치", "04-v2-old", 3, {
      properties: { kind: "handle", causeMapVisible: true },
    }),
  ], makeHero("04-v2-ui", .5));
}

function renderCanvas(selectedEntityId?: string) {
  return renderToStaticMarkup(createElement(CampaignCanvas, {
    world: sceneWorld(),
    scene: { floors: [{ from: 0, to: 10, y: 0 }] },
    title: "고요한 장면",
    reducedMotion: true,
    paused: true,
    selectedEntityId,
    onSelectEntity: () => undefined,
  }));
}

describe("campaign canvas scene-only inspection", () => {
  it("keeps the authored canvas fixed and has no pan, zoom, or visible object cards", () => {
    const html = renderCanvas();
    expect(html).toContain('data-scene-width="960"');
    expect(html).toContain('width="960"');
    expect(html).toContain('height="500"');
    expect(html).not.toContain("campaign-map-navigation");
    expect(html).not.toContain("campaign-object-picker");
    expect(html).not.toContain("전체 지도");
    expect(html).not.toContain("용사 위치");
  });

  it("keeps keyboard selection accessible without duplicating details or internal data", () => {
    const html = renderCanvas("current");
    expect(html).toContain("현재 장치 선택됨");
    expect(html).toContain('aria-label="장면 속 물건"');
    expect(html).toContain("현재 장치");
    expect(html).toContain("짧은 출구");
    expect(html).not.toContain("지난 장치");
    expect(html).not.toContain("캔버스 밖에 반복하지 않는 설명");
    expect(html).not.toContain("capacity");
    expect(html).not.toContain("unlistedInternalKey");
    expect(html).not.toContain("campaign-entity-facts");
    expect(html).not.toContain("campaign-scene-observation");
  });
});
