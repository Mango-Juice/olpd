import { describe, expect, it } from "vitest";
import {
  createNotebook,
  deleteProgram,
  departNotebook,
  killNotebook,
  moveProgram,
  retryNotebook,
  writeProgram,
} from "../src/campaign/notebook";
import type { InstructionProgram } from "../src/campaign/types";

const program = (id: string): InstructionProgram => ({
  id,
  version: 2,
  text: `${id} 메모`,
  model: "test-fixture",
  scope: {},
  guard: false,
  body: { kind: "action", actor: "hero", verb: "push", target: "box" },
});

describe("shared notebook economy", () => {
  it("starts with one line, appends only after death, and consumes an unused grant on retry", () => {
    let book = writeProgram(createNotebook(), program("one"));
    expect(book.canWrite).toBe(false);
    expect(() => writeProgram(book, program("two"))).toThrow("새 한 줄");
    book = killNotebook(departNotebook(book));
    book = writeProgram(book, program("two"));
    expect(book.instructions.map((item) => item.id)).toEqual(["one", "two"]);
    book = retryNotebook(killNotebook(departNotebook(book)));
    expect(book.canWrite).toBe(false);
  });

  it("never overwrites an existing line", () => {
    const book = writeProgram(createNotebook(), program("one"));
    expect(() => writeProgram(killNotebook(book), program("replacement"), "one")).toThrow("덮어쓸 수 없어요");
  });

  it("deletes only after death and charges two erasers then three penalty deaths", () => {
    let book = writeProgram(createNotebook(), program("one"));
    expect(() => deleteProgram(book, "one")).toThrow("죽은 뒤");
    book = deleteProgram(killNotebook(book), "one");
    book = writeProgram(book, program("two"));
    book = deleteProgram(killNotebook(book), "two");
    book = writeProgram(book, program("three"));
    book = deleteProgram(killNotebook(book), "three");
    expect(book).toMatchObject({ erasers: 0, penaltyDeaths: 3, canWrite: true });
  });

  it("stores low-to-high priority and moves toward the visible top", () => {
    let book = writeProgram(createNotebook(), program("low"));
    book = writeProgram(killNotebook(book), program("high"));
    expect([...book.instructions].reverse().map((item) => item.id)).toEqual(["high", "low"]);
    book = moveProgram(book, "low", "up");
    expect([...book.instructions].reverse().map((item) => item.id)).toEqual(["low", "high"]);
  });

  it("rejects different actions for the same normalized selector and condition", () => {
    const first = {
      ...program("one"),
      bindings: { box: { kind: "public-kind" as const, value: "crate" } },
    };
    let book = writeProgram(createNotebook(), first);
    book = killNotebook(book);
    const conflict = {
      ...program("two"),
      bindings: { another: { kind: "public-kind" as const, value: "crate" } },
      body: { kind: "action" as const, actor: "hero" as const, verb: "pull" as const, target: "another" },
    };
    expect(() => writeProgram(book, conflict)).toThrow("조건이 같지만 행동이 달라요");
  });
});
