import { describe, expect, it } from "vitest";
import { isNumericallyCorrect, parseNumber } from "./grading";

describe("parseNumber", () => {
  it.each([
    ["0.25", 0.25], ["1/4", 0.25], ["25%", 0.25], ["2.5e-3", 0.0025], ["−3", -3], ["1,000", 1000], [".5", 0.5],
  ])("parses %s", (input, expected) => {
    expect(parseNumber(input)).toBeCloseTo(expected, 12);
  });

  it.each(["", "abc", "1/0", "2x", "1..2"])("rejects %s", (input) => {
    expect(parseNumber(input)).toBeNull();
  });
});

describe("isNumericallyCorrect", () => {
  it("uses absolute tolerance when provided", () => {
    expect(isNumericallyCorrect("0.88", 0.881, 0.01)).toBe(true);
    expect(isNumericallyCorrect("0.86", 0.881, 0.01)).toBe(false);
  });

  it("defaults to 1% relative tolerance", () => {
    expect(isNumericallyCorrect("100.9", 100, null)).toBe(true);
    expect(isNumericallyCorrect("102", 100, null)).toBe(false);
    expect(isNumericallyCorrect("3/4", 0.75, null)).toBe(true);
  });
});
