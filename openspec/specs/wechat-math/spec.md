## Purpose

Markdown `$...$` / `$$...$$` math is typeset as self-contained MathJax SVG for preview and WeChat copy, with TeX preserved for Word linear-text fallback.

## Requirements

### Requirement: Markdown math is typeset as self-contained inline SVG

The editor SHALL parse Markdown inline math `$...$` and block math `$$...$$` into placeholder nodes with classes `math-inline` and `math-block` respectively, and SHALL store the original TeX on each node in a `data-tex` attribute (HTML-escaped). After sanitizing for WeChat inline styles, the editor SHALL replace each placeholder’s children with a MathJax SVG produced by `tex2svg` using `fontCache: 'none'`, so the formula contains path/rect vector glyphs and MUST NOT contain a hidden MathML duplicate of the same expression. If MathJax is unavailable or rendering fails, the placeholder SHALL keep readable TeX delimiters (`\(...\)` or `\[...\]`).

#### Scenario: Inline formula in preview

- **WHEN** the markdown contains `$E = mc^2$` and MathJax has loaded
- **THEN** the preview’s matching `.math-inline` node contains an `<svg>` child and no `.katex-mathml` (or other hidden MathML) sibling with the same formula text

#### Scenario: Block formula in preview

- **WHEN** the markdown contains a `$$...$$` block and MathJax has loaded
- **THEN** the preview’s matching `.math-block` node contains an `<svg>` child whose width and height are expressed as inline styles (not only width/height attributes)

#### Scenario: TeX source is preserved after render

- **WHEN** a formula has been typeset to SVG
- **THEN** the placeholder node still has `data-tex` equal to the authored TeX

#### Scenario: Engine missing

- **WHEN** MathJax `tex2svg` is not available
- **THEN** the placeholder still displays the TeX wrapped in `\(...\)` or `\[...\]` and the editor does not throw

### Requirement: WeChat copy pastes SVG math without duplicated symbols

When the user copies preview HTML for the WeChat official-account editor, the copied `text/html` payload SHALL include the already-typeset SVG formulas from the preview. The copied math MUST NOT include KaTeX HTML+MathML dual output. The copy path SHALL NOT re-parse formula `textContent` as TeX.

#### Scenario: Copy to WeChat uses rendered SVG

- **WHEN** the user clicks 「复制到公众号」 after formulas have been rendered
- **THEN** the HTML placed on the clipboard contains the preview’s math `<svg>` elements and does not contain `.katex` / `.katex-mathml` markup

#### Scenario: Plain-text clipboard alternative

- **WHEN** the same copy writes `text/plain` alongside `text/html`
- **THEN** the plain text is derived from the copied HTML document (or preview inner text) and is not a second KaTeX render pass

### Requirement: Word export degrades formulas to linear readable text

Because the browser Word path (html-docx-js MHT) cannot layout SVG math, Word export SHALL replace each `.math-block` / `.math-inline` with linear Unicode text derived from that node’s `data-tex` (fractions, roots, scripts, and common symbols mapped where possible; unrecognized TeX left intact) before Word HTML preparation.

#### Scenario: Word export uses TeX fallback

- **WHEN** the user saves as Word and the article contains `$E = mc^2$`
- **THEN** the HTML fed into the DOCX converter contains linear readable text for that formula (not an SVG and not KaTeX HTML)

#### Scenario: Missing TeX attribute

- **WHEN** a math placeholder has no `data-tex`
- **THEN** Word rewrite leaves that node’s text unchanged rather than throwing

### Requirement: HTML and PDF export keep the rendered SVG

Standalone HTML download SHALL embed the preview HTML including math SVG and MUST NOT require KaTeX CSS or webfonts for formulas to remain visible. PDF print SHALL write the already-rendered preview HTML into the print document and MUST NOT load KaTeX or call `renderToString` on formula `textContent`.

#### Scenario: Save HTML

- **WHEN** the user saves as HTML after math has been rendered
- **THEN** the downloaded file contains the math `<svg>` and does not link `katex.min.css`

#### Scenario: Save PDF

- **WHEN** the user saves as PDF after math has been rendered
- **THEN** the print iframe body includes the existing math SVG and does not inject KaTeX scripts for a second typesetting pass

### Requirement: Live preview does not typeset math on every keystroke

Markdown textarea `input` events SHALL debounce preview re-render (including math typesetting) by approximately 180ms. Immediate `render()` from theme, font-size, spacing, import, and programmatic `setMarkdown` / `rerender` MAY stay synchronous.

#### Scenario: Typing is debounced

- **WHEN** the user types several characters in the markdown editor in under 180ms
- **THEN** math typesetting runs after the pause, not once per character
