/* AI 黑板 - AI 后端:设置、后端探测、流式调用 */

/* ---------- 设置(只存本机浏览器) ---------- */
const SETTINGS_KEY = 'blackboard-settings';
const DEFAULT_SETTINGS = { apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', effort: 'medium' };
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch {}
  // 旧版本默认模型是 claude-sonnet-5,升级后统一改用 Opus 5.5
  if (!s.model || s.model === 'claude-sonnet-5') s.model = DEFAULT_SETTINGS.model;
  return { ...DEFAULT_SETTINGS, ...s };
}
let settings = loadSettings();

const backendBadge = document.getElementById('backendBadge');
const settingsMask = document.getElementById('settingsMask');
const settingsInfo = document.getElementById('settingsInfo');
const setApiKey = document.getElementById('setApiKey');
const setBaseUrl = document.getElementById('setBaseUrl');
const setModel = document.getElementById('setModel');
const setEffort = document.getElementById('setEffort');
const setUseLocal = document.getElementById('setUseLocal');

function openSettings() {
  setApiKey.value = settings.apiKey;
  setBaseUrl.value = settings.baseUrl;
  setModel.value = settings.model;
  setEffort.value = settings.effort;
  setUseLocal.checked = localStorage.getItem(LOCAL_FLAG) === '1';
  settingsInfo.textContent = backend.mode === 'server'
    ? '当前走服务器 AI 后端(claude CLI 订阅额度或服务器密钥)。API Key 与地址仅在其不可用时生效。'
    : '未检测到可用的服务器 AI 后端,将由浏览器直连 Anthropic API,请填写你自己的 API Key。';
  settingsMask.classList.remove('hidden');
}
document.getElementById('btn-settings').onclick = openSettings;
document.getElementById('settingsCancel').onclick = () => settingsMask.classList.add('hidden');
settingsMask.addEventListener('click', (e) => { if (e.target === settingsMask) settingsMask.classList.add('hidden'); });
document.getElementById('settingsSave').onclick = () => {
  settings = {
    apiKey: setApiKey.value.trim(),
    baseUrl: setBaseUrl.value.trim() || DEFAULT_SETTINGS.baseUrl,
    model: setModel.value.trim() || DEFAULT_SETTINGS.model,
    effort: setEffort.value || DEFAULT_SETTINGS.effort,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (setUseLocal.checked) localStorage.setItem(LOCAL_FLAG, '1');
  else localStorage.removeItem(LOCAL_FLAG);
  settingsMask.classList.add('hidden');
  // 重新探测(勾选本机服务时给 15 秒,留时间响应浏览器的本地网络权限询问)
  backendReady = detectBackend(setUseLocal.checked ? 15000 : 5000);
  updateBadge();
};

/* ---------- 后端探测 ---------- */
// 优先级:① 同源服务器(claude CLI 或服务器密钥) ② 访问者本机 localhost:3275(需在设置中开启,
// 因为 Chrome 会为"公网页面访问本机"弹权限询问) ③ 浏览器直连 Anthropic API
const LOCAL_PORT = 3275;
const LOCAL_FLAG = 'blackboard-use-local';
let backend = { mode: 'detecting', base: '', stream: false };
let backendReady = Promise.resolve();

async function probeHealth(base, ms) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 2500);
    const r = await fetch(base + '/api/health', { signal: ctrl.signal });
    clearTimeout(t);
    const h = await r.json();
    if (h && h.ok && (h.llm === 'cli' || h.llm === 'key')) return h;
  } catch {}
  return null;
}

const onLocalPage = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

async function detectBackend(localProbeMs) {
  let h = await probeHealth('');
  if (h) backend = { mode: 'server', base: '', stream: !!h.stream };
  else if (!onLocalPage && localStorage.getItem(LOCAL_FLAG) === '1' &&
           (h = await probeHealth(`http://localhost:${LOCAL_PORT}`, localProbeMs || 5000))) {
    backend = { mode: 'server', base: `http://localhost:${LOCAL_PORT}`, stream: !!h.stream };
  } else backend = { mode: 'direct', base: '', stream: true };
  updateBadge();
}
backendReady = detectBackend();

function updateBadge() {
  if (!backendBadge) return;
  if (backend.mode === 'server') {
    backendBadge.textContent = backend.base ? '本机 Claude ✓' : '服务器 AI ✓';
    backendBadge.className = 'backend-badge ok';
  } else if (backend.mode === 'direct') {
    backendBadge.textContent = settings.apiKey ? 'API 直连 ✓' : '未配置 API Key';
    backendBadge.className = 'backend-badge ' + (settings.apiKey ? 'ok' : 'warn');
  } else {
    backendBadge.textContent = '检测后端中…';
    backendBadge.className = 'backend-badge';
  }
}
updateBadge();

/* ---------- 流式调用 ---------- */
// 逐条产出 SSE 的 data: JSON
async function* sseEvents(resp) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      try { yield JSON.parse(line.slice(5)); } catch {}
    }
  }
}

function imageBlock(b64) {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } };
}

/**
 * 流式调用 AI。
 * @param {{system?:string, messages:Array, effort?:string, maxTokens?:number,
 *          onText?:(delta:string)=>void, onThinking?:()=>void, signal?:AbortSignal}} o
 * @returns {Promise<string>} 完整回答文本
 */
async function aiStream(o) {
  await backendReady;
  const effort = o.effort || settings.effort || 'medium';
  const maxTokens = o.maxTokens || 16000;
  const onText = o.onText || (() => {});
  const onThinking = o.onThinking || (() => {});

  if (backend.mode === 'server') {
    if (!backend.stream) return legacyServerCall(o, onText);
    const resp = await fetch(backend.base + '/api/ai/stream', {
      method: 'POST',
      signal: o.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: o.system || '', messages: o.messages, model: settings.model, effort, max_tokens: maxTokens }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || `AI 请求失败(${resp.status})`);
    }
    let full = '', final = null;
    for await (const ev of sseEvents(resp)) {
      if (ev.t === 'text') { full += ev.d; onText(ev.d); }
      else if (ev.t === 'thinking') onThinking();
      else if (ev.t === 'done') final = ev.text;
      else if (ev.t === 'error') throw new Error(ev.m || 'AI 请求失败');
    }
    return final != null ? final : full;
  }

  // 浏览器直连 Anthropic API
  if (!settings.apiKey) {
    openSettings();
    throw new Error('请先在「⚙️ 设置」里填写 Anthropic API Key(或在本机运行 node server.js)');
  }
  const resp = await fetch(settings.baseUrl.replace(/\/+$/, '') + '/v1/messages', {
    method: 'POST',
    signal: o.signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model || DEFAULT_SETTINGS.model,
      max_tokens: maxTokens,
      system: o.system || '',
      messages: o.messages,
      output_config: { effort },
      stream: true,
    }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error?.message || `Anthropic API 请求失败(${resp.status})`);
  }
  let full = '';
  for await (const ev of sseEvents(resp)) {
    if (ev.type === 'content_block_delta') {
      if (ev.delta.type === 'text_delta') { full += ev.delta.text; onText(ev.delta.text); }
      else if (ev.delta.type === 'thinking_delta') onThinking();
    } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') {
      onThinking();
    } else if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'refusal') {
      throw new Error('模型拒绝了这个请求,请换个问法');
    } else if (ev.type === 'error') {
      throw new Error(ev.error?.message || 'Anthropic API 流式错误');
    }
  }
  return full;
}

// 旧版本机服务(没有 /api/ai/stream):压平成单轮,非流式
async function legacyServerCall(o, onText) {
  let image, prompt = '';
  for (const m of o.messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    for (const b of blocks) {
      if (b.type === 'text') prompt += (m.role === 'assistant' ? '【你之前的输出】\n' : '') + b.text + '\n\n';
      else if (b.type === 'image') image = b.source.data;
    }
  }
  const resp = await fetch(backend.base + '/api/ai', {
    method: 'POST',
    signal: o.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, system: o.system, image_base64: image, max_tokens: o.maxTokens || 16000 }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'AI 请求失败');
  onText(data.text);
  return data.text;
}

// 一次性(非流式语义)调用:识别类小任务用低思考深度以求快
async function callAI({ prompt, system, image, effort }) {
  const content = [];
  if (image) content.push(imageBlock(image));
  content.push({ type: 'text', text: prompt || '' });
  return aiStream({ system, messages: [{ role: 'user', content }], effort: effort || 'low', maxTokens: 8000 });
}

// 从 AI 返回的文本里提取 JSON（可能带 ```json 围栏或说明文字）
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  const start = Math.min(
    ...['[', '{'].map(c => { const i = text.indexOf(c); return i === -1 ? Infinity : i; })
  );
  if (start === Infinity) throw new Error('AI 未返回 JSON');
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
  return JSON.parse(text.slice(start, end + 1));
}
