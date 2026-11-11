/* AI 黑板 - 界面逻辑:手写画布、工具栏、提问、小工具(规整图形 / 函数图像 / 单词卡) */

const board = document.getElementById('board');
const ctx = board.getContext('2d');
const BOARD_BG = '#1d3a2f';
const CHALK_WHITE = '#f5f5f0';
const CHALK_YELLOW = '#ffd97d';
const CHALK_BLUE = '#9fd3ff';

let tool = 'pointer'; // pointer | pen | eraser
let penColor = CHALK_WHITE;
let drawing = false;
let lastX = 0, lastY = 0;
let inkDirty = false;

/* ---------- 偏好(本机保存) ---------- */
const PREFS_KEY = 'blackboard-prefs';
const levelSel = document.getElementById('level');
const speedSel = document.getElementById('speed');
const btnVoice = document.getElementById('btn-voice');
(function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch {}
  if (p.level) levelSel.value = p.level;
  if (p.speed != null) speedSel.value = String(p.speed);
  if (p.voice === false) prefs.voice = false;
  prefs.speed = parseFloat(speedSel.value);
  if (!Number.isFinite(prefs.speed)) prefs.speed = 1;
  btnVoice.classList.toggle('on', prefs.voice);
})();
function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ level: levelSel.value, speed: prefs.speed, voice: prefs.voice }));
}
levelSel.onchange = savePrefs;
speedSel.onchange = () => { prefs.speed = parseFloat(speedSel.value); savePrefs(); updateControls(); };
btnVoice.onclick = () => {
  prefs.voice = !prefs.voice;
  btnVoice.classList.toggle('on', prefs.voice);
  if (!prefs.voice && window.speechSynthesis) speechSynthesis.cancel();
  savePrefs();
};

/* ---------- 手写画布(透明,盖在板书上面,随板书一起滚动) ---------- */
const DPR = Math.min(2, window.devicePixelRatio || 1);
let cw = 0, ch = 0;
function fitCanvas() {
  const w = innerEl.clientWidth, h = Math.min(innerEl.clientHeight, 9000);
  if (!w || !h || (w === cw && h === ch)) return;
  let old = null;
  if (board.width && board.height && inkDirty) {
    old = document.createElement('canvas');
    old.width = board.width; old.height = board.height;
    old.getContext('2d').drawImage(board, 0, 0);
  }
  cw = w; ch = h;
  board.width = Math.round(w * DPR);
  board.height = Math.round(h * DPR);
  board.style.width = w + 'px';
  board.style.height = h + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (old) ctx.drawImage(old, 0, 0);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
new ResizeObserver(fitCanvas).observe(innerEl);
fitCanvas();

function setInk(dirty) {
  inkDirty = dirty;
  document.getElementById('ink-flag').classList.toggle('hidden', !dirty);
}

function clearInk() {
  ctx.clearRect(0, 0, cw, ch);
  setInk(false);
}

// 只擦掉当前可见区域的手写
function clearVisibleInk() {
  ctx.clearRect(0, scrollEl.scrollTop, cw, scrollEl.clientHeight);
}

function pointerPos(e) {
  const r = board.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

board.addEventListener('pointerdown', e => {
  if (tool === 'pointer') return;
  drawing = true;
  [lastX, lastY] = pointerPos(e);
  board.setPointerCapture(e.pointerId);
  strokeTo(lastX + 0.01, lastY + 0.01);
});
board.addEventListener('pointermove', e => {
  if (!drawing) return;
  const [x, y] = pointerPos(e);
  strokeTo(x, y);
});
function strokeTo(x, y) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (tool === 'pen') {
    ctx.strokeStyle = penColor;
    ctx.lineWidth = 3.4;
    ctx.globalAlpha = 0.93;
    setInk(true);
  } else {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = 36;
  }
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.restore();
  [lastX, lastY] = [x, y];
}
const endStroke = () => { drawing = false; };
board.addEventListener('pointerup', endStroke);
board.addEventListener('pointercancel', endStroke);

// 当前可见区域的截图(深绿底 + 手写),返回 base64 PNG 与纵向偏移
function snapshot() {
  const w = scrollEl.clientWidth, h = scrollEl.clientHeight, top = scrollEl.scrollTop;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = BOARD_BG;
  g.fillRect(0, 0, w, h);
  g.drawImage(board, 0, top * DPR, w * DPR, h * DPR, 0, 0, w, h);
  return { b64: c.toDataURL('image/png').split(',')[1], w, h, top };
}

/* ---------- 工具栏 ---------- */
const toolBtns = { pointer: document.getElementById('btn-pointer'), pen: document.getElementById('btn-pen'), eraser: document.getElementById('btn-eraser') };
function setTool(t) {
  tool = t;
  for (const k in toolBtns) toolBtns[k].classList.toggle('active', k === t);
  innerEl.dataset.tool = t;
}
toolBtns.pointer.onclick = () => setTool('pointer');
toolBtns.pen.onclick = () => setTool('pen');
toolBtns.eraser.onclick = () => setTool('eraser');
document.querySelectorAll('#pen-colors .dot').forEach(d => {
  d.onclick = () => {
    penColor = d.dataset.color;
    document.querySelectorAll('#pen-colors .dot').forEach(x => x.classList.toggle('active', x === d));
    setTool('pen');
  };
});
document.getElementById('btn-clear').onclick = () => {
  wipeLesson();
  clearInk();
  wordCard.classList.add('hidden');
  showWelcome();
};
setTool('pointer');

/* ---------- 播放控制 ---------- */
const btnPause = document.getElementById('btn-pause');
const btnSkip = document.getElementById('btn-skip');
const btnStop = document.getElementById('btn-stop');
const btnReplay = document.getElementById('btn-replay');
const suggestEl = document.getElementById('suggest');
btnPause.onclick = togglePause;
btnSkip.onclick = skipAnimation;
btnStop.onclick = stopLesson;
btnReplay.onclick = replayLesson;

function updateControls() {
  const busy = player.running || player.streaming;
  btnPause.classList.toggle('hidden', !player.running || instant());
  btnPause.textContent = player.paused ? '▶ 继续' : '⏸ 暂停';
  btnSkip.classList.toggle('hidden', !busy || instant());
  btnStop.classList.toggle('hidden', !busy);
  btnReplay.classList.toggle('hidden', busy || lessonIsEmpty());
  // 讲完后给出追问建议
  const items = !busy && player.suggest && player.suggest.length ? player.suggest : null;
  suggestEl.classList.toggle('hidden', !items);
  if (items) {
    suggestEl.innerHTML = '';
    const tag = document.createElement('span');
    tag.className = 'chips-label';
    tag.textContent = '继续问:';
    suggestEl.appendChild(tag);
    items.forEach(q => suggestEl.appendChild(chip(q, () => ask(q))));
  }
}
onLessonState = updateControls;

function chip(text, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

/* ---------- 欢迎页 ---------- */
const EXAMPLES = [
  ['数学 · 证明', ['证明 √2 是无理数', '证明勾股定理', '证明素数有无穷多个', '为什么 0.999… = 1?']],
  ['数学 · 讲解', ['讲解二次函数 y = x² − 2x − 3 的图像与性质', '用图像解释导数的几何意义', '推导一元二次方程的求根公式']],
  ['英语 · 词源与语法', ['讲解 biology 的词源和同根词', '分析句子的语法结构: The book that I bought yesterday is very interesting.', '现在完成时和一般过去时有什么区别?']],
];
function showWelcome() {
  if (!lessonIsEmpty()) return;
  lessonEl.innerHTML = '';
  const w = document.createElement('div');
  w.className = 'welcome';
  const h = document.createElement('div');
  h.className = 'welcome-title';
  h.textContent = '问一个问题,看老师一步一步写出来';
  const sub = document.createElement('div');
  sub.className = 'welcome-sub';
  sub.textContent = '严谨的证明、解题过程、函数图像与几何图、英语词源和长难句分析……也可以拿起粉笔把题目写在黑板上再提问。';
  w.append(h, sub);
  EXAMPLES.forEach(([label, list]) => {
    const g = document.createElement('div');
    g.className = 'welcome-group';
    const l = document.createElement('div');
    l.className = 'welcome-label';
    l.textContent = label;
    const row = document.createElement('div');
    row.className = 'chips';
    list.forEach(q => row.appendChild(chip(q, () => ask(q, { fresh: true }))));
    g.append(l, row);
    w.appendChild(g);
  });
  lessonEl.appendChild(w);
  suggestEl.classList.add('hidden');
}
showWelcome();

/* ---------- 提问 ---------- */
const askForm = document.getElementById('ask-form');
const askInput = document.getElementById('ask-input');
const inkAttach = document.getElementById('ink-attach');

function ask(question, opt) {
  opt = opt || {};
  suggestEl.classList.add('hidden');
  if (inkDirty && inkAttach.checked && !opt.fresh) opt.image = snapshot().b64;
  return askLesson(question, opt);
}

askForm.addEventListener('submit', e => {
  e.preventDefault();
  let q = askInput.value.trim();
  if (!q) {
    if (inkDirty && inkAttach.checked) q = '请讲解黑板上手写的内容(如果是一道题,请给出完整严谨的解答)。';
    else { askInput.focus(); return; }
  }
  askInput.value = '';
  autoGrow();
  ask(q);
});
askInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); askForm.requestSubmit(); }
});
function autoGrow() {
  askInput.style.height = 'auto';
  askInput.style.height = Math.min(askInput.scrollHeight, 140) + 'px';
}
askInput.addEventListener('input', autoGrow);

const fail = (prefix, err) => showStatus(prefix + ': ' + err.message, 5000);

/* ==================== 小工具一:手绘图形 → 标准图形 + 角度标注 ==================== */
document.getElementById('btn-recognize-shape').onclick = async () => {
  if (!inkDirty) { showStatus('先用 ✏️ 粉笔在黑板上画一个图形', 3000); return; }
  try {
    showStatus('正在识别图形…');
    const snap = snapshot();
    const text = await callAI({
      image: snap.b64,
      system: '你是几何图形识别助手。只输出 JSON，不要任何其他文字。',
      prompt: `图片是一块黑板（尺寸 ${snap.w}x${snap.h} 像素），上面有手绘的几何图形。请识别出所有图形，并给出规整后的坐标（图片像素坐标系）。输出 JSON 数组，每个元素形如：
{"type":"triangle","points":[[x1,y1],[x2,y2],[x3,y3]]}
{"type":"rectangle","points":[[左上x,左上y],[右上],[右下],[左下]]}（如果是正方形请让四边等长）
{"type":"circle","center":[x,y],"radius":r}
{"type":"polygon","points":[...]}（其他多边形，如果接近正多边形请规整为正多边形）
{"type":"line","points":[[x1,y1],[x2,y2]]}
规整原则：看起来想画等腰/等边/直角三角形就规整成标准的；接近水平/垂直的线就摆正。坐标尽量贴近原手绘位置。`,
    });
    const shapes = extractJSON(text);
    if (!Array.isArray(shapes) || shapes.length === 0) throw new Error('未识别到图形');
    clearVisibleInk();
    ctx.save();
    ctx.translate(0, snap.top);
    shapes.forEach(drawShape);
    ctx.restore();
    hideStatus();
  } catch (err) { fail('识别失败', err); }
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
    chalkText(angles[i].toFixed(1) + '°', p[0] + dx / d * 34, p[1] + dy / d * 34, CHALK_BLUE, 16, true);
  });
  annotateSides(pts);
}

// 标注每条边的长度（像素）
function annotateSides(pts) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    chalkText(Math.round(dist(a, b)) + 'px', (a[0] + b[0]) / 2 + 6, (a[1] + b[1]) / 2 - 6, CHALK_WHITE, 13);
  }
}

function chalkText(text, x, y, color, size, center) {
  ctx.fillStyle = color;
  ctx.font = `${size || 15}px "LXGW WenKai Screen", KaiTi, "Microsoft YaHei", sans-serif`;
  ctx.textAlign = center ? 'center' : 'left';
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

/* ==================== 小工具二:公式 → 函数图像 ==================== */
function toExpr(raw) {
  return String(raw).trim().replace(/^[yf]\s*(\(x\))?\s*=\s*/i, '')
    .replace(/²/g, '^2').replace(/³/g, '^3').replace(/[−–]/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
}
function tryCompile(expr) {
  try { const v = math.compile(expr).evaluate({ x: 1.234 }); return typeof v === 'number'; } catch { return false; }
}

document.getElementById('btn-plot').onclick = async () => {
  try {
    let expr = toExpr(askInput.value);
    if (!expr || !tryCompile(expr)) {
      if (!inkDirty) { showStatus('在输入框里写一个公式(如 x^2 - 2x),或用粉笔把公式写在黑板上', 4000); return; }
      showStatus('正在识别手写公式…');
      const text = await callAI({
        image: snapshot().b64,
        system: '你是手写数学公式识别助手。',
        prompt: '图片黑板上有一个手写的数学公式（关于 x 的函数）。请把它转换成 math.js 可以解析的表达式，只输出表达式本身（不要 y=，不要解释）。例如手写 y=x²-2x 就输出 x^2 - 2*x。如果看不到公式，输出 NONE。',
      });
      expr = toExpr(text.trim().split('\n').pop());
      if (/^none$/i.test(expr) || !expr) throw new Error('黑板上没有识别到公式');
      if (!tryCompile(expr)) throw new Error('公式无法解析: ' + expr);
      clearVisibleInk();
    } else {
      askInput.value = '';
      autoGrow();
    }
    hideStatus();
    lessonEl.querySelector('.welcome')?.remove();
    const ops = [];
    if (!lessonIsEmpty()) ops.push({ op: 'divider' });
    ops.push({ op: 'h', text: '函数图像' }, { op: 'plot', fns: [{ expr, label: 'y = ' + expr }], xmin: -10, xmax: 10 });
    playLocalOps(ops);
  } catch (err) { fail('绘图失败', err); }
};

/* ==================== 小工具三:单词卡 ==================== */
const wordCard = document.getElementById('word-card');
document.getElementById('word-close').onclick = () => wordCard.classList.add('hidden');

document.getElementById('btn-word').onclick = async () => {
  try {
    let word = askInput.value.trim().toLowerCase();
    if (!/^[a-z][a-z\-']*$/.test(word)) {
      if (!inkDirty) { showStatus('在输入框里写一个英文单词,或用粉笔把单词写在黑板上', 4000); return; }
      showStatus('正在识别手写单词…');
      const text = await callAI({
        image: snapshot().b64,
        system: '你是手写英文识别助手。',
        prompt: '图片黑板上手写了一个英文单词，请只输出这个单词本身（小写），不要任何其他文字。如果没有单词，输出 NONE。',
      });
      word = text.trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z\-']/g, '');
      if (word === 'none' || !/^[a-z][a-z\-']*$/.test(word)) throw new Error('黑板上没有识别到英文单词');
    } else {
      askInput.value = '';
      autoGrow();
    }
    await lookupWord(word);
  } catch (err) { fail('查询失败', err); }
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
    speakBtn.onclick = () => speakEn(ex.en);
    en.appendChild(speakBtn);
    const zh = document.createElement('div');
    zh.className = 'zh';
    zh.textContent = ex.zh;
    li.append(en, zh);
    ul.appendChild(li);
  });

  wordCard.classList.remove('hidden');
  hideStatus();
  speakEn(word);
}

document.getElementById('btn-speak').onclick = () => {
  const w = document.getElementById('word-text').textContent;
  if (w) speakEn(w);
};
document.getElementById('word-explain').onclick = () => {
  const w = document.getElementById('word-text').textContent;
  wordCard.classList.add('hidden');
  if (w) ask(`讲解英语单词 ${w} 的词源、构词、同根词和用法`);
};

/* 英文朗读：浏览器内置 Web Speech API */
function speakEn(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith('en'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
