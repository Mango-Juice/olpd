import { mkdir, readFile, writeFile } from "node:fs/promises";

import { interpretCampaignWithJev } from "../server/campaign-jev";
import type { CampaignJevTraceEvent } from "../server/campaign-contracts";
import { RAIN_INTRO } from "../src/campaign/stages/rain";
import { RAIN_REACH } from "../src/campaign/stages/rain-late";
import type { InstructionProgram, PhysicalAction, ProgramNode, Verb, WorldState } from "../src/campaign/types";

type ExpectedAction = Omit<Pick<PhysicalAction, "actor" | "verb" | "target">, "verb"> & {
  verb: Verb | readonly Verb[];
} & Partial<Pick<PhysicalAction, "destination" | "instrument" | "amount">>;
type PhysicsKind = "intro_full" | "intro_board" | "intro_dismount" | "pour";
type EvaluationCase = {
  id: string;
  text: string;
  world: () => WorldState;
  expected: readonly ExpectedAction[];
  physics: PhysicsKind;
  expectedPhysicsSafe: boolean;
};

function advanceIntro(world: WorldState): WorldState {
  return RAIN_INTRO.advance(world).world;
}
function requireDone(world: WorldState, action: PhysicalAction): WorldState {
  const result = RAIN_INTRO.execute!(world, action);
  if (result.outcome !== "done") throw new Error(`fixture action failed: ${result.reason}`);
  return result.world;
}
function introAtLaunch(): WorldState {
  let world = RAIN_INTRO.enter(null);
  world = requireDone(world, { kind: "action", actor: "hero", verb: "push", target: "rain-cork", destination: "rain-launch" });
  return advanceIntro(world);
}
function introAboardNearPlatform(): WorldState {
  let world = introAtLaunch();
  world = requireDone(world, { kind: "action", actor: "hero", verb: "board", target: "rain-cork" });
  return advanceIntro(world);
}

const CASES: readonly EvaluationCase[] = [
  {
    id: "intro-exact",
    text: "빈 코르크 상자를 물에 띄우고 그 위에 올라 건너편 발판에서 내려",
    world: () => RAIN_INTRO.enter(null),
    expected: [
      { actor: "hero", verb: ["push", "place"], target: "rain-cork", destination: "rain-launch" },
      { actor: "hero", verb: "board", target: "rain-cork" },
      { actor: "hero", verb: "dismount", target: "rain-cork", destination: "rain-platform" },
    ],
    physics: "intro_full",
    expectedPhysicsSafe: true,
  },
  {
    id: "intro-paraphrase",
    text: "코르크 상자를 물가 탑승 윤곽으로 밀고 상자에 올라탄 뒤 맞은편 민트 발판에서 내려",
    world: () => RAIN_INTRO.enter(null),
    expected: [
      { actor: "hero", verb: "push", target: "rain-cork", destination: "rain-launch" },
      { actor: "hero", verb: "board", target: "rain-cork" },
      { actor: "hero", verb: "dismount", target: "rain-cork", destination: "rain-platform" },
    ],
    physics: "intro_full",
    expectedPhysicsSafe: true,
  },
  {
    id: "board-minimal",
    text: "빈 코르크 상자 위에 올라",
    world: introAtLaunch,
    expected: [{ actor: "hero", verb: "board", target: "rain-cork" }],
    physics: "intro_board",
    expectedPhysicsSafe: true,
  },
  {
    id: "dismount-minimal",
    text: "빈 코르크 상자에서 맞은편 민트 발판으로 내려",
    world: introAboardNearPlatform,
    expected: [{ actor: "hero", verb: "dismount", target: "rain-cork", destination: "rain-platform" }],
    physics: "intro_dismount",
    expectedPhysicsSafe: true,
  },
  {
    id: "pour-two-participle",
    text: "세 칸 얕은 대야의 물 두 칸을 떠 있는 빈 통에 부어",
    world: () => RAIN_REACH.enter(null),
    expected: [{ actor: "hero", verb: "pour", target: "reach-basin", destination: "reach-barrel", amount: 2 }],
    physics: "pour",
    expectedPhysicsSafe: true,
  },
  {
    id: "pour-two-plain",
    text: "세 칸 얕은 대야의 물 두 칸을 빈 통에 부어",
    world: () => RAIN_REACH.enter(null),
    expected: [{ actor: "hero", verb: "pour", target: "reach-basin", destination: "reach-barrel", amount: 2 }],
    physics: "pour",
    expectedPhysicsSafe: true,
  },
  {
    id: "pour-three-plain",
    text: "세 칸 얕은 대야의 물 세 칸을 빈 통에 부어",
    world: () => RAIN_REACH.enter(null),
    expected: [{ actor: "hero", verb: "pour", target: "reach-basin", destination: "reach-barrel", amount: 3 }],
    physics: "pour",
    expectedPhysicsSafe: false,
  },
  {
    id: "pour-two-arabic",
    text: "세 칸 얕은 대야에서 물 2칸을 빈 통에 부어",
    world: () => RAIN_REACH.enter(null),
    expected: [{ actor: "hero", verb: "pour", target: "reach-basin", destination: "reach-barrel", amount: 2 }],
    physics: "pour",
    expectedPhysicsSafe: true,
  },
];

function actions(node: ProgramNode): PhysicalAction[] {
  if (node.kind === "action") return [node];
  if (node.kind === "wait") return [];
  if (node.kind === "until") return [node.body];
  if (node.kind === "if") return [...actions(node.then), ...(node.otherwise ? actions(node.otherwise) : [])];
  return node.children.flatMap(actions);
}
function semanticMatch(program: InstructionProgram, expected: readonly ExpectedAction[]): boolean {
  const actual = actions(program.body);
  if (actual.length !== expected.length) return false;
  return actual.every((action, index) => {
    const wanted = expected[index];
    const verbs: readonly Verb[] = Array.isArray(wanted.verb) ? wanted.verb : [wanted.verb as Verb];
    return action.actor === wanted.actor && verbs.includes(action.verb) && action.target === wanted.target &&
      action.destination === wanted.destination && action.instrument === wanted.instrument && action.amount === wanted.amount;
  });
}
async function apiKey(): Promise<string> {
  const source = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  const line = source.split(/\r?\n/u).find((candidate) => candidate.startsWith("TYPESAFE_API_KEY="));
  const value = line?.slice("TYPESAFE_API_KEY=".length).trim().replace(/^(['"])(.*)\1$/u, "$2");
  if (!value) throw new Error("TYPESAFE_API_KEY missing");
  return value;
}
function runPhysics(kind: PhysicsKind, initial: WorldState, program: InstructionProgram) {
  const physicalActions = actions(program.body);
  if (kind === "intro_full") {
    let world = initial;
    for (const action of physicalActions) {
      const result = RAIN_INTRO.execute!(world, action);
      if (result.outcome !== "done") return { safe: false, outcome: result.outcome, reason: result.reason, complete: false };
      const advanced = RAIN_INTRO.advance(result.world);
      world = advanced.world;
      if (advanced.failure) return { safe: false, outcome: "failure", reason: advanced.failure, complete: false };
    }
    const complete = RAIN_INTRO.complete(world);
    return { safe: complete, outcome: complete ? "done" : "incomplete", reason: null, complete };
  }
  const action = physicalActions[0];
  if (!action || physicalActions.length !== 1) return { safe: false, outcome: "invalid_action_count", reason: null, complete: false };
  if (kind === "intro_board" || kind === "intro_dismount") {
    const result = RAIN_INTRO.execute!(initial, action);
    const expectedVerb = kind === "intro_board" ? "board" : "dismount";
    return { safe: result.outcome === "done" && action.verb === expectedVerb, outcome: result.outcome, reason: result.reason, complete: RAIN_INTRO.complete(result.world) };
  }
  const result = RAIN_REACH.execute!(initial, action);
  if (result.outcome !== "done") return { safe: false, outcome: result.outcome, reason: result.reason, sourceAmount: initial.entities["reach-basin"].properties.amount, destinationAmount: initial.entities["reach-barrel"].properties.amount };
  const advanced = RAIN_REACH.advance(result.world);
  return {
    safe: !advanced.failure,
    outcome: advanced.failure ? "failure" : "done",
    reason: advanced.failure ?? result.reason,
    sourceAmount: advanced.world.entities["reach-basin"].properties.amount,
    destinationAmount: advanced.world.entities["reach-barrel"].properties.amount,
    stable: advanced.world.entities["reach-barrel"].properties.stable,
  };
}

const key = await apiKey();
const requested = new Set(process.argv.slice(2));
const selectedCases = requested.size === 0 ? CASES : CASES.filter((testCase) => requested.has(testCase.id));
if (selectedCases.length === 0) throw new Error("No matching evaluation cases");
if (selectedCases.length > 8) throw new Error("Cohort is bounded to eight inputs");
const results = [];
for (const testCase of selectedCases) {
  const started = performance.now();
  const trace: CampaignJevTraceEvent[] = [];
  const initial = testCase.world();
  try {
    const result = await interpretCampaignWithJev(testCase.text, initial, { apiKey: key, trace: (event) => trace.push(event) });
    const semantic = semanticMatch(result.program, testCase.expected);
    const physics = runPhysics(testCase.physics, initial, result.program);
    const physicsMatchesExpectation = physics.safe === testCase.expectedPhysicsSafe;
    results.push({ id: testCase.id, gate: "returned", semantic, physics, expectedPhysicsSafe: testCase.expectedPhysicsSafe, physicsMatchesExpectation, pass: semantic && physicsMatchesExpectation, confidence: result.confidence, needsConfirmation: result.needsConfirmation, latencyMs: Math.round(performance.now() - started), program: result.program, sources: result.sourceSpans, trace });
  } catch (error) {
    const rejection = [...trace].reverse().find((event) => event.kind === "rejection");
    results.push({ id: testCase.id, gate: "rejected", semantic: null, physics: null, expectedPhysicsSafe: testCase.expectedPhysicsSafe, physicsMatchesExpectation: false, pass: false, latencyMs: Math.round(performance.now() - started), rejection: rejection ?? null, error: error instanceof Error ? { name: error.name, message: error.message, code: "code" in error ? error.code : undefined } : String(error), trace });
  }
}

const artifactDirectory = new URL("../artifacts/campaign-jev-v4-corrected/", import.meta.url);
await mkdir(artifactDirectory, { recursive: true });
const artifact = { generatedAt: new Date().toISOString(), model: "jev-1.13.0", requestsExpected: selectedCases.length * 4, results };
await writeFile(new URL("cohort.json", artifactDirectory), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
const summary = results.map(({ trace: _trace, ...result }) => result);
console.log(JSON.stringify({ artifact: "artifacts/campaign-jev-v4-corrected/cohort.json", model: artifact.model, requestsExpected: artifact.requestsExpected, passed: summary.filter((item) => item.pass).length, total: summary.length, results: summary }, null, 2));
