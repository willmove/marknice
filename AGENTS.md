# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

MarkNice converts Markdown / Word documents into WeChat-Official-Account-ready
rich-text layouts (微信公众号排版). It is a **dependency-free, build-step-free**
vanilla-JS web app: plain `.html` + `.js` + `.css`, no bundler, no `package.json`,
no transpilation. All third-party libraries (marked, JSZip, MathJax, html-docx-js)
load from CDN via `<script>` tags. Comments and UI strings are in Chinese.

## Running locally

There is no build, lint, or test suite. You run the static files directly.

```bash
# Pure static (no PDF import) — serve repo root and open /
python3 -m http.server 8080      # or: npx serve .

# Full app incl. PDF import — needs Node >= 18
cp .env.example .env             # set PADDLE_OCR_TOKEN=...
node server/server.js            # serves static files AND the /api proxy
```

The whole app lives at `/` (`index.html`): the editor is at the top of the page,
intro/features/footer below. `guide.html` is the user manual. The Node server
(`server/server.js`) is **zero-dependency** (Node stdlib only) — do not add npm
packages to it.

## Architecture

### Single editor on the homepage

`index.html` *is* the editor: the editor section is the first thing in `<body>`
(after the navbar), with SEO intro + features + footer below it. It loads
`src/main.js` (core) and then `src/pro-extras.js` (the PDF-import extension).
Asset paths are relative (`./src/...`) so the app deploys to any static host.

> Historical note: there used to be two separate editor pages (`lite/` and `pro/`,
> selected via a `window.__APP_TIER__` global). They have been **merged** into the
> single homepage editor; the tier system and those directories are gone. If you see
> references to "Lite/Pro" or `__APP_TIER__` anywhere, they are stale.

### The `window.MarkNice` extension API

`main.js` exposes a hook/accessor namespace (defined near the top of the file) that
`pro-extras.js` (and any future extension) builds on instead of touching internals:

- `addBeforeRender(fn)` — transform the markdown string before parsing
- `addAfterRender(fn)` — mutate the rendered preview DOM after each render
- `onReady(fn)` — run after initial render (runs immediately if already ready)
- `registerTheme(key, label, theme)` — add a theme + dropdown `<option>` at runtime
- `getMarkdown` / `setMarkdown` / `getPreviewElement` / `rerender` / `setStatus`

When adding an optional feature, register it through these hooks (as `pro-extras.js`
does) rather than editing the render pipeline directly.

### Render pipeline (`src/main.js`)

`render()` is the hub: markdown → `marked` parse → MathJax SVG math → inline-style
application → `sanitizeForWechat()`. Key concepts:

- **Themes** live in the `themes` object. Each theme is a style map keyed by element;
  styles are applied **inline** (via `applyInlineStyles` / `scaledStyle`) rather than
  via CSS classes, because WeChat strips `<style>` and class-based CSS on paste.
- `sanitizeForWechat()` converts the preview into paste-safe HTML. Font size and
  paragraph spacing are runtime offsets (`fontSizeOffset`, `paraSpacingOffset`)
  folded into the inline styles — handle these when touching style output.
- A custom `marked` extension handles `$...$` / `$$...$$` math (rendered by MathJax as self-contained SVG for WeChat paste).
- Copy-to-clipboard writes both `text/html` and `text/plain` so it pastes cleanly
  into the WeChat editor.
- Export paths: HTML file, PDF (browser print dialog), Word (`html-docx-js`).
  WeChat/Word quirks (line breaks in bold list items, table cell spacing, justified
  text) have been fixed deliberately in this layer — be careful regressing them.

### DOCX import (`src/docx-parser.js`)

`window.parseDocx(arrayBuffer)` is a **hand-written** OOXML parser (uses JSZip to
unzip, then walks the XML). It handles heading-number detection, ordered/unordered
lists, merged-cell tables, OMML→LaTeX math conversion (`ommlToLatex`), embedded
images (→ data URIs), and run-level text formatting. There is no docx library —
extend the XML walking helpers (`_qn`, `_qnAll`, `_qnDeep`, `_attr`) when adding
support for new elements.

### PDF import & the proxy

`pro-extras.js` implements PDF import by calling PaddleOCR through the local Node
proxy. The browser never sees the token. Flow: `POST /api/ocr/jobs` (submit) →
poll `GET /api/ocr/jobs/:id` → fetch result JSON + images via `GET /api/proxy?url=`
→ assemble markdown. `server/server.js` injects `PADDLE_OCR_TOKEN` from `.env`,
and `/api/proxy` only passes hosts on the `PROXY_ALLOWED_HOSTS` suffix allowlist
(defaults: `.aistudio-app.com`, `.bcebos.com`). Keep that allowlist tight.

## Conventions

- Match the surrounding ES5-ish vanilla style (no modules/imports in the browser
  code; functions attach to `window` for cross-file use).
- Anything that ends up pasted into WeChat must use **inline styles**, not classes.
- New themes: add to the `themes` map in `main.js`, or call
  `MarkNice.registerTheme(...)` from an extension module.
- `.env` holds the only secret and is gitignored; never commit a real token.
