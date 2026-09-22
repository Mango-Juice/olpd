/** Bounded production-provider check. One call per requested onboarding scene; no retries. */
import { mkdir, writeFile } from "node:fs/promises";
import { interpretCampaignWithDeepSeek, DEEPSEEK_CAMPAIGN_PROMPT_VERSION } from "../server/campaign-deepseek";
import { STAGES } from "../src/campaign/catalog";
import { resolveStage } from "../src/campaign/registry";
import { executePhysicalAction } from "../src/campaign/physics";
import { createCursor, stepProgram } from "../src/campaign/program";
import type { WorldState } from "../src/campaign/types";

process.env.AI_STRUCTURED_LOGS ??= "false";
const thinking = process.argv.includes("--thinking") ? "low" : "disabled";
const core = process.argv.includes("--core");
const filter = process.argv.find((arg) => arg.startsWith("--ids="))?.slice(6).split(",");
if (core && !filter?.length) throw new Error("Core probes require explicit scene IDs");
const overrideText = process.argv.find((arg) => arg.startsWith("--text="))?.slice(7);
if (overrideText && filter?.length !== 1) throw new Error("Text override requires one explicit scene ID");
const directory = new URL(`../artifacts/onboarding-live/${new Date().toISOString().replaceAll(":", "-")}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const rows: Record<string, unknown>[] = [];
for (const summary of STAGES) {
  const stage = resolveStage(summary.id);
  if (!stage) continue;
  const scenes = core ? stage.segments : stage.onboarding ?? [];
  let previous: WorldState | null = null;
  for (const segment of scenes) {
    if (filter && !filter.includes(segment.id)) continue;
    const initial = segment.enter(core ? null : previous);
    const text = overrideText ?? segment.hints[2];
    const started = performance.now();
    const trace: unknown[] = [];
    let row: Record<string, unknown>;
    try {
      const { program } = await interpretCampaignWithDeepSeek(text, initial, { thinking, trace: (event) => trace.push(event) });
      let world = structuredClone(initial);
      let cursor = createCursor();
      let outcome: string = "limit";
      let reason: string | null = null;
      let steps = 0;
      for (; steps < 128; steps++) {
        const next = stepProgram(world, program.body, cursor, segment.execute ?? executePhysicalAction);
        world = next.world; cursor = next.cursor; outcome = next.outcome; reason = next.reason;
        if (["clarification", "failure", "blocked"].includes(outcome)) break;
        if (next.actions.length || outcome === "waiting") {
          const environment = segment.advance(world);
          world = environment.world;
          if (environment.failure) { outcome = "failure"; reason = environment.failure; break; }
        }
        if (segment.complete(world) || outcome === "done") break;
      }
      const pass = !["clarification", "failure", "blocked"].includes(outcome) && segment.complete(world);
      if (pass) previous = world;
      row = { id: segment.id, text, pass, outcome, reason, steps, program };
    } catch (error) {
      row = { id: segment.id, text, pass: false, error: error instanceof Error ? error.message : String(error) };
    }
    row = { ...row, latencyMs: Math.round(performance.now() - started), trace };
    rows.push(row);
    await writeFile(new URL("results.json", directory), JSON.stringify({ promptVersion: DEEPSEEK_CAMPAIGN_PROMPT_VERSION, thinking, core, rows }, null, 2));
    console.log(JSON.stringify({ ...row, trace: undefined, program: undefined }));
  }
}
console.log(JSON.stringify({ passed: rows.filter((row) => row.pass).length, total: rows.length, artifact: directory.pathname }));
if (rows.some((row) => !row.pass)) process.exitCode = 1;
