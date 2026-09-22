import { describe, expect, it } from "vitest";
import { copyArchivedProgram, createNotebook, deleteProgram, departNotebook, rewindNotebook, visitBookmark, writeProgram } from "../src/campaign/notebook";
import type { InstructionProgram } from "../src/campaign/types";
const program = (id: string): InstructionProgram => ({ id, version: 2, text: "상자를 밀어", model: "test-fixture", scope: {}, guard: false, body: { kind: "action", actor: "hero", verb: "push", target: "box" } });
describe("campaign notebook economy", () => {
  it("deduplicates discovery grants across rewind and does not stack them", () => {
    let book = createNotebook("02-1");
    book = writeProgram(book, program("one"));
    expect(visitBookmark(book, "02-1").canWrite).toBe(false);
    book = visitBookmark(book, "02-2");
    book = writeProgram(book, program("two"));
    book = rewindNotebook(book);
    book = writeProgram(book, program("three"));
    expect(visitBookmark(book, "02-2").canWrite).toBe(false);
    expect(book.bells).toBe(1);
  });
  it("charges edits atomically and switches to three bells after two erasers", () => {
    let book = writeProgram(createNotebook("02-1"), program("one"));
    for (let edit = 0; edit < 3; edit++) {
      book = rewindNotebook(book);
      book = writeProgram(book, program("one"), "one");
    }
    expect(book.erasers).toBe(0);
    expect(book.bells).toBe(6);
    expect(book.canWrite).toBe(false);
    expect(book.instructions).toHaveLength(1);
  });
  it("rejects stale edits and over-limit input without spending resources", () => {
    const book = createNotebook("02-1");
    expect(() => writeProgram(book, program("one"), "missing")).toThrow();
    expect(() => writeProgram(book, { ...program("one"), text: "🌙".repeat(501) })).toThrow();
    expect(book.erasers).toBe(2);
    expect(book.canWrite).toBe(true);
    expect(writeProgram(book, { ...program("one"), text: "  " + "🌙".repeat(500) + "  " }).instructions[0].text).toBe("🌙".repeat(500));
  });
  it("locks editing during active execution and free archive copy after first departure", () => {
    const source = program("one");
    let book = copyArchivedProgram(createNotebook("02-1"), source);
    source.text = "changed outside";
    expect(book.instructions[0].text).toBe("상자를 밀어");
    expect(book.canWrite).toBe(true);
    book = departNotebook(book);
    expect(() => deleteProgram(book, "one")).toThrow();
    book = rewindNotebook(book);
    expect(() => copyArchivedProgram(book, program("two"))).toThrow();
  });
});
