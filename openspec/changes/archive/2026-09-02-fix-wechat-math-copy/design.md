## Context

MarkNice typesets `$...$` / `$$...$$` with KaTeX `renderToString` (default `htmlAndMathml`) after `sanitizeForWechat`. The preview page loads `katex.min.css`, so MathML stays clipped and the HTML layer aligns with KaTeX webfonts. Copied HTML does not include that stylesheet; WeChat also strips class CSS. Both the MathML annotation and the visual glyphs become visible — the reported “duplicate formula symbols” bug.

The sibling Markion publishing workspace (`assets/marknice-workspace/static/math-runtime.js`) already replaced this path with MathJax 3 `tex2svg`, `fontCache: 'none'`, and `replaceChildren(svg)`. Paste into WeChat 4.1.13.7 was verified. MarkNice stays a CDN, no-bundler vanilla app, so the same runtime is ported but MathJax is loaded from jsDelivr instead of a vendored file.

Constraints: ES5-ish browser code, Chinese UI strings, inline styles for anything that must survive WeChat paste, no new npm/build step.

## Goals / Non-Goals

**Goals:**

- Preview, WeChat copy, and saved HTML use the same self-contained SVG math (no hidden MathML, no KaTeX webfonts).
- Original TeX remains on the node for Word linear-text fallback and Markdown round-trip.
- PDF print uses the already-rendered SVG; it MUST NOT re-parse `textContent` as TeX.
- Live typing remains usable despite slower `tex2svg` (debounce).

**Non-Goals:**

- Vendoring MathJax into the repo (Markion needs offline; this web app already depends on CDN).
- Changing the WeChat copy/clipboard API, OSS image upload, or theme inline-style pipeline.
- Native OMML in Word export (html-docx MHT cannot carry SVG math; linear Unicode is the fallback).
- Changing DOCX import OMML→LaTeX (`docx-parser.js` already emits math placeholders).
- Pixel-identical glyphs versus KaTeX.

## Decisions

### 1. MathJax SVG with `fontCache: 'none'`, not KaTeX HTML or computed-style inlining

- **Choice:** `MathJax.tex2svg` + `svg.fontCache = 'none'`, then `el.replaceChildren(svg)` and polish width/height into inline style.
- **Why:** SVG paths survive WeChat CSS/tag filtering and contain no duplicate MathML. `fontCache: 'none'` embeds glyphs in the SVG so paste does not need MathJax fonts.
- **Rejected:** `katex` `output: 'html'` — still needs `katex.css` and webfonts. Inlining computed styles — brittle, huge HTML, fonts still missing. Rasterizing to PNG on copy — blurry, not selectable.

### 2. CDN `tex-svg-full.js` 3.2.2, config script first

- **Choice:** `https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg-full.js`, with `src/math-runtime.js` loaded immediately before it (both `defer`, document order preserved).
- **Why:** Matches Markion’s engine (including mhchem `\ce{}`). Full bundle is heavier than `tex-svg.js`; keep parity with the proven workspace unless size becomes a problem later.
- **Config:** `window.MathJax = { svg: { fontCache: 'none' }, options: { enableMenu: false } }` MUST be assigned before the engine script runs.

### 3. Dedicated `src/math-runtime.js` exposing `window.MarkNiceMath`

- **Choice:** Port Markion’s runtime; rename the global to `MarkNiceMath` (`renderInto`, `texToLinearText`, `rewriteForWordExport`). `main.js` `renderMath` becomes a one-line delegate.
- **Why:** Keeps TeX→linear conversion and SVG polish out of the theme/sanitizer hub. Same extension style as `docx-parser.js` / `pro-extras.js`.

### 4. Preserve TeX in `data-tex`, HTML-escaped

- **Choice:** marked math renderer writes `data-tex` plus the existing `\(...\)` / `\[...\]` placeholder body. `sanitizeForWechat` continues to keep `math-inline` / `math-block` classes (needed to find nodes after parse). `data-tex` is not an `on*` / `id` / `class` attribute, so the current sanitizer leaves it.
- **Why:** After SVG replace, `textContent` is empty or meaningless; Word and `htmlToMarkdown` need the source.

### 5. Word export degrades SVG to linear Unicode; PDF/HTML keep SVG

- **Choice:** Before `prepareHtmlForWordExport`, run `MarkNiceMath.rewriteForWordExport`. PDF iframe writes `dataset.html` as-is (already SVG); drop the KaTeX reload + second `renderToString`.
- **Why:** html-docx `altChunk(MHT)` layouts neither MathML nor SVG math. Browser print handles SVG.

### 6. Debounce markdown `input` at 180ms

- **Choice:** Same interval as the Markion workspace. Theme/font/spacing controls still call `render()` immediately.
- **Why:** MathJax is slower than KaTeX; current code renders on every keypress.

## Risks / Trade-offs

- **[Risk] MathJax CDN failure** → Preview falls back to placeholder `\(...\)` text (same class of failure as today’s KaTeX CDN miss). Document in FAQ.
- **[Risk] WeChat strips `<svg>` in some editor versions** → Markion verified 4.1.13.7; if a future editor drops SVG, formulas vanish rather than duplicate. Mitigation: keep `data-tex` so a later image/text fallback can be added without re-parsing DOM.
- **[Risk] Live preview lag on formula-heavy docs** → 180ms debounce; no incremental math cache in this change.
- **[Risk] Glyph metrics differ from KaTeX** → Acceptable; WeChat correctness beats preview font matching.
- **[Trade-off] `tex-svg-full` payload larger than KaTeX** → One-time CDN cache vs paste correctness.

## Migration Plan

- Deploy is static-file replace: new `math-runtime.js`, `index.html` script tags, `main.js` hooks. No data migration.
- Rollback: restore KaTeX tags and `renderMath`; leave `data-tex` harmless if present.

## Open Questions

- None blocking implementation. `tex-svg.js` vs `tex-svg-full.js` is decided as full for Markion parity.
