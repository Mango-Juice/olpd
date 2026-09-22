import { expect, it } from "vitest";
import { parseProgram } from "../src/campaign/validation";
const valid = { version: 2, id: "p", text: "상자를 밀어", model: "fixture", scope: {}, guard: false, body: { kind: "action", actor: "hero", verb: "push", target: "box" } };
it("accepts physical intent without judging it safe and returns a detached value", () => {
  const result = parseProgram(valid);
  expect(result).toEqual(valid);
  expect(result).not.toBe(valid);
});
it("rejects invented capabilities, hidden completion fields, and malformed bounds", () => {
  expect(parseProgram({ ...valid, body: { ...valid.body, verb: "teleport" } })).toBeNull();
  expect(parseProgram({ ...valid, unlockStage: 10 })).toBeNull();
  expect(parseProgram({ ...valid, body: { ...valid.body, amount: Infinity } })).toBeNull();
  expect(parseProgram({ ...valid, scope: { stageId: 11 } })).toBeNull();
});
it("rejects recursive or excessive structures rather than overflowing", () => {
  const recursive: Record<string, unknown> = { kind: "sequence" };
  recursive.children = [recursive];
  expect(parseProgram({ ...valid, body: recursive })).toBeNull();
});
