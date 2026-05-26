# MarkNice

Markdown / Word 转微信公众号排版格式的 Web 应用。

## 功能

- 粘贴或上传 Markdown（`.md / .markdown / .txt`），实时预览转换结果
- 导入 Word 文档（`.docx`），自动识别标题编号、有序/无序列表、合并单元格表格、OMML 数学公式、图片、文本格式
- 数学公式通过 KaTeX 渲染为 HTML
- 12 种公众号排版主题：简洁、雅致、科技、教育、新闻、杂志、琥珀橙、活力紫、极简留白、复古专栏、暖红知识、暗夜霓虹
- 字号与段距自由调节
- 一键复制富文本（`text/html` + `text/plain`），直接粘贴到公众号编辑器
- 另存为 HTML 文件
- 保存为 PDF 文件（通过打印对话框，文字可选可复制）
- 保存为 Word 文档（.docx 格式，保留格式和样式）
- 桌面 / 手机预览模式切换
- 深色 / 浅色主题，支持跟随系统
- 移动端触屏优化

## 项目结构

```text
marknice/
├── index.html            # 首页（Hero / 特性介绍）
├── lite/index.html       # Lite 编辑器
├── pro/index.html        # Pro 编辑器（含 PDF 导入等扩展）
├── src/
│   ├── main.js           # 业务逻辑（转换、模板、复制、Word 导入、HTML/PDF/Word 导出）
│   ├── pro-extras.js     # Pro 专属扩展（PDF 导入等）
│   ├── docx-parser.js    # 自定义 DOCX 解析器（编号、合并单元格、公式、图片）
│   └── styles.css        # 页面样式（含移动端响应式）
├── server/
│   └── server.js         # 零依赖 Node 服务（静态文件 + PaddleOCR 代理）
├── .env.example          # 后端配置模板
└── README.md
```

## 外部依赖（CDN）

- [marked](https://github.com/markedjs/marked) — Markdown 解析
- [JSZip](https://stuk.github.io/jszip/) — DOCX 文件解压
- [KaTeX](https://katex.org/) — 数学公式渲染
- [html-docx-js](https://github.com/evidenceprime/html-docx-js) — HTML 转 Word 文档

## 本地运行

### 方式 A：仅 Lite（纯静态）

```bash
git clone https://github.com/willmove/marknice.git
cd marknice
python3 -m http.server 8080
# 或 npx serve .
```

访问 `http://localhost:8080/lite/`。

### 方式 B：包含 Pro 的完整版（PDF 导入需要）

Pro 版的"导入 PDF"通过本地 Node 代理调用 PaddleOCR API，规避浏览器 CORS 限制并保护 Token。需要 **Node.js >= 18**。

```bash
# 1. 复制环境变量模板，填入自己的 PaddleOCR Token
cp .env.example .env
# 编辑 .env，填写 PADDLE_OCR_TOKEN=...

# 2. 启动服务（同时托管静态文件和 /api 代理）
node server/server.js
```

打开浏览器访问：

- 首页：`http://localhost:8080/`
- Lite：`http://localhost:8080/lite/`
- Pro：`http://localhost:8080/pro/`

> Token 仅保存在 `.env`，不会随仓库提交（已在 .gitignore 中忽略）。
> Pro 的"导入 PDF"按钮需要后端运行，其余功能（Markdown/Word 导入、主题、导出等）静态部署即可使用。

## 部署

页面资源使用相对路径，可直接部署到任意静态托管服务。

手动同步示例：

```bash
sudo rsync -av --delete /path/to/marknice/ /var/www/marknice/
```

## 🤝 联系我们

如果您有任何建议、反馈或合作意向，欢迎通过以下方式联系我们：

- 📧 邮箱: willmove#163.com (# 替换为 @)
- 💬 GitHub: [https://github.com/willmove/]
- 📱 微信: [willmove]


**关注公众号**，分享更多 AI 产品实践技巧：

![alt text](qr_code.jpg)


