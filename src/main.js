const markdownEl = document.getElementById('markdown');
const previewEl = document.getElementById('preview');
const statusEl = document.getElementById('status');
const fileInput = document.getElementById('fileInput');
const themeSelect = document.getElementById('themeSelect');

// ===== Public API for extensions (used by pro-extras.js) =====
window.MarkNice = window.MarkNice || {};
const __mnHooks = { beforeRender: [], afterRender: [], ready: [] };
let __mnReady = false;
Object.assign(window.MarkNice, {
  // Hook: (md:string) => string — transform markdown source before parsing
  addBeforeRender(fn) { if (typeof fn === 'function') __mnHooks.beforeRender.push(fn); },
  // Hook: (previewEl:HTMLElement) => void — mutate rendered DOM
  addAfterRender(fn) { if (typeof fn === 'function') __mnHooks.afterRender.push(fn); },
  // Hook: () => void — called after main.js finished initial render.
  // If registered after main.js (typical for pro-extras.js), runs immediately.
  onReady(fn) {
    if (typeof fn !== 'function') return;
    if (__mnReady) { try { fn(); } catch(e) { console.error(e); } }
    else __mnHooks.ready.push(fn);
  },
  // Register a theme dynamically: themes[key] = theme object, append <option>
  registerTheme(key, label, theme) {
    if (!key || !theme) return;
    themes[key] = theme;
    if (themeSelect && !themeSelect.querySelector(`option[value="${key}"]`)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label || key;
      themeSelect.appendChild(opt);
    }
  },
  // Direct accessors
  getMarkdown: () => markdownEl.value,
  setMarkdown(md) { markdownEl.value = md == null ? '' : String(md); render(); },
  getPreviewElement: () => previewEl,
  rerender: () => render(),
  setStatus(text) { statusEl.textContent = text == null ? '' : String(text); },
});
const fontScaleSelect = null; // removed, replaced by +/- buttons
let fontSizeOffset = 0; // px offset from default, can be negative or positive
let paraSpacingOffset = 0; // px offset for paragraph/heading margins
const fontSizeLabel = document.getElementById('fontSizeLabel');
const fontSizeDown = document.getElementById('fontSizeDown');
const fontSizeUp = document.getElementById('fontSizeUp');
const modeToggleBtn = document.getElementById('modeToggleBtn');

marked.setOptions({ breaks: true, gfm: true });

// Math extension for marked: handle $$...$$ (block) and $...$ (inline)
marked.use({
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start: function(src) { var m = src.match(/\$\$/); return m ? m.index : -1; },
      tokenizer: function(src) {
        var match = src.match(/^\$\$([\s\S]+?)\$\$/);
        if (match) return { type: 'mathBlock', raw: match[0], tex: match[1].trim() };
      },
      renderer: function(token) {
        return '<div class="math-block">\\[' + token.tex + '\\]</div>';
      }
    },
    {
      name: 'mathInline',
      level: 'inline',
      start: function(src) { var m = src.match(/\$/); return m ? m.index : -1; },
      tokenizer: function(src) {
        var match = src.match(/^\$([^\$\n]+?)\$/);
        if (match) return { type: 'mathInline', raw: match[0], tex: match[1].trim() };
      },
      renderer: function(token) {
        return '<span class="math-inline">\\(' + token.tex + '\\)</span>';
      }
    }
  ]
});

function tokenHeadingOptions(tagName) {
  return tagName === 'H1'
    ? {
      margin: '28px 0 18px',
      fontSize: 24,
      lineHeight: 1.4,
      fontWeight: 800,
      paddingLeft: 12,
      bgPadding: '8px 14px 7px',
      bgRadius: 3,
      tailHeight: 48,
      tailWidth: 26,
    }
    : {
      margin: '24px 0 14px',
      fontSize: 21,
      lineHeight: 1.45,
      fontWeight: 800,
      paddingLeft: 10,
      bgPadding: '7px 13px 6px',
      bgRadius: 3,
      tailHeight: 42,
      tailWidth: 23,
    };
}

function tokenHeadingStyle(theme, opts) {
  if (theme.headingVariant === 'ribbon') {
    return `margin:${opts.margin};border-bottom:2px solid ${theme.headingLine || theme.accent};line-height:0;`;
  }
  if (theme.headingBg) {
    return `margin:${opts.margin};padding:${opts.bgPadding};background:${theme.headingBg};border-radius:${opts.bgRadius}px;color:${theme.headingText || theme.heading};font-size:${opts.fontSize}px;line-height:${opts.lineHeight};font-weight:${opts.fontWeight};box-shadow:0 10px 24px rgba(79,70,229,0.16);`;
  }
  return `margin:${opts.margin};padding-left:${opts.paddingLeft}px;border-left:4px solid ${theme.accent};font-size:${opts.fontSize}px;line-height:${opts.lineHeight};color:${theme.heading};font-weight:${opts.fontWeight};`;
}

function makeTokenTheme(theme) {
  const strongColor = theme.strong || theme.heading;
  const codeText = theme.codeText || theme.text;
  const pageBgStyle = theme.pageBg
    ? `background:${theme.pageBg};${theme.pageBgSize ? `background-size:${theme.pageBgSize};` : ''}padding:24px 20px;border-radius:8px;`
    : '';
  return {
    section: `font-family:${theme.bodyFont};font-size:16px;color:${theme.text};line-height:1.9;letter-spacing:0.5px;word-break:break-word;${pageBgStyle}`,
    headingVariant: theme.headingVariant,
    headingBg: theme.headingBg,
    headingText: theme.headingText,
    headingTailBg: theme.headingTailBg,
    headingLine: theme.headingLine,
    accent: theme.accent,
    styles: {
      p: `margin:16px 0;line-height:1.9;color:${theme.text};font-size:16px;word-break:break-word;text-align:justify;`,
      h1: tokenHeadingStyle(theme, tokenHeadingOptions('H1')),
      h2: tokenHeadingStyle(theme, tokenHeadingOptions('H2')),
      h3: `margin:20px 0 12px;font-size:18px;line-height:1.5;color:${theme.heading};font-weight:700;`,
      'h4,h5,h6': `margin:18px 0 10px;font-size:17px;line-height:1.6;color:${theme.heading};font-weight:600;`,
      blockquote: `margin:18px 0;padding:12px 16px;background:${theme.quoteBg};border-left:4px solid ${theme.quoteBorder};color:${theme.text};border-radius:6px;`,
      ul: `margin:14px 0 14px 1.2em;padding:0;color:${theme.text};line-height:1.9;`,
      ol: `margin:14px 0 14px 1.2em;padding:0;color:${theme.text};line-height:1.9;`,
      li: 'margin:6px 0;font-size:16px;',
      a: `color:${theme.accent};text-decoration:none;border-bottom:1px solid ${theme.accent};`,
      img: 'max-width:100%;height:auto;border-radius:8px;display:block;margin:20px auto;',
      pre: `margin:18px 0;padding:14px 16px;overflow:auto;background:${theme.codeBg};border-radius:8px;color:${codeText};font-family:Menlo,Consolas,monospace;font-size:14px;line-height:1.7;white-space:normal;word-break:break-all;`,
      code: `font-family:Menlo,Consolas,monospace;background:${theme.codeBg};color:${theme.accent};display:inline;white-space:normal;padding:2px 6px;border-radius:4px;font-size:0.92em;`,
      'strong,b': `color:${strongColor};font-weight:700;`,
      mark: `background:${theme.markBg || theme.quoteBg};color:${theme.heading};padding:1px 4px;border-radius:3px;`,
      table: 'width:100%;border-collapse:collapse;margin:18px 0;font-size:14px;',
      th: `border:1px solid ${theme.hr};padding:8px 10px;background:${theme.quoteBg};font-weight:700;color:${theme.heading};text-align:left;`,
      td: `border:1px solid ${theme.hr};padding:8px 10px;color:${theme.text};`,
      hr: `border:none;border-top:1px solid ${theme.hr};margin:28px 0;`,
    }
  };
}

const themes = {
  claude: makeTokenTheme({
    bodyFont: '-apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
    text: '#3d3929',
    heading: '#181815',
    accent: '#d97757',
    strong: '#c2613f',
    quoteBg: '#faf9f5',
    quoteBorder: '#d97757',
    codeBg: '#f5f4ef',
    hr: '#e8e6dc',
    markBg: '#f9e8e0',
  }),
  simple: { section: 'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;word-break:break-word;color:#222;', styles: {
    h1:'font-size:24px;line-height:1.6;font-weight:700;margin:24px 0 16px;color:#111;',h2:'font-size:20px;line-height:1.6;font-weight:700;margin:22px 0 14px;color:#111;',h3:'font-size:17px;line-height:1.6;font-weight:700;margin:20px 0 12px;color:#222;',h4:'font-size:15px;line-height:1.6;font-weight:700;margin:16px 0 10px;color:#222;',h5:'font-size:14px;line-height:1.6;font-weight:700;margin:14px 0 8px;color:#333;',h6:'font-size:13px;line-height:1.6;font-weight:700;margin:12px 0 8px;color:#333;',p:'font-size:14px;line-height:1.85;margin:10px 0;color:#222;text-align:justify;',blockquote:'margin:14px 0;padding:10px 14px;border-left:4px solid #3e7bfa;background:#f4f7ff;color:#3a4a77;font-size:13px;line-height:1.8;',ul:'margin:10px 0;padding-left:24px;line-height:1.85;color:#222;font-size:14px;',ol:'margin:10px 0;padding-left:24px;line-height:1.85;color:#222;font-size:14px;',li:'margin:6px 0;',a:'color:#276ef1;text-decoration:none;border-bottom:1px solid #8eb2ff;',img:'max-width:100%;display:block;margin:16px auto;border-radius:6px;',pre:'background:#f6f8fa;border:1px solid #e2e8f0;border-radius:8px;padding:12px;overflow:auto;line-height:1.6;font-size:12px;',code:'background:#f1f4f8;padding:2px 5px;border-radius:4px;font-size:90%;font-family:Menlo,Consolas,monospace;',table:'border-collapse:collapse;width:100%;margin:12px 0;font-size:12px;',th:'border:1px solid #d9e2f0;padding:8px;background:#f7faff;text-align:left;',td:'border:1px solid #d9e2f0;padding:8px;',hr:'border:none;border-top:1px solid #dbe3ef;margin:24px 0;'
  }},
  tech: { section: 'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;word-break:break-word;color:#1a2433;', styles: {
    h1:'font-size:25px;line-height:1.55;font-weight:800;margin:36px 0 22px;color:#0b3b8b;border-bottom:2px solid #dce9ff;padding-bottom:8px;',h2:'font-size:21px;line-height:1.6;font-weight:700;margin:32px 0 20px;color:#1456c5;',h3:'font-size:17px;line-height:1.6;font-weight:700;margin:28px 0 10px;color:#1d3f6f;',h4:'font-size:15px;line-height:1.6;font-weight:700;margin:16px 0 10px;color:#1d3f6f;',p:'font-size:14px;line-height:1.9;margin:10px 0;color:#1f2d3d;text-align:justify;',blockquote:'margin:14px 0;padding:12px 14px;border-left:4px solid #5b8dff;background:#f5f8ff;color:#2a4f8a;font-size:13px;line-height:1.85;',ul:'margin:10px 0;padding-left:24px;line-height:1.9;color:#1f2d3d;font-size:14px;',ol:'margin:10px 0;padding-left:24px;line-height:1.9;color:#1f2d3d;font-size:14px;',li:'margin:6px 0;',a:'color:#1456c5;text-decoration:none;border-bottom:1px dashed #7aa2ff;',img:'max-width:100%;display:block;margin:18px auto;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.08);',pre:'background:#eef6ff;color:#1b3f75;border:1px solid #cfe2ff;border-radius:8px;padding:12px;overflow:auto;line-height:1.65;font-size:12px;',code:'background:#eef4ff;padding:2px 6px;border-radius:4px;font-size:90%;font-family:Menlo,Consolas,monospace;color:#174ea6;',table:'border-collapse:collapse;width:100%;margin:12px 0;font-size:12px;',th:'border:1px solid #d3e3ff;padding:8px;background:#edf3ff;text-align:left;color:#1d3f6f;',td:'border:1px solid #d3e3ff;padding:8px;',hr:'border:none;border-top:1px solid #dce6ff;margin:24px 0;'
  }},
  green: { section: 'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;word-break:break-word;color:#2b2b2b;', styles: {
    h1:'font-size:25px;line-height:1.6;font-weight:800;margin:36px 0 22px;color:#2e5b1f;',h2:'font-size:21px;line-height:1.6;font-weight:700;margin:32px 0 20px;color:#3f7f2f;',h3:'font-size:17px;line-height:1.6;font-weight:700;margin:28px 0 10px;color:#4a6b2f;',h4:'font-size:15px;line-height:1.6;font-weight:700;margin:16px 0 10px;color:#4a6b2f;',p:'font-size:14px;line-height:1.95;margin:10px 0;color:#2f2f2f;text-align:justify;',blockquote:'margin:14px 0;padding:12px 14px;border-left:4px solid #7abf45;background:#f6fbef;color:#486a30;font-size:13px;line-height:1.85;',ul:'margin:10px 0;padding-left:24px;line-height:1.9;color:#2f2f2f;font-size:14px;',ol:'margin:10px 0;padding-left:24px;line-height:1.9;color:#2f2f2f;font-size:14px;',li:'margin:6px 0;',a:'color:#3f7f2f;text-decoration:none;border-bottom:1px solid #9fd57a;',img:'max-width:100%;display:block;margin:16px auto;border-radius:6px;',pre:'background:#f6f8f0;border:1px solid #d8e6c6;border-radius:8px;padding:12px;overflow:auto;line-height:1.6;font-size:12px;',code:'background:#eef5e7;padding:2px 6px;border-radius:4px;font-size:90%;font-family:Menlo,Consolas,monospace;color:#496e2d;',table:'border-collapse:collapse;width:100%;margin:12px 0;font-size:12px;',th:'border:1px solid #d5e4c5;padding:8px;background:#f2f8ea;text-align:left;color:#496e2d;',td:'border:1px solid #d5e4c5;padding:8px;',hr:'border:none;border-top:1px solid #dbe8cf;margin:24px 0;'
  }},
  health: makeTokenTheme({
    bodyFont: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    text: '#183d34',
    heading: '#123f34',
    accent: '#0f8f67',
    strong: '#087857',
    quoteBg: '#f7fcf9',
    quoteBorder: '#5a8f75',
    codeBg: '#edf7f2',
    codeText: '#0f3129',
    hr: '#dcebe3',
    markBg: '#e5f5ee',
    pageBg: 'linear-gradient(rgba(18,63,52,0.045) 1px,transparent 1px),linear-gradient(90deg,rgba(18,63,52,0.045) 1px,transparent 1px),#f4faf7',
    pageBgSize: '48px 48px,48px 48px,auto',
  }),
  news: { section: 'font-family:Georgia,"PingFang SC","Microsoft YaHei",serif;word-break:break-word;color:#1f1f1f;', styles: {
    h1:'font-size:28px;line-height:1.45;font-weight:700;margin:36px 0 22px;color:#111;',h2:'font-size:22px;line-height:1.5;font-weight:700;margin:32px 0 20px;color:#1b1b1b;',h3:'font-size:18px;line-height:1.55;font-weight:700;margin:28px 0 10px;color:#2b2b2b;',h4:'font-size:16px;line-height:1.55;font-weight:700;margin:16px 0 10px;color:#2b2b2b;',p:'font-size:15px;line-height:2;margin:10px 0;color:#1f1f1f;text-align:justify;',blockquote:'margin:14px 0;padding:10px 14px;border-left:4px solid #999;background:#f8f8f8;color:#444;font-size:13px;line-height:1.85;',ul:'margin:10px 0;padding-left:24px;line-height:1.9;color:#1f1f1f;font-size:15px;',ol:'margin:10px 0;padding-left:24px;line-height:1.9;color:#1f1f1f;font-size:15px;',li:'margin:6px 0;',a:'color:#1155cc;text-decoration:underline;',img:'max-width:100%;display:block;margin:18px auto;',pre:'background:#f5f5f5;border:1px solid #e3e3e3;border-radius:4px;padding:12px;overflow:auto;line-height:1.6;font-size:12px;',code:'background:#f0f0f0;padding:2px 5px;border-radius:3px;font-size:90%;font-family:Menlo,Consolas,monospace;',table:'border-collapse:collapse;width:100%;margin:12px 0;font-size:12px;',th:'border:1px solid #ddd;padding:8px;background:#f7f7f7;text-align:left;',td:'border:1px solid #ddd;padding:8px;',hr:'border:none;border-top:1px solid #ddd;margin:24px 0;'
  }},
  magazine: { section: 'font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;word-break:break-word;color:#27272a;', styles: {
    h1:'font-size:30px;line-height:1.5;font-weight:800;margin:24px 0 14px;color:#7a1f1f;text-align:center;',h2:'font-size:22px;line-height:1.6;font-weight:700;margin:20px 0 12px;color:#992d2d;',h3:'font-size:18px;line-height:1.6;font-weight:700;margin:16px 0 10px;color:#ad3a3a;',h4:'font-size:16px;line-height:1.6;font-weight:700;margin:14px 0 10px;color:#ad3a3a;',p:'font-size:15px;line-height:1.95;margin:12px 0;color:#2f2f33;text-align:justify;letter-spacing:.2px;',blockquote:'margin:16px 0;padding:12px 16px;border-left:0;background:#fff3f2;color:#8a2c2c;font-size:14px;line-height:1.9;border-radius:10px;',ul:'margin:10px 0;padding-left:24px;line-height:1.9;color:#2f2f33;font-size:15px;',ol:'margin:10px 0;padding-left:24px;line-height:1.9;color:#2f2f33;font-size:15px;',li:'margin:6px 0;',a:'color:#c23a3a;text-decoration:none;border-bottom:1px dashed #d67f7f;',img:'max-width:100%;display:block;margin:20px auto;border-radius:12px;box-shadow:0 8px 20px rgba(120,30,30,.12);',pre:'background:#fff6f6;border:1px solid #f2d9d9;border-radius:10px;padding:12px;overflow:auto;line-height:1.7;font-size:12px;',code:'background:#ffeef0;padding:2px 6px;border-radius:4px;font-size:90%;font-family:Menlo,Consolas,monospace;color:#9c2f3a;',table:'border-collapse:collapse;width:100%;margin:12px 0;font-size:12px;',th:'border:1px solid #f0d1d1;padding:8px;background:#fff7f7;text-align:left;',td:'border:1px solid #f0d1d1;padding:8px;',hr:'border:none;border-top:1px dashed #e8c2c2;margin:24px 0;'
  }},
  ocean: makeTokenTheme({
    bodyFont: '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
    text: '#1f3a3d',
    heading: '#0b4f55',
    accent: '#0e9594',
    strong: '#0a7e7d',
    quoteBg: '#effbfa',
    quoteBorder: '#0e9594',
    codeBg: '#e8f6f5',
    codeText: '#0b6b6a',
    hr: '#cdeae8',
    markBg: '#d6f3f1',
  }),
  minimal: { section: 'font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;word-break:break-word;color:#111827;', styles: {
    h1:'font-size:26px;line-height:1.45;font-weight:700;margin:30px 0 18px;color:#111827;',h2:'font-size:21px;line-height:1.5;font-weight:700;margin:24px 0 14px;color:#1f2937;',h3:'font-size:17px;line-height:1.6;font-weight:600;margin:20px 0 10px;color:#374151;',h4:'font-size:15px;line-height:1.6;font-weight:600;margin:16px 0 8px;color:#374151;',p:'font-size:15px;line-height:2.05;margin:14px 0;color:#111827;',blockquote:'margin:16px 0;padding:0 0 0 14px;border-left:3px solid #111827;background:transparent;color:#374151;font-size:14px;line-height:1.95;',ul:'margin:12px 0;padding-left:22px;line-height:2;color:#111827;font-size:15px;',ol:'margin:12px 0;padding-left:22px;line-height:2;color:#111827;font-size:15px;',li:'margin:6px 0;',a:'color:#111827;text-decoration:underline;',img:'max-width:100%;display:block;margin:22px auto;border-radius:2px;',pre:'background:#fafafa;border:1px solid #ececec;border-radius:6px;padding:12px;overflow:auto;line-height:1.65;font-size:12px;',code:'background:#f3f4f6;padding:2px 5px;border-radius:4px;font-size:90%;font-family:Menlo,Consolas,monospace;',table:'border-collapse:collapse;width:100%;margin:12px 0;font-size:12px;',th:'border-bottom:1px solid #d1d5db;padding:8px 6px;text-align:left;',td:'border-bottom:1px solid #e5e7eb;padding:8px 6px;',hr:'border:none;border-top:1px solid #e5e7eb;margin:28px 0;'
  }},
  retro: { section: 'font-family:Georgia,"Times New Roman","PingFang SC",serif;word-break:break-word;color:#2d2418;', styles: {
    h1:'font-size:28px;line-height:1.5;font-weight:700;margin:24px 0 14px;color:#4a3215;',h2:'font-size:22px;line-height:1.55;font-weight:700;margin:20px 0 12px;color:#5f3f17;',h3:'font-size:18px;line-height:1.6;font-weight:700;margin:16px 0 10px;color:#704a1a;',h4:'font-size:16px;line-height:1.6;font-weight:700;margin:14px 0 8px;color:#704a1a;',p:'font-size:15px;line-height:2;margin:12px 0;color:#2f261b;text-align:justify;',blockquote:'margin:16px 0;padding:12px 14px;border-left:4px solid #8b6a35;background:#f8f2e8;color:#5a4423;font-size:14px;line-height:1.9;',ul:'margin:10px 0;padding-left:24px;line-height:1.95;color:#2f261b;font-size:15px;',ol:'margin:10px 0;padding-left:24px;line-height:1.95;color:#2f261b;font-size:15px;',li:'margin:6px 0;',a:'color:#7a4e14;text-decoration:none;border-bottom:1px solid #c8a870;',img:'max-width:100%;display:block;margin:20px auto;border:6px solid #f0e3cc;border-radius:2px;',pre:'background:#f8f2e8;border:1px solid #e4d1ad;border-radius:6px;padding:12px;overflow:auto;line-height:1.65;font-size:12px;',code:'background:#f2e7d4;padding:2px 5px;border-radius:3px;font-size:90%;font-family:Menlo,Consolas,monospace;color:#704a1a;',table:'border-collapse:collapse;width:100%;margin:12px 0;font-size:12px;',th:'border:1px solid #d7c19a;padding:8px;background:#f7ebd6;text-align:left;',td:'border:1px solid #d7c19a;padding:8px;',hr:'border:none;border-top:1px solid #d7c19a;margin:24px 0;'
  }},
  night: { section: 'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;word-break:break-word;color:#cbd5ff;background:#0f1220;padding:14px;border-radius:12px;', styles: {
    h1:'font-size:27px;line-height:1.5;font-weight:800;margin:24px 0 14px;color:#9ec5ff;',h2:'font-size:22px;line-height:1.55;font-weight:700;margin:20px 0 12px;color:#84f0ff;',h3:'font-size:18px;line-height:1.6;font-weight:700;margin:16px 0 10px;color:#b9a3ff;',h4:'font-size:16px;line-height:1.6;font-weight:700;margin:14px 0 8px;color:#b9a3ff;',p:'font-size:15px;line-height:1.95;margin:12px 0;color:#d5dbff;text-align:justify;',blockquote:'margin:16px 0;padding:12px 14px;border-left:4px solid #7c8cff;background:#171b2f;color:#aebcff;font-size:14px;line-height:1.85;',ul:'margin:10px 0;padding-left:24px;line-height:1.9;color:#d5dbff;font-size:15px;',ol:'margin:10px 0;padding-left:24px;line-height:1.9;color:#d5dbff;font-size:15px;',li:'margin:6px 0;',a:'color:#7de3ff;text-decoration:none;border-bottom:1px dashed #7de3ff;',img:'max-width:100%;display:block;margin:20px auto;border-radius:10px;box-shadow:0 0 0 1px #2c3255,0 8px 24px rgba(0,0,0,.35);',pre:'background:#171b2f;border:1px solid #2f3763;border-radius:8px;padding:12px;overflow:auto;line-height:1.65;font-size:12px;color:#d6e0ff;',code:'background:#23294a;padding:2px 6px;border-radius:4px;font-size:90%;font-family:Menlo,Consolas,monospace;color:#9ec5ff;',table:'border-collapse:collapse;width:100%;margin:12px 0;font-size:12px;',th:'border:1px solid #2f3763;padding:8px;background:#1f2440;text-align:left;color:#9ec5ff;',td:'border:1px solid #2f3763;padding:8px;color:#d5dbff;',hr:'border:none;border-top:1px solid #2f3763;margin:24px 0;'
  }},
  elegant: makeTokenTheme({
    bodyFont: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
    text: '#4a3a30',
    heading: '#5a3826',
    accent: '#b08968',
    strong: '#8a5a36',
    quoteBg: '#fffaf2',
    quoteBorder: '#d8b891',
    codeBg: '#f7efe4',
    codeText: '#6b4a35',
    hr: '#eadcc9',
    markBg: '#f6e6cf',
    pageBg: '#fff8ee',
  }),
  vivid: makeTokenTheme({
    bodyFont: '"PingFang SC","Microsoft YaHei",sans-serif',
    text: '#233044',
    heading: '#d94841',
    accent: '#ff6b6b',
    headingBg: '#f1665d',
    headingText: '#ffffff',
    headingVariant: 'ribbon',
    headingTailBg: '#e5e7eb',
    headingLine: '#ff6b6b',
    strong: '#e05252',
    quoteBg: '#fff4f4',
    quoteBorder: '#ff6b6b',
    codeBg: '#fff8f1',
    hr: '#ffd6d6',
    markBg: '#ffe3e3',
  }),
  warmred: { section: 'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;word-break:break-word;color:#3b2e2a;background:#fffcfa;padding:16px;', styles: {
    h1:'font-size:24px;line-height:1.6;font-weight:800;margin:36px 0 18px;color:#c0392b;text-align:center;',h2:'font-size:20px;line-height:1.6;font-weight:700;margin:32px 0 16px;color:#c0392b;text-align:center;border-bottom:2px solid #c0392b;padding-bottom:8px;display:inline-block;',h3:'font-size:17px;line-height:1.6;font-weight:700;margin:28px 0 12px;color:#c0392b;',h4:'font-size:15px;line-height:1.6;font-weight:700;margin:22px 0 10px;color:#a93226;',h5:'font-size:14px;line-height:1.6;font-weight:700;margin:18px 0 8px;color:#a93226;',h6:'font-size:13px;line-height:1.6;font-weight:700;margin:14px 0 8px;color:#a93226;',p:'font-size:15px;line-height:2.0;margin:14px 0;color:#3b2e2a;text-align:justify;letter-spacing:.3px;',strong:'color:#c0392b;font-weight:700;',blockquote:'margin:18px 0;padding:14px 18px;border-left:4px solid #c0392b;background:#fef5f0;color:#7a2e1f;font-size:14px;line-height:1.9;border-radius:0 8px 8px 0;',ul:'margin:14px 0;padding-left:22px;line-height:2.0;color:#3b2e2a;font-size:15px;',ol:'margin:14px 0;padding-left:22px;line-height:2.0;color:#3b2e2a;font-size:15px;',li:'margin:8px 0;',a:'color:#c0392b;text-decoration:none;border-bottom:1px solid #e8a89a;',img:'max-width:100%;display:block;margin:20px auto;border-radius:8px;',pre:'background:#f7ede0;border:1px solid #ecdcc8;border-radius:10px;padding:14px;overflow:auto;line-height:1.7;font-size:12px;',code:'background:#f7ede0;padding:2px 6px;border-radius:4px;font-size:90%;font-family:Menlo,Consolas,monospace;color:#a93226;',table:'border-collapse:collapse;width:100%;margin:14px 0;font-size:13px;',th:'border:1px solid #ecdcc8;padding:10px;background:#f7ede0;text-align:left;color:#7a2e1f;font-weight:700;',td:'border:1px solid #ecdcc8;padding:10px;',hr:'border:none;border-top:2px solid #c0392b;margin:28px 0;width:40%;margin-left:auto;margin-right:auto;'
  }},
  amber: { section: 'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;word-break:break-word;color:#2c2c2c;', styles: {
    h1:'font-size:20px;line-height:1.6;font-weight:800;margin:40px 0 28px;color:#fff;text-align:center;background:#c8722a;border-radius:8px;padding:10px 28px;display:inline-block;width:auto;',h2:'font-size:18px;line-height:1.6;font-weight:800;margin:36px 0 24px;color:#fff;text-align:center;background:#c8722a;border-radius:8px;padding:8px 24px;display:inline-block;width:auto;',h3:'font-size:16px;line-height:1.6;font-weight:700;margin:30px 0 18px;color:#c8722a;font-weight:700;',h4:'font-size:15px;line-height:1.6;font-weight:700;margin:24px 0 14px;color:#c8722a;',h5:'font-size:14px;line-height:1.6;font-weight:700;margin:20px 0 12px;color:#c8722a;',h6:'font-size:13px;line-height:1.6;font-weight:700;margin:16px 0 10px;color:#c8722a;',p:'font-size:15px;line-height:2.0;margin:18px 0;color:#2c2c2c;text-align:justify;letter-spacing:.2px;',strong:'color:#c8722a;font-weight:700;',blockquote:'margin:20px 0;padding:14px 18px;border-left:4px solid #c8722a;background:#fdf5ec;color:#7a4010;font-size:14px;line-height:1.95;border-radius:0 8px 8px 0;',ul:'margin:16px 0;padding-left:22px;line-height:2.0;color:#2c2c2c;font-size:15px;',ol:'margin:16px 0;padding-left:8px;line-height:2.0;color:#2c2c2c;font-size:15px;list-style:none;',li:'margin:10px 0;',a:'color:#c8722a;text-decoration:none;border-bottom:1px solid #e8b07a;',img:'max-width:100%;display:block;margin:24px auto;border-radius:8px;',pre:'background:#fdf5ec;border:1px solid #f0d5b0;border-radius:8px;padding:14px;overflow:auto;line-height:1.65;font-size:12px;',code:'background:#faebd7;padding:2px 6px;border-radius:4px;font-size:90%;font-family:Menlo,Consolas,monospace;color:#a05a20;',table:'border-collapse:collapse;width:100%;margin:16px 0;font-size:13px;',th:'border:1px solid #f0d5b0;padding:10px;background:#fdf0e0;text-align:left;color:#7a4010;',td:'border:1px solid #f0d5b0;padding:10px;',hr:'border:none;border-top:1px solid #f0d5b0;margin:28px 0;'
  }}
};

function scaledStyle(styleText, fontOffset = 0, spacingOffset = 0) {
  let s = styleText;
  if (fontOffset) s = s.replace(/font-size:(\d+)px/g, (_, n) => `font-size:${Math.max(Number(n) + fontOffset, 9)}px`);
  if (spacingOffset) {
    // match margin with 3 values: top h bot (e.g. margin:36px 0 22px)
    s = s.replace(/margin:([-\d]+)px ([-\d]+(?:px)?) ([-\d]+)px/g, (_, top, mid, bot) =>
      `margin:${Math.max(Number(top) + spacingOffset, 0)}px ${mid} ${Math.max(Number(bot) + spacingOffset, 0)}px`
    );
    // match margin with 4 values: top h bot h (e.g. margin:36px 0 22px 0)
    s = s.replace(/margin:([-\d]+)px ([-\d]+(?:px)?) ([-\d]+)px ([-\d]+(?:px)?)/g, (_, top, h1, bot, h2) =>
      `margin:${Math.max(Number(top) + spacingOffset, 0)}px ${h1} ${Math.max(Number(bot) + spacingOffset, 0)}px ${h2}`
    );
  }
  return s;
}

function applyInlineStyles(container, styleMap, offset = 0) {
  Object.entries(styleMap).forEach(([tag, style]) => {
    const styleWithScale = scaledStyle(style, offset, paraSpacingOffset);
    container.querySelectorAll(tag).forEach(el => {
      const prev = el.getAttribute('style') || '';
      el.setAttribute('style', prev ? `${prev};${styleWithScale}` : styleWithScale);
    });
  });
}

function sanitizeForWechat(html) {
  const theme = themes[themeSelect.value] || themes.simple;
  const offset = fontSizeOffset;
  const doc = new DOMParser().parseFromString(`<section>${html}</section>`, 'text/html');
  const root = doc.body.firstElementChild;
  root.setAttribute('style', theme.section);
  root.querySelectorAll('script,style,iframe,object,embed').forEach(n => n.remove());
  root.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const n = attr.name.toLowerCase();
      if (n.startsWith('on') || n === 'id') el.removeAttribute(attr.name);
      if (n === 'class') {
        const cls = el.getAttribute('class') || '';
        if (cls !== 'math-inline' && cls !== 'math-block') el.removeAttribute(attr.name);
      }
    });
  });
  applyInlineStyles(root, theme.styles, offset);
  // Reset code styles inside pre blocks to avoid extra indentation
  root.querySelectorAll('pre code').forEach(el => {
    el.setAttribute('style', 'background:none;padding:0;border-radius:0;font-size:inherit;font-family:Menlo,Consolas,monospace;');
  });
  // Insert LRM (U+200E) before inline <code> and <strong> inside list items and table cells
  // to prevent WeChat editor from breaking them into separate lines
  root.querySelectorAll('li code, td code, th code').forEach(el => {
    if (el.closest('pre')) return; // skip code blocks
    el.parentNode.insertBefore(doc.createTextNode('\u200E'), el);
  });
  root.querySelectorAll('li strong, td strong, th strong, li b, td b, th b').forEach(el => {
    if (el.previousSibling) return; // only first child (line-start bold)
    el.parentNode.insertBefore(doc.createTextNode('\u200E'), el);
  });
  // For amber theme: center h1/h2 wrapper + colored ol numbers
  if (themeSelect.value === 'amber') {
    // Wrap h1/h2 in a centered div so inline-block centering works in WeChat
    root.querySelectorAll('h1, h2').forEach(el => {
      const wrapper = doc.createElement('div');
      wrapper.setAttribute('style', 'text-align:center;margin:0;padding:0;');
      el.parentNode.insertBefore(wrapper, el);
      wrapper.appendChild(el);
    });
    // Style ol items with amber numbered prefix
    root.querySelectorAll('ol').forEach(ol => {
      ol.setAttribute('style', (ol.getAttribute('style') || '') + ';list-style:none;padding-left:0;');
      ol.querySelectorAll(':scope > li').forEach((li, i) => {
        const marker = `<span style="color:#c8722a;font-weight:700;">${i + 1}、</span>`;
        li.innerHTML = marker + li.innerHTML;
      });
    });
  }
  // For warmred theme: add numbered circle before h2, center h2 wrapper
  if (themeSelect.value === 'warmred') {
    let h2Counter = 0;
    root.querySelectorAll('h2').forEach(el => {
      h2Counter++;
      const num = String(h2Counter).padStart(2, '0');
      const marker = `<span style="display:block;text-align:center;margin-bottom:8px;"><span style="display:inline-block;width:52px;height:52px;line-height:52px;border-radius:50%;background:#c0392b;color:#fff;font-size:24px;font-weight:900;text-align:center;font-family:'DIN Alternate','Impact','Arial Black',sans-serif;letter-spacing:1px;">${num}</span></span>`;
      const wrapper = doc.createElement('div');
      wrapper.setAttribute('style', 'text-align:center;margin:0;padding:0;');
      el.parentNode.insertBefore(wrapper, el);
      wrapper.appendChild(el);
      wrapper.insertAdjacentHTML('afterbegin', marker);
    });
  }
  if (theme.headingVariant === 'ribbon') {
    root.querySelectorAll('h1,h2').forEach(h => {
      const opts = tokenHeadingOptions(h.tagName);
      const wrapper = doc.createElement('section');
      wrapper.setAttribute('style', scaledStyle(tokenHeadingStyle(theme, opts), offset, paraSpacingOffset));
      const label = doc.createElement('section');
      label.setAttribute('style', scaledStyle(
        `display:inline-block;box-sizing:border-box;max-width:88%;padding:${opts.bgPadding};background:${theme.headingBg || theme.accent};border-radius:${opts.bgRadius}px ${opts.bgRadius}px 0 0;color:${theme.headingText || '#ffffff'};font-size:${opts.fontSize}px;line-height:${opts.lineHeight};font-weight:${opts.fontWeight};letter-spacing:0;vertical-align:bottom;`,
        offset,
        paraSpacingOffset
      ));
      label.textContent = h.textContent || '';
      const tail = doc.createElement('span');
      tail.setAttribute('style', `display:inline-block;width:0;height:0;border-left:${opts.tailWidth}px solid ${theme.headingTailBg || '#e5e7eb'};border-top:${opts.tailHeight}px solid transparent;vertical-align:bottom;`);
      wrapper.appendChild(label);
      wrapper.appendChild(tail);
      h.replaceWith(wrapper);
    });
  }
  return root.outerHTML;
}

function renderMath(container) {
  if (typeof katex === 'undefined') return;
  container.querySelectorAll('.math-block').forEach(function(el) {
    var tex = el.textContent.replace(/^\\\[/, '').replace(/\\\]$/, '').trim();
    try { el.innerHTML = katex.renderToString(tex, { displayMode: true, throwOnError: false }); } catch(e) {}
  });
  container.querySelectorAll('.math-inline').forEach(function(el) {
    var tex = el.textContent.replace(/^\\\(/, '').replace(/\\\)$/, '').trim();
    try { el.innerHTML = katex.renderToString(tex, { displayMode: false, throwOnError: false }); } catch(e) {}
  });
}

function render() {
  let md = markdownEl.value || '';
  for (const fn of __mnHooks.beforeRender) {
    try { const r = fn(md); if (typeof r === 'string') md = r; }
    catch (e) { console.error('[MarkNice] beforeRender hook error:', e); }
  }
  const html = sanitizeForWechat(marked.parse(md));
  previewEl.innerHTML = html;
  renderMath(previewEl);
  for (const fn of __mnHooks.afterRender) {
    try { fn(previewEl); }
    catch (e) { console.error('[MarkNice] afterRender hook error:', e); }
  }
  previewEl.dataset.html = previewEl.innerHTML;
  statusEl.textContent = md.trim()
    ? `已转换（${themeSelect.options[themeSelect.selectedIndex].text}｜字号 ${fontSizeOffset >= 0 ? '+' : ''}${fontSizeOffset}｜段距 ${paraSpacingOffset >= 0 ? '+' : ''}${paraSpacingOffset}）`
    : '';
}

async function copyRichHtml(html) {
  if (navigator.clipboard && window.ClipboardItem) {
    const blobHtml = new Blob([html], { type: 'text/html' });
    const blobText = new Blob([previewEl.innerText], { type: 'text/plain' });
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })]);
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(previewEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('copy');
  sel.removeAllRanges();
}

function systemMode() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const sunIcon = document.getElementById('sunIcon');
const moonIcon = document.getElementById('moonIcon');
const navbar = document.getElementById('navbar');

function updateModeUi(mode) {
  document.body.setAttribute('data-mode', mode);
  if (mode === 'dark') {
    sunIcon.style.display = 'none';
    moonIcon.style.display = 'block';
  } else {
    sunIcon.style.display = 'block';
    moonIcon.style.display = 'none';
  }
}

// Navbar scroll effect
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 10);
});

function applyMode(mode, persist = true) {
  const safe = mode === 'dark' ? 'dark' : 'light';
  updateModeUi(safe);
  if (persist) localStorage.setItem('ui-mode', safe);
}

const savedMode = localStorage.getItem('ui-mode');
if (savedMode) {
  applyMode(savedMode, false);
} else {
  updateModeUi(systemMode());
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem('ui-mode')) updateModeUi(systemMode());
});
modeToggleBtn.addEventListener('click', () => {
  const current = document.body.getAttribute('data-mode') || systemMode();
  applyMode(current === 'light' ? 'dark' : 'light', true);
});
modeToggleBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  localStorage.removeItem('ui-mode');
  updateModeUi(systemMode());
  statusEl.textContent = '已切回跟随系统模式';
});

document.getElementById('convertBtn')?.addEventListener('click', render);
themeSelect.addEventListener('change', render);
fontSizeDown.addEventListener('click', () => {
  fontSizeOffset = Math.max(fontSizeOffset - 1, -6);
  fontSizeLabel.textContent = fontSizeOffset;
  render();
});
fontSizeUp.addEventListener('click', () => {
  fontSizeOffset = Math.min(fontSizeOffset + 1, 6);
  fontSizeLabel.textContent = fontSizeOffset;
  render();
});
const paraSpacingLabel = document.getElementById('paraSpacingLabel');
document.getElementById('paraSpacingDown').addEventListener('click', () => {
  paraSpacingOffset = Math.max(paraSpacingOffset - 2, -16);
  paraSpacingLabel.textContent = paraSpacingOffset;
  render();
});
document.getElementById('paraSpacingUp').addEventListener('click', () => {
  paraSpacingOffset = Math.min(paraSpacingOffset + 2, 24);
  paraSpacingLabel.textContent = paraSpacingOffset;
  render();
});
markdownEl.addEventListener('input', () => {
  clearTimeout(window.__renderTimer);
  window.__renderTimer = setTimeout(render, 250);
});
document.getElementById('copyBtn').addEventListener('click', async () => {
  const html = previewEl.dataset.html || '';
  if (!html.trim()) return (statusEl.textContent = '请先输入并转换内容');
  try {
    await copyRichHtml(html);
    statusEl.textContent = '复制成功，可去公众号编辑器粘贴';
  } catch {
    statusEl.textContent = '复制失败，请手动全选预览区复制';
  }
});
document.getElementById('copyMdBtn').addEventListener('click', async () => {
  const md = markdownEl.value;
  if (!md.trim()) return (statusEl.textContent = '请先输入 Markdown 内容');
  try {
    await navigator.clipboard.writeText(md);
    statusEl.textContent = 'Markdown 源码已复制到剪贴板';
  } catch {
    statusEl.textContent = '复制失败，请手动选中编辑区复制';
  }
});
document.getElementById('sampleBtn').addEventListener('click', () => {
  markdownEl.value = `# 公众号排版标题\n\n这是一段**正文**，用于测试粘贴到微信公众号编辑器后的样式。\n\n## 二级标题\n\n- 列表项一\n- 列表项二\n\n> 这是引用区块，可以用于金句或重点提示。\n\n\`\`\`js\nconsole.log('hello wechat');\n\`\`\`\n\n[一个链接](https://mp.weixin.qq.com)`;
  render();
});
document.getElementById('clearBtn').addEventListener('click', () => {
  markdownEl.value = '';
  previewEl.innerHTML = '';
  previewEl.dataset.html = '';
  statusEl.textContent = '';
});
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  markdownEl.value = await file.text();
  render();
});

// ===== HTML to Markdown converter =====
function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const children = Array.from(node.childNodes).map(processNode).join('');
    switch (tag) {
      case 'h1': return '# ' + children.trim() + '\n\n';
      case 'h2': return '## ' + children.trim() + '\n\n';
      case 'h3': return '### ' + children.trim() + '\n\n';
      case 'h4': return '#### ' + children.trim() + '\n\n';
      case 'h5': return '##### ' + children.trim() + '\n\n';
      case 'h6': return '###### ' + children.trim() + '\n\n';
      case 'p': return children.trim() + '\n\n';
      case 'br': return '\n';
      case 'strong': case 'b': return '**' + children.trim() + '**';
      case 'em': case 'i': return '*' + children.trim() + '*';
      case 'u': return '<u>' + children.trim() + '</u>';
      case 's': case 'strike': case 'del': return '~~' + children.trim() + '~~';
      case 'sub': return '<sub>' + children.trim() + '</sub>';
      case 'sup': return '<sup>' + children.trim() + '</sup>';
      case 'a': {
        const href = node.getAttribute('href') || '';
        const text = children.trim();
        if (!text && !href) return '';
        if (!href) return text;
        return '[' + text + '](' + href + ')';
      }
      case 'img': {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        return '![' + alt + '](' + src + ')\n\n';
      }
      case 'ul': return children + '\n';
      case 'ol': return children + '\n';
      case 'li': {
        const parent = node.parentElement;
        const isOl = parent && parent.tagName.toLowerCase() === 'ol';
        const idx = isOl ? Array.from(parent.children).indexOf(node) + 1 : 0;
        const prefix = isOl ? idx + '. ' : '- ';
        return prefix + children.trim() + '\n';
      }
      case 'blockquote': {
        const lines = children.trim().split('\n');
        return lines.map(function(l) { return '> ' + l; }).join('\n') + '\n\n';
      }
      case 'pre': return '```\n' + node.textContent.trim() + '\n```\n\n';
      case 'code': {
        if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') return children;
        return '`' + children.trim() + '`';
      }
      case 'hr': return '---\n\n';
      case 'table': return processTable(node);
      case 'span': {
        if (node.classList && node.classList.contains('math-inline')) {
          var tex = node.textContent.replace(/^\\\(/, '').replace(/\\\)$/, '').trim();
          return tex ? ('$' + tex + '$') : children;
        }
        return children;
      }
      case 'div': {
        if (node.classList && node.classList.contains('math-block')) {
          var tex = node.textContent.replace(/^\\\[/, '').replace(/\\\]$/, '').trim();
          return tex ? ('$$' + tex + '$$\n\n') : children;
        }
        return children;
      }
      default: return children;
    }
  }

  function processTable(table) {
    const rows = Array.from(table.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr'));
    if (!rows.length) return '';
    let hasMerge = false;
    rows.forEach(function(row) {
      row.querySelectorAll('th, td').forEach(function(cell) {
        if (parseInt(cell.getAttribute('colspan') || '1', 10) > 1 ||
            parseInt(cell.getAttribute('rowspan') || '1', 10) > 1) hasMerge = true;
      });
    });
    if (hasMerge) {
      let html = '<table>\n';
      rows.forEach(function(row) {
        html += '<tr>';
        row.querySelectorAll('th, td').forEach(function(cell) {
          const tag = cell.tagName.toLowerCase();
          const cs = cell.getAttribute('colspan');
          const rs = cell.getAttribute('rowspan');
          let attrs = '';
          if (cs && cs !== '1') attrs += ' colspan="' + cs + '"';
          if (rs && rs !== '1') attrs += ' rowspan="' + rs + '"';
          html += '<' + tag + attrs + '>' + cell.textContent.trim() + '</' + tag + '>';
        });
        html += '</tr>\n';
      });
      html += '</table>\n\n';
      return html;
    }
    let md = '';
    rows.forEach(function(row, ri) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      md += '| ' + cells.map(function(c) { return c.textContent.trim(); }).join(' | ') + ' |\n';
      if (ri === 0) md += '| ' + cells.map(function() { return '---'; }).join(' | ') + ' |\n';
    });
    return md + '\n';
  }

  const result = processNode(doc.body);
  var merged = result.replace(/\n{3,}/g, '\n\n');
  // Merge adjacent bold markers: **A** **B** or **A****B** → **A B** or **AB**
  for (var _m = 0; _m < 5; _m++) {
    merged = merged.replace(/\*\*([^*]+?)\*\*( ?)\*\*([^*]+?)\*\*/g, '**$1$2$3**');
  }
  // Merge adjacent italic markers: *A* *B* or *A**B* → *A B* or *AB*
  for (var _n = 0; _n < 5; _n++) {
    merged = merged.replace(/(?<!\*)\*([^*]+?)\*( ?)\*([^*]+?)\*(?!\*)/g, '*$1$2$3*');
  }
  return merged.trim() + '\n';
}

// ===== Word (.docx) import =====
const wordFileInput = document.getElementById('wordFileInput');
wordFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  statusEl.textContent = '正在导入 Word 文档…';
  try {
    const arrayBuffer = await file.arrayBuffer();
    const html = await window.parseDocx(arrayBuffer);
    const markdown = htmlToMarkdown(html);
    markdownEl.value = markdown;
    render();
    statusEl.textContent = '已导入 Word 文档';
  } catch (err) {
    console.error(err);
    statusEl.textContent = '导入失败，请确认文件为 .docx 格式';
  }
  wordFileInput.value = '';
});

// ===== Save as HTML =====
document.getElementById('saveHtmlBtn').addEventListener('click', () => {
  const html = previewEl.dataset.html || '';
  if (!html.trim()) return (statusEl.textContent = '请先输入并转换内容');
  const fullHtml = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>导出内容</title>\n</head>\n<body>\n' + html + '\n</body>\n</html>';
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'export.html';
  a.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = '已保存为 HTML 文件';
});

// ===== Save as PDF =====
document.getElementById('savePdfBtn').addEventListener('click', () => {
  const html = previewEl.dataset.html || '';
  if (!html.trim()) return (statusEl.textContent = '请先输入并转换内容');
  statusEl.textContent = '正在准备 PDF…';
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;height:600px;border:none;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">' +
    '<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"><\/script>' +
    '<style>' +
    'body{margin:0;padding:30px 40px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.8;color:#333}' +
    'h1{font-size:24px;margin:20px 0 10px}h2{font-size:20px;margin:18px 0 8px}h3{font-size:17px;margin:14px 0 6px}' +
    'p{margin:8px 0}img{max-width:100%}' +
    'table{border-collapse:collapse;width:100%;margin:10px 0}td,th{border:1px solid #ccc;padding:6px 10px}th{background:#f5f5f5}' +
    'blockquote{margin:10px 0;padding:8px 16px;border-left:4px solid #ddd;color:#666}' +
    'pre{background:#f6f6f6;padding:12px;border-radius:4px;overflow-x:auto}code{font-size:13px}' +
    '@media print{body{padding:0 20px}@page{margin:15mm 10mm}}' +
    '</style></head><body>' + html + '<\/body></html>');
  doc.close();

  iframe.contentWindow.onafterprint = () => {
    document.body.removeChild(iframe);
  };

  // Wait for KaTeX library to load, then render math and print
  const checkKatexAndRender = () => {
    const win = iframe.contentWindow;
    if (typeof win.katex !== 'undefined') {
      try {
        // Render math formulas
        const container = win.document.body;
        container.querySelectorAll('.math-block').forEach(function(el) {
          const tex = el.textContent.replace(/^\\\[/, '').replace(/\\\]$/, '').trim();
          try {
            el.innerHTML = win.katex.renderToString(tex, { displayMode: true, throwOnError: false });
          } catch(e) {
            console.error('KaTeX block render error:', e);
          }
        });
        container.querySelectorAll('.math-inline').forEach(function(el) {
          const tex = el.textContent.replace(/^\\\(/, '').replace(/\\\)$/, '').trim();
          try {
            el.innerHTML = win.katex.renderToString(tex, { displayMode: false, throwOnError: false });
          } catch(e) {
            console.error('KaTeX inline render error:', e);
          }
        });

        // Wait a bit more for rendering to complete, then print
        setTimeout(() => {
          win.print();
          statusEl.textContent = '请在打印对话框中选择"另存为 PDF"';
          // Fallback cleanup if onafterprint doesn't fire
          setTimeout(() => {
            if (iframe.parentNode) document.body.removeChild(iframe);
          }, 60000);
        }, 300);
      } catch (err) {
        console.error('Error rendering math:', err);
        statusEl.textContent = '准备 PDF 时出错：' + err.message;
        if (iframe.parentNode) document.body.removeChild(iframe);
      }
    } else {
      // KaTeX not loaded yet, wait and retry
      setTimeout(checkKatexAndRender, 100);
    }
  };

  // Start checking after initial delay to allow scripts to load
  setTimeout(checkKatexAndRender, 500);
});

// ===== Word export helpers =====
const WORD_EXPORT_MAX_IMAGE_WIDTH_PX = 560;

function wordPxToPt(px) {
  return ((px * 72) / 96).toFixed(2).replace(/\.?0+$/, '');
}

function wordUpsertStyle(style, prop, value) {
  const pattern = new RegExp(`(^|;)\\s*${prop}\\s*:[^;]*`, 'i');
  if (pattern.test(style)) return style.replace(pattern, `$1${prop}:${value}`);
  return `${style.replace(/;?\s*$/, '')};${prop}:${value}`;
}

function wordBytesFromDataUrl(src) {
  const match = String(src || '').match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  try {
    if (match[2]) {
      const binary = atob(match[3]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    const decoded = decodeURIComponent(match[3]);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    return bytes;
  } catch (err) {
    return null;
  }
}

function wordReadUint32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function wordReadUint16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function wordReadUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function wordReadUint24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function wordReadUint32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function wordAscii(bytes, start, length) {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function wordTextFromDataUrl(src) {
  const bytes = wordBytesFromDataUrl(src);
  if (!bytes) return null;
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch (err) {
    let out = '';
    for (const byte of bytes) out += String.fromCharCode(byte);
    return out;
  }
}

function wordCssLengthToPx(value) {
  const match = String(value || '').trim().match(/^([\d.]+)\s*(px|pt|in|cm|mm)?$/i);
  if (!match) return null;
  const n = Number.parseFloat(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (match[2] || 'px').toLowerCase();
  if (unit === 'pt') return (n * 96) / 72;
  if (unit === 'in') return n * 96;
  if (unit === 'cm') return (n * 96) / 2.54;
  if (unit === 'mm') return (n * 96) / 25.4;
  return n;
}

function wordSvgDimensions(src) {
  if (!/^data:image\/svg\+xml/i.test(src || '')) return null;
  const text = wordTextFromDataUrl(src);
  if (!text) return null;

  const width = /<svg\b[^>]*\bwidth=["']?([^"'\s>]+)/i.exec(text)?.[1];
  const height = /<svg\b[^>]*\bheight=["']?([^"'\s>]+)/i.exec(text)?.[1];
  const widthPx = width ? wordCssLengthToPx(width) : null;
  const heightPx = height ? wordCssLengthToPx(height) : null;
  if (widthPx && heightPx) return { width: Math.round(widthPx), height: Math.round(heightPx) };

  const viewBox = /<svg\b[^>]*\bviewBox=["']\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*["']/i.exec(text);
  if (!viewBox) return null;
  const vbWidth = Number.parseFloat(viewBox[3]);
  const vbHeight = Number.parseFloat(viewBox[4]);
  if (!Number.isFinite(vbWidth) || !Number.isFinite(vbHeight) || vbWidth <= 0 || vbHeight <= 0) return null;
  return { width: Math.round(vbWidth), height: Math.round(vbHeight) };
}

function wordDataImageDimensions(src) {
  const svg = wordSvgDimensions(src);
  if (svg) return svg;

  const bytes = wordBytesFromDataUrl(src);
  if (!bytes || bytes.length < 10) return null;

  const png =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52;
  if (png && bytes.length >= 24) return { width: wordReadUint32BE(bytes, 16), height: wordReadUint32BE(bytes, 20) };

  const gif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes.length >= 10;
  if (gif) return { width: wordReadUint16LE(bytes, 6), height: wordReadUint16LE(bytes, 8) };

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = wordReadUint16BE(bytes, offset + 2);
      if (length < 2) return null;
      if (
        marker === 0xc0 ||
        marker === 0xc1 ||
        marker === 0xc2 ||
        marker === 0xc3 ||
        marker === 0xc5 ||
        marker === 0xc6 ||
        marker === 0xc7 ||
        marker === 0xc9 ||
        marker === 0xca ||
        marker === 0xcb ||
        marker === 0xcd ||
        marker === 0xce ||
        marker === 0xcf
      ) {
        return { width: wordReadUint16BE(bytes, offset + 7), height: wordReadUint16BE(bytes, offset + 5) };
      }
      offset += 2 + length;
    }
  }

  const webp = wordAscii(bytes, 0, 4) === 'RIFF' && wordAscii(bytes, 8, 4) === 'WEBP' && bytes.length >= 30;
  if (webp) {
    const chunk = wordAscii(bytes, 12, 4);
    if (chunk === 'VP8X') return { width: wordReadUint24LE(bytes, 24) + 1, height: wordReadUint24LE(bytes, 27) + 1 };
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = wordReadUint32LE(bytes, 21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: wordReadUint16LE(bytes, 26) & 0x3fff, height: wordReadUint16LE(bytes, 28) & 0x3fff };
    }
  }

  return null;
}

function wordLoadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => reject(new Error('Image load timeout')), 8000);
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Image load failed'));
    };
    image.src = src;
  });
}

async function wordMeasureImage(src, fallbackDimensions) {
  if (fallbackDimensions?.width && fallbackDimensions.height) return fallbackDimensions;
  if (!src) return null;
  try {
    const image = await wordLoadImage(src);
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    if (!width || !height) return null;
    return { width, height };
  } catch (err) {
    return fallbackDimensions;
  }
}

async function prepareHtmlForWordExport(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const img of Array.from(doc.body.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || '';
    const dimensions = await wordMeasureImage(src, wordDataImageDimensions(src));
    const hasDimensions = !!dimensions && dimensions.width > 0 && dimensions.height > 0;
    const displayWidth = Math.max(1, Math.min(hasDimensions ? dimensions.width : WORD_EXPORT_MAX_IMAGE_WIDTH_PX, WORD_EXPORT_MAX_IMAGE_WIDTH_PX));
    const displayHeight = hasDimensions ? Math.max(1, Math.round((dimensions.height * displayWidth) / dimensions.width)) : null;
    const scale = hasDimensions ? Math.round((displayWidth / dimensions.width) * 100) : 100;
    const style = [
      `width:${wordPxToPt(displayWidth)}pt`,
      displayHeight ? `height:${wordPxToPt(displayHeight)}pt` : '',
      `max-width:${wordPxToPt(WORD_EXPORT_MAX_IMAGE_WIDTH_PX)}pt`,
      'display:block',
      'margin:10px auto',
      'border-radius:0',
      hasDimensions ? `mso-width-percent:${scale * 10}` : '',
      hasDimensions ? `mso-height-percent:${scale * 10}` : '',
    ].filter(Boolean).join(';') + ';';
    img.setAttribute('style', style);
    img.setAttribute('width', String(displayWidth));
    if (displayHeight) img.setAttribute('height', String(displayHeight));
    else img.removeAttribute('height');

    const parent = img.parentElement;
    if (parent && /^(figure|p|div|section)$/i.test(parent.tagName)) {
      let parentStyle = parent.getAttribute('style') || '';
      parentStyle = wordUpsertStyle(parentStyle, 'text-align', 'center');
      parentStyle = wordUpsertStyle(parentStyle, 'margin', '14px 0');
      parentStyle = wordUpsertStyle(parentStyle, 'page-break-inside', 'avoid');
      parent.setAttribute('style', parentStyle);
    }
  }
  return doc.body.innerHTML;
}

// ===== Save as Word =====
document.getElementById('saveWordBtn').addEventListener('click', async () => {
  const html = previewEl.dataset.html || '';
  if (!html.trim()) return (statusEl.textContent = '请先输入并转换内容');

  try {
    statusEl.textContent = '正在生成 Word 文档…';

    const wordBodyHtml = await prepareHtmlForWordExport(html);

    // Prepare HTML content with proper structure for Word
    const wordHtml = `
      <!DOCTYPE html>
      <html xmlns:o='urn:schemas-microsoft-com:office:office'
            xmlns:w='urn:schemas-microsoft-com:office:word'
            xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Export</title>
        <style>
          body {
            font-family: 'PingFang SC', 'Microsoft YaHei', SimHei, sans-serif;
            font-size: 14px;
            line-height: 1.8;
            color: #333;
          }
          h1 { font-size: 24px; margin: 20px 0 10px; font-weight: bold; }
          h2 { font-size: 20px; margin: 18px 0 8px; font-weight: bold; }
          h3 { font-size: 17px; margin: 14px 0 6px; font-weight: bold; }
          h4 { font-size: 15px; margin: 12px 0 6px; font-weight: bold; }
          h5 { font-size: 14px; margin: 10px 0 6px; font-weight: bold; }
          h6 { font-size: 13px; margin: 10px 0 6px; font-weight: bold; }
          p { margin: 8px 0; }
          ul, ol { margin: 10px 0; padding-left: 24px; }
          li { margin: 6px 0; }
          blockquote {
            margin: 10px 0;
            padding: 8px 16px;
            border-left: 4px solid #ddd;
            background: #f8f8f8;
            color: #666;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            margin: 10px 0;
          }
          td, th {
            border: 1px solid #ccc;
            padding: 6px 10px;
          }
          th { background: #f5f5f5; font-weight: bold; }
          pre {
            background: #f6f6f6;
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
            white-space: pre-wrap;
          }
          code {
            font-family: Consolas, Monaco, 'Courier New', monospace;
            font-size: 13px;
          }
          img { max-width: ${WORD_EXPORT_MAX_IMAGE_WIDTH_PX}px; display:block; margin:10px auto; }
          figure { text-align:center; margin:14px 0; page-break-inside:avoid; }
          strong { font-weight: bold; }
          em { font-style: italic; }
          u { text-decoration: underline; }
          s { text-decoration: line-through; }
          a { color: #0066cc; text-decoration: underline; }
        </style>
      </head>
      <body>
        ${wordBodyHtml}
      </body>
      </html>
    `;

    // Check if htmlDocx is available
    if (typeof htmlDocx === 'undefined') {
      statusEl.textContent = '错误：Word 导出库未加载';
      return;
    }

    // Convert HTML to Word document
    const converted = htmlDocx.asBlob(wordHtml);

    // Create download link
    const url = URL.createObjectURL(converted);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    statusEl.textContent = '已保存为 Word 文档';
  } catch (err) {
    console.error('Word export error:', err);
    statusEl.textContent = '保存失败：' + err.message;
  }
});

render();

// ===== Phone/Desktop preview mode toggle =====
const previewContainer = document.getElementById('previewContainer');
const desktopModeBtn = document.getElementById('desktopModeBtn');
const phoneModeBtn = document.getElementById('phoneModeBtn');

desktopModeBtn.addEventListener('click', () => {
  previewContainer.classList.remove('phone-mode');
  desktopModeBtn.classList.add('active');
  phoneModeBtn.classList.remove('active');
});

phoneModeBtn.addEventListener('click', () => {
  previewContainer.classList.add('phone-mode');
  phoneModeBtn.classList.add('active');
  desktopModeBtn.classList.remove('active');
});

// ===== Fire ready hooks (extensions registered via MarkNice.onReady) =====
__mnReady = true;
for (const fn of __mnHooks.ready) {
  try { fn(); } catch (e) { console.error('[MarkNice] ready hook error:', e); }
}
