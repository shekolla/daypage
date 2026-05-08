// Tight markdown subset (bold, italic, inline code, [text](url), bare-URL
// auto-link, line break). Hand-rolled instead of pulling in `marked` to keep
// the bundle small and the rendered HTML auditable.
//
// Security model: escape-first. Every `<`, `>`, `&` becomes its entity before
// any tag character is inserted, so user text cannot escape into real HTML
// or attribute injection. After the escape, we add `<a>`, `<strong>`, etc.
// with known-safe attributes.
//
// IMPORTANT: keep this function the SINGLE place markdown-derived HTML is
// built. If you need a new pattern, extend this — don't bypass it.
export function renderMarkdown(s) {
  if (!s) return "";
  let h = String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Stash inline-code spans behind a placeholder so subsequent substitutions
  // (links, bold, italic, auto-link, newlines) don't see their contents.
  // Restored at the very end.
  const codeStash = [];
  h = h.replace(/`([^`\n]+)`/g, (_, code) => {
    codeStash.push(code);
    return ` CODE${codeStash.length - 1} `;
  });
  // Markdown links [label](url) — only http(s) accepted, no javascript: schemes.
  h = h.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer" class="text-blue-700 underline decoration-dotted">$1</a>'
  );
  // Bare URL auto-link.
  h = h.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (_, pre, url) =>
      `${pre}<a href="${url}" target="_blank" rel="noreferrer" class="text-blue-700 underline decoration-dotted">${url}</a>`
  );
  // Bold / italic.
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  // Newlines.
  h = h.replace(/\n/g, "<br>");
  // Restore code spans.
  h = h.replace(/ CODE(\d+) /g, (_, idx) =>
    `<code class="bg-stone-100 px-1 py-0.5 rounded text-[0.95em]">${codeStash[Number(idx)]}</code>`
  );
  return h;
}
