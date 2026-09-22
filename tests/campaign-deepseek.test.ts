import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { handleCampaignInterpret } from "../server/campaign-http";
import { DEEPSEEK_CAMPAIGN_TIMEOUT_MS, interpretCampaignWithDeepSeek } from "../server/campaign-deepseek";
import { interpretCampaign } from "../server/campaign-service";
import { RAIN_INTRO } from "../src/campaign/stages/rain";
import { RAIN_REACH } from "../src/campaign/stages/rain-late";
import { resetRateLimitsForTests } from "../server/rate-limit";

const action = { kind: "action", actor: "hero", verb: "board", target: "rain-cork" };
const envelope = (body: unknown = action) => ({ status: "ok", scope: { mode: "current" }, guard: false, body });
function response(body: unknown = envelope(), finish = "stop") {
  return new Response(JSON.stringify({ model: "deepseek-flash", choices: [{ finish_reason: finish, message: { content: typeof body === "string" ? body : JSON.stringify(body) } }], usage: { prompt_tokens: 1500, completion_tokens: 100 } }));
}
function fake(body: unknown = envelope()) { return vi.fn<typeof fetch>(async () => response(body)); }
beforeEach(() => {
  vi.stubEnv("AI_STRUCTURED_LOGS", "false"); vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("DEEPSEEK_API_KEY", "fake-key-not-for-logs"); vi.stubEnv("CAMPAIGN_DEEPSEEK_THINKING", "disabled");
  resetRateLimitsForTests();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("DeepSeek campaign boundary", () => {
  it("routes the production campaign service through one non-thinking call and requires preview", async () => {
    const fetchImpl = fake(); vi.stubGlobal("fetch", fetchImpl);
    const world = RAIN_INTRO.enter(null);
    const result = await interpretCampaign({ text: "상자에 올라", stageId: 2, runId: "test", revision: 0, attempt: world.attempt, world }, "deepseek-unit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
    const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(request).toMatchObject({ model: "deepseek-flash", thinking: { type: "disabled" }, temperature: 0, response_format: { type: "json_object" } });
    expect(result).toMatchObject({ needsConfirmation: true, confidence: null, program: { model: "deepseek-flash", text: "상자에 올라", body: action } });
  });
  it("keeps hidden live state, stale facts, and credentials out of trace while preserving public context", async () => {
    const world = RAIN_INTRO.enter(null);
    world.entities["rain-cork"].properties.kind = "INTERNAL_SENTINEL";
    world.entities["rain-cork"].properties.secretFutureBookkeeping = "UNKNOWN_SENTINEL";
    world.attempt = 2;
    world.facts.push({ entity: "rain-cork", property: "afloat", value: true, tick: 0, attempt: 1 });
    const before = structuredClone(world); const trace: unknown[] = [];
    await interpretCampaignWithDeepSeek("상자에 올라", world, { fetchImpl: fake(), trace: (event) => trace.push(event) });
    expect(JSON.stringify(trace)).not.toContain("fake-key-not-for-logs");
    expect(JSON.stringify(trace)).not.toContain("INTERNAL_SENTINEL");
    expect(JSON.stringify(trace)).not.toContain("UNKNOWN_SENTINEL");
    const request = trace[0] as { data: { messages: { content: string }[] } };
    expect(JSON.parse(request.data.messages[1].content).world.facts).toEqual([]);
    expect(world).toEqual(before);
  });
  it("leaves a dangerous but explicit pour quantity intact", async () => {
    const body = { kind: "action", actor: "hero", verb: "pour", target: "reach-basin", destination: "reach-barrel", amount: 3 };
    const result = await interpretCampaignWithDeepSeek("물 세 칸을 통에 부어", RAIN_REACH.enter(null), { fetchImpl: fake(envelope(body)) });
    expect(result.program.body).toEqual(body);
  });
  it.each([
    ["unknown entity", { ...action, target: "invented" }],
    ["unknown actor", { ...action, actor: "keeper" }],
    ["role collision", { ...action, verb: "pour", destination: "rain-cork", amount: 1 }],
    ["hidden condition", { kind: "wait", until: { kind: "property", entity: "rain-cork", property: "kind", source: "visible", comparison: "eq", value: "object" } }],
  ])("rejects %s without retries", async (_name, body) => {
    const fetchImpl = fake(envelope(body));
    await expect(interpretCampaignWithDeepSeek("상자에 올라", RAIN_INTRO.enter(null), { fetchImpl })).rejects.toMatchObject({ code: "uncertain" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("returns free clarification without fabricating a program", async () => {
    await expect(interpretCampaignWithDeepSeek("그것을 옮겨", RAIN_INTRO.enter(null), { fetchImpl: fake({ status: "clarification", reason: "어느 물건을 옮길까요?" }) })).rejects.toMatchObject({ status: 422, code: "uncertain", message: "어느 물건을 옮길까요?" });
  });
  it("requires a top-level trigger exactly when guard is true", async () => {
    const condition = { kind: "property", entity: "rain-cork", property: "afloat", comparison: "eq", value: true, source: "visible" };
    for (const body of [{ ...envelope(), condition }, { ...envelope(), guard: true }]) {
      await expect(interpretCampaignWithDeepSeek("상자가 뜨면 관찰해", RAIN_INTRO.enter(null), { fetchImpl: fake(body) })).rejects.toMatchObject({ code: "provider" });
    }
    const result = await interpretCampaignWithDeepSeek("상자가 뜨면 항상 먼저 관찰해", RAIN_INTRO.enter(null), { fetchImpl: fake({ ...envelope({ ...action, verb: "observe" }), guard: true, condition }) });
    expect(result.program.condition).toEqual(condition);
  });
  it.each(["not json", { ...envelope(), extra: "ignored?" }, { ...envelope(), body: { ...action, arbitrary: true } }, { ...envelope(), scope: { mode: "region", region: "secret" } }])("rejects malformed or unsupported envelopes", async (value) => {
    await expect(interpretCampaignWithDeepSeek("상자에 올라", RAIN_INTRO.enter(null), { fetchImpl: fake(value) })).rejects.toHaveProperty("status");
  });
  it("rejects truncated output and an oversized provider body", async () => {
    for (const res of [response(envelope(), "length"), new Response("x".repeat(128 * 1024 + 1))]) {
      await expect(interpretCampaignWithDeepSeek("상자에 올라", RAIN_INTRO.enter(null), { fetchImpl: vi.fn(async () => res) })).rejects.toMatchObject({ code: "provider" });
    }
  });
  it("rejects controls but accepts Arabic amounts and a valid 500-codepoint instruction", async () => {
    const fetchImpl = fake();
    await expect(interpretCampaignWithDeepSeek("상자\u0007", RAIN_INTRO.enter(null), { fetchImpl })).rejects.toMatchObject({ code: "input" });
    expect(fetchImpl).not.toHaveBeenCalled();
    await interpretCampaignWithDeepSeek("물 2칸", RAIN_INTRO.enter(null), { fetchImpl });
    await interpretCampaignWithDeepSeek("가".repeat(500), RAIN_INTRO.enter(null), { fetchImpl });
    await expect(interpretCampaignWithDeepSeek("가".repeat(501), RAIN_INTRO.enter(null), { fetchImpl })).rejects.toMatchObject({ code: "input" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("honors low as an explicit server setting without silently retrying", async () => {
    const fetchImpl = fake();
    await interpretCampaignWithDeepSeek("상자에 올라", RAIN_INTRO.enter(null), { fetchImpl, thinking: "low" });
    const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(request).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "low" });
    expect(request).not.toHaveProperty("temperature");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("aborts at the bounded deadline and forwards external cancellation", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })));
    const call = interpretCampaignWithDeepSeek("상자에 올라", RAIN_INTRO.enter(null), { fetchImpl });
    const assertion = expect(call).rejects.toMatchObject({ code: "unavailable", retryable: true });
    await vi.advanceTimersByTimeAsync(DEEPSEEK_CAMPAIGN_TIMEOUT_MS + 1); await assertion;
    const controller = new AbortController();
    const second = interpretCampaignWithDeepSeek("상자에 올라", RAIN_INTRO.enter(null), { fetchImpl, signal: controller.signal });
    const cancelled = expect(second).rejects.toMatchObject({ code: "unavailable" }); controller.abort(); await cancelled;
    await expect(interpretCampaignWithDeepSeek("상자에 올라", RAIN_INTRO.enter(null), { fetchImpl, signal: controller.signal })).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([401, 402, 429, 503])("handles provider HTTP %s without repeating paid requests", async (status) => {
    const fetchImpl = vi.fn(async () => new Response("private provider diagnostic", { status }));
    await expect(interpretCampaignWithDeepSeek("상자에 올라", RAIN_INTRO.enter(null), { fetchImpl })).rejects.not.toHaveProperty("message", "private provider diagnostic");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("cancels the provider when a client closes after fully uploading its HTTP request", async () => {
    let started!: () => void; let aborted!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; });
    const abort = new Promise<void>((resolve) => { aborted = resolve; });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      started();
      init?.signal?.addEventListener("abort", () => { aborted(); reject(new Error("cancelled")); }, { once: true });
    })));
    const server = createServer((req, res) => { void handleCampaignInterpret(req, res); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const world = RAIN_INTRO.enter(null);
    const body = JSON.stringify({ text: "상자에 올라", stageId: 2, runId: "disconnect", revision: 0, attempt: world.attempt, world });
    const client = request({ hostname: "127.0.0.1", port: (server.address() as AddressInfo).port, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } });
    client.on("error", () => {});
    try {
      client.end(body); await start; client.destroy(); await abort;
    } finally {
      client.destroy(); server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
