/* AI 黑板 - 前端逻辑 */

const board = document.getElementById('board');
const ctx = board.getContext('2d');
const statusEl = document.getElementById('status');

const BOARD_BG = '#1e5b3a';
const CHALK_WHITE = '#f5f5f0';
const CHALK_YELLOW = '#ffd97d';
const CHALK_BLUE = '#9fd3ff';

let tool = 'pen'; // pen | eraser
let mode = 'math'; // math | english
let drawing = false;
let lastX = 0, lastY = 0;

/* ---------- 画布初始化 ---------- */
function resizeBoard() {
  const w = board.clientWidth || 1000;
  // 保留旧内容
  const old = document.createElement('canvas');
  old.width = board.width; old.height = board.height;
  if (board.width > 0) old.getContext('2d').drawImage(board, 0, 0);
  board.width = w;
  board.height = 560;
  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, board.width, board.height);
  if (old.width > 0) ctx.drawImage(old, 0, 0);
}
window.addEventListener('resize', resizeBoard);
resizeBoard();

function clearBoard() {
  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, board.width, board.height);
}

/* ---------- 手写 ---------- */
function pointerPos(e) {
  const r = board.getBoundingClientRect();
  return [
    (e.clientX - r.left) * (board.width / r.width),
    (e.clientY - r.top) * (board.height / r.height),
  ];
}

board.addEventListener('pointerdown', e => {
  drawing = true;
  [lastX, lastY] = pointerPos(e);
  board.setPointerCapture(e.pointerId);
});
board.addEventListener('pointermove', e => {
  if (!drawing) return;
  const [x, y] = pointerPos(e);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (tool === 'pen') {
    ctx.strokeStyle = CHALK_WHITE;
    ctx.lineWidth = 3;
  } else {
    ctx.strokeStyle = BOARD_BG;
    ctx.lineWidth = 30;
  }
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(x, y);
  ctx.stroke();
  [lastX, lastY] = [x, y];
});
board.addEventListener('pointerup', () => { drawing = false; });

/* ---------- 工具栏 ---------- */
const btnPen = document.getElementById('btn-pen');
const btnEraser = document.getElementById('btn-eraser');
btnPen.onclick = () => { tool = 'pen'; btnPen.classList.add('active'); btnEraser.classList.remove('active'); };
btnEraser.onclick = () => { tool = 'eraser'; btnEraser.classList.add('active'); btnPen.classList.remove('active'); };
document.getElementById('btn-clear').onclick = clearBoard;

/* ---------- 模式切换 ---------- */
const tabMath = document.getElementById('tab-math');
const tabEnglish = document.getElementById('tab-english');
const mathTools = document.getElementById('math-tools');
const englishTools = document.getElementById('english-tools');
const wordCard = document.getElementById('word-card');

tabMath.onclick = () => {
  mode = 'math';
  tabMath.classList.add('active'); tabEnglish.classList.remove('active');
  mathTools.classList.remove('hidden'); englishTools.classList.add('hidden');
  wordCard.classList.add('hidden');
};
tabEnglish.onclick = () => {
  mode = 'english';
  tabEnglish.classList.add('active'); tabMath.classList.remove('active');
  englishTools.classList.remove('hidden'); mathTools.classList.add('hidden');
};

/* ---------- 通用 ---------- */
function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.classList.remove('hidden');
}
function hideStatus() { statusEl.classList.add('hidden'); }

function snapshotBase64() {
  return board.toDataURL('image/png').split(',')[1];
}

/* ---------- 设置(直连 API 模式用,只存本机浏览器) ---------- */
const SETTINGS_KEY = 'blackboard-settings';
const DEFAULT_SETTINGS = { apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5' };
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
let settings = loadSettings();

const backendBadge = document.getElementById('backendBadge');
const settingsMask = document.getElementById('settingsMask');
const settingsInfo = document.getElementById('settingsInfo');
const setApiKey = document.getElementById('setApiKey');
const setBaseUrl = document.getElementById('setBaseUrl');
const setModel = document.getElementById('setModel');
const setUseLocal = document.getElementById('setUseLocal');

document.getElementById('btn-settings').onclick = () => {
  setApiKey.value = settings.apiKey;
  setBaseUrl.value = settings.baseUrl;
  setModel.value = settings.model;
  setUseLocal.checked = localStorage.getItem(LOCAL_FLAG) === '1';
  settingsInfo.textContent = backend.mode === 'server'
    ? '当前走服务器 AI 后端(claude CLI 订阅额度或服务器密钥),以下配置仅在其不可用时生效。'
    : '未检测到可用的服务器 AI 后端,识别走浏览器直连 Anthropic API,请填写你自己的 API Key。';
  settingsMask.classList.remove('hidden');
};
document.getElementById('settingsCancel').onclick = () => settingsMask.classList.add('hidden');
settingsMask.addEventListener('click', (e) => { if (e.target === settingsMask) settingsMask.classList.add('hidden'); });
document.getElementById('settingsSave').onclick = () => {
  settings = {
    apiKey: setApiKey.value.trim(),
    baseUrl: setBaseUrl.value.trim() || DEFAULT_SETTINGS.baseUrl,
    model: setModel.value.trim() || DEFAULT_SETTINGS.model,
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
let backend = { mode: 'detecting', base: '' };
let backendReady = Promise.resolve();

async function probeHealth(base, ms) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 2500);
    const r = await fetch(base + '/api/health', { signal: ctrl.signal });
    clearTimeout(t);
    const h = await r.json();
    return !!(h && h.ok && (h.llm === 'cli' || h.llm === 'key'));
  } catch { return false; }
}

const onLocalPage = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

async function detectBackend(localProbeMs) {
  if (await probeHealth('')) backend = { mode: 'server', base: '' };
  else if (!onLocalPage && localStorage.getItem(LOCAL_FLAG) === '1' &&
           await probeHealth(`http://localhost:${LOCAL_PORT}`, localProbeMs || 5000)) {
    backend = { mode: 'server', base: `http://localhost:${LOCAL_PORT}` };
  } else backend = { mode: 'direct', base: '' };
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

async function callAI({ prompt, system, image, maxTokens }) {
  await backendReady;

  if (backend.mode === 'server') {
    const resp = await fetch(backend.base + '/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, system,
        image_base64: image || undefined,
        max_tokens: maxTokens || 1500,
      }),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || 'AI 请求失败');
    return data.text;
  }

  // 浏览器直连 Anthropic API
  if (!settings.apiKey) {
    document.getElementById('btn-settings').click();
    throw new Error('请先在「⚙️ 设置」里填写 Anthropic API Key(或在本机运行 node server.js)');
  }
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } });
  content.push({ type: 'text', text: prompt || '' });

  const resp = await fetch(settings.baseUrl.replace(/\/+$/, '') + '/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model || 'claude-sonnet-5',
      max_tokens: maxTokens || 1500,
      system: system || '',
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error?.message || `Anthropic API 请求失败(${resp.status})`);
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
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

/* ==================== 数学模式 ==================== */

/* ---- 1. 手绘图形 → 标准图形 + 角度标注 ---- */
document.getElementById('btn-recognize-shape').onclick = async () => {
  try {
    showStatus('正在识别图形…');
    const text = await callAI({
      image: snapshotBase64(),
      system: '你是几何图形识别助手。只输出 JSON，不要任何其他文字。',
      prompt: `图片是一块黑板（尺寸 ${board.width}x${board.height} 像素），上面有手绘的几何图形。请识别出所有图形，并给出规整后的坐标（图片像素坐标系）。输出 JSON 数组，每个元素形如：
{"type":"triangle","points":[[x1,y1],[x2,y2],[x3,y3]]}
{"type":"rectangle","points":[[左上x,左上y],[右上],[右下],[左下]]}（如果是正方形请让四边等长）
{"type":"circle","center":[x,y],"radius":r}
{"type":"polygon","points":[...]}（其他多边形，如果接近正多边形请规整为正多边形）
{"type":"line","points":[[x1,y1],[x2,y2]]}
规整原则：看起来想画等腰/等边/直角三角形就规整成标准的；接近水平/垂直的线就摆正。坐标尽量贴近原手绘位置。`,
    });
    const shapes = extractJSON(text);
    if (!Array.isArray(shapes) || shapes.length === 0) throw new Error('未识别到图形');
    clearBoard();
    shapes.forEach(drawShape);
    hideStatus();
  } catch (err) {
    showStatus('识别失败: ' + err.message);
    setTimeout(hideStatus, 4000);
  }
};

function drawShape(s) {
  ctx.strokeStyle = CHALK_YELLOW;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.type === 'circle') {
    ctx.beginPath();
    ctx.arc(s.center[0], s.center[1], s.radius, 0, Math.PI * 2);
    ctx.stroke();
    // 圆心
    ctx.fillStyle = CHALK_YELLOW;
    ctx.beginPath();
    ctx.arc(s.center[0], s.center[1], 3, 0, Math.PI * 2);
    ctx.fill();
    chalkText(`r ≈ ${Math.round(s.radius)}px`, s.center[0] + 8, s.center[1] - 8, CHALK_BLUE, 15);
    return;
  }
  const pts = s.points;
  if (!pts || pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (s.type !== 'line') ctx.closePath();
  ctx.stroke();

  if (s.type === 'triangle' && pts.length === 3) annotateTriangle(pts);
  if (s.type === 'rectangle' && pts.length === 4) annotateSides(pts);
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

// 三角形：标注三个内角和三边长度
function annotateTriangle(pts) {
  const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
  const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
  const angles = pts.map((p, i) => {
    const a = pts[(i + 1) % 3], b = pts[(i + 2) % 3];
    const v1 = [a[0] - p[0], a[1] - p[1]];
    const v2 = [b[0] - p[0], b[1] - p[1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
    return Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI;
  });
  pts.forEach((p, i) => {
    // 角度标签放在顶点朝质心方向内侧
    const dx = cx - p[0], dy = cy - p[1];
    const d = Math.hypot(dx, dy) || 1;
    const tx = p[0] + dx / d * 34, ty = p[1] + dy / d * 34;
    chalkText(angles[i].toFixed(1) + '°', tx, ty, CHALK_BLUE, 16, true);
  });
  annotateSides(pts);
}

// 标注每条边的长度（像素）
function annotateSides(pts) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    chalkText(Math.round(dist(a, b)) + 'px', mx + 6, my - 6, CHALK_WHITE, 13);
  }
}

function chalkText(text, x, y, color, size, center) {
  ctx.fillStyle = color;
  ctx.font = `${size || 15}px "Comic Sans MS", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = center ? 'center' : 'left';
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

/* ---- 2. 公式 → 函数图像 ---- */
document.getElementById('btn-plot').onclick = () => {
  const expr = document.getElementById('formula-input').value.trim();
  if (!expr) { showStatus('请先输入公式'); setTimeout(hideStatus, 2000); return; }
  plotFormula(expr);
};

document.getElementById('btn-recognize-formula').onclick = async () => {
  try {
    showStatus('正在识别公式…');
    const text = await callAI({
      image: snapshotBase64(),
      system: '你是手写数学公式识别助手。',
      prompt: '图片黑板上有一个手写的数学公式（关于 x 的函数）。请把它转换成 math.js 可以解析的表达式，只输出表达式本身（不要 y=，不要解释）。例如手写 y=x²-2x 就输出 x^2 - 2*x。如果看不到公式，输出 NONE。',
      maxTokens: 200,
    });
    const expr = text.trim().replace(/^y\s*=\s*/i, '');
    if (expr === 'NONE' || !expr) throw new Error('黑板上没有识别到公式');
    document.getElementById('formula-input').value = expr;
    plotFormula(expr);
  } catch (err) {
    showStatus('识别失败: ' + err.message);
    setTimeout(hideStatus, 4000);
  }
};

function plotFormula(exprRaw) {
  let compiled;
  const expr = exprRaw.replace(/^y\s*=\s*/i, '');
  try {
    compiled = math.compile(expr);
    compiled.evaluate({ x: 1 }); // 试算
  } catch {
    showStatus('公式无法解析: ' + expr);
    setTimeout(hideStatus, 3000);
    return;
  }
  hideStatus();
  clearBoard();

  const W = board.width, H = board.height;
  const xMin = -10, xMax = 10;
  // 采样求 y 范围
  const N = 600;
  const samples = [];
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i <= N; i++) {
    const x = xMin + (xMax - xMin) * i / N;
    let y;
    try { y = compiled.evaluate({ x }); } catch { y = NaN; }
    if (typeof y !== 'number' || !isFinite(y)) { samples.push(null); continue; }
    samples.push([x, y]);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  if (yMin === Infinity) { showStatus('该公式在 [-10,10] 上没有有效值'); setTimeout(hideStatus, 3000); return; }
  // y 范围留白，且不要过扁
  if (yMax - yMin < 1e-9) { yMin -= 1; yMax += 1; }
  const pad = (yMax - yMin) * 0.15;
  yMin -= pad; yMax += pad;
  // 限制极端范围，避免渐近线把图压扁
  if (yMax > 60) yMax = 60;
  if (yMin < -60) yMin = -60;

  const margin = 40;
  const sx = x => margin + (x - xMin) / (xMax - xMin) * (W - 2 * margin);
  const sy = y => H - margin - (y - yMin) / (yMax - yMin) * (H - 2 * margin);

  // 坐标轴
  ctx.strokeStyle = 'rgba(245,245,240,.55)';
  ctx.lineWidth = 1.5;
  const axisY = (0 >= yMin && 0 <= yMax) ? sy(0) : H - margin; // x 轴
  const axisX = (0 >= xMin && 0 <= xMax) ? sx(0) : margin;     // y 轴
  ctx.beginPath();
  ctx.moveTo(margin - 10, axisY); ctx.lineTo(W - margin + 10, axisY);
  ctx.moveTo(axisX, margin - 10); ctx.lineTo(axisX, H - margin + 10);
  ctx.stroke();

  // 刻度
  ctx.fillStyle = 'rgba(245,245,240,.7)';
  ctx.font = '12px sans-serif';
  for (let x = Math.ceil(xMin); x <= xMax; x += 2) {
    if (x === 0) continue;
    const px = sx(x);
    ctx.beginPath(); ctx.moveTo(px, axisY - 4); ctx.lineTo(px, axisY + 4); ctx.stroke();
    ctx.fillText(x, px - 6, axisY + 18);
  }
  const yStep = niceStep((yMax - yMin) / 8);
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
    if (Math.abs(y) < yStep / 2) continue;
    const py = sy(y);
    ctx.beginPath(); ctx.moveTo(axisX - 4, py); ctx.lineTo(axisX + 4, py); ctx.stroke();
    ctx.fillText(+y.toFixed(2), axisX + 8, py + 4);
  }

  // 曲线
  ctx.strokeStyle = CHALK_YELLOW;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  let penUp = true;
  for (const s of samples) {
    if (!s || s[1] < yMin || s[1] > yMax) { penUp = true; continue; }
    const px = sx(s[0]), py = sy(s[1]);
    if (penUp) { ctx.moveTo(px, py); penUp = false; }
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  chalkText('y = ' + expr, margin + 10, margin - 12, CHALK_BLUE, 18);
}

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

/* ==================== 英语模式 ==================== */

document.getElementById('btn-recognize-word').onclick = async () => {
  try {
    showStatus('正在识别手写单词…');
    const text = await callAI({
      image: snapshotBase64(),
      system: '你是手写英文识别助手。',
      prompt: '图片黑板上手写了一个英文单词，请只输出这个单词本身（小写），不要任何其他文字。如果没有单词，输出 NONE。',
      maxTokens: 50,
    });
    const word = text.trim().toLowerCase();
    if (word === 'none' || !/^[a-z][a-z\-']*$/.test(word)) throw new Error('黑板上没有识别到英文单词');
    document.getElementById('word-input').value = word;
    await lookupWord(word);
  } catch (err) {
    showStatus('识别失败: ' + err.message);
    setTimeout(hideStatus, 4000);
  }
};

document.getElementById('btn-lookup').onclick = () => {
  const word = document.getElementById('word-input').value.trim().toLowerCase();
  if (!word) { showStatus('请先输入单词'); setTimeout(hideStatus, 2000); return; }
  lookupWord(word).catch(err => {
    showStatus('查询失败: ' + err.message);
    setTimeout(hideStatus, 4000);
  });
};

async function lookupWord(word) {
  showStatus(`正在生成「${word}」的释义、例句和配图…`);

  // 配图（免费的 Pollinations 文生图，与释义并行加载）
  const img = document.getElementById('word-image');
  img.src = 'https://image.pollinations.ai/prompt/' +
    encodeURIComponent(`simple bright cartoon illustration for children of the English word "${word}", clean background, educational flashcard style`) +
    '?width=512&height=512&nologo=true';

  const text = await callAI({
    system: '你是英语老师，为学生制作单词卡片。只输出 JSON。',
    prompt: `为英文单词 "${word}" 生成学习卡片，输出 JSON：
{"word":"${word}","phonetic":"美式音标，形如 /ˈbʌtərflaɪ/","meaning":"中文释义（含词性，多个义项用；分隔）","examples":[{"en":"英文例句1","zh":"中文翻译"},{"en":"例句2","zh":"翻译"},{"en":"例句3","zh":"翻译"}]}
例句要简单实用，适合初学者。`,
  });
  const card = extractJSON(text);

  document.getElementById('word-text').textContent = card.word || word;
  document.getElementById('word-phonetic').textContent = card.phonetic || '';
  document.getElementById('word-meaning').textContent = card.meaning || '';
  const ul = document.getElementById('word-examples');
  ul.innerHTML = '';
  (card.examples || []).forEach(ex => {
    const li = document.createElement('li');
    const en = document.createElement('div');
    en.className = 'en';
    en.textContent = ex.en;
    const speakBtn = document.createElement('button');
    speakBtn.className = 'speak-line';
    speakBtn.textContent = '🔊';
    speakBtn.onclick = () => speak(ex.en);
    en.appendChild(speakBtn);
    const zh = document.createElement('div');
    zh.className = 'zh';
    zh.textContent = ex.zh;
    li.appendChild(en); li.appendChild(zh);
    ul.appendChild(li);
  });

  document.getElementById('word-card').classList.remove('hidden');
  hideStatus();
  speak(word);
}

document.getElementById('btn-speak').onclick = () => {
  const w = document.getElementById('word-text').textContent;
  if (w) speak(w);
};

/* 朗读：浏览器内置 Web Speech API，免费离线可用 */
function speak(text) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith('en'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
// 某些浏览器需要先触发一次 getVoices
speechSynthesis.getVoices();
