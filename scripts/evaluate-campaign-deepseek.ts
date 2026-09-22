/** Frozen eight-case Jev comparison cohort; no production provider changes. */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { RAIN_INTRO } from "../src/campaign/stages/rain";
import { RAIN_REACH } from "../src/campaign/stages/rain-late";
import { parseProgram } from "../src/campaign/validation";
import { formatProperty, propertyVisibility } from "../src/campaign/presentation";
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


const SYSTEM = `You translate a player's Korean instruction into a deterministic physical action program. Return one JSON object only. Never solve the puzzle, add helpful actions, remove dangerous actions, or use hidden world state. The world contains only public facts, not the answer. Preserve who does what to which object, source/destination, explicit amount, sequence, parallelism, conditions, and negation. Do not turn descriptive clauses into commanded actions. Resolve omitted subjects to hero; resolve pronouns from the instruction and public actor state. If genuinely ambiguous or unrepresentable, return {"status":"clarification","reason":"brief Korean question"}.
Otherwise return {"status":"ok","body":ProgramNode}. Do not add other keys or null optional fields.
ProgramNode grammar:
- Action: {"kind":"action","actor":"hero"|"keeper","verb":Verb,"target":entityID,"destination"?:entityID,"instrument"?:entityID,"amount"?:positiveNumber}
- {"kind":"sequence"|"parallel","children":[ProgramNode,...]}
- {"kind":"wait","until":Predicate}
- {"kind":"if","condition":Predicate,"then":ProgramNode,"otherwise"?:ProgramNode}
- {"kind":"until","condition":Predicate,"body":Action}
Predicate: {"kind":"property","entity":entityID,"property":publicPropertyKey,"comparison":"eq"|"lt"|"lte"|"gt"|"gte","value":string|number|boolean,"source":"visible"|"remembered"}, or {"kind":"all"|"any","predicates":[Predicate,...]}, or {"kind":"not","predicate":Predicate}.
Verb role contracts:
move/jump/duck: target is actor's destination or obstacle; no destination field.
push/pull/place: target is the object being moved; destination is the separate receiving place.
take/release/open/close/turn/climb: target is the acted-on object; no destination.
board: target is the object actor boards, not the destination ashore.
dismount: target is the ridden object; destination is the landing place if stated. A preceding board may establish the ridden object within this instruction.
pour: target is the source vessel; destination is the receiving vessel; amount is the quantity explicitly transferred, not the vessel's capacity or number in its name.
tie: target and destination are the two endpoints; instrument is the rope. untie: target is the endpoint, optional destination/rope only when specified.
hold: target is the object continuously held; optional instrument only when explicit.
observe/remember: target is the public object observed or remembered.
Use only listed entity/actor IDs and public properties. Output JSON, not prose or code fences.`;
function publicWorld(world: WorldState) {
  return {
    stageId: world.stageId, segmentId: world.segmentId,
    actors: Object.values(world.actors),
    entities: world.visible.map((id) => {
      const e = world.entities[id];
      const properties = Object.fromEntries(Object.entries(e.properties).filter(([key]) => propertyVisibility(key) !== "hidden"));
      return { id, name: e.name, description: e.description, material: e.material, movable: e.movable, weight: e.weight, capacity: e.capacity, reach: e.reach, location: e.location, parent: e.parent, properties,
        propertyLabels: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, formatProperty(world, key, value)?.label ?? key])) };
    }),
    facts: world.facts.filter((fact) => fact.attempt === world.attempt && propertyVisibility(fact.property) !== "hidden"),
  };
}
// This frozen cohort asks for straight-line actions only. Flattening an if/parallel
// would hide a meaning error, even if its leaves happened to match the answer.
function straightLine(node: ProgramNode): boolean {
  return node.kind === "action" || (node.kind === "sequence" && node.children.every(straightLine));
}
const checkOnly = process.argv.includes("--check-fixtures");
const rounds = process.argv.includes("--repeat") ? 3 : 1;
const thinking = process.argv.includes("--thinking");
const key = process.env.DEEPSEEK_API_KEY;
if (!checkOnly && !key) throw new Error("DEEPSEEK_API_KEY missing; load .env.local with --env-file");
const directory = new URL(`../artifacts/campaign-deepseek/${new Date().toISOString().replaceAll(":", "-")}/`, import.meta.url);
if (!checkOnly) await mkdir(directory, { recursive: true });
const results: Record<string, unknown>[] = [];
for (let round = 1; round <= rounds; round++) for (const test of CASES) {
  const initial = test.world();
  if (checkOnly) {
    const golden = test.expected.map((expected) => ({ kind: "action" as const, ...expected, verb: Array.isArray(expected.verb) ? expected.verb[0] : expected.verb })) as PhysicalAction[];
    const program = parseProgram({ version: 2, id: test.id, text: test.text, model: "fixture", scope: { stageId: initial.stageId, region: initial.actors.hero.location.region }, guard: false, body: golden.length === 1 ? golden[0] : { kind: "sequence", children: golden } });
    if (!program || !semanticMatch(program, test.expected) || runPhysics(test.physics, initial, program).safe !== test.expectedPhysicsSafe) throw new Error(`Invalid golden fixture: ${test.id}`);
    console.log(`fixture PASS ${test.id}`);
    continue;
  }
  const request = { model: "deepseek-flash", thinking: { type: thinking ? "enabled" : "disabled" }, ...(thinking ? { reasoning_effort: "low" } : { temperature: 0 }), max_tokens: thinking ? 4096 : 2048, response_format: { type: "json_object" }, messages: [
    { role: "system", content: SYSTEM },
    { role: "user", content: JSON.stringify({ instruction: test.text, world: publicWorld(initial) }) },
  ] };
  const started = performance.now();
  let responseModel: unknown = null;
  let usage: unknown = null;
  let content: unknown = null;
  let finishReason: unknown = null;
  let result: Record<string, unknown>;
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(request), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
    const payload = await response.json();
    responseModel = payload.model; usage = payload.usage;
    const choice = payload.choices?.[0];
    finishReason = choice?.finish_reason; content = choice?.message?.content;
    if (finishReason !== "stop" || typeof content !== "string") throw new Error(`Incomplete response: ${String(finishReason)}`);
    if (!thinking && choice.message.reasoning_content) throw new Error("Unexpected reasoning tokens in non-thinking evaluation");
    const parsed = JSON.parse(content);
    if (parsed.status !== "ok") throw new Error(`Model clarification: ${String(parsed.reason ?? "unspecified")}`);
    if (Object.keys(parsed).sort().join(",") !== "body,status") throw new Error("Unexpected response envelope keys");
    const program = parseProgram({ version: 2, id: `${test.id}:${round}`, text: test.text, model: "deepseek-flash", scope: { stageId: initial.stageId, region: initial.actors.hero.location.region }, guard: false, body: parsed.body });
    if (!program) throw new Error("Invalid program schema");
    const semantic = straightLine(program.body) && semanticMatch(program, test.expected);
    const physics = straightLine(program.body) ? runPhysics(test.physics, initial, program) : null;
    const physicsMatchesExpectation = physics !== null && (test.expectedPhysicsSafe ? physics.safe : physics.outcome === "failure");
    result = { id: test.id, round, semantic, physics, pass: semantic && physicsMatchesExpectation, program };
  } catch (error) {
    result = { id: test.id, round, pass: false, error: error instanceof Error ? error.message : String(error) };
  }
  result = { ...result, latencyMs: Math.round(performance.now() - started), responseModel, usage, finishReason, content, request };
  results.push(result);
  await writeFile(new URL("cohort.json", directory), JSON.stringify({ generatedAt: new Date().toISOString(), requestedModel: "deepseek-flash", documentedVersion: "DeepSeek-V4.1-Flash", thinking: thinking ? "low" : "disabled", temperature: thinking ? null : 0, promptSha256: createHash("sha256").update(SYSTEM).digest("hex"), results }, null, 2));
  console.log(JSON.stringify({ id: test.id, round, pass: result.pass, semantic: result.semantic, latencyMs: result.latencyMs, error: result.error }));
  if (typeof result.error === "string" && /HTTP (401|402|403|404|429)/u.test(result.error)) break;
}
if (!checkOnly) console.log(JSON.stringify({ artifact: directory.pathname, passed: results.filter((result) => result.pass).length, total: results.length }));
