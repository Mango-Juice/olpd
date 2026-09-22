/** Bounded causal probes. Does not edit the production prompt or user saves. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { interpretCampaignWithDeepSeek, DEEPSEEK_CAMPAIGN_PROMPT } from "../server/campaign-deepseek";
import { DEEPSEEK_CASES } from "./campaign-deepseek-cases";

process.env.AI_STRUCTURED_LOGS = "false";
const original = DEEPSEEK_CASES.find((item) => item.id === "intro-exact")!;
const old = JSON.parse(await readFile("artifacts/campaign-deepseek-live/2026-09-22T02-27-31.498Z/cohort.json", "utf8"));
const v5 = old.results[0].trace.find((event: { kind: string }) => event.kind === "request").data.messages[0].content as string;
const atomic = "\nExecution semantics: A completed atomic action already includes its direct physical state change before the next instruction executes. Do not insert waits merely to recheck the result of that completed action. Ordinary A-then-B sequences need no extra state confirmation. Preserve an explicitly requested wait or independently occurring event; this rule never removes a player's explicit condition.";
const waitSentence = " An event such as arriving while aboard a drifting object is not an extra move command: preserve the event with wait or if, never invent movement to make the event happen.";
const holdSentence = ' "While holding" without an endpoint is a plain hold, not until held=true (that would release immediately). A single actor cannot simultaneously maintain a hold and leave; return clarification for that conflict.';
const arms = process.argv.includes("--ablation") ? [
  { id: "v6-minus-event-sentence", prompt: DEEPSEEK_CAMPAIGN_PROMPT.replace(waitSentence, ""), text: original.text, thinking: "disabled" as const },
  { id: "v6-minus-hold-sentence", prompt: DEEPSEEK_CAMPAIGN_PROMPT.replace(holdSentence, ""), text: original.text, thinking: "disabled" as const },
] : [
  { id: "v6-baseline", prompt: DEEPSEEK_CAMPAIGN_PROMPT, text: original.text, thinking: "disabled" as const },
  { id: "v6-atomic-contract", prompt: DEEPSEEK_CAMPAIGN_PROMPT + atomic, text: original.text, thinking: "disabled" as const },
  { id: "v5-prompt-only", prompt: v5, text: original.text, thinking: "disabled" as const },
  { id: "v6-low-only", prompt: DEEPSEEK_CAMPAIGN_PROMPT, text: original.text, thinking: "low" as const },
  { id: "v6-wording-only", prompt: DEEPSEEK_CAMPAIGN_PROMPT, text: "빈 코르크 상자를 물가 탑승 윤곽에 놓고 그 위에 올라 건너편 발판에서 내려", thinking: "disabled" as const },
];
const folder = `artifacts/deepseek-wait-diagnosis/${new Date().toISOString().replaceAll(":", "-")}`;
await mkdir(folder, { recursive: true });
const results: unknown[] = [];
for (let round = 0; round < 3; round++) {
  // Rotate order to avoid completely confounding arms with request time/cache warmup.
  for (let offset = 0; offset < arms.length; offset++) {
    const arm = arms[(offset + round) % arms.length];
    let actualRequest: unknown; const trace: unknown[] = []; const start = performance.now();
    let outcome: Record<string, unknown>;
    try {
      const result = await interpretCampaignWithDeepSeek(arm.text, original.world(), {
        thinking: arm.thinking,
        fetchImpl: async (url, init) => {
          const body = JSON.parse(String(init?.body)); body.messages[0].content = arm.prompt;
          actualRequest = body;
          return fetch(url, { ...init, body: JSON.stringify(body) });
        },
        trace: (event) => { if (event.kind !== "request") trace.push(event); },
      });
      outcome = { program: result.program, strictSemantic: original.check(result.program), physics: original.physics?.(result.program) };
    } catch (error) {
      outcome = { error: error instanceof Error ? error.message : String(error) };
    }
    const row = { arm: arm.id, round: round + 1, latencyMs: Math.round(performance.now() - start), promptHash: createHash("sha256").update(arm.prompt).digest("hex"), actualRequest, trace, ...outcome };
    results.push(row);
    await writeFile(`${folder}/results.json`, JSON.stringify({ purpose: "Single-factor prompt, reasoning and wording probes; same production model/world/parser; no automatic retries", results }, null, 2));
    console.log(JSON.stringify({ arm: row.arm, round: row.round, latencyMs: row.latencyMs, ...outcome }));
  }
}
console.log(folder);
