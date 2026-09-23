import { afterEach, describe, expect, it, vi } from "vitest";
import { postInterpretJson } from "../src/services/interpret-api";

afterEach(() => vi.unstubAllGlobals());

describe("shared browser interpreter transport", () => {
  it("keeps the legacy 429 guidance without depending on a JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 429 })));
    await expect(postInterpretJson("/api/interpret", {}, new AbortController().signal))
      .rejects.toThrow("1분 뒤");
  });

  it("maps malformed JSON and preserves a validated API error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })));
    await expect(postInterpretJson("/api/interpret", {}, new AbortController().signal))
      .rejects.toThrow("응답을 읽지 못했어요");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "대상을 더 분명히 적어 주세요." } }), { status: 422 })));
    await expect(postInterpretJson("/api/interpret", {}, new AbortController().signal))
      .rejects.toThrow("대상을 더 분명히");
  });
});
