import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCampaignState } from "../src/campaign/progress";
import { StageRoadmap } from "../src/components/StageRoadmap";

describe("completed stage roadmap", () => {
  it("keeps the new-adventure entry without a past-memo archive action", () => {
    const campaign = createCampaignState("roadmap-ui");
    const completion = { run: { stageId: 1 as const, runId: "first-clear" }, completedAt: 100, source: "campaign" as const };
    campaign.stages[0] = { ...campaign.stages[0], status: "completed", completion, bestScore: 2 };
    campaign.stages[1] = { ...campaign.stages[1], status: "unlocked" };

    const html = renderToStaticMarkup(createElement(StageRoadmap, { campaign, onSelect: () => undefined }));
    expect(html).toContain("새 모험 시작");
    expect(html).toContain("완료 상태와 열린 문은 그대로 남아요");
    expect(html).not.toContain("지난 메모 보기");
    expect(html).not.toContain("지난 모험의 메모");
  });
});
