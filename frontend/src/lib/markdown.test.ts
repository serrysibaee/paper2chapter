import { describe, expect, it } from "vitest";
import { preprocess, type MarkdownContext } from "./markdown";

const ctx: MarkdownContext = {
  paperId: "abc",
  references: [{ id: "R1", number: 7, text: "A. Author. Title." }, { id: "R2", number: null, text: "B" }],
  figures: [{ id: "F1", page: 3, caption: "Figure 1: [weird] caption", image_file: "F1.png", width: 10, height: 10 }],
  tables: [{ id: "T1", page: 2, caption: "Table 1: results", markdown: "|a|b|\n|---|---|\n|1|2|" }],
};

describe("preprocess", () => {
  it("links references by their printed number and pages to the PDF", () => {
    const out = preprocess("See [@R1] and [@p4].", ctx);
    expect(out).toContain("[7](#ref-R1)");
    expect(out).toContain("(cite:p4)");
  });

  it("handles grouped citations and falls back to list position", () => {
    expect(preprocess("[@R1; @R2]", ctx)).toBe("\\[[7](#ref-R1), [2](#ref-R2)\\]");
  });

  it("flags unresolved and unknown citations", () => {
    expect(preprocess("[@?R9]", ctx)).toContain("(cite:unresolved)");
    expect(preprocess("[@R42]", ctx)).toContain("(cite:unresolved)");
  });

  it("expands figure and table placeholders, dropping unknown ones", () => {
    const out = preprocess("{{fig:F1}}\n{{table:T1}}\n{{fig:F9}}", ctx);
    expect(out).toContain("![Figure 1: weird caption](figure:F1)");
    expect(out).toContain("|1|2|");
    expect(out).toContain("*Table 1: results (paper p. 2)*");
    expect(out).not.toContain("F9");
  });

  it("leaves math alone", () => {
    expect(preprocess("$x_{[i]}$ and $$a^2$$", ctx)).toBe("$x_{[i]}$ and $$a^2$$");
  });
});
