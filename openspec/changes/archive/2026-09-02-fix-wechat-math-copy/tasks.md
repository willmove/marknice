## 1. Math runtime

- [x] 1.1 Add `src/math-runtime.js` ported from Markion `static/math-runtime.js`: MathJax config (`fontCache: 'none'`, menu off), `tex2svg` + `replaceChildren` + SVG polish, TeX→linear text, `rewriteForWordExport`, expose `window.MarkNiceMath`
- [x] 1.2 Load `math-runtime.js` immediately before MathJax `tex-svg-full` 3.2.2 CDN in `index.html` (both `defer`); remove KaTeX CSS and JS

## 2. Render pipeline

- [x] 2.1 Update marked math renderers in `src/main.js` to HTML-escape TeX and emit `data-tex` on `.math-block` / `.math-inline` placeholders
- [x] 2.2 Point `renderMath` at `MarkNiceMath.renderInto`; recover TeX from `data-tex` in `htmlToMarkdown`
- [x] 2.3 Debounce markdown textarea `input` re-render by 180ms; keep immediate `render()` for theme, font, spacing, import, and API setters

## 3. Export paths

- [x] 3.1 Run `MarkNiceMath.rewriteForWordExport` on preview HTML before `prepareHtmlForWordExport`
- [x] 3.2 Remove KaTeX reload and second `renderToString` from the PDF print iframe; print already-rendered SVG HTML
- [x] 3.3 Confirm saved HTML uses preview HTML (SVG) and does not inject KaTeX assets

## 4. Docs and verify

- [x] 4.1 Update `README.md` and `guide.html` FAQ/dependency text from KaTeX to MathJax SVG paste behavior
- [x] 4.2 Verify in the browser: preview inline/block math is SVG; copy HTML has no `.katex-mathml`; typing is debounced
