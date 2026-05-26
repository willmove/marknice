/**
 * pro-extras.js — MarkNice Pro 专属扩展点
 *
 * 仅由 pro/index.html 加载（lite 不加载）。
 * 公共 API 文档见 src/main.js 中 window.MarkNice 命名空间。
 *
 * 注意：本文件不再持有任何凭证。PaddleOCR Token 由后端 server.js
 * 从项目根目录的 .env 读取，前端只调用同源 /api 路径，避免 CORS 与 Token 暴露。
 */
(function () {
  'use strict';

  if (!window.MarkNice || window.MarkNice.tier !== 'pro') {
    console.warn('[pro-extras] MarkNice 未就绪或当前不是 Pro 版，跳过加载。');
    return;
  }

  const MN = window.MarkNice;

  // ===========================================================================
  // 模块：导入 PDF（PaddleOCR，经本地代理）
  // ---------------------------------------------------------------------------

  const API = {
    submit: '/api/ocr/jobs',
    status: (id) => `/api/ocr/jobs/${encodeURIComponent(id)}`,
    proxy: (url) => `/api/proxy?url=${encodeURIComponent(url)}`,
  };

  const OCR_OPTIONAL = {
    useDocOrientationClassify: false,
    useDocUnwarping: false,
    useChartRecognition: false,
  };

  const POLL_INTERVAL_MS = 5000;

  async function readJsonOrThrow(res, ctxLabel) {
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    if (!res.ok) {
      const msg = (json && (json.error || json.message)) || text || res.statusText;
      throw new Error(`${ctxLabel} ${res.status}：${msg}`);
    }
    return json;
  }

  async function submitOcrJob(file) {
    const data = new FormData();
    data.append('model', 'PaddleOCR-VL-1.5');
    data.append('optionalPayload', JSON.stringify(OCR_OPTIONAL));
    data.append('file', file);
    const res = await fetch(API.submit, { method: 'POST', body: data });
    const json = await readJsonOrThrow(res, '提交失败');
    if (!json?.data?.jobId) throw new Error('返回数据缺少 jobId');
    return json.data.jobId;
  }

  async function pollJobUntilDone(jobId, onProgress) {
    while (true) {
      const res = await fetch(API.status(jobId));
      const json = await readJsonOrThrow(res, '查询失败');
      const data = json?.data || {};
      const state = data.state;
      if (state === 'pending') {
        onProgress({ phase: 'pending' });
      } else if (state === 'running') {
        const p = data.extractProgress || {};
        onProgress({ phase: 'running', total: p.totalPages, done: p.extractedPages });
      } else if (state === 'done') {
        const url = data.resultUrl?.jsonUrl;
        if (!url) throw new Error('任务完成但缺少结果地址');
        return url;
      } else if (state === 'failed') {
        throw new Error(`OCR 失败：${data.errorMsg || '未知错误'}`);
      } else {
        onProgress({ phase: state || 'unknown' });
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function fetchAsDataUrl(remoteUrl) {
    try {
      const res = await fetch(API.proxy(remoteUrl));
      if (!res.ok) return remoteUrl;
      const blob = await res.blob();
      return await blobToDataUrl(blob);
    } catch (e) {
      console.warn('[pro-extras] 图片下载失败，保留原 URL:', remoteUrl, e);
      return remoteUrl;
    }
  }

  function replaceImagePaths(md, pathToUrlMap) {
    if (!md) return md;
    const entries = Object.entries(pathToUrlMap).sort((a, b) => b[0].length - a[0].length);
    for (const [p, url] of entries) {
      md = md.split(p).join(url);
    }
    return md;
  }

  async function fetchAndAssembleMarkdown(jsonUrl, onPageDone) {
    const res = await fetch(API.proxy(jsonUrl));
    if (!res.ok) throw new Error(`下载结果失败 ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split('\n').filter(Boolean);
    const pages = [];
    let pageIndex = 0;
    for (const line of lines) {
      let parsed;
      try { parsed = JSON.parse(line); }
      catch (e) { console.warn('[pro-extras] JSONL 行解析失败已跳过', e); continue; }
      const result = parsed?.result;
      if (!result?.layoutParsingResults) continue;
      for (const page of result.layoutParsingResults) {
        const mdText = page?.markdown?.text || '';
        const images = page?.markdown?.images || {};
        const dataUrls = {};
        await Promise.all(
          Object.entries(images).map(async ([p, url]) => {
            dataUrls[p] = await fetchAsDataUrl(url);
          })
        );
        pages.push(replaceImagePaths(mdText, dataUrls));
        pageIndex += 1;
        if (typeof onPageDone === 'function') onPageDone(pageIndex);
      }
    }
    return pages.join('\n\n---\n\n');
  }

  async function importPdf(file) {
    MN.setStatus(`正在上传 PDF：${file.name}…`);
    const jobId = await submitOcrJob(file);
    MN.setStatus(`已提交任务 ${jobId.slice(0, 8)}… 等待处理`);
    const jsonUrl = await pollJobUntilDone(jobId, ({ phase, total, done }) => {
      if (phase === 'pending') MN.setStatus('OCR 任务排队中…');
      else if (phase === 'running') {
        MN.setStatus(total ? `OCR 进行中：${done || 0}/${total} 页` : 'OCR 进行中…');
      } else MN.setStatus(`OCR 状态：${phase}`);
    });
    MN.setStatus('正在下载并合并结果…');
    const md = await fetchAndAssembleMarkdown(jsonUrl, (n) => {
      MN.setStatus(`已合并 ${n} 页…`);
    });
    if (!md.trim()) throw new Error('OCR 结果为空');
    MN.setMarkdown(md);
    MN.setStatus('PDF 导入完成');
  }

  // ---------------------------------------------------------------------------
  // UI 注入：在"导入 Word"按钮后面追加"导入 PDF"按钮
  // ---------------------------------------------------------------------------
  function buildPdfButton() {
    const label = document.createElement('label');
    label.className = 'file-upload-btn';
    label.title = '导入 PDF（经本地代理调用 PaddleOCR）';
    label.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <text x="7" y="18" font-size="6" fill="currentColor" stroke="none" font-family="Arial">PDF</text>
      </svg>
      <span class="btn-label">导入 PDF</span>
    `;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.hidden = true;
    label.appendChild(input);

    let busy = false;
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (busy) { MN.setStatus('上一次任务尚未完成，请稍候'); return; }
      busy = true;
      label.style.opacity = '0.6';
      label.style.pointerEvents = 'none';
      try {
        await importPdf(file);
      } catch (err) {
        console.error('[pro-extras] PDF 导入失败:', err);
        const msg = err.message || String(err);
        const hint = msg.includes('Failed to fetch') || msg.includes('NetworkError')
          ? '（请确认已通过 `node server/server.js` 启动后端代理）'
          : '';
        MN.setStatus(`PDF 导入失败：${msg}${hint}`);
      } finally {
        input.value = '';
        busy = false;
        label.style.opacity = '';
        label.style.pointerEvents = '';
      }
    });

    return label;
  }

  function injectPdfButton() {
    const wordInput = document.getElementById('wordFileInput');
    const wordLabel = wordInput ? wordInput.closest('.file-upload-btn') : null;
    if (!wordLabel || !wordLabel.parentNode) {
      console.warn('[pro-extras] 找不到导入 Word 按钮，未注入 PDF 按钮');
      return;
    }
    const pdfLabel = buildPdfButton();
    wordLabel.parentNode.insertBefore(pdfLabel, wordLabel.nextSibling);
  }

  MN.onReady(() => {
    injectPdfButton();
    console.info('[MarkNice Pro] 已加载：PDF 导入（PaddleOCR 经本地代理）');
  });

  // ---------------------------------------------------------------------------
  // 后续 Pro 功能可在此扩展，建议按模块拆分：
  //   - AI 改写 / 摘要 / 翻译
  //   - 图床上传与图片压缩
  //   - 自定义模板管理与导入导出
  //   - 多文档草稿管理（基于 IndexedDB / localStorage）
  //   - 协作分享链接
  // ---------------------------------------------------------------------------
})();
