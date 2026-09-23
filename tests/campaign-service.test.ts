import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignInterpretResult } from "../server/campaign-contracts.ts";
import { handleCampaignInterpret } from "../server/campaign-http.ts";
import {
  CAMPAIGN_HTTP_BODY_LIMIT,
  campaignContext,
  interpretCampaign,
} from "../server/campaign-service.ts";
import { resetRateLimitsForTests } from "../server/rate-limit.ts";
import { QUIET_RAIN_STAGE as RAIN_STAGE } from "../src/campaign/quiet/early.ts";
import { GARDEN_STAGE } from "./fixtures/campaign-worlds/garden.ts";
import type { WorldState } from "../src/campaign/types.ts";

process.env.AI_STRUCTURED_LOGS = "false";

const interpreted: CampaignInterpretResult = {
  program: {
    version: 2,
    id: "fixture-program",
    text: "상자를 밀어",
    model: "fixture",
    scope: { stageId: 2 },
    guard: false,
    body: {
      kind: "action",
      actor: "hero",
      verb: "push",
      target: "02-v2-1-box",
    },
  },
  confidence: 0.9,
  sourceSpans: { actions: [], condition: null },
  needsConfirmation: false,
};

function validRequest(text = "상자를 밀어") {
  const world = RAIN_STAGE.segments[0].enter(null);
  return {
    text,
    stageId: 2 as const,
    runId: "run-service-test",
    revision: 4,
    attempt: world.attempt,
    world,
  };
}

function providerSpy() {
  return vi.fn(async () => interpreted);
}

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

describe("campaign service request boundary", () => {
  it("derives actor gravity from its current public room instead of the last catalog spawn", () => {
    const world = GARDEN_STAGE.practice.enter(null);
    const marker = Object.values(world.entities).find((entity) => entity.properties.kind === "room-gravity-marker" && entity.properties.gravity === "up")!;
    expect(marker).toBeDefined();
    world.actors.hero.location = { ...marker.location };
    for (const id of world.actors.hero.carrying) world.entities[id].location = { ...marker.location };
    world.actors.hero.capabilities = ["teleport", "gravity:down"];
    marker.properties.gravity = "left";
    const context = campaignContext({ ...validRequest(), stageId: 5, world }, (id) => id === 5 ? GARDEN_STAGE : null);
    expect(context.world.actors.hero.capabilities).toContain("gravity:up");
    expect(context.world.actors.hero.capabilities).not.toContain("gravity:down");
    expect(context.world.actors.hero.capabilities).not.toContain("teleport");
    expect(context.world.entities[marker.id].properties.gravity).toBe("up");
  });
  it.each([
    [
      "semantically invalid world",
      () => {
        const body = validRequest();
        body.world.tick = -1;
        return body;
      },
    ],
    [
      "unknown segment",
      () => {
        const body = validRequest();
        body.world.segmentId = "02-missing";
        return body;
      },
    ],
    [
      "unknown entity",
      () => {
        const body = validRequest();
        const source = body.world.entities["02-v2-1-box"];
        body.world.entities.intruder = {
          ...structuredClone(source),
          id: "intruder",
          name: "없는 물체",
        };
        body.world.visible.push("intruder");
        return body;
      },
    ],
    ["control character", () => validRequest("상자를\u0007 밀어")],
    ["over 500 code points", () => validRequest("가".repeat(501))],
  ])("rejects %s without invoking the interpreter", async (_name, makeBody) => {
    const interpret = providerSpy();
    await expect(
      interpretCampaign(makeBody(), "198.51.100.10", { interpret }),
    ).rejects.toMatchObject({ status: 400, code: "input" });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("stops at AI_ENABLED before invoking the interpreter", async () => {
    process.env.AI_ENABLED = "false";
    const interpret = providerSpy();
    await expect(
      interpretCampaign(validRequest(), "198.51.100.11", { interpret }),
    ).rejects.toMatchObject({ status: 503, code: "unavailable" });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("restores canonical descriptors and capabilities without mutating input", () => {
    const body = validRequest("  상자를 밀어  ");
    body.world.attempt = 2;
    body.attempt = 2;
    body.world.entities["02-v2-1-box"].name = "조작된 이름";
    body.world.entities["02-v2-1-box"].description = "조작된 설명";
    body.world.entities["02-v2-1-box"].material = "metal";
    body.world.entities["02-v2-1-box"].movable = false;
    body.world.entities["02-v2-1-box"].reach = 99;
    body.world.actors.hero.capabilities = ["teleport"];
    body.world.facts = [
      {
        entity: "02-v2-1-box",
        property: "afloat",
        value: false,
        attempt: 1,
        tick: 0,
      },
      {
        entity: "02-v2-1-box",
        property: "afloat",
        value: true,
        attempt: 2,
        tick: 0,
      },
      {
        entity: "not-in-stage",
        property: "visible",
        value: true,
        attempt: 2,
        tick: 0,
      },
    ];
    const before = structuredClone(body);
    const canonical = RAIN_STAGE.segments[0].enter(null);

    const context = campaignContext(body);

    expect(body).toEqual(before);
    expect(context.text).toBe("상자를 밀어");
    expect(context.world).not.toBe(body.world);
    expect(context.world.entities["02-v2-1-box"]).toMatchObject({
      name: canonical.entities["02-v2-1-box"].name,
      description: canonical.entities["02-v2-1-box"].description,
      material: canonical.entities["02-v2-1-box"].material,
      movable: canonical.entities["02-v2-1-box"].movable,
      reach: canonical.entities["02-v2-1-box"].reach,
    });
    expect(context.world.actors.hero.capabilities).toEqual(
      canonical.actors.hero.capabilities,
    );
    expect(context.world.facts).toEqual([before.world.facts[1]]);
  });

  it("accepts exactly 500 code points and forwards canonical world and signal", async () => {
    const text = "가".repeat(500);
    const body = validRequest(`  ${text}  `);
    const controller = new AbortController();
    const interpret = vi.fn(
      async (
        _text: string,
        _world: WorldState,
        _options?: { signal?: AbortSignal },
      ) => interpreted,
    );

    await expect(
      interpretCampaign(body, "198.51.100.12", {
        signal: controller.signal,
        interpret,
      }),
    ).resolves.toBe(interpreted);
    expect(interpret).toHaveBeenCalledTimes(1);
    const [forwardedText, forwardedWorld, options] = interpret.mock.calls[0];
    expect([...forwardedText]).toHaveLength(500);
    expect(forwardedText).toBe(text);
    expect(forwardedWorld).not.toBe(body.world);
    expect(forwardedWorld.stageId).toBe(2);
    expect(options?.signal).toBe(controller.signal);
  });
});

async function withCampaignServer<T>(
  run: (base: string) => Promise<T>,
): Promise<T> {
  const server = createServer((req, res) => {
    void handleCampaignInterpret(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}/api/campaign-interpret`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function oversizedContentLength(url: string): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: "POST",
        headers: { "Content-Length": String(CAMPAIGN_HTTP_BODY_LIMIT + 1) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(Buffer.alloc(CAMPAIGN_HTTP_BODY_LIMIT + 1));
  });
}

describe("campaign HTTP request boundary", () => {
  it("enforces POST and returns an Allow header", async () => {
    await withCampaignServer(async (url) => {
      const response = await fetch(url);
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "input" },
      });
    });
  });

  it("rejects declared oversized bodies before reading them", async () => {
    await withCampaignServer(async (url) => {
      const response = await oversizedContentLength(url);
      expect(response.status).toBe(413);
      expect(JSON.parse(response.body)).toMatchObject({
        error: { code: "input" },
      });
    });
  });

  it("rejects malformed JSON with a stable 400 response", async () => {
    await withCampaignServer(async (url) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{broken",
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "input", retryable: false },
      });
    });
  });
});
