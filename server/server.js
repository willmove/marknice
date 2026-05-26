/**
 * MarkNice 本地代理 + 静态文件服务器
 *
 * 启动：node server/server.js
 * 依赖：Node.js >= 18（使用全局 fetch / FormData）
 * 配置：项目根目录下 .env（参见 .env.example）
 *
 * 路由：
 *   POST /api/ocr/jobs           → 转发到 PaddleOCR 提交任务（注入 .env 里的 Token）
 *   GET  /api/ocr/jobs/:id       → 转发到 PaddleOCR 查询状态
 *   GET  /api/proxy?url=...      → 受限白名单内的任意 URL 透传（用于下载结果 JSON 与图片）
 *   其他                          → 作为静态文件从项目根目录返回
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ---------- 简易 .env 加载器（无依赖） ----------
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(path.join(ROOT, '.env'));

const PORT = parseInt(process.env.PORT, 10) || 8080;
const TOKEN = process.env.PADDLE_OCR_TOKEN || '';
const PADDLE_OCR_BASE = process.env.PADDLE_OCR_BASE || 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';

// 允许 /api/proxy 透传的主机后缀（逗号分隔），默认覆盖 PaddleOCR 与百度对象存储
const DEFAULT_PROXY_HOSTS = '.aistudio-app.com,.bcebos.com';
const PROXY_ALLOWED_SUFFIXES = (process.env.PROXY_ALLOWED_HOSTS || DEFAULT_PROXY_HOSTS)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// ---------- 工具 ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'upgrade',
  'content-encoding', // body 已被 fetch 解码
]);

async function pipeUpstream(res, upstream) {
  res.statusCode = upstream.status;
  upstream.headers.forEach((value, name) => {
    if (HOP_BY_HOP.has(name.toLowerCase())) return;
    try { res.setHeader(name, value); } catch (_) {}
  });
  const ab = await upstream.arrayBuffer();
  res.end(Buffer.from(ab));
}

function hostAllowed(hostname) {
  const h = hostname.toLowerCase();
  return PROXY_ALLOWED_SUFFIXES.some((s) =>
    s.startsWith('.') ? h.endsWith(s) || h === s.slice(1) : h === s
  );
}

// ---------- API 处理 ----------
async function handleApi(req, res, urlObj) {
  if (!TOKEN) {
    return sendJson(res, 500, {
      error: '服务端未配置 PADDLE_OCR_TOKEN，请在项目根目录的 .env 中设置后重启。',
    });
  }

  // POST /api/ocr/jobs —— 透传客户端的 multipart 请求体
  if (req.method === 'POST' && urlObj.pathname === '/api/ocr/jobs') {
    const body = await readBody(req);
    console.log(`[proxy] POST submit  size=${body.length}B  ct=${req.headers['content-type']}`);
    const upstream = await fetch(PADDLE_OCR_BASE, {
      method: 'POST',
      headers: {
        Authorization: `bearer ${TOKEN}`,
        'Content-Type': req.headers['content-type'] || 'application/octet-stream',
      },
      body,
    });
    console.log(`[proxy] POST submit  upstream=${upstream.status}`);
    return pipeUpstream(res, upstream);
  }

  // GET /api/ocr/jobs/:id
  const m = urlObj.pathname.match(/^\/api\/ocr\/jobs\/([\w-]+)$/);
  if (req.method === 'GET' && m) {
    const upstream = await fetch(`${PADDLE_OCR_BASE}/${m[1]}`, {
      headers: { Authorization: `bearer ${TOKEN}` },
    });
    console.log(`[proxy] GET  status   jobId=${m[1].slice(0,8)}…  upstream=${upstream.status}`);
    return pipeUpstream(res, upstream);
  }

  // 友好错误：GET /api/ocr/jobs 没带 jobId
  if (req.method === 'GET' && urlObj.pathname === '/api/ocr/jobs') {
    return sendJson(res, 400, { error: '缺少 jobId，调用方式应为 GET /api/ocr/jobs/:jobId' });
  }

  // GET /api/proxy?url=<encoded>
  if (req.method === 'GET' && urlObj.pathname === '/api/proxy') {
    const target = urlObj.searchParams.get('url');
    if (!target) return sendJson(res, 400, { error: '缺少 url 参数' });
    let parsed;
    try { parsed = new URL(target); } catch { return sendJson(res, 400, { error: '非法 url' }); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return sendJson(res, 400, { error: '协议必须为 http/https' });
    }
    if (!hostAllowed(parsed.hostname)) {
      return sendJson(res, 403, { error: `主机不在白名单中: ${parsed.hostname}` });
    }
    const upstream = await fetch(target);
    console.log(`[proxy] GET  proxy    host=${parsed.hostname}  upstream=${upstream.status}`);
    return pipeUpstream(res, upstream);
  }

  console.warn(`[proxy] unmatched ${req.method} ${urlObj.pathname}`);
  return sendJson(res, 404, { error: 'API 路径不存在' });
}

// ---------- 静态文件 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function safeJoin(root, reqPath) {
  // 防止路径穿越
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const joined = path.normalize(path.join(root, decoded));
  if (!joined.startsWith(root)) return null;
  return joined;
}

function serveStatic(req, res, urlObj) {
  let filePath = safeJoin(ROOT, urlObj.pathname);
  if (!filePath) { res.writeHead(403); return res.end('Forbidden'); }

  fs.stat(filePath, (err, stat) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      fs.stat(filePath, (e2, s2) => {
        if (e2 || !s2.isFile()) { res.writeHead(404); return res.end('Not Found'); }
        sendFile(res, filePath);
      });
    } else {
      sendFile(res, filePath);
    }
  });
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  // 开发阶段：HTML/JS/CSS 不缓存，避免改动后浏览器拿到旧版
  const noCacheExts = new Set(['.html', '.htm', '.js', '.mjs', '.css']);
  const headers = { 'Content-Type': type };
  if (noCacheExts.has(ext)) headers['Cache-Control'] = 'no-store, must-revalidate';
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

// ---------- 主入口 ----------
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (urlObj.pathname.startsWith('/api/')) {
      await handleApi(req, res, urlObj);
    } else {
      serveStatic(req, res, urlObj);
    }
  } catch (err) {
    console.error('[server] 处理请求失败:', err);
    if (!res.headersSent) sendJson(res, 502, { error: err.message || '上游错误' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`MarkNice server running at http://localhost:${PORT}`);
  console.log(`  ✓ 静态文件根目录: ${ROOT}`);
  console.log(`  ✓ PaddleOCR token: ${TOKEN ? '已加载' : '⚠ 未配置（PDF 导入将不可用）'}`);
  console.log(`  ✓ /api/proxy 白名单: ${PROXY_ALLOWED_SUFFIXES.join(', ')}`);
});
