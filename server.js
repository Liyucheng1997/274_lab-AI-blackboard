// AI黑板 - 零依赖 Node 服务器：静态文件 + Claude 流式代理
// 启动: node server.js   (可选环境变量 ANTHROPIC_API_KEY / BOARD_MODEL / PORT)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const PORT = process.env.PORT || 3275;
const PUBLIC_DIR = path.join(__dirname, 'public');
const API_KEY = process.env.ANTHROPIC_API_KEY;
const DEFAULT_MODEL = process.env.BOARD_MODEL || 'claude-opus-5-5';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/* ---------- 请求规整 ---------- */
// 新格式: {system, messages:[{role, content: string | blocks}], model, effort, max_tokens}
// 旧格式: {system, prompt, image_base64}
function normalize(payload) {
  let messages = payload.messages;
  if (!Array.isArray(messages) || !messages.length) {
    const content = [];
    if (payload.image_base64) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: payload.image_base64 } });
    }
    content.push({ type: 'text', text: payload.prompt || '' });
    messages = [{ role: 'user', content }];
  }
  return {
    system: payload.system || '',
    messages,
    model: (typeof payload.model === 'string' && payload.model.trim()) || DEFAULT_MODEL,
    effort: EFFORTS.includes(payload.effort) ? payload.effort : 'medium',
    // Opus 5.5 的思考无法关闭且计入 max_tokens,不能给太小
    max_tokens: Math.max(4000, Math.min(Number(payload.max_tokens) || 16000, 64000)),
  };
}

/* ---------- 后端一: Anthropic API(流式) ---------- */
// emit({t:'text',d}) / emit({t:'thinking'});返回完整文本
async function streamAnthropic(req, emit, signal) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.max_tokens,
      system: req.system,
      messages: req.messages,
      output_config: { effort: req.effort },
      stream: true,
    }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data.error && data.error.message) || `Claude API 请求失败(${resp.status})`);
  }
  let full = '', buf = '';
  const dec = new TextDecoder();
  for await (const chunk of resp.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') { full += ev.delta.text; emit({ t: 'text', d: ev.delta.text }); }
        else if (ev.delta.type === 'thinking_delta') emit({ t: 'thinking' });
      } else if (ev.type === 'content_block_start' && ev.content_block.type === 'thinking') {
        emit({ t: 'thinking' });
      } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason === 'refusal') {
        throw new Error('模型拒绝了这个请求,请换个问法');
      } else if (ev.type === 'error') {
        throw new Error((ev.error && ev.error.message) || 'Claude API 流式错误');
      }
    }
  }
  return full;
}

/* ---------- 后端二: 本地 Claude Code CLI(订阅额度,流式) ---------- */
function streamCLI(req, emit, signal) {
  return new Promise((resolve, reject) => {
    // 把多轮对话压平成一段提示;图片落盘后让 CLI 用 Read 查看
    const tmpFiles = [];
    const parts = [];
    const multi = req.messages.length > 1;
    for (const m of req.messages) {
      let text = '';
      const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      for (const b of blocks) {
        if (b.type === 'text') text += b.text;
        else if (b.type === 'image' && b.source && b.source.data) {
          const f = path.join(os.tmpdir(), `ai-blackboard-${Date.now()}-${tmpFiles.length}.png`);
          fs.writeFileSync(f, Buffer.from(b.source.data, 'base64'));
          tmpFiles.push(f);
          text = `请先用 Read 工具查看这张图片: ${f}\n\n` + text;
        }
      }
      parts.push(multi ? `【${m.role === 'assistant' ? '你之前的输出' : '用户'}】\n${text}` : text);
    }
    const prompt = parts.join('\n\n') + (multi ? '\n\n请直接针对最后一条【用户】消息作答。' : '');

    const args = ['-p', '--model', req.model, '--effort', req.effort,
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    if (req.system) args.push('--system-prompt', req.system);
    if (tmpFiles.length) args.push('--allowedTools', 'Read');

    const child = spawn('claude', args, { windowsHide: true, cwd: os.tmpdir() });
    let streamed = '', result = null, err = '', buf = '', done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      tmpFiles.forEach(f => fs.unlink(f, () => {}));
      fn(v);
    };
    const timer = setTimeout(() => { child.kill(); finish(reject, new Error('Claude CLI 调用超时(5 分钟)')); }, 300000);
    if (signal) signal.addEventListener('abort', () => { child.kill(); finish(reject, new Error('已取消')); });

    child.stdout.on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'stream_event' && ev.event) {
          const e = ev.event;
          if (e.type === 'content_block_delta' && e.delta) {
            if (e.delta.type === 'text_delta') { streamed += e.delta.text; emit({ t: 'text', d: e.delta.text }); }
            else if (e.delta.type === 'thinking_delta') emit({ t: 'thinking' });
          } else if (e.type === 'content_block_start' && e.content_block && e.content_block.type !== 'text') {
            emit({ t: 'thinking' });
          }
        } else if (ev.type === 'result') {
          if (ev.is_error) err = String(ev.result || ev.error || 'claude CLI 返回错误');
          else result = String(ev.result || '');
        }
      }
    });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish(reject, new Error('无法启动 claude CLI: ' + e.message)));
    child.on('close', code => {
      if (result !== null) {
        if (!streamed) emit({ t: 'text', d: result }); // 老版本 CLI 不发增量时兜底
        finish(resolve, result);
      } else if (code === 0 && streamed) finish(resolve, streamed);
      else finish(reject, new Error('claude CLI 失败: ' + (err.trim() || 'exit ' + code)));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function runAI(req, emit, signal) {
  if (API_KEY) return streamAnthropic(req, emit, signal);
  if (hasCli()) return streamCLI(req, emit, signal);
  return Promise.reject(new Error('本服务器未安装 claude CLI 也未配置 API Key,请在页面设置中填写 API Key 使用直连模式'));
}

async function readJSON(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

// POST /api/ai/stream → SSE: {t:'text',d} | {t:'thinking'} | {t:'done',text} | {t:'error',m}
async function handleStream(req, res) {
  let payload;
  try { payload = await readJSON(req); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '请求体不是合法 JSON' }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  const emit = ev => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
  try {
    const text = await runAI(normalize(payload), emit, ctrl.signal);
    emit({ t: 'done', text });
  } catch (err) {
    emit({ t: 'error', m: err.message });
  }
  clearInterval(ping);
  res.end();
}

// POST /api/ai → {text} (非流式,兼容旧页面)
async function handleAI(req, res) {
  let payload;
  try { payload = await readJSON(req); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '请求体不是合法 JSON' }));
    return;
  }
  try {
    const text = await runAI(normalize(payload), () => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// CORS:允许部署在 board.liyucheng.me 的页面调用访问者本机的这个服务(优先走本地 claude 订阅额度)
const ALLOWED_ORIGINS = /^https:\/\/board\.liyucheng\.me$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// claude CLI 是否可用(缓存);部署在服务器上时通常没有 CLI
let cliOk = null;
function hasCli() {
  if (cliOk !== null) return cliOk;
  const out = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  cliOk = out.status === 0 && !!(out.stdout || '').trim();
  return cliOk;
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Chrome PNA:允许公网页面访问本机私有网络服务
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, service: 'board', stream: true, model: DEFAULT_MODEL,
      llm: API_KEY ? 'key' : (hasCli() ? 'cli' : 'none'),
    }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/ai/stream') { handleStream(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/ai') { handleAI(req, res); return; }
  // 静态文件
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`AI黑板已启动: http://localhost:${PORT}`);
  console.log(`默认模型: ${DEFAULT_MODEL}`);
  console.log(API_KEY ? 'AI 模式: Anthropic API (ANTHROPIC_API_KEY)' : 'AI 模式: 本地 Claude Code CLI (订阅额度)');
});
