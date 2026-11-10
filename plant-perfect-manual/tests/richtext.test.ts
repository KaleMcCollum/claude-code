import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/permissions";
import { docToText, isEmptyDoc, safeHref, sanitizeDoc } from "@/lib/richtext";

describe("checking rich text before it is saved", () => {
  it("leaves a normal document exactly as it is", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Wages" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Coffee staff start at " },
            { type: "text", text: "$13.00/hr", marks: [{ type: "bold" }] },
            { type: "hardBreak" },
            { type: "text", text: "see ", marks: [{ type: "italic" }, { type: "underline" }] },
            { type: "text", text: "the policy", marks: [{ type: "link", attrs: { href: "https://example.com/p" } }] },
          ],
        },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }],
        },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "three" }] }] }],
        },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Garden Center" }] }] },
                { type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Coffee Shop" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: "$15" }] }] },
                { type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph" }] },
              ],
            },
          ],
        },
      ],
    };
    expect(sanitizeDoc(structuredClone(doc))).toEqual(doc);
    expect(docToText(sanitizeDoc(doc))).toBe(
      "Wages\nCoffee staff start at $13.00/hr\nsee the policy\none\nthree\ndone\nGarden Center\tCoffee Shop\n$15",
    );
  });

  it("never changes the words, whatever they are", () => {
    const text = "<script>alert('x')</script>  & \"quotes\"   multiple   spaces  emoji 🌱";
    const cleaned = sanitizeDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    expect(cleaned.content[0].content?.[0].text).toBe(text);
  });

  it("drops unsafe links but keeps their words", () => {
    for (const href of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "//evil.example", "", 42]) {
      const cleaned = sanitizeDoc({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "words", marks: [{ type: "link", attrs: { href } }] }] }],
      });
      expect(cleaned.content[0].content?.[0]).toEqual({ type: "text", text: "words" });
    }
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("mailto:someone@example.com")).toBe("mailto:someone@example.com");
    expect(safeHref("tel:+17015550100")).toBe("tel:+17015550100");
  });

  it("drops unknown formatting, attributes and block types", () => {
    const cleaned = sanitizeDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { style: "position:fixed", onclick: "x()" },
          content: [{ type: "text", text: "hello", marks: [{ type: "highlight", attrs: { color: "red" } }, { type: "bold", attrs: { x: 1 } }] }],
        },
        { type: "iframe", attrs: { src: "https://evil.example" } },
        { type: "heading", attrs: { level: 9 }, content: [{ type: "text", text: "big" }] },
        "not a node",
        null,
      ],
    });
    expect(cleaned).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello", marks: [{ type: "bold" }] }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "big" }] },
      ],
    });
  });

  it("refuses things that are not documents, or are far too large", () => {
    expect(() => sanitizeDoc(null)).toThrow(AppError);
    expect(() => sanitizeDoc("<p>html</p>")).toThrow(AppError);
    expect(() => sanitizeDoc({ type: "paragraph" })).toThrow(AppError);
    const huge = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(400_000) }] }] };
    expect(() => sanitizeDoc(huge)).toThrow("too long");
  });

  it("knows when a document is empty", () => {
    expect(isEmptyDoc(null)).toBe(true);
    expect(isEmptyDoc(sanitizeDoc({ type: "doc" }))).toBe(true);
    expect(isEmptyDoc(sanitizeDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }] }))).toBe(true);
    expect(isEmptyDoc(sanitizeDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }))).toBe(false);
  });
});
