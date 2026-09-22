import { readFile } from "node:fs/promises";

import type { PhysicalAction, Predicate, ProgramNode, Verb } from "../src/campaign/types";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-1.13.0";
const TIMEOUT_MS = 30_000;
const NONE = "NONE";
const MIN_ANCHOR_PROBABILITY = 0.5;
const MIN_FIELD_CONFIDENCE = 0.6;

type ChoiceQuestion = { type: "choice"; instructions: string | Record<string, unknown>; criteria: Record<string, string | null> };
type NoulQuestion = { type: "noul"; instructions: string | Record<string, unknown>; criteria?: { true: string; false: string } };
type Question = ChoiceQuestion | NoulQuestion;
type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
type NoulAnswer = { type: "noul"; noul: number };
type Answer = ChoiceAnswer | NoulAnswer;
type ApiResponse = { model: string; answers: Record<string, Answer>; usage: { input_tokens: number; output_tokens: number } };
type Token = { id: string; text: string; start: number; end: number };
type Span = { id: string; text: string; tokenStart: number; tokenEnd: number; charStart: number; charEnd: number };
type Anchor = Token & { probability: number };
type EntitySpec = { id: string; name: string; aliases: string[]; description: string };
type CallMetrics = { latencyMs: number; inputTokens: number; outputTokens: number };

const CASES = [
  { id: "three-step-sequence", text: "빈 코르크 상자를 물에 띄우고 그 위에 올라 건너편 발판에서 내려" },
  { id: "two-actor-parallel", text: "인형이 왼쪽 발판을 누르는 동안 나는 문을 건너" },
  { id: "event-condition", text: "수위가 위 눈금에 닿으면 수문을 닫아" },
  { id: "sustained-pull", text: "인형은 내가 문을 건너는 동안 레버를 당긴 채 있어" },
  { id: "once-pull", text: "인형은 내가 문을 건너는 동안 레버를 한 번 당겨" },
  { id: "explicit-instrument", text: "긴 밧줄로 배를 고리에 묶어" },
] as const;

const ENTITIES: EntitySpec[] = [
  { id: "cork_box", name: "빈 코르크 상자", aliases: ["코르크 상자", "빈 상자", "상자"], description: "물에 뜰 수 있고 올라탈 수 있는 이동 물체" },
  { id: "water", name: "물", aliases: ["수면", "수위"], description: "level 속성을 가진 물 영역" },
  { id: "far_platform", name: "건너편 발판", aliases: ["맞은편 발판"], description: "물 건너편의 도착 발판" },
  { id: "left_plate", name: "왼쪽 발판", aliases: ["왼쪽 압력판", "압력판"], description: "힘을 계속 가하면 눌림 상태가 유지되는 발판" },
  { id: "door", name: "문", aliases: ["통로 문"], description: "용사가 통과할 수 있는 문" },
  { id: "sluice_gate", name: "수문", aliases: ["물문"], description: "열고 닫아 물길을 제어하는 문" },
  { id: "upper_mark", name: "위 눈금", aliases: ["상단 눈금", "윗 눈금"], description: "수위 비교에 쓰는 위쪽 기준 눈금" },
  { id: "lever", name: "레버", aliases: ["손잡이"], description: "당기거나 당긴 상태를 유지할 수 있는 장치" },
  { id: "long_rope", name: "긴 밧줄", aliases: ["밧줄", "긴 로프"], description: "다른 대상을 묶을 때 도구로 쓰는 긴 밧줄" },
  { id: "boat", name: "배", aliases: ["보트"], description: "밧줄로 고정할 수 있는 배" },
  { id: "anchor_ring", name: "고리", aliases: ["계류 고리", "쇠고리"], description: "배를 밧줄로 묶어 고정하는 부착 지점" },
];

const VERB_CRITERIA: Record<Verb | "none", string> = {
  move: "목표 지점, 문, 통로를 따라 이동하거나 건넌다.", jump: "뛴다.", duck: "몸을 숙인다.",
  push: "대상을 한 번 밀거나 누른다. 힘을 계속 유지하라는 뜻은 아니다.",
  pull: "대상을 한 번 당긴다. 당긴 상태를 계속 유지하라는 뜻은 아니다.",
  place: "대상을 다른 장소나 대상 위에 놓거나 띄운다.", take: "대상을 집거나 가져간다.",
  release: "잡거나 누르거나 당기던 대상을 놓는다.", open: "대상을 연다.", close: "대상을 닫는다.", turn: "대상을 돌린다.",
  tie: "대상을 다른 지점에 묶는다.", untie: "묶인 대상을 푼다.", board: "물체나 탈것 위에 올라탄다.",
  dismount: "타고 있던 물체에서 내린다. 내리는 장소는 destination이고 타던 물체가 target이다.",
  climb: "대상을 타고 오르거나 기어오른다.", pour: "액체를 붓는다.",
  hold: "누르기나 당기기 같은 힘을 다른 행동 동안 계속 유지한다.", observe: "대상이나 상태를 관찰한다.", remember: "관찰한 사실을 기억한다.",
  none: "이 기준점이 물리 행동 서술어가 아니거나 위 동사로 해석할 수 없다.",
};

function tokenize(text: string): Token[] {
  return [...text.matchAll(/\S+/gu)].map((match, index) => ({ id: `T${index}`, text: match[0], start: match.index, end: match.index + match[0].length }));
}
function makeSpans(text: string, tokens: Token[], maxTokens = 6): Span[] {
  const spans: Span[] = [];
  for (let start = 0; start < tokens.length; start += 1) for (let end = start; end < Math.min(tokens.length, start + maxTokens); end += 1) {
    spans.push({ id: `S${start}_${end}`, text: text.slice(tokens[start].start, tokens[end].end), tokenStart: start, tokenEnd: end, charStart: tokens[start].start, charEnd: tokens[end].end });
  }
  return spans;
}
function spanCriteria(spans: Span[]): Record<string, string | null> {
  return Object.fromEntries([...spans.map((span) => [span.id, `[${span.tokenStart}..${span.tokenEnd}] 원문 그대로: “${span.text}”`] as const), [NONE, "해당하는 명시적 원문 구간이 없다."]]);
}
function entityCriteria(allowNone = true): Record<string, string | null> {
  return Object.fromEntries([...ENTITIES.map((entity) => [entity.id, `${entity.name}; 별칭: ${entity.aliases.join(", ")}; ${entity.description}`] as const), ...(allowNone ? [[NONE, "해당 역할의 엔티티가 명시되거나 문맥상 참조되지 않았다."] as const] : [])]);
}

function phaseOneQuestions(tokens: Token[]): Record<string, Question> {
  const questions: Record<string, Question> = {
    action_count: { type: "choice", instructions: { question: "사용자가 실행하라고 한 서로 구별되는 물리 행동 서술어는 몇 개인가?", rules: ["세계 상태 조건의 서술어는 세지 않는다.", "A하는 동안 B하라는 문장에서 A와 B가 모두 실제 수행 행동이면 둘 다 센다.", "놓고, 올라, 내려처럼 이어진 서로 다른 동작은 각각 센다."] }, criteria: { "1": "한 행동", "2": "두 행동", "3": "세 행동", "4+": "네 행동 이상", unclear: "명확히 셀 수 없음" } },
    composition: { type: "choice", instructions: "문장의 물리 행동들을 ProgramNode로 합칠 때 주된 관계는 무엇인가? 세계 상태 조건절은 행동으로 세지 않는다.", criteria: { single: "물리 행동 하나", sequence: "여러 행동을 순서대로 실행", parallel: "둘 이상의 행동이 같은 시간 구간에 겹쳐 실행", mixed: "순차와 동시 관계가 함께 있음", unclear: "관계를 정할 수 없음" } },
    has_condition: { type: "noul", instructions: "물리 행동 실행을 제어하는 세계 상태나 사건 조건이 명시되어 있는가? 다른 수행 행동이 진행되는 '동안'은 여기서 세계 상태 조건이 아니다.", criteria: { true: "~면, ~하면처럼 상태나 사건이 실행을 제어한다.", false: "조건 없이 실행하거나 수행 행동끼리의 시간 관계만 말한다." } },
    has_parallel: { type: "noul", instructions: "둘 이상의 물리 행동이 같은 시간 구간에 겹쳐야 한다고 명시되어 있는가?", criteria: { true: "한 행동을 하는 동안 다른 행동을 한다.", false: "한 행동이거나 순차 실행만 한다." } },
  };
  for (const token of tokens) {
    questions[`action_anchor_${token.id}`] = { type: "noul", instructions: { question: "`candidate_token` 자체가 사용자가 수행시키는 물리 행동을 나타내는 서술어인가?", candidate_token: token, rules: ["조사, 명사, 대상, 장소, 횟수 표현은 아니다.", "다른 행동이 진행되는 동안 수행할 동작도 행동 서술어다.", "세계 상태가 어떤 기준에 닿는 것처럼 실행 조건만 나타내는 서술어는 행동 서술어가 아니다.", "candidate_token 이외의 토큰이 행동을 표현하더라도 이 질문에는 영향을 주지 않는다."] }, criteria: { true: "이 토큰이 물리 행동 서술어다.", false: "이 토큰은 물리 행동 서술어가 아니다." } };
    questions[`condition_anchor_${token.id}`] = { type: "noul", instructions: { question: "`candidate_token` 자체가 명령 실행을 제어하는 세계 상태/사건 조건의 서술어인가?", candidate_token: token, rules: ["다른 수행 행동이 진행되는 '동안'의 행동 서술어는 세계 상태 조건으로 세지 않는다.", "명령받은 행동 자체의 서술어는 조건 서술어가 아니다.", "candidate_token 이외의 토큰이 조건을 표현하더라도 이 질문에는 영향을 주지 않는다."] }, criteria: { true: "이 토큰이 실행 조건의 핵심 서술어다.", false: "이 토큰은 실행 조건 서술어가 아니다." } };
  }
  return questions;
}

function anchoredSpanQuestion(anchor: Anchor, role: string, criteria: Record<string, string | null>, requireAnchor: boolean): ChoiceQuestion {
  return { type: "choice", instructions: { question: `원문에서 action_anchor가 나타내는 행동의 ${role}에 해당하는 가장 짧고 완전한 연속 구간은 무엇인가?`, action_anchor: anchor, source_rule: "후보 span 하나를 고르고 원문에 없는 말을 만들지 않는다.", anchor_rule: requireAnchor ? "선택한 행동절에는 action_anchor 토큰이 반드시 포함되어야 한다." : "행위자나 논항은 한국어 문장 구조상 action_anchor와 떨어져 있을 수 있다." }, criteria };
}
function anchoredEntityQuestion(anchor: Anchor, role: "target" | "destination" | "instrument", allowNone: boolean): ChoiceQuestion {
  const roleRules = {
    target: ["place는 옮겨 놓는 물체, board는 올라타는 물체, dismount는 내려오는 현재 탑승 물체가 target이다.", "move는 통과하거나 이동 기준이 되는 문/통로, tie는 묶이는 물체가 target이다.", "대명사나 생략된 참조는 전체 instruction의 앞 행동과 담화 문맥으로 해소하되 퍼즐 해법을 새로 만들지 않는다."],
    destination: ["place는 놓을 장소, dismount는 내리는 장소, tie는 묶어 붙이는 지점이 destination이다.", "move에서 별도 도착점을 사용자가 말하지 않았다면 NONE이다. 통과 대상인 문이나 카탈로그의 관련 없어 보이는 장소를 destination으로 추측하지 않는다.", "그 역할이 없으면 NONE이며 target을 destination으로 복제하지 않는다."],
    instrument: ["사용자가 별도의 행동 도구를 명시했을 때만 고른다. 직접 target을 instrument로 복제하지 않는다.", "퍼즐에 유용해 보여도 명시되지 않은 도구를 추측하지 않는다.", "tie에서 밧줄은 instrument이고 묶이는 물체는 target, 붙이는 지점은 destination이다."],
  } as const;
  return { type: "choice", instructions: { question: `action_anchor 행동의 ${role} 역할을 맡는 visible_entities의 ID는 무엇인가?`, action_anchor: anchor, role_rules: roleRules[role] }, criteria: entityCriteria(allowNone) };
}

function phaseTwoQuestions(actionAnchors: Anchor[], conditionAnchor: Anchor | null, spans: Span[]): Record<string, Question> {
  const questions: Record<string, Question> = {};
  const spansWithNone = spanCriteria(spans);
  for (const anchor of actionAnchors) {
    const prefix = `action_${anchor.id}`;
    questions[`${prefix}_clause`] = anchoredSpanQuestion(anchor, "핵심 행동절 전체(서술어와 이 행동의 명시 target/destination/instrument 포함)", spansWithNone, true);
    questions[`${prefix}_actor_explicit`] = { type: "noul", instructions: { question: "action_anchor 행동의 문법적 행위자가 원문에 명시되어 있는가?", action_anchor: anchor, rules: ["한국어 주제/주어는 중첩절 앞이나 밖에 있을 수 있으므로 전체 instruction에서 찾는다.", "일반 명령에서 행위자가 생략된 것은 명시된 행위자가 아니다."] }, criteria: { true: "원문에 이 행동의 행위자 표현이 있다.", false: "행위자가 생략되어 있다." } };
    questions[`${prefix}_actor_source`] = anchoredSpanQuestion(anchor, "문법적 행위자 표현", spansWithNone, false);
    questions[`${prefix}_actor`] = { type: "choice", instructions: { question: "action_anchor 행동을 수행하는 게임 actor는 누구인가?", action_anchor: anchor, aliases: { hero: "나, 내가, 나는, 또는 행위자가 생략된 명령 수신자", keeper: "인형" }, rule: "전체 한국어 문장의 절 경계와 주제/주어 범위를 사용한다." }, criteria: { hero: "용사", keeper: "인형/동료", unclear: "판단할 수 없음" } };
    questions[`${prefix}_verb`] = { type: "choice", instructions: { question: "action_anchor 행동을 캠페인 AST Verb 하나로 정규화하면 무엇인가?", action_anchor: anchor, duration_rule: "다른 행동 동안 힘을 계속 유지하면 hold, 한 번만 당기면 pull이다." }, criteria: VERB_CRITERIA };
    questions[`${prefix}_duration`] = { type: "choice", instructions: { question: "action_anchor 행동에 명시된 지속/횟수 방식은 무엇인가?", action_anchor: anchor, rules: ["한 번, 1회처럼 횟수를 한 번으로 명시하면 once다.", "당긴 채, 누르는 동안처럼 힘이나 상태의 유지를 명시하면 sustained다.", "다른 행동이 동안 절에 있다는 사실만으로 그 행동 자체를 sustained로 만들지 않는다."] }, criteria: { ordinary: "지속이나 횟수를 따로 명시하지 않은 보통 행동", sustained: "다른 행동이 진행되는 동안 힘이나 상태를 계속 유지", once: "한 번만 실행한다고 명시", unclear: "판단할 수 없음" } };
    questions[`${prefix}_target_source`] = anchoredSpanQuestion(anchor, "target을 언급하거나 가리키는 표현", spansWithNone, false);
    questions[`${prefix}_target_reference`] = { type: "choice", instructions: { question: "action_anchor의 target 참조 방식은 무엇인가?", action_anchor: anchor }, criteria: { explicit: "target 이름이나 명사구가 이 행동절에 직접 명시됨", anaphoric: "그것/그 위처럼 앞서 언급한 대상을 가리킴", implicit_context: "현재 탑승물처럼 행동 의미와 앞 문맥에서 대상이 생략됨", unclear: "target 참조를 판단할 수 없음" } };
    questions[`${prefix}_target_entity`] = anchoredEntityQuestion(anchor, "target", false);
    questions[`${prefix}_destination_source`] = anchoredSpanQuestion(anchor, "destination을 명시하는 표현", spansWithNone, false);
    questions[`${prefix}_destination_entity`] = anchoredEntityQuestion(anchor, "destination", true);
    questions[`${prefix}_instrument_source`] = anchoredSpanQuestion(anchor, "instrument 도구를 명시하는 표현", spansWithNone, false);
    questions[`${prefix}_instrument_entity`] = anchoredEntityQuestion(anchor, "instrument", true);
  }
  if (conditionAnchor) {
    questions.condition_clause = { type: "choice", instructions: { question: "condition_anchor를 포함하는 실행 조건절 전체의 가장 짧고 완전한 원문 span은 무엇인가?", condition_anchor: conditionAnchor }, criteria: spansWithNone };
    questions.condition_subject_source = { type: "choice", instructions: { question: "condition_anchor 조건에서 관찰되는 대상/상태 주어의 원문 span은 무엇인가?", condition_anchor: conditionAnchor }, criteria: spansWithNone };
    questions.condition_entity = { type: "choice", instructions: { question: "condition_anchor 조건에서 속성을 관찰할 visible entity ID는 무엇인가?", condition_anchor: conditionAnchor }, criteria: entityCriteria(false) };
    questions.condition_property = { type: "choice", instructions: { question: "condition_anchor 조건이 관찰하는 속성은 무엇인가?", condition_anchor: conditionAnchor }, criteria: { level: "물 또는 액체의 높이/수위", position: "대상의 위치", contact: "두 대상이 맞닿았는지", open: "열림 여부", pressed: "눌림 여부", other_state: "그 밖의 상태" } };
    questions.condition_value_source = { type: "choice", instructions: { question: "condition_anchor 조건의 기준값/목표 상태를 나타내는 원문 span은 무엇인가?", condition_anchor: conditionAnchor }, criteria: spansWithNone };
    questions.condition_value_entity = { type: "choice", instructions: { question: "condition_anchor 조건의 비교 기준값 역할을 맡는 visible entity ID는 무엇인가?", condition_anchor: conditionAnchor }, criteria: entityCriteria(false) };
    questions.condition_comparison = { type: "choice", instructions: { question: "condition_anchor 조건의 비교 연산은 무엇인가?", condition_anchor: conditionAnchor }, criteria: { reaches_or_above: "수치나 위치가 기준에 닿거나 그 이상이 됨", eq: "기준과 같음", lt: "기준보다 작음", lte: "기준보다 작거나 같음", gt: "기준보다 큼", gte: "기준보다 크거나 같음", state_is: "비수치 상태가 특정 상태가 됨", unclear: "관계를 정할 수 없음" } };
  }
  return questions;
}

function getChoice(answers: Record<string, Answer>, id: string): ChoiceAnswer {
  const answer = answers[id]; if (!answer || answer.type !== "choice") throw new Error(`${id}: Choice 응답이 없습니다.`); return answer;
}
function getNoul(answers: Record<string, Answer>, id: string): number {
  const answer = answers[id]; if (!answer || answer.type !== "noul") throw new Error(`${id}: Noul 응답이 없습니다.`); return answer.noul;
}
function selectedSpan(answers: Record<string, Answer>, spanMap: Map<string, Span>, id: string): Span | null {
  const choice = getChoice(answers, id).choice; if (choice === NONE) return null; const span = spanMap.get(choice); if (!span) throw new Error(`${id}: 알 수 없는 span ${choice}`); return span;
}
function sourceRef(span: Span | null): null | { text: string; chars: [number, number]; tokens: [number, number] } {
  return span && { text: span.text, chars: [span.charStart, span.charEnd], tokens: [span.tokenStart, span.tokenEnd] };
}
function comparison(choice: string): Extract<Predicate, { kind: "property" }>["comparison"] {
  if (choice === "lt" || choice === "lte" || choice === "gt" || choice === "gte" || choice === "eq") return choice; return choice === "reaches_or_above" ? "gte" : "eq";
}
function selectAnchors(tokens: Token[], answers: Record<string, Answer>) {
  const countChoice = getChoice(answers, "action_count").choice;
  const actionCount = countChoice === "4+" || countChoice === "unclear" ? 0 : Number(countChoice);
  const ranked = tokens.map((token) => ({ ...token, probability: getNoul(answers, `action_anchor_${token.id}`) })).sort((left, right) => right.probability - left.probability);
  const actionAnchors = ranked.slice(0, actionCount).sort((left, right) => left.start - right.start);
  const hasCondition = getNoul(answers, "has_condition");
  const conditionRanked = tokens.map((token) => ({ ...token, probability: getNoul(answers, `condition_anchor_${token.id}`) })).sort((left, right) => right.probability - left.probability);
  return { countChoice, actionAnchors, conditionAnchor: hasCondition >= 0.5 ? conditionRanked[0] ?? null : null };
}

function compose(text: string, tokens: Token[], spans: Span[], phaseOne: ApiResponse, phaseTwo: ApiResponse, metrics: { phaseOne: CallMetrics; phaseTwo: CallMetrics }) {
  const selected = selectAnchors(tokens, phaseOne.answers);
  const spanMap = new Map(spans.map((span) => [span.id, span]));
  const issues: string[] = [];
  if (selected.countChoice === "4+" || selected.countChoice === "unclear") issues.push("action_count_out_of_probe_range");
  if (selected.actionAnchors.some((anchor) => anchor.probability < MIN_ANCHOR_PROBABILITY)) issues.push("low_action_anchor_probability");
  if (selected.conditionAnchor && selected.conditionAnchor.probability < MIN_ANCHOR_PROBABILITY) issues.push("low_condition_anchor_probability");
  const actions = selected.actionAnchors.map((anchor) => {
    const prefix = `action_${anchor.id}`;
    const clause = selectedSpan(phaseTwo.answers, spanMap, `${prefix}_clause`);
    const actorExplicit = getNoul(phaseTwo.answers, `${prefix}_actor_explicit`);
    const actorSourceRaw = selectedSpan(phaseTwo.answers, spanMap, `${prefix}_actor_source`);
    const actorSource = actorExplicit >= 0.5 ? actorSourceRaw : null;
    const actorAnswer = getChoice(phaseTwo.answers, `${prefix}_actor`);
    const verbAnswer = getChoice(phaseTwo.answers, `${prefix}_verb`);
    const targetSource = selectedSpan(phaseTwo.answers, spanMap, `${prefix}_target_source`);
    const targetReference = getChoice(phaseTwo.answers, `${prefix}_target_reference`);
    const targetEntity = getChoice(phaseTwo.answers, `${prefix}_target_entity`);
    const destinationSourceRaw = selectedSpan(phaseTwo.answers, spanMap, `${prefix}_destination_source`);
    const destinationEntity = getChoice(phaseTwo.answers, `${prefix}_destination_entity`);
    const destinationSource = destinationEntity.choice === NONE ? null : destinationSourceRaw;
    const instrumentSourceRaw = selectedSpan(phaseTwo.answers, spanMap, `${prefix}_instrument_source`);
    const instrumentEntity = getChoice(phaseTwo.answers, `${prefix}_instrument_entity`);
    const instrumentSource = instrumentEntity.choice === NONE ? null : instrumentSourceRaw;
    const duration = getChoice(phaseTwo.answers, `${prefix}_duration`);
    const actor = actorAnswer.choice; const verb = verbAnswer.choice;
    const ast: PhysicalAction | null = (actor === "hero" || actor === "keeper") && verb !== "none" ? { kind: "action", actor, verb: verb as Verb, target: targetEntity.choice, ...(destinationEntity.choice !== NONE ? { destination: destinationEntity.choice } : {}), ...(instrumentEntity.choice !== NONE ? { instrument: instrumentEntity.choice } : {}) } : null;
    if (!clause || anchor.start < clause.charStart || anchor.end > clause.charEnd) issues.push(`${anchor.id}:invalid_clause_anchor`);
    if (actorExplicit >= 0.5 && !actorSource) issues.push(`${anchor.id}:missing_explicit_actor_source`);
    if (actorAnswer.confidence < MIN_FIELD_CONFIDENCE || actor === "unclear") issues.push(`${anchor.id}:uncertain_actor`);
    if (verbAnswer.confidence < MIN_FIELD_CONFIDENCE || verb === "none") issues.push(`${anchor.id}:uncertain_verb`);
    if (duration.confidence < MIN_FIELD_CONFIDENCE || duration.choice === "unclear") issues.push(`${anchor.id}:uncertain_duration`);
    if (targetEntity.confidence < MIN_FIELD_CONFIDENCE || targetEntity.choice === NONE) issues.push(`${anchor.id}:uncertain_target_entity`);
    if (targetReference.choice !== "implicit_context" && !targetSource) issues.push(`${anchor.id}:missing_target_source`);
    if (!destinationSource && destinationEntity.choice !== NONE) issues.push(`${anchor.id}:destination_without_source`);
    if (!instrumentSource && instrumentEntity.choice !== NONE) issues.push(`${anchor.id}:instrument_without_source`);
    if (destinationEntity.choice !== NONE && destinationEntity.confidence < MIN_FIELD_CONFIDENCE) issues.push(`${anchor.id}:uncertain_destination_entity`);
    if (instrumentEntity.choice !== NONE && instrumentEntity.confidence < MIN_FIELD_CONFIDENCE) issues.push(`${anchor.id}:uncertain_instrument_entity`);
    if (destinationEntity.choice === targetEntity.choice && destinationEntity.choice !== NONE) issues.push(`${anchor.id}:target_destination_role_collision`);
    if (instrumentEntity.choice === targetEntity.choice && instrumentEntity.choice !== NONE) issues.push(`${anchor.id}:target_instrument_role_collision`);
    return { anchor: { id: anchor.id, text: anchor.text, chars: [anchor.start, anchor.end] as [number, number], probability: anchor.probability }, clause: sourceRef(clause), actor: { value: actor, confidence: actorAnswer.confidence, explicitProbability: actorExplicit, source: sourceRef(actorSource) }, verb: { value: verb, confidence: verbAnswer.confidence }, duration: { value: duration.choice, confidence: duration.confidence }, target: { entity: targetEntity.choice, confidence: targetEntity.confidence, reference: targetReference.choice, source: sourceRef(targetSource) }, destination: { entity: destinationEntity.choice, confidence: destinationEntity.confidence, source: sourceRef(destinationSource) }, instrument: { entity: instrumentEntity.choice, confidence: instrumentEntity.confidence, source: sourceRef(instrumentSource) }, ast };
  });
  const clauseKeys = actions.flatMap((action) => action.clause ? [`${action.clause.chars[0]}:${action.clause.chars[1]}`] : []);
  if (new Set(clauseKeys).size !== clauseKeys.length) issues.push("duplicate_action_clause");
  const physical = actions.flatMap((action) => action.ast ? [action.ast] : []);
  if (physical.length !== selected.actionAnchors.length) issues.push("incomplete_action_ast");
  const compositionAnswer = getChoice(phaseOne.answers, "composition"); const hasParallel = getNoul(phaseOne.answers, "has_parallel");
  const composedAsParallel = physical.length > 1 && hasParallel >= 0.5;
  if (physical.length > 1 && !composedAsParallel && compositionAnswer.confidence < MIN_FIELD_CONFIDENCE) issues.push("uncertain_composition");
  if (compositionAnswer.choice === "parallel" && hasParallel < 0.5) issues.push("parallel_judgment_disagrees");
  if (compositionAnswer.choice === "mixed" || compositionAnswer.choice === "unclear") issues.push("unsupported_composition_shape");
  let body: ProgramNode | null = physical.length === 1 ? physical[0] : physical.length > 1 ? { kind: composedAsParallel ? "parallel" : "sequence", children: physical } : null;
  let condition: null | Record<string, unknown> = null;
  if (selected.conditionAnchor) {
    const clause = selectedSpan(phaseTwo.answers, spanMap, "condition_clause"); const subject = selectedSpan(phaseTwo.answers, spanMap, "condition_subject_source"); const valueSource = selectedSpan(phaseTwo.answers, spanMap, "condition_value_source");
    const entity = getChoice(phaseTwo.answers, "condition_entity"); const property = getChoice(phaseTwo.answers, "condition_property"); const valueEntity = getChoice(phaseTwo.answers, "condition_value_entity"); const comparisonAnswer = getChoice(phaseTwo.answers, "condition_comparison");
    const predicate: Predicate = { kind: "property", entity: entity.choice, property: property.choice, comparison: comparison(comparisonAnswer.choice), value: valueEntity.choice, source: "visible" };
    if (!clause || selected.conditionAnchor.start < clause.charStart || selected.conditionAnchor.end > clause.charEnd) issues.push("invalid_condition_clause_anchor");
    if (!subject || !valueSource) issues.push("missing_condition_source_span");
    for (const [name, answer] of [["entity", entity], ["property", property], ["value", valueEntity], ["comparison", comparisonAnswer]] as const) if (answer.confidence < MIN_FIELD_CONFIDENCE || answer.choice === "unclear") issues.push(`uncertain_condition_${name}`);
    if (body) body = { kind: "if", condition: predicate, then: body };
    condition = { anchor: { id: selected.conditionAnchor.id, text: selected.conditionAnchor.text, chars: [selected.conditionAnchor.start, selected.conditionAnchor.end], probability: selected.conditionAnchor.probability }, clause: sourceRef(clause), subject: sourceRef(subject), valueSource: sourceRef(valueSource), predicate, confidences: { entity: entity.confidence, property: property.confidence, value: valueEntity.confidence, comparison: comparisonAnswer.confidence } };
  }
  const accepted = issues.length === 0 && body !== null;
  return { input: text, indexedTokens: tokens, model: phaseTwo.model, metrics, phaseOne: { actionCount: { choice: selected.countChoice, confidence: getChoice(phaseOne.answers, "action_count").confidence }, composition: { choice: compositionAnswer.choice, confidence: compositionAnswer.confidence }, hasCondition: getNoul(phaseOne.answers, "has_condition"), hasParallel, actionAnchors: selected.actionAnchors.map((anchor) => ({ id: anchor.id, text: anchor.text, probability: anchor.probability })), conditionAnchor: selected.conditionAnchor && { id: selected.conditionAnchor.id, text: selected.conditionAnchor.text, probability: selected.conditionAnchor.probability } }, actions, condition, qualityGate: { accepted, issues: [...new Set(issues)] }, program: accepted ? body : null, candidateProgram: body };
}

async function readApiKey(): Promise<string> {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  const source = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  const line = source.split(/\r?\n/u).find((candidate) => candidate.startsWith("TYPESAFE_API_KEY="));
  const value = line?.slice("TYPESAFE_API_KEY=".length).trim().replace(/^(['"])(.*)\1$/u, "$2");
  if (!value) throw new Error(".env.local에 TYPESAFE_API_KEY가 없습니다."); return value;
}
async function callJev(apiKey: string, state: Record<string, unknown>, questions: Record<string, Question>) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS); const started = performance.now();
  try {
    const httpResponse = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ state, model: MODEL, questions }), signal: controller.signal });
    if (!httpResponse.ok) { const safeBody = (await httpResponse.text()).slice(0, 500); throw new Error(`TypeSafe HTTP ${httpResponse.status}: ${safeBody}`); }
    const response = await httpResponse.json() as ApiResponse;
    return { response, metrics: { latencyMs: Math.round(performance.now() - started), inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
  } finally { clearTimeout(timer); }
}
async function evaluate(apiKey: string, text: string) {
  const tokens = tokenize(text); const spans = makeSpans(text, tokens);
  const baseState = { instruction: text, indexed_tokens: tokens, visible_entities: ENTITIES, actor_aliases: { hero: "나/내가/나는/생략된 명령 수신자", keeper: "인형" }, task_boundary: "퍼즐을 풀지 말고 사용자가 명시한 행동 구조와 참조만 해석한다. 엔티티는 visible_entities에서만 고른다." };
  const first = await callJev(apiKey, baseState, phaseOneQuestions(tokens)); const selected = selectAnchors(tokens, first.response.answers);
  const secondState = { ...baseState, selected_action_anchors: selected.actionAnchors, selected_condition_anchor: selected.conditionAnchor, phase_boundary: "각 질문은 지정된 anchor 하나만 해석한다. 다른 anchor의 행동과 논항을 섞지 않는다." };
  const second = await callJev(apiKey, secondState, phaseTwoQuestions(selected.actionAnchors, selected.conditionAnchor, spans));
  return compose(text, tokens, spans, first.response, second.response, { phaseOne: first.metrics, phaseTwo: second.metrics });
}
async function main() {
  const apiKey = await readApiKey(); const results = [];
  const requestedCase = process.argv[2];
  const selectedCases = requestedCase ? CASES.filter((testCase) => testCase.id === requestedCase) : CASES;
  if (selectedCases.length === 0) throw new Error(`알 수 없는 probe case: ${requestedCase}`);
  for (const testCase of selectedCases) results.push({ id: testCase.id, ...await evaluate(apiKey, testCase.text) });
  const totals = results.reduce((sum, item) => ({ requests: sum.requests + 2, inputTokens: sum.inputTokens + item.metrics.phaseOne.inputTokens + item.metrics.phaseTwo.inputTokens, outputTokens: sum.outputTokens + item.metrics.phaseOne.outputTokens + item.metrics.phaseTwo.outputTokens, latencyMs: sum.latencyMs + item.metrics.phaseOne.latencyMs + item.metrics.phaseTwo.latencyMs, accepted: sum.accepted + (item.qualityGate.accepted ? 1 : 0) }), { requests: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, accepted: 0 });
  console.log(JSON.stringify({ probe: "campaign-jev-composition-v2-two-phase", totals, results }, null, 2));
}

await main();
