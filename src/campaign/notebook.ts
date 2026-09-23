import {
  MEMORY_INITIAL_ERASERS,
  appendMemory,
  consumeMemoryWrite,
  deleteMemory,
  grantMemoryWrite,
  moveMemory,
  placeMemory,
} from "../game/memory.js";
import type { InstructionProgram } from "./types";

export const CAMPAIGN_INPUT_LIMIT = 500;

export interface Notebook {
  /** Persisted low-to-high. The player-facing notebook renders this in reverse. */
  instructions: InstructionProgram[];
  canWrite: boolean;
  erasers: number;
  penaltyDeaths: number;
  deaths: number;
  departed: boolean;
  editing: boolean;
  /** Deletion is a post-death action, never a free ready-state edit. */
  canDelete: boolean;
}

export function createNotebook(): Notebook {
  return {
    instructions: [],
    canWrite: true,
    erasers: MEMORY_INITIAL_ERASERS,
    penaltyDeaths: 0,
    deaths: 0,
    departed: false,
    editing: true,
    canDelete: false,
  };
}

export function departNotebook(book: Notebook): Notebook {
  return {
    ...consumeMemoryWrite(book),
    departed: true,
    editing: false,
    canDelete: false,
  };
}

/** A fatal outcome grants exactly one append opportunity while preserving the notebook. */
export function killNotebook(book: Notebook): Notebook {
  return {
    ...grantMemoryWrite(book),
    deaths: book.deaths + 1,
    editing: true,
    canDelete: true,
  };
}

/** Retry consumes an unused grant and returns the same accumulated notebook to the entrance. */
export function retryNotebook(book: Notebook): Notebook {
  return {
    ...consumeMemoryWrite(book),
    departed: false,
    editing: true,
    canDelete: false,
  };
}

function assertEditable(book: Notebook): void {
  if (!book.editing) throw new Error("행동이나 대기 중에는 메모를 바꿀 수 없어요.");
}

function canonicalId(program: InstructionProgram, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const binding = program.bindings?.[id];
  return binding ? `${binding.kind}:${binding.value}` : `literal:${id}`;
}

function canonicalPredicate(program: InstructionProgram, predicate: NonNullable<InstructionProgram["condition"]>): unknown {
  if (predicate.kind === "property" || predicate.kind === "visible") return { ...predicate, entity: canonicalId(program, predicate.entity) };
  if (predicate.kind === "not") return { kind: "not", predicate: canonicalPredicate(program, predicate.predicate) };
  return {
    kind: predicate.kind,
    predicates: predicate.predicates.map((item) => canonicalPredicate(program, item))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  };
}

function canonicalNode(program: InstructionProgram, node: InstructionProgram["body"]): unknown {
  if (node.kind === "action") {
    return {
      ...node,
      target: canonicalId(program, node.target),
      destination: canonicalId(program, node.destination),
      instrument: canonicalId(program, node.instrument),
      references: node.references && Object.fromEntries(Object.entries(node.references).map(([role, reference]) =>
        [role, { ...reference, entity: canonicalId(program, reference!.entity) }])),
    };
  }
  if (node.kind === "wait") return { kind: "wait", until: canonicalPredicate(program, node.until) };
  if (node.kind === "until") return { kind: "until", condition: canonicalPredicate(program, node.condition), body: canonicalNode(program, node.body) };
  if (node.kind === "if") return { kind: "if", condition: canonicalPredicate(program, node.condition), then: canonicalNode(program, node.then), otherwise: node.otherwise && canonicalNode(program, node.otherwise) };
  return { kind: node.kind, children: node.children.map((child) => canonicalNode(program, child)) };
}

function selectorSignature(program: InstructionProgram): string[] {
  const ids = new Set<string>();
  const add = (id: string | undefined) => {
    const canonical = canonicalId(program, id);
    if (canonical) ids.add(canonical);
  };
  const predicate = (value: NonNullable<InstructionProgram["condition"]>) => {
    if (value.kind === "property" || value.kind === "visible") add(value.entity);
    else if (value.kind === "not") predicate(value.predicate);
    else value.predicates.forEach(predicate);
  };
  const node = (value: InstructionProgram["body"]) => {
    if (value.kind === "action") {
      add(value.target); add(value.destination); add(value.instrument);
      Object.values(value.references ?? {}).forEach((reference) => add(reference?.entity));
    } else if (value.kind === "wait") predicate(value.until);
    else if (value.kind === "until") { predicate(value.condition); node(value.body); }
    else if (value.kind === "if") { predicate(value.condition); node(value.then); if (value.otherwise) node(value.otherwise); }
    else value.children.forEach(node);
  };
  if (program.condition) predicate(program.condition);
  node(program.body);
  return [...ids].sort();
}

function applicabilitySignature(program: InstructionProgram): string {
  return JSON.stringify({
    scope: { stageId: program.scope.stageId ?? null, region: program.scope.region ?? null },
    selectors: selectorSignature(program),
    condition: program.condition ? canonicalPredicate(program, program.condition) : null,
  });
}

function behaviorSignature(program: InstructionProgram): string {
  return JSON.stringify({ guard: program.guard, body: canonicalNode(program, program.body) });
}

function protectsSharedApplicability(program: InstructionProgram): boolean {
  return program.scope.region === undefined && !!program.bindings && Object.keys(program.bindings).length > 0;
}

/** Append-only. A bad interpretation must be rejected before this function is called. */
export function writeProgram(
  book: Notebook,
  program: InstructionProgram,
  replaceId?: string,
): Notebook {
  assertEditable(book);
  if (replaceId !== undefined) throw new Error("기존 메모는 덮어쓸 수 없어요. 지운 뒤 새 생에서 한 줄을 남겨 주세요.");
  const normalized = { ...structuredClone(program), text: program.text.trim() };
  if (!normalized.text || [...normalized.text].length > CAMPAIGN_INPUT_LIMIT) {
    throw new Error("한 줄은 1~500자로 적어 주세요.");
  }
  if (book.instructions.some((item) => item.id === normalized.id)) {
    throw new Error("같은 메모가 이미 있어요.");
  }
  const conflict = protectsSharedApplicability(normalized) && book.instructions.find((item) =>
    protectsSharedApplicability(item)
    && applicabilitySignature(item) === applicabilitySignature(normalized)
    && behaviorSignature(item) !== behaviorSignature(normalized));
  if (conflict) {
    throw new Error(`기존 메모 “${conflict.text}”와 조건이 같지만 행동이 달라요. 조건을 바꾸거나 기존 메모를 지워 주세요.`);
  }
  return appendMemory(book, normalized);
}

export function deleteProgram(book: Notebook, id: string): Notebook {
  assertEditable(book);
  if (!book.canDelete) throw new Error("죽은 뒤에만 기억을 지울 수 있어요.");
  return deleteMemory<InstructionProgram, Notebook>(book, id, (item) => item.id).state;
}

/** One-slot movement; up means toward the visible top. */
export function moveProgram(book: Notebook, id: string, direction: "up" | "down"): Notebook {
  assertEditable(book);
  return moveMemory<InstructionProgram, Notebook>(book, id, direction, (item) => item.id);
}

/** Places around another item in the high-to-low order shown in the UI. */
export function placeProgram(
  book: Notebook,
  id: string,
  targetId: string,
  position: "before" | "after",
): Notebook {
  assertEditable(book);
  return placeMemory<InstructionProgram, Notebook>(book, id, targetId, position, (item) => item.id);
}
