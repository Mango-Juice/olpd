import type { InstructionProgram } from "./types";

export const CAMPAIGN_INPUT_LIMIT = 500;
export interface Notebook {
  /** Highest priority first, matching the visible notebook. */
  instructions: InstructionProgram[];
  canWrite: boolean;
  erasers: number;
  bells: number;
  departed: boolean;
  editing: boolean;
  /** Lives outside the rewind snapshot; initial segment includes the first free line. */
  visitedBookmarks: string[];
  /** Only the instruction rejected as impossible may be repaired or removed free. */
  clarificationId?: string;
  /** Refundable edit charges, keyed by the resulting instruction identity. */
  writeCosts?: Record<string, { erasers: number; bells: number }>;
  /** Onboarding owns one temporary line whose edits and resets never spend campaign resources. */
  scratch?: boolean;
}
export function createNotebook(firstSegment: string, scratch = false): Notebook {
  return { instructions: [], canWrite: true, erasers: 2, bells: 0, departed: false, editing: true, visitedBookmarks: [firstSegment], ...(scratch ? { scratch: true } : {}) };
}
export function visitBookmark(book: Notebook, segment: string): Notebook {
  if (book.visitedBookmarks.includes(segment)) return book;
  return { ...book, canWrite: true, editing: true, visitedBookmarks: [...book.visitedBookmarks, segment] };
}
export function departNotebook(book: Notebook): Notebook {
  if (book.clarificationId) throw new Error("뜻을 확인할 메모를 먼저 고치거나 지워 주세요.");
  return { ...book, departed: true, editing: false, canWrite: false };
}
export function rewindNotebook(book: Notebook): Notebook {
  return { ...book, bells: book.bells + (book.scratch ? 0 : 1), canWrite: true, editing: true };
}
export function clarifyNotebook(book: Notebook, instructionId: string): Notebook {
  if (!book.instructions.some((item) => item.id === instructionId)) throw new Error("확인할 메모를 찾을 수 없어요.");
  const costs = { ...book.writeCosts };
  const refund = costs[instructionId];
  delete costs[instructionId];
  return { ...book, clarificationId: instructionId, writeCosts: costs, editing: true, canWrite: true,
    erasers: Math.min(2, book.erasers + (refund?.erasers ?? 0)), bells: Math.max(0, book.bells - (refund?.bells ?? 0)) };
}
function assertEditable(book: Notebook): void {
  if (!book.editing) throw new Error("행동이나 대기 중에는 메모를 바꿀 수 없어요.");
}
function deletionCost(book: Notebook): Pick<Notebook, "erasers" | "bells"> {
  return book.erasers > 0 ? { erasers: book.erasers - 1, bells: book.bells } : { erasers: 0, bells: book.bells + 3 };
}
/** Call only after interpretation and explicit intent confirmation. Errors charge nothing. */
export function writeProgram(book: Notebook, program: InstructionProgram, replaceId?: string): Notebook {
  assertEditable(book);
  if (!book.canWrite) throw new Error("새 한 줄 기회가 없어요.");
  if (book.clarificationId && replaceId !== book.clarificationId) throw new Error("뜻을 확인할 메모 한 줄을 무료로 고칠 수 있어요.");
  const normalized = { ...structuredClone(program), text: program.text.trim() };
  if (!normalized.text || [...normalized.text].length > CAMPAIGN_INPUT_LIMIT) throw new Error("한 줄은 1~500자로 적어 주세요.");
  const index = replaceId === undefined ? -1 : book.instructions.findIndex((item) => item.id === replaceId);
  if (replaceId !== undefined && index < 0) throw new Error("수정할 메모를 찾을 수 없어요.");
  if (book.scratch && index < 0 && book.instructions.length > 0) throw new Error("도입에서는 임시 한 줄만 쓸 수 있어요.");
  if (book.instructions.some((item, position) => item.id === program.id && position !== index)) throw new Error("같은 메모가 이미 있어요.");
  const instructions = book.instructions.map((item) => structuredClone(item));
  if (index < 0) instructions.unshift(normalized);
  else instructions[index] = normalized;
  const cost = book.scratch || index < 0 || replaceId === book.clarificationId ? { erasers: book.erasers, bells: book.bells } : deletionCost(book);
  const writeCosts = { ...book.writeCosts };
  if (replaceId) delete writeCosts[replaceId];
  writeCosts[program.id] = { erasers: book.erasers - cost.erasers, bells: cost.bells - book.bells };
  return { ...book, ...cost, instructions, writeCosts, clarificationId: undefined, canWrite: book.scratch ? true : false };
}
export function deleteProgram(book: Notebook, id: string): Notebook {
  assertEditable(book);
  if (!book.instructions.some((item) => item.id === id)) return book;
  if (book.clarificationId && book.clarificationId !== id) throw new Error("뜻을 확인할 메모를 먼저 고치거나 지워 주세요.");
  const free = book.scratch || book.clarificationId === id;
  const writeCosts = { ...book.writeCosts };
  delete writeCosts[id];
  return { ...book, ...(free ? {} : deletionCost(book)), writeCosts, clarificationId: undefined, canWrite: book.scratch ? true : book.canWrite, instructions: book.instructions.filter((item) => item.id !== id) };
}
export function reorderProgram(book: Notebook, id: string, position: number): Notebook {
  assertEditable(book);
  const index = book.instructions.findIndex((item) => item.id === id);
  if (index < 0 || !Number.isInteger(position) || position < 0 || position >= book.instructions.length || index === position) return book;
  const instructions = [...book.instructions];
  const [item] = instructions.splice(index, 1);
  instructions.splice(position, 0, item);
  return { ...book, instructions };
}
export function copyArchivedProgram(book: Notebook, program: InstructionProgram): Notebook {
  assertEditable(book);
  if (book.scratch) throw new Error("본편 메모는 도입의 임시 한 줄로 가져올 수 없어요.");
  if (book.departed) throw new Error("보관한 메모는 이 장의 첫 출발 전에만 복사할 수 있어요.");
  if (book.instructions.some((item) => item.id === program.id)) return book;
  return { ...book, instructions: [...book.instructions, structuredClone(program)] };
}
