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
 *   POST /api/oss/temp-images    → 上传匿名用户本地图片到 OSS 临时目录，用于复制到公众号
 *   其他                          → 作为静态文件从项目根目录返回
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
const OSS_ACCESS_KEY_ID = process.env.OSS_ACCESS_KEY_ID || '';
const OSS_ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET || '';
const OSS_BUCKET = process.env.OSS_BUCKET || '';
const OSS_ENDPOINT = (process.env.OSS_ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const OSS_PUBLIC_BASE_URL = (process.env.OSS_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const OSS_TEMP_PREFIX = (process.env.OSS_TEMP_PREFIX || 'temp/').replace(/^\/+/, '').replace(/\/?$/, '/');
const OSS_OBJECT_ACL = (process.env.OSS_OBJECT_ACL || 'public-read').trim().toLowerCase();
const OSS_MAX_IMAGES = parseInt(process.env.OSS_MAX_IMAGES, 10) || 12;
const OSS_MAX_IMAGE_BYTES = parseInt(process.env.OSS_MAX_IMAGE_BYTES, 10) || 2 * 1024 * 1024;
const OSS_MAX_REQUEST_BYTES = parseInt(process.env.OSS_MAX_REQUEST_BYTES, 10) || 30 * 1024 * 1024;

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

function readBody(req, maxBytes = 0) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (maxBytes && total > maxBytes) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
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

function ossConfigured() {
  return !!(OSS_ACCESS_KEY_ID && OSS_ACCESS_KEY_SECRET && OSS_BUCKET && OSS_ENDPOINT);
}

function normalizeObjectKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

function publicObjectUrl(objectKey) {
  const encodedKey = normalizeObjectKey(objectKey);
  if (OSS_PUBLIC_BASE_URL) return `${OSS_PUBLIC_BASE_URL}/${encodedKey}`;
  return `https://${OSS_BUCKET}.${OSS_ENDPOINT}/${encodedKey}`;
}

function ossSign(method, contentType, date, objectKey, ossHeaders = {}) {
  const canonicalHeaders = Object.keys(ossHeaders)
    .map((name) => name.toLowerCase())
    .sort()
    .map((name) => `${name}:${ossHeaders[name]}\n`)
    .join('');
  const canonicalResource = `/${OSS_BUCKET}/${objectKey}`;
  const stringToSign = [
    method,
    '',
    contentType || '',
    date,
    canonicalHeaders + canonicalResource,
  ].join('\n');
  const signature = crypto
    .createHmac('sha1', OSS_ACCESS_KEY_SECRET)
    .update(stringToSign, 'utf8')
    .digest('base64');
  return `OSS ${OSS_ACCESS_KEY_ID}:${signature}`;
}

function detectImage(buffer, declaredType, name) {
  const lowerName = String(name || '').toLowerCase();
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) return { mime: 'image/jpeg', ext: 'jpg' };
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) return { mime: 'image/png', ext: 'png' };
  if (
    buffer.length >= 6 &&
    (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a')
  ) return { mime: 'image/gif', ext: 'gif' };
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) return { mime: 'image/webp', ext: 'webp' };
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return { mime: 'image/bmp', ext: 'bmp' };
  }
  if (buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', ext: 'avif' };
  }
  if (/^image\/(jpeg|jpg|png|gif|webp|bmp|avif)$/i.test(declaredType || '')) {
    const mime = declaredType.toLowerCase().replace('image/jpg', 'image/jpeg');
    return { mime, ext: mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length) };
  }
  if (/\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(lowerName)) {
    const ext = lowerName.match(/\.(jpe?g|png|gif|webp|bmp|avif)$/i)[1].replace('jpeg', 'jpg');
    return { mime: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, ext };
  }
  return null;
}

function dataUrlToImage(dataUrl, name) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error(`${name || '图片'} 不是合法的 base64 图片`);
  if (/svg/i.test(match[1])) throw new Error('临时图床不接收 SVG 图片');
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw new Error(`${name || '图片'} 内容为空`);
  if (buffer.length > OSS_MAX_IMAGE_BYTES) {
    throw new Error(`${name || '图片'} 超过大小限制 ${Math.round(OSS_MAX_IMAGE_BYTES / 1024 / 1024)}MB`);
  }
  const detected = detectImage(buffer, match[1], name);
  if (!detected) throw new Error(`${name || '图片'} 不是支持的图片格式`);
  return { buffer, mime: detected.mime, ext: detected.ext };
}

function makeTempObjectKey(name, ext) {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const safeStem = path
    .basename(String(name || 'image'), path.extname(String(name || 'image')))
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'image';
  return `${OSS_TEMP_PREFIX}${yyyy}/${mm}/${dd}/${crypto.randomUUID()}-${safeStem}.${ext}`;
}

async function putObjectToOssOnce(objectKey, buffer, contentType, objectAcl) {
  const date = new Date().toUTCString();
  const ossHeaders = {};
  if (objectAcl && objectAcl !== 'none' && objectAcl !== 'bucket') ossHeaders['x-oss-object-acl'] = objectAcl;
  const headers = {
    Date: date,
    'Content-Type': contentType,
    'Content-Length': String(buffer.length),
    'Cache-Control': 'public, max-age=86400',
    ...ossHeaders,
  };
  headers.Authorization = ossSign('PUT', contentType, date, objectKey, ossHeaders);

  const upstream = await fetch(`https://${OSS_BUCKET}.${OSS_ENDPOINT}/${normalizeObjectKey(objectKey)}`, {
    method: 'PUT',
    headers,
    body: buffer,
  });
  const text = upstream.ok ? '' : await upstream.text().catch(() => '');
  return { ok: upstream.ok, status: upstream.status, text };
}

async function putObjectToOss(objectKey, buffer, contentType) {
  let result = await putObjectToOssOnce(objectKey, buffer, contentType, OSS_OBJECT_ACL);
  if (
    !result.ok &&
    OSS_OBJECT_ACL &&
    OSS_OBJECT_ACL !== 'none' &&
    OSS_OBJECT_ACL !== 'bucket' &&
    result.status === 403 &&
    /bucket acl|access.*object/i.test(result.text)
  ) {
    console.warn('[oss] object ACL rejected by bucket policy, retrying without x-oss-object-acl');
    result = await putObjectToOssOnce(objectKey, buffer, contentType, 'none');
  }
  if (!result.ok) {
    throw new Error(`OSS 上传失败 ${result.status}: ${result.text.slice(0, 200)}`);
  }
}

async function handleTempOssImages(req, res) {
  if (!ossConfigured()) {
    return sendJson(res, 500, {
      error: '服务端未配置 OSS 临时图床，请设置 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET / OSS_ENDPOINT 后重启。',
    });
  }

  const body = await readBody(req, OSS_MAX_REQUEST_BYTES);
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch (_) {
    return sendJson(res, 400, { error: '请求体必须是 JSON' });
  }

  const images = Array.isArray(payload.images) ? payload.images : [];
  if (!images.length) return sendJson(res, 400, { error: '缺少 images' });
  if (images.length > OSS_MAX_IMAGES) return sendJson(res, 400, { error: `单次最多上传 ${OSS_MAX_IMAGES} 张图片` });

  const uploaded = [];
  for (const item of images) {
    const name = item && item.name ? String(item.name) : 'image';
    const image = dataUrlToImage(item && item.dataUrl, name);
    const objectKey = makeTempObjectKey(name, image.ext);
    await putObjectToOss(objectKey, image.buffer, image.mime);
    uploaded.push({
      id: item && item.id ? String(item.id) : '',
      name,
      key: objectKey,
      url: publicObjectUrl(objectKey),
      size: image.buffer.length,
      type: image.mime,
    });
  }

  console.log(`[oss] uploaded temp images count=${uploaded.length}`);
  return sendJson(res, 200, { images: uploaded, prefix: OSS_TEMP_PREFIX });
}

// ---------- API 处理 ----------
async function handleApi(req, res, urlObj) {
  // POST /api/ocr/jobs —— 透传客户端的 multipart 请求体
  if (req.method === 'POST' && urlObj.pathname === '/api/ocr/jobs') {
    if (!TOKEN) {
      return sendJson(res, 500, {
        error: '服务端未配置 PADDLE_OCR_TOKEN，请在项目根目录的 .env 中设置后重启。',
      });
    }
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
    if (!TOKEN) {
      return sendJson(res, 500, {
        error: '服务端未配置 PADDLE_OCR_TOKEN，请在项目根目录的 .env 中设置后重启。',
      });
    }
    const upstream = await fetch(`${PADDLE_OCR_BASE}/${m[1]}`, {
      headers: { Authorization: `bearer ${TOKEN}` },
    });
    console.log(`[proxy] GET  status   jobId=${m[1].slice(0,8)}…  upstream=${upstream.status}`);
    return pipeUpstream(res, upstream);
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/oss/temp-images') {
    return handleTempOssImages(req, res);
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
  console.log(`  ✓ OSS 临时图床: ${ossConfigured() ? `${OSS_BUCKET}/${OSS_TEMP_PREFIX}` : '⚠ 未配置'}`);
  console.log(`  ✓ /api/proxy 白名单: ${PROXY_ALLOWED_SUFFIXES.join(', ')}`);
});
