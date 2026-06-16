import { describe, expect, it } from "vitest";
import { blockPlainText, inlineText, parseInline, parseMarkdown } from "./parse";

describe("parseMarkdown", () => {
  it("parses headings at three levels", () => {
    const blocks = parseMarkdown("# Title\n## Sub\n### Small");
    expect(blocks.map((b) => b.kind)).toEqual(["h1", "h2", "h3"]);
    expect(blocks.map((b) => inlineText(b.inline))).toEqual(["Title", "Sub", "Small"]);
  });

  it("keeps single newlines as hard breaks and splits paragraphs on blank lines", () => {
    const blocks = parseMarkdown("one\ntwo\n\nthree");
    expect(blocks).toHaveLength(2);
    expect(inlineText(blocks[0].inline)).toBe("one\ntwo");
    expect(inlineText(blocks[1].inline)).toBe("three");
  });

  it("parses bullet and ordered list items", () => {
    const blocks = parseMarkdown("- a\n* b\n1. first\n2) second");
    expect(blocks.map((b) => b.kind)).toEqual(["li", "li", "li", "li"]);
    expect(blocks.map((b) => b.ordinal)).toEqual([undefined, undefined, 1, 2]);
  });

  it("flushes a pending paragraph before a heading or list", () => {
    const blocks = parseMarkdown("intro line\n# Heading\n- item");
    expect(blocks.map((b) => b.kind)).toEqual(["p", "h1", "li"]);
  });

  it("ignores trailing whitespace and blank-only lines", () => {
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });
});

describe("parseInline", () => {
  it("tokenizes bold, italic, code and links", () => {
    expect(parseInline("a **b** _c_ `d` [e](http://x)")).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", text: "b" },
      { kind: "text", text: " " },
      { kind: "em", text: "c" },
      { kind: "text", text: " " },
      { kind: "code", text: "d" },
      { kind: "text", text: " " },
      { kind: "link", text: "e", href: "http://x" },
    ]);
  });

  it("keeps unmatched markers as plain text", () => {
    expect(parseInline("just text")).toEqual([{ kind: "text", text: "just text" }]);
  });

  it("flattens to plain text", () => {
    expect(inlineText(parseInline("**bold** and _it_"))).toBe("bold and it");
  });
});

describe("blockPlainText", () => {
  it("prefixes ordered and bullet list items", () => {
    const [ordered, bullet] = parseMarkdown("1. first\n- second");
    expect(blockPlainText(ordered)).toBe("1. first");
    expect(blockPlainText(bullet)).toBe("• second");
  });

  it("leaves paragraphs unprefixed", () => {
    const [p] = parseMarkdown("plain");
    expect(blockPlainText(p)).toBe("plain");
  });
});
