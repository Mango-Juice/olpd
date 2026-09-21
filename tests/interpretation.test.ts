import { describe, expect, it } from "vitest";
import { isInterpretation } from "../src/game/interpretation";
const valid = {
  action: "jump",
  appliesTo: ["pit", "bridge"],
  uncertainty: 0.2,
  model: "jev-1.13.0",
  rulesVersion: "1",
};
describe("browser interpretation trust boundary", () => {
  it("accepts a versioned confident result", () =>
    expect(isInterpretation(valid)).toBe(true));
  it.each([
    null,
    {},
    { ...valid, appliesTo: ["unknown"] },
    { ...valid, appliesTo: ["pit", "pit"] },
    { ...valid, uncertainty: NaN },
    { ...valid, uncertainty: 0.49 },
    { ...valid, model: "" },
    { ...valid, rulesVersion: "other" },
  ])("rejects malformed/uncertain data before rendering %j", (value) =>
    expect(isInterpretation(value)).toBe(false),
  );
});
