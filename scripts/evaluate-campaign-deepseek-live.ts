/** Exercises the actual production adapter; does not change live app state. */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DEEPSEEK_CAMPAIGN_PROMPT, DEEPSEEK_CAMPAIGN_PROMPT_VERSION, interpretCampaignWithDeepSeek } from "../server/campaign-deepseek";
import { DEEPSEEK_CASES } from "./campaign-deepseek-cases";

process.env.AI_STRUCTURED_LOGS ??= "false";
const thinking = process.argv.includes("--thinking") ? "low" : "disabled";
const repeatArg = process.argv.find((arg) => arg.startsWith("--repeat="));
const repeats = repeatArg ? Number(repeatArg.slice(9)) : 1;
if (![1, 2, 3].includes(repeats)) throw new Error("repeat must be 1, 2 or 3");
const filter = process.argv.find((arg) => arg.startsWith("--ids="))?.slice(6).split(",");
const cases = DEEPSEEK_CASES.filter((test) => !filter || filter.includes(test.id));
if (!cases.length || cases.length * repeats > 120) throw new Error("Select 1..120 calls");
if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY missing");
const directory = new URL(`../artifacts/campaign-deepseek-live/${new Date().toISOString().replaceAll(":", "-")}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const results: Record<string, unknown>[] = [];
const hash = createHash("sha256").update(DEEPSEEK_CAMPAIGN_PROMPT).digest("hex");
let stop = false;
for (let round = 1; round <= repeats && !stop; round++) {
  for (const test of cases) {
    const started = performance.now(); const trace: unknown[] = [];
    let result: Record<string, unknown>;
    try {
      const interpreted = await interpretCampaignWithDeepSeek(test.text, test.world(), { thinking, trace: (event) => trace.push(event) });
      const semantic = test.expected !== "clarification" && test.check(interpreted.program);
      const physics = test.physics?.(interpreted.program) ?? null;
      result = { id: test.id, group: test.group, expected: test.expected, round, semantic, physics, pass: semantic && (physics === null || physics.pass), program: interpreted.program, needsConfirmation: interpreted.needsConfirmation };
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unexpected";
      result = { id: test.id, group: test.group, expected: test.expected, round, pass: test.expected !== "program" && ["uncertain", "unsupported", "input"].includes(code), code, error: error instanceof Error ? error.message : String(error) };
      // A completed model response rejected by local validation is a case failure, not an outage.
      const responded = trace.some((event) => typeof event === "object" && event !== null && "kind" in event && event.kind === "response");
      if (code === "rate_limited" || (code === "provider" && !responded)) stop = true;
    }
    result = { ...result, latencyMs: Math.round(performance.now() - started), trace }; results.push(result);
    await writeFile(new URL("cohort.json", directory), JSON.stringify({ generatedAt: new Date().toISOString(), model: "deepseek-flash", thinking, promptVersion: DEEPSEEK_CAMPAIGN_PROMPT_VERSION, promptSha256: hash, repeats, results }, null, 2));
    console.log(JSON.stringify({ id: test.id, round, pass: result.pass, semantic: result.semantic, physics: result.physics, latencyMs: result.latencyMs, error: result.error }));
    if (stop) break;
  }
}
console.log(JSON.stringify({ artifact: directory.pathname, passed: results.filter((result) => result.pass).length, total: results.length }));
