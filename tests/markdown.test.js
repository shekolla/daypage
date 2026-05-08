import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../lib/markdown.js";

describe("renderMarkdown", () => {
  it("returns empty string for falsy input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(null)).toBe("");
    expect(renderMarkdown(undefined)).toBe("");
  });

  it("HTML-escapes `<`, `>`, and `&` BEFORE adding any tags", () => {
    const out = renderMarkdown("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;/script&gt;");
  });

  it("escapes ampersands so &amp; cannot become a real entity surprise", () => {
    expect(renderMarkdown("a & b")).toContain("a &amp; b");
  });

  it("renders **bold**", () => {
    const out = renderMarkdown("hello **world**");
    expect(out).toContain("<strong>world</strong>");
  });

  it("renders *italic*", () => {
    const out = renderMarkdown("an *important* note");
    expect(out).toContain("<em>important</em>");
  });

  it("renders inline `code`", () => {
    const out = renderMarkdown("use `git push` here");
    expect(out).toMatch(/<code[^>]*>git push<\/code>/);
  });

  it("does not re-parse markdown inside backticks", () => {
    const out = renderMarkdown("`**not bold**`");
    // The bold tags should NOT appear because the content is inside <code>.
    expect(out).toMatch(/<code[^>]*>\*\*not bold\*\*<\/code>/);
    expect(out).not.toContain("<strong>");
  });

  it("renders [label](url) markdown links", () => {
    const out = renderMarkdown("see [docs](https://example.com)");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noreferrer"');
    expect(out).toContain(">docs</a>");
  });

  it("auto-links bare URLs", () => {
    const out = renderMarkdown("ping https://docs.google.com/x for ref");
    expect(out).toContain('href="https://docs.google.com/x"');
  });

  it("only allows http(s) URLs in markdown links", () => {
    // javascript: scheme must NOT match the link regex.
    const out = renderMarkdown("[click](javascript:alert(1))");
    expect(out).not.toContain("href=");
  });

  it("converts newlines to <br>", () => {
    expect(renderMarkdown("a\nb")).toContain("a<br>b");
  });

  it("does not double-render an existing markdown link as a bare URL", () => {
    const out = renderMarkdown("[docs](https://example.com)");
    // We expect exactly one anchor opening tag.
    expect((out.match(/<a /g) || []).length).toBe(1);
  });
});
