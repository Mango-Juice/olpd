import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignInterpretResult } from "../server/campaign-contracts.ts";
import { handleCampaignInterpret, isLoopbackAddress } from "../server/campaign-http.ts";
import { campaignContext } from "../server/campaign-service.ts";
import { resetRateLimitsForTests } from "../server/rate-limit.ts";
import { resolveStage } from "../src/campaign/registry.ts";
import { THEATRE_STAGE } from "../src/campaign/stages/theatre.ts";
import type { WorldState } from "../src/campaign/types.ts";

const resolveQaStage: typeof resolveStage = (id) => id === THEATRE_STAGE.id ? THEATRE_STAGE : resolveStage(id);

function theatreRequest() {
  const world = THEATRE_STAGE.practice.enter(null);
  return {
    text: "인형을 발판에 올려",
    stageId: 7 as const,
    runId: "qa-stage-seven",
    revision: 0,
    attempt: world.attempt,
    world,
  };
}

const interpreted: CampaignInterpretResult = {
  program: {
    version: 2,
    id: "qa-fixture",
    text: "인형을 발판에 올려",
    model: "fixture",
    scope: { stageId: 7 },
    guard: false,
    body: { kind: "action", actor: "hero", verb: "place", target: "07-practice-puppet" },
  },
  confidence: 0.9,
  sourceSpans: { actions: [], condition: null },
  needsConfirmation: false,
};

let previousAIEnabled: string | undefined;
beforeEach(() => {
  resetRateLimitsForTests();
  previousAIEnabled = process.env.AI_ENABLED;
  delete process.env.AI_ENABLED;
});

afterEach(() => {
  if (previousAIEnabled === undefined) delete process.env.AI_ENABLED;
  else process.env.AI_ENABLED = previousAIEnabled;
});

async function withHandler(
  handler: RequestListener,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("campaign dev QA boundary", () => {
  it("keeps stage 7 outside the regular production resolver", () => {
    expect(() => campaignContext(theatreRequest())).toThrow(expect.objectContaining({ status: 400, code: "input" }));
  });

  it("accepts and canonicalizes stage 7 only through an injected resolver", () => {
    const body = theatreRequest();
    const entity = Object.values(body.world.entities)[0];
    entity.name = "조작된 이름";

    const context = campaignContext(body, resolveQaStage);

    expect(context.world.stageId).toBe(7);
    expect(context.world.entities[entity.id].name).not.toBe("조작된 이름");
    expect(body.world.entities[entity.id].name).toBe("조작된 이름");
  });

  it("passes the injected resolver through the HTTP handler without calling a real provider", async () => {
    const interpret = vi.fn(async (_text: string, _world: WorldState) => interpreted);
    await withHandler((req, res) => {
      void handleCampaignInterpret(req, res, {
        resolveStage: resolveQaStage,
        interpret,
      });
    }, async (url) => {
      const body = theatreRequest();
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(interpreted);
      expect(interpret).toHaveBeenCalledTimes(1);
      expect(interpret.mock.calls[0][1].stageId).toBe(7);
    });
  });

  it("keeps the regular HTTP handler on the production stage resolver", async () => {
    const interpret = vi.fn(async (_text: string, _world: WorldState) => interpreted);
    await withHandler((req, res) => {
      void handleCampaignInterpret(req, res, { interpret });
    }, async (url) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(theatreRequest()),
      });
      expect(response.status).toBe(400);
      expect(interpret).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["127.0.0.1", true],
    ["127.23.45.67", true],
    ["::1", true],
    ["::ffff:127.0.0.1", true],
    ["192.168.0.2", false],
    ["::ffff:192.168.0.2", false],
    [undefined, false],
  ])("classifies loopback remoteAddress %s", (address, expected) => {
    expect(isLoopbackAddress(address)).toBe(expected);
  });
});
