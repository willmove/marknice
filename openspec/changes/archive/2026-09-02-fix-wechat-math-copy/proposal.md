## Why

Copying preview HTML into the WeChat official-account draft editor currently pastes KaTeX's dual HTML+MathML tree. WeChat strips class-based CSS and does not load KaTeX fonts, so the hidden MathML layer becomes visible next to the visual glyphs — formulas duplicate, overlap, or show raw TeX. The sibling Markion workspace already solved this by typesetting math as self-contained MathJax SVG; MarkNice should adopt the same paste-safe output.

## What Changes

- Replace KaTeX HTML/MathML rendering with MathJax 3 `tex-svg` so preview, WeChat copy, and standalone HTML all emit self-contained inline SVG (glyphs as `<path>`/`<rect>`, `fontCache: 'none'`).
- Keep original TeX on each formula node (`data-tex`) so Word export can degrade to linear Unicode text (Word's html-docx MHT path cannot layout SVG math).
- Stop the PDF print path from re-parsing already-rendered formula `textContent` as TeX; print the already-typeset SVG.
- Debounce live preview input so MathJax `tex2svg` does not run on every keystroke.
- Load MathJax from CDN (same dependency style as marked / html-docx-js). Remove KaTeX JS and CSS.
- Update README and the guide FAQ so they describe SVG paste behavior instead of KaTeX.

## Capabilities

### New Capabilities
- `wechat-math`: Markdown `$...$` / `$$...$$` math is typeset as self-contained inline SVG for preview and WeChat copy, with TeX preserved for Word linear-text fallback and no second-pass TeX parse on PDF print.

### Modified Capabilities
- (none — this repository has no existing main specs)

## Impact

- `index.html`: swap KaTeX `<link>`/`<script>` for math-runtime config + MathJax `tex-svg-full` CDN; load order must set `window.MathJax` before the engine script.
- `src/main.js`: marked math renderer (`data-tex` + HTML escape), `renderMath`, input debounce, Word rewrite hook, PDF print, `htmlToMarkdown` TeX recovery.
- New `src/math-runtime.js`: port of Markion `static/math-runtime.js` (render, polish SVG, TeX→linear text, Word rewrite), exposed as `window.MarkNiceMath`.
- `src/docx-parser.js`: unchanged placeholder HTML (`\(...\)` / `\[...\]`); it already re-enters the render pipeline.
- Docs: `README.md`, `guide.html`.
- CDN: add MathJax 3.2.2 `tex-svg-full`; remove KaTeX 0.16.11.
