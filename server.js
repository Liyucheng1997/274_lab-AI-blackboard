// AI黑板 - 零依赖 Node 服务器：静态文件 + Claude API 代理
// 启动: 先设置环境变量 ANTHROPIC_API_KEY，然后 node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3275;
const PUBLIC_DIR = path.join(__dirname, 'public');
const API_KEY = process.env.ANTHROPIC_API_KEY;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 走本地 Claude Code CLI（使用登录的订阅额度，无需 API 密钥）
function callClaudeCLI(payload) {
  return new Promise((resolve, reject) => {
    let prompt = '';
    if (payload.system) prompt += `[系统指令] ${payload.system}\n\n`;
    let tmpFile = null;
    if (payload.image_base64) {
      tmpFile = path.join(os.tmpdir(), `ai-blackboard-${Date.now()}.png`);
      fs.writeFileSync(tmpFile, Buffer.from(payload.image_base64, 'base64'));
      prompt += `请先用 Read 工具查看这张图片: ${tmpFile}\n\n`;
    }
    prompt += payload.prompt || '';

    const child = spawn('claude', ['-p', '--allowedTools', 'Read'], {
      windowsHide: true,
    });
    let out = '', err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude CLI 调用超时(120s)'));
    }, 120000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(new Error('无法启动 claude CLI: ' + e.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (tmpFile) fs.unlink(tmpFile, () => {});
      if (code === 0) resolve(out.trim());
      else reject(new Error('claude CLI 失败: ' + (err || out || 'exit ' + code)));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function handleAI(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '请求体不是合法 JSON' }));
    return;
  }

  const content = [];
  if (payload.image_base64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: payload.image_base64 },
    });
  }
  content.push({ type: 'text', text: payload.prompt || '' });

  // 没有 API 密钥时走本地 Claude Code CLI（订阅额度）
  if (!API_KEY) {
    try {
      const text = await callClaudeCLI(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: payload.model || 'claude-sonnet-5',
        max_tokens: payload.max_tokens || 1500,
        system: payload.system || '',
        messages: [{ role: 'user', content }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      res.writeHead(resp.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: data.error ? data.error.message : 'Claude API 请求失败' }));
      return;
    }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '无法连接 Claude API: ' + err.message }));
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/ai') {
    handleAI(req, res);
    return;
  }
  // 静态文件
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`AI黑板已启动: http://localhost:${PORT}`);
  console.log(API_KEY ? 'AI 模式: Anthropic API (ANTHROPIC_API_KEY)' : 'AI 模式: 本地 Claude Code CLI (订阅额度)');
});
