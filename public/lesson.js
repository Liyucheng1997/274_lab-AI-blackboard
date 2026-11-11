/* AI 黑板 - 板书讲解引擎
 * AI 流式输出 NDJSON(每行一个板书动作),这里逐个"写"到黑板上并朗读讲解。 */

const lessonEl = document.getElementById('lesson');
const scrollEl = document.getElementById('board-scroll');
const innerEl = document.getElementById('board-inner');
const cursorEl = document.getElementById('chalk-cursor');
const captionEl = document.getElementById('caption');
const statusEl = document.getElementById('status');

const COLOR_NAMES = ['white', 'yellow', 'blue', 'green', 'red', 'pink', 'orange'];
const COLOR_HEX = { white: '#f3f1e7', yellow: '#ffd97d', blue: '#9fd3ff', green: '#b5e48c', red: '#ff9a8b', pink: '#ffb3d1', orange: '#ffb86b' };
const CYCLE = ['yellow', 'blue', 'pink', 'green', 'orange'];
const colorOf = (c, d) => (COLOR_NAMES.includes(c) ? c : (d || 'white'));

/* ---------- 状态提示 ---------- */
let statusTimer = null;
function showStatus(msg, ms) {
  clearTimeout(statusTimer);
  statusEl.textContent = msg;
  statusEl.classList.remove('hidden');
  if (ms) statusTimer = setTimeout(hideStatus, ms);
}
function hideStatus() { clearTimeout(statusTimer); statusEl.classList.add('hidden'); }

/* ---------- 系统提示词 ---------- */
function lessonSystemPrompt(level) {
  return `你是一位站在黑板前讲课的顶尖教师,数学、英语等各科都能讲。学生提出问题后,你一边写板书一边口头讲解。你的输出会被程序逐行解析,实时"写"到黑板上并朗读出来,所以必须严格遵守下面的格式。

# 输出格式
只输出 NDJSON:每行一个完整的 JSON 对象(一个板书动作)。不要输出任何其他文字,不要代码围栏,不要空行。
JSON 字符串里的反斜杠必须转义:LaTeX 的 \\frac 在 JSON 里要写成 \\\\frac。

# 板书动作
{"op":"title","text":"标题"}  每块板书的第一行
{"op":"h","text":"小节标题"}  例如 已知 / 求证 / 证明 / 词源 / 例句 / 小结
{"op":"p","text":"一行板书","color":"white","id":"a1","indent":0,"say":"口头讲解"}
{"op":"math","tex":"独立成行的公式(LaTeX)","color":"white","id":"m1","say":"口头讲解"}
{"op":"mark","target":"a1","type":"strike","say":"口头讲解"}  回头在之前某一行上做标记;type 取 strike(划掉)/underline(下划线)/box(框起来)/highlight(高亮)
{"op":"plot","fns":[{"expr":"x^2-2*x","label":"y=x^2-2x"}],"xmin":-2,"xmax":4,"points":[{"x":1,"y":-1,"label":"顶点(1,-1)"}],"say":"..."}  函数图像;expr 用 math.js 语法(x^2、sin(x)、exp(x)、log(x)、sqrt(x)、abs(x)),可选 ymin/ymax
{"op":"figure","w":420,"h":280,"items":[...],"say":"..."}  几何示意图,坐标原点在左上角、y 轴向下,所有坐标落在 w×h 内并留出 30 以上的边距。items 可用:
   {"t":"poly","p":[[x,y],...],"color":"white","fill":false}  多边形
   {"t":"line","p":[[x1,y1],[x2,y2]],"dashed":false,"color":"yellow"}  线段
   {"t":"circle","c":[x,y],"r":80}
   {"t":"point","at":[x,y],"label":"A"}
   {"t":"label","at":[x,y],"text":"a","color":"blue"}  文字标注(边长、角名等)
   {"t":"right","at":[x,y],"p1":[x,y],"p2":[x,y]}  直角符号:顶点 at,两边分别朝向 p1、p2
   {"t":"angle","at":[x,y],"p1":[x,y],"p2":[x,y],"label":"α"}  角弧
{"op":"word","word":"biology","parts":[{"t":"bio","m":"生命","o":"希腊语 bíos"},{"t":"logy","m":"…学","o":"希腊语 lógos"}],"meaning":"生物学","say":"..."}  单词的词根词缀拆解
{"op":"sentence","parts":[{"t":"The boy","r":"主语"},{"t":"who broke the window","r":"定语从句","c":"blue"},{"t":"is","r":"系动词"},{"t":"my brother","r":"表语"},{"t":"."}],"zh":"打破窗户的那个男孩是我弟弟。","say":"..."}  句子成分分析:按顺序把整句切成若干段,r 是该段的语法成分(可省略),c 是颜色(可省略)
{"op":"table","head":["时态","结构","例句"],"rows":[["一般现在时","do/does","He **works**."]],"say":"..."}
{"op":"say","text":"只说不写的过渡讲解"}
{"op":"divider"}
{"op":"wipe"}  擦掉整块黑板。只有当学生换了一个与当前板书无关的全新话题时,才把它作为第一个动作
{"op":"suggest","items":["追问1","追问2","追问3"]}  最后一个动作:三个学生接下来可能想问的简短问题

# 字段说明
- text 里可以用 $...$ 写行内公式(KaTeX 语法),用 **...** 强调关键词。所有数学符号、变量、表达式都写成公式。
- color 可选 white(默认)、yellow(结论/重点)、blue(提示/思路)、green(补充说明)、red(易错点/关键一步)、pink、orange。
- id 只在之后要用 mark 回指这一行时才需要。indent 取 0/1/2,表示缩进层级。
- say 是老师边写边说的话:自然口语、不含任何 LaTeX 或符号标记(公式读成话,例如"a 的平方加 b 的平方"),讲清这一步"为什么",而不是把板书念一遍。每个 say 一到三句。讲英语时,say 里可以夹带英文单词和例句。
- 多步推导请拆成多个 math 动作,一步一行,不要用 aligned 等多行环境;每个 math 的 tex 只写一行公式。

# 板书风格
- 板书要像真正的好老师写的:精炼、分层、一行只写一件事,每行不超过 28 个汉字。详细的解释放进 say。
- 一次讲解通常 12~30 个动作。先用一两行点明问题或直觉,再展开,最后用 yellow 写出结论或小结。
- 善用颜色区分层次;善用 mark:先写出常见的错误想法,再回头 strike 划掉它,或把关键一步 box 起来。
- 能用图说明的就画图:函数性质用 plot,几何题用 figure(先画图再推理,图上标清字母)。

# 学科要求
- 证明题:必须严谨。先写"已知""求证"(必要时),"证明"部分每一步都要有依据(用了哪个定义、定理或前面哪一步),不跳步、不循环论证;分类讨论要穷尽,反证法要写明假设与矛盾;最后以 $\\\\blacksquare$ 收尾。如果命题本身不成立,直接指出并给出反例。
- 计算与解题:写出关键步骤,最后把答案 box 起来,并提醒易错点。
- 英语词汇与词源:用 word 拆解词根词缀(parts 的 t 拼起来应等于或接近原词),讲清各部分的来源语言与本义、词义如何演变,再给两三个同根词和一个例句。
- 英语语法与长难句:用 sentence 划分句子成分,再逐条讲解从句、时态、非谓语等结构,最后给出译文和可迁移的规律。
- 其他学科同理:抓住主干,结构化呈现。

# 追问
对话历史里是你之前写过的板书。学生追问时,默认接着当前板书往下写(不要重复已有内容,不要再写 title),针对追问讲透即可;若附带了黑板手写内容的图片,先读懂图片再讲。

学生水平:${level && level !== 'auto' ? level + '。请用这个阶段学生能听懂的语言和知识来讲' : '请根据问题本身判断,并用相应阶段学生能听懂的方式来讲'}。默认用中文讲解。`;
}

/* ---------- 播放器 ---------- */
const prefs = { speed: 1, voice: true };
const player = {
  ops: [],        // 当前黑板上的全部动作(用于重讲)
  idx: 0,
  running: false,
  paused: false,
  skip: false,    // 跳过动画
  gen: 0,         // 代数:变化即取消正在进行的播放
  streaming: false,
  waiters: [],
  suggest: null,
};
const ids = new Map();   // 板书行 id → 元素
const convo = [];        // 多轮对话历史
let aiAbort = null;
let onLessonState = () => {};

const dead = gen => gen !== player.gen;
const instant = () => player.skip || prefs.speed === 0;

function sleep(ms, gen) {
  return new Promise(res => {
    if (dead(gen) || instant()) return res();
    let left = ms / prefs.speed, last = performance.now();
    const tick = () => {
      if (dead(gen) || instant()) return res();
      const now = performance.now();
      if (!player.paused) left -= now - last;
      last = now;
      if (left <= 0) res(); else setTimeout(tick, Math.min(left, 60));
    };
    setTimeout(tick, Math.min(left, 60));
  });
}

function wake() { player.waiters.splice(0).forEach(f => f()); }
function pushOp(op) { player.ops.push(op); wake(); runPlayer(); }

async function runPlayer() {
  if (player.running) return;
  player.running = true;
  const gen = player.gen;
  onLessonState();
  while (!dead(gen)) {
    if (player.idx < player.ops.length) {
      const op = player.ops[player.idx++];
      try { await renderOp(op, gen); } catch (e) { console.error('板书动作渲染失败', op, e); }
    } else if (player.streaming) {
      await new Promise(r => player.waiters.push(r));
    } else break;
  }
  if (dead(gen)) return; // 新一代播放已接管
  player.running = false;
  cursorEl.classList.add('hidden');
  hideCaption();
  onLessonState();
}

function stopLesson() {
  player.gen++;
  player.running = false;
  player.streaming = false;
  player.paused = false;
  player.idx = player.ops.length;
  if (aiAbort) { aiAbort.abort(); aiAbort = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  wake();
  cursorEl.classList.add('hidden');
  hideCaption();
  hideStatus();
  // 把写到一半的内容直接显示完整
  lessonEl.querySelectorAll('.writing').forEach(el => el.classList.remove('writing'));
  onLessonState();
}

function togglePause() {
  player.paused = !player.paused;
  if (window.speechSynthesis) player.paused ? speechSynthesis.pause() : speechSynthesis.resume();
  onLessonState();
}

function skipAnimation() {
  player.skip = true;
  if (player.paused) togglePause();
  if (window.speechSynthesis) speechSynthesis.cancel();
  onLessonState();
}

function clearLessonDom() {
  lessonEl.innerHTML = '';
  ids.clear();
  scrollEl.scrollTop = 0;
}

// 擦掉整块黑板并清空对话
function wipeLesson() {
  stopLesson();
  player.ops = [];
  player.idx = 0;
  player.suggest = null;
  convo.length = 0;
  clearLessonDom();
  onLessonState();
}

function replayLesson() {
  if (!player.ops.length) return;
  stopLesson();
  clearLessonDom();
  player.idx = 0;
  player.skip = false;
  runPlayer();
}

const lessonIsEmpty = () => player.ops.length === 0;

// 直接播放一组本地生成的动作(函数图像等小工具用)
function playLocalOps(ops) {
  player.skip = false;
  ops.forEach(op => player.ops.push(op));
  wake();
  runPlayer();
}

/* ---------- 语音与字幕 ---------- */
function showCaption(text) {
  captionEl.textContent = text;
  captionEl.classList.remove('hidden');
}
function hideCaption() { captionEl.classList.add('hidden'); }

let zhVoice = null;
function pickVoice() {
  if (!window.speechSynthesis) return;
  const vs = speechSynthesis.getVoices().filter(v => /^zh([-_](CN|Hans))?/i.test(v.lang) && !/HK|TW/i.test(v.lang));
  const score = v => (/Xiaoxiao|Yunxi|Xiaoyi/i.test(v.name) ? 4 : 0) + (/Natural|Online/i.test(v.name) ? 2 : 0) + (/Google/i.test(v.name) ? 1 : 0);
  zhVoice = vs.sort((a, b) => score(b) - score(a))[0] || null;
}
if (window.speechSynthesis) {
  pickVoice();
  speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

const plainSay = t => String(t).replace(/\$|\*\*|\\[a-zA-Z]+|[{}\\]/g, ' ').replace(/\s+/g, ' ').trim();

function speakSay(text, gen) {
  if (!text || dead(gen) || instant()) return Promise.resolve();
  showCaption(text);
  const spoken = plainSay(text);
  if (!prefs.voice || !window.speechSynthesis || !spoken) {
    return sleep(Math.min(4500, 600 + spoken.length * 110), gen); // 静音时留出读字幕的时间
  }
  return new Promise(res => {
    const u = new SpeechSynthesisUtterance(spoken);
    u.lang = 'zh-CN';
    if (zhVoice) u.voice = zhVoice;
    u.rate = Math.max(0.6, Math.min(2, 1.08 * prefs.speed));
    let done = false;
    const finish = () => { if (done) return; done = true; clearInterval(watch); res(); };
    u.onend = finish;
    u.onerror = finish;
    // 被取消/跳过时立即结束;并设置兜底超时,防止个别浏览器不触发 onend
    const startedAt = performance.now();
    const limit = 4000 + spoken.length * 450;
    const watch = setInterval(() => {
      if (dead(gen) || instant()) { speechSynthesis.cancel(); finish(); }
      else if (!player.paused && performance.now() - startedAt > limit) finish();
    }, 120);
    speechSynthesis.speak(u);
  });
}

/* ---------- 富文本:$公式$、**强调**,拆成可逐个显现的单元 ---------- */
function texHTML(tex, display) {
  try {
    return katex.renderToString(String(tex), { displayMode: !!display, throwOnError: false, strict: false, trust: false });
  } catch {
    const s = document.createElement('span');
    s.textContent = tex;
    return s.outerHTML;
  }
}

function fillRich(el, text) {
  const units = [];
  const addChars = (str, cls) => {
    for (const ch of str) {
      const s = document.createElement('span');
      s.className = 'u ch' + (cls ? ' ' + cls : '');
      s.textContent = ch;
      el.appendChild(s);
      units.push(s);
    }
  };
  const tokens = String(text == null ? '' : text).split(/(\$[^$]+\$|\*\*[^*]+\*\*)/);
  for (const tk of tokens) {
    if (!tk) continue;
    if (tk.length > 2 && tk[0] === '$' && tk[tk.length - 1] === '$') {
      const s = document.createElement('span');
      s.className = 'u mt';
      s.dataset.len = tk.length;
      s.innerHTML = texHTML(tk.slice(1, -1), false);
      el.appendChild(s);
      units.push(s);
    } else if (tk.startsWith('**') && tk.endsWith('**') && tk.length > 4) {
      addChars(tk.slice(2, -2), 'em');
    } else addChars(tk);
  }
  return units;
}

function moveCursor(target) {
  const r = target.getBoundingClientRect();
  const base = innerEl.getBoundingClientRect();
  cursorEl.style.left = (r.right - base.left) + 'px';
  cursorEl.style.top = (r.bottom - base.top) + 'px';
  cursorEl.classList.remove('hidden');
}

function follow(el) {
  const bottom = el.offsetTop + el.offsetHeight + 90;
  const target = bottom - scrollEl.clientHeight;
  if (target > scrollEl.scrollTop) scrollEl.scrollTo({ top: target, behavior: instant() ? 'auto' : 'smooth' });
}

// 逐个显现 units(容器需带 .writing 类)
async function writeUnits(container, units, gen) {
  if (instant() || dead(gen)) { container.classList.remove('writing'); return; }
  for (const u of units) {
    if (dead(gen) || instant()) break;
    u.classList.add('on');
    if (u.classList.contains('mt')) {
      const d = Math.min(1100, 160 + 22 * (+u.dataset.len || 10));
      u.style.animationDuration = (d / prefs.speed) + 'ms';
      moveCursor(u);
      await sleep(d, gen);
    } else {
      const ch = u.textContent;
      if (ch.trim()) moveCursor(u);
      await sleep(/[\u2e80-\u9fff]/.test(ch) ? 42 : /\s/.test(ch) ? 12 : 24, gen);
    }
  }
  container.classList.remove('writing');
}

// 从左到右"写出"一整块(公式、图等)
async function wipeIn(el, ms, gen) {
  if (instant() || dead(gen)) return;
  el.style.animationDuration = (ms / prefs.speed) + 'ms';
  el.classList.add('wipe-in');
  await sleep(ms, gen);
  el.classList.remove('wipe-in');
}

async function fadeIn(el, ms, gen) {
  if (instant() || dead(gen)) return;
  el.style.animationDuration = (ms / prefs.speed) + 'ms';
  el.classList.add('fade-in');
  await sleep(ms, gen);
  el.classList.remove('fade-in');
}

function addLine(cls) {
  const el = document.createElement('div');
  el.className = cls;
  lessonEl.appendChild(el);
  return el;
}

// 每行右侧的"追问这一步"按钮
function addAskButton(el, quote) {
  const b = document.createElement('button');
  b.className = 'ask-step';
  b.type = 'button';
  b.title = '请老师把这一步讲得更细';
  b.textContent = '?';
  b.onclick = e => {
    e.stopPropagation();
    askLesson(`请更详细地解释这一步:「${quote}」`);
  };
  el.appendChild(b);
}

/* ---------- 各种板书动作 ---------- */
async function renderOp(op, gen) {
  if (!op || typeof op !== 'object') return;
  const kind = op.op || (op.tex ? 'math' : 'p');
  const speech = () => speakSay(op.say, gen);

  switch (kind) {
    case 'wipe': clearLessonDom(); return;

    case 'suggest':
      if (Array.isArray(op.items)) player.suggest = op.items.filter(s => typeof s === 'string').slice(0, 4);
      return;

    case 'say':
      await speakSay(op.text || op.say, gen);
      return;

    case 'divider': {
      const el = addLine('l-divider');
      follow(el);
      await fadeIn(el, 300, gen);
      return;
    }

    case 'q': { // 追问的问题回显(本地生成)
      const el = addLine('l-q');
      el.textContent = '🙋 ' + op.text;
      follow(el);
      await fadeIn(el, 300, gen);
      return;
    }

    case 'title': {
      const el = addLine('l-title writing');
      const txt = document.createElement('span');
      txt.className = 'txt';
      el.appendChild(txt);
      const units = fillRich(txt, op.text);
      follow(el);
      const sp = speech();
      await writeUnits(el, units, gen);
      el.classList.add('underlined');
      await sleep(450, gen);
      await sp;
      return;
    }

    case 'h': {
      const el = addLine('l-h writing');
      const units = fillRich(el, op.text);
      follow(el);
      const sp = speech();
      await writeUnits(el, units, gen);
      await sp;
      return;
    }

    case 'math': {
      const el = addLine('l-math c-' + colorOf(op.color));
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.innerHTML = texHTML(op.tex, true);
      el.appendChild(txt);
      if (op.id) ids.set(String(op.id), el);
      addAskButton(el, '$' + op.tex + '$');
      follow(el);
      const sp = speech();
      moveCursor(txt);
      await wipeIn(txt, Math.min(2200, 500 + 16 * String(op.tex).length), gen);
      moveCursor(txt);
      await sp;
      await sleep(200, gen);
      return;
    }

    case 'mark': {
      const el = ids.get(String(op.target));
      if (!el) { await speech(); return; }
      const type = ['strike', 'underline', 'box', 'highlight'].includes(op.type) ? op.type : 'underline';
      follow(el);
      const sp = speech();
      el.classList.add('mk-' + type);
      await sleep(700, gen);
      await sp;
      return;
    }

    case 'plot': {
      const el = addLine('l-figure');
      let ok = true;
      if (instant()) el.classList.add('noanim');
      el.style.setProperty('--dur', (1500 / (prefs.speed || 1)) + 'ms');
      try { el.appendChild(buildPlot(op)); } catch (e) {
        ok = false;
        el.className = 'line c-red';
        el.textContent = '（函数图像绘制失败: ' + e.message + '）';
      }
      follow(el);
      const sp = speech();
      if (ok) await sleep(1500, gen);
      await sp;
      return;
    }

    case 'figure': {
      const el = addLine('l-figure');
      const { svg, parts } = buildFigure(op);
      el.appendChild(svg);
      follow(el);
      const sp = speech();
      if (!instant()) {
        parts.forEach(p => p.classList.add('hid'));
        for (const p of parts) {
          if (dead(gen) || instant()) break;
          p.classList.remove('hid');
          p.classList.add(p.tagName === 'text' ? 'fade-in' : 'draw');
          p.style.animationDuration = (420 / prefs.speed) + 'ms';
          await sleep(p.tagName === 'text' ? 160 : 420, gen);
        }
        parts.forEach(p => p.classList.remove('hid'));
      }
      await sp;
      return;
    }

    case 'word': {
      const el = addLine('l-word');
      const parts = Array.isArray(op.parts) ? op.parts : [];
      const nodes = [];
      parts.forEach((p, i) => {
        if (i) { const plus = document.createElement('span'); plus.className = 'w-plus'; plus.textContent = '+'; el.appendChild(plus); nodes.push(plus); }
        const card = document.createElement('div');
        card.className = 'w-part c-' + colorOf(p.c || p.color, CYCLE[i % CYCLE.length]);
        const t = document.createElement('div'); t.className = 'w-t'; t.textContent = p.t || '';
        const m = document.createElement('div'); m.className = 'w-m'; m.textContent = p.m || '';
        card.append(t, m);
        if (p.o) { const o = document.createElement('div'); o.className = 'w-o'; o.textContent = p.o; card.appendChild(o); }
        el.appendChild(card);
        nodes.push(card);
      });
      if (op.word || op.meaning) {
        const eq = document.createElement('div');
        eq.className = 'w-eq';
        eq.textContent = '= ' + [op.word, op.meaning].filter(Boolean).join('  ');
        el.appendChild(eq);
        nodes.push(eq);
      }
      follow(el);
      const sp = speech();
      if (!instant()) {
        nodes.forEach(n => n.classList.add('hid'));
        for (const n of nodes) {
          if (dead(gen) || instant()) break;
          n.classList.remove('hid');
          await fadeIn(n, n.classList.contains('w-plus') ? 150 : 420, gen);
        }
        nodes.forEach(n => n.classList.remove('hid'));
      }
      await sp;
      return;
    }

    case 'sentence': {
      const el = addLine('l-sentence writing');
      const row = document.createElement('div');
      row.className = 's-row';
      el.appendChild(row);
      const units = [], roles = [];
      let ci = 0;
      (Array.isArray(op.parts) ? op.parts : []).forEach(p => {
        const seg = document.createElement('span');
        seg.className = 's-seg';
        const t = document.createElement('span');
        t.className = 's-t';
        units.push(...fillRich(t, p.t || ''));
        seg.appendChild(t);
        if (p.r) {
          seg.classList.add('has-role', 'c-' + colorOf(p.c || p.color, CYCLE[ci++ % CYCLE.length]));
          const r = document.createElement('span');
          r.className = 's-r';
          r.textContent = p.r;
          seg.appendChild(r);
          roles.push(seg);
        }
        row.appendChild(seg);
      });
      let zh = null;
      if (op.zh) { zh = document.createElement('div'); zh.className = 's-zh'; zh.textContent = op.zh; el.appendChild(zh); }
      follow(el);
      const sp = speech();
      const animate = !instant();
      if (animate) { roles.forEach(r => r.classList.add('role-hid')); if (zh) zh.classList.add('hid'); }
      await writeUnits(el, units, gen);
      for (const r of roles) {
        if (animate && !dead(gen) && !instant()) await sleep(380, gen);
        r.classList.remove('role-hid');
      }
      if (zh) { zh.classList.remove('hid'); await fadeIn(zh, 400, gen); }
      await sp;
      return;
    }

    case 'table': {
      const el = addLine('l-table');
      const table = document.createElement('table');
      const rows = [];
      const addRow = (cells, tag) => {
        const tr = document.createElement('tr');
        (Array.isArray(cells) ? cells : []).forEach(c => {
          const cell = document.createElement(tag);
          fillRich(cell, c);
          tr.appendChild(cell);
        });
        table.appendChild(tr);
        rows.push(tr);
      };
      if (Array.isArray(op.head)) addRow(op.head, 'th');
      (Array.isArray(op.rows) ? op.rows : []).forEach(r => addRow(r, 'td'));
      el.appendChild(table);
      follow(el);
      const sp = speech();
      if (!instant()) {
        rows.forEach(r => r.classList.add('hid'));
        for (const r of rows) {
          if (dead(gen) || instant()) break;
          r.classList.remove('hid');
          await fadeIn(r, 380, gen);
        }
        rows.forEach(r => r.classList.remove('hid'));
      }
      follow(el);
      await sp;
      return;
    }

    default: { // p 及未知动作:只要有 text 就当一行板书
      if (op.text == null || op.text === '') { await speech(); return; }
      const size = ['small', 'large'].includes(op.size) ? ' s-' + op.size : '';
      const el = addLine(`line writing c-${colorOf(op.color)}${size} in-${Math.max(0, Math.min(2, op.indent | 0))}`);
      const txt = document.createElement('span');
      txt.className = 'txt';
      el.appendChild(txt);
      const units = fillRich(txt, op.text);
      if (op.id) ids.set(String(op.id), el);
      addAskButton(el, String(op.text).replace(/\*\*/g, ''));
      follow(el);
      const sp = speech();
      await writeUnits(el, units, gen);
      await sp;
      await sleep(180, gen);
    }
  }
}

/* ---------- SVG:函数图像 ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}
const fmtNum = v => String(+v.toFixed(6)).replace(/^-/, '−');

function buildPlot(op) {
  const fns = (Array.isArray(op.fns) ? op.fns : (op.expr ? [{ expr: op.expr, label: op.label }] : []))
    .map(f => (typeof f === 'string' ? { expr: f } : f)).filter(f => f && f.expr);
  if (!fns.length) throw new Error('缺少函数表达式');
  let xMin = Number.isFinite(+op.xmin) ? +op.xmin : -5;
  let xMax = Number.isFinite(+op.xmax) ? +op.xmax : 5;
  if (!(xMax > xMin)) { xMin = -5; xMax = 5; }
  const N = 480;
  const compiled = fns.map(f => math.compile(String(f.expr).replace(/^\s*y\s*=\s*/i, '')));
  const series = compiled.map(c => {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const x = xMin + (xMax - xMin) * i / N;
      let y;
      try { y = c.evaluate({ x }); } catch { y = NaN; }
      pts.push(typeof y === 'number' && isFinite(y) ? [x, y] : null);
    }
    return pts;
  });
  const pointsExtra = (Array.isArray(op.points) ? op.points : []).filter(p => p && isFinite(+p.x) && isFinite(+p.y));

  let yMin = +op.ymin, yMax = +op.ymax;
  if (!(isFinite(yMin) && isFinite(yMax) && yMax > yMin)) {
    const ys = series.flat().filter(Boolean).map(p => p[1]).sort((a, b) => a - b);
    if (!ys.length) throw new Error('该函数在给定区间上没有有效值');
    yMin = ys[Math.floor(ys.length * 0.03)];
    yMax = ys[Math.ceil(ys.length * 0.97) - 1];
    pointsExtra.forEach(p => { yMin = Math.min(yMin, +p.y); yMax = Math.max(yMax, +p.y); });
    if (yMin > 0 && yMin < (yMax - yMin) * 0.6) yMin = 0;
    if (yMax < 0 && -yMax < (yMax - yMin) * 0.6) yMax = 0;
    if (yMax - yMin < 1e-9) { yMin -= 1; yMax += 1; }
    const pad = (yMax - yMin) * 0.12;
    yMin -= pad; yMax += pad;
  }

  const W = 520, H = 330, m = 34, TOP = 28; // TOP: 顶部留给图例
  const sx = x => m + (x - xMin) / (xMax - xMin) * (W - 2 * m);
  const sy = y => H - m - (y - yMin) / (yMax - yMin) * (H - 2 * m);
  const svg = svgEl('svg', { viewBox: `0 ${-TOP} ${W} ${H + TOP}`, class: 'plot' });
  let legendX = m;
  const clipId = 'clip' + Math.random().toString(36).slice(2, 8);
  const defs = svgEl('defs', {}, svg);
  svgEl('rect', { x: m - 2, y: m - 2, width: W - 2 * m + 4, height: H - 2 * m + 4 }, svgEl('clipPath', { id: clipId }, defs));

  const axisY = (yMin <= 0 && yMax >= 0) ? sy(0) : H - m;
  const axisX = (xMin <= 0 && xMax >= 0) ? sx(0) : m;
  const g = svgEl('g', { class: 'axes' }, svg);
  const xs = niceStep((xMax - xMin) / 8), ysStep = niceStep((yMax - yMin) / 6);
  for (let x = Math.ceil(xMin / xs) * xs; x <= xMax + 1e-9; x += xs) {
    const px = sx(x);
    svgEl('line', { x1: px, y1: m, x2: px, y2: H - m, class: 'grid' }, g);
    if (Math.abs(x) > xs / 2) svgEl('text', { x: px, y: Math.min(H - 6, axisY + 16), 'text-anchor': 'middle', class: 'tick' }, g).textContent = fmtNum(x);
  }
  for (let y = Math.ceil(yMin / ysStep) * ysStep; y <= yMax + 1e-9; y += ysStep) {
    const py = sy(y);
    svgEl('line', { x1: m, y1: py, x2: W - m, y2: py, class: 'grid' }, g);
    if (Math.abs(y) > ysStep / 2) svgEl('text', { x: Math.max(22, axisX - 6), y: py + 4, 'text-anchor': 'end', class: 'tick' }, g).textContent = fmtNum(y);
  }
  svgEl('path', { d: `M${m - 8},${axisY} H${W - m + 12} m-7,-4 l7,4 l-7,4`, class: 'axis' }, g);
  svgEl('path', { d: `M${axisX},${H - m + 8} V${m - 12} m-4,7 l4,-7 l4,7`, class: 'axis' }, g);
  svgEl('text', { x: W - m + 14, y: axisY + 16, class: 'tick it' }, g).textContent = 'x';
  svgEl('text', { x: axisX + 8, y: m - 12, class: 'tick it' }, g).textContent = 'y';
  if (axisX !== m || axisY !== H - m) svgEl('text', { x: axisX - 6, y: axisY + 16, 'text-anchor': 'end', class: 'tick it' }, g).textContent = 'O';

  const span = yMax - yMin;
  series.forEach((pts, i) => {
    let d = '', up = true, prev = null;
    for (const p of pts) {
      if (!p || p[1] < yMin - span || p[1] > yMax + span || (prev && Math.abs(p[1] - prev[1]) > span * 1.5)) { up = true; prev = p; continue; }
      d += (up ? 'M' : 'L') + sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1);
      up = false; prev = p;
    }
    const color = COLOR_HEX[colorOf(fns[i].color, CYCLE[i % CYCLE.length])];
    svgEl('path', { d, class: 'curve', stroke: color, pathLength: 1, 'clip-path': `url(#${clipId})` }, svg);
    const label = String(fns[i].label || ('y = ' + fns[i].expr)).replace(/\$/g, '');
    svgEl('line', { x1: legendX, y1: -10, x2: legendX + 18, y2: -10, stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round' }, svg);
    svgEl('text', { x: legendX + 24, y: -5, class: 'legend', fill: color }, svg).textContent = label;
    legendX += 24 + [...label].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 16 : 9), 0) + 22;
  });
  pointsExtra.forEach(p => {
    const px = sx(+p.x), py = sy(+p.y);
    svgEl('circle', { cx: px, cy: py, r: 4.5, class: 'pt' }, svg);
    if (p.label) svgEl('text', { x: px + 8, y: py - 8, class: 'ptl' }, svg).textContent = String(p.label).replace(/\$/g, '');
  });
  return svg;
}

/* ---------- SVG:几何示意图 ---------- */
function buildFigure(op) {
  const W = Math.max(120, Math.min(900, +op.w || 420)), H = Math.max(100, Math.min(700, +op.h || 280));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'figure', style: `max-width:${Math.round(W * 1.15)}px` });
  const parts = [];
  const P = p => (Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]) ? [+p[0], +p[1]] : null);
  const hex = (c, d) => COLOR_HEX[colorOf(c, d || 'white')];
  const stroke = (tag, attrs, it) => {
    const e = svgEl(tag, { ...attrs, class: 'fs' + (it.dashed ? ' dashed' : ''), stroke: hex(it.color), pathLength: it.dashed ? null : 1 }, svg);
    parts.push(e);
    return e;
  };
  const text = (at, str, color, cls) => {
    const e = svgEl('text', { x: at[0], y: at[1], class: cls || 'fl', fill: hex(color, 'blue'), 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, svg);
    e.textContent = String(str).replace(/\$/g, '');
    parts.push(e);
  };
  const unit = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };

  for (const it of (Array.isArray(op.items) ? op.items : [])) {
    if (!it || typeof it !== 'object') continue;
    const t = it.t || it.type;
    if (t === 'poly' || t === 'polygon') {
      const pts = (it.p || it.points || []).map(P).filter(Boolean);
      if (pts.length < 2) continue;
      const e = stroke('path', { d: 'M' + pts.map(p => p.join(',')).join('L') + 'Z' }, it);
      if (it.fill) { e.setAttribute('fill', hex(it.color)); e.setAttribute('fill-opacity', '0.1'); }
    } else if (t === 'line' || t === 'seg') {
      const pts = (it.p || it.points || []).map(P).filter(Boolean);
      if (pts.length < 2) continue;
      stroke('path', { d: 'M' + pts.map(p => p.join(',')).join('L') }, it);
    } else if (t === 'circle') {
      const c = P(it.c || it.center), r = +(it.r || it.radius);
      if (!c || !(r > 0)) continue;
      stroke('circle', { cx: c[0], cy: c[1], r }, it);
    } else if (t === 'point') {
      const at = P(it.at);
      if (!at) continue;
      parts.push(svgEl('circle', { cx: at[0], cy: at[1], r: 3.5, class: 'fp', fill: hex(it.color) }, svg));
      if (it.label) {
        // 标签放在远离图形中心的一侧
        const dx = at[0] - W / 2, dy = at[1] - H / 2, d = Math.hypot(dx, dy) || 1;
        text([at[0] + dx / d * 16, at[1] + dy / d * 16], it.label, it.color || 'white', 'fl pl');
      }
    } else if (t === 'label') {
      const at = P(it.at);
      if (at && it.text != null) text(at, it.text, it.color);
    } else if (t === 'right') {
      const at = P(it.at), p1 = P(it.p1), p2 = P(it.p2);
      if (!at || !p1 || !p2) continue;
      const u = unit(at, p1), v = unit(at, p2), s = 13;
      stroke('path', { d: `M${at[0] + u[0] * s},${at[1] + u[1] * s} L${at[0] + (u[0] + v[0]) * s},${at[1] + (u[1] + v[1]) * s} L${at[0] + v[0] * s},${at[1] + v[1] * s}` }, { color: it.color || 'blue' });
    } else if (t === 'angle') {
      const at = P(it.at), p1 = P(it.p1), p2 = P(it.p2);
      if (!at || !p1 || !p2) continue;
      const u = unit(at, p1), v = unit(at, p2), r = 22;
      const cross = u[0] * v[1] - u[1] * v[0];
      stroke('path', { d: `M${at[0] + u[0] * r},${at[1] + u[1] * r} A${r},${r} 0 0 ${cross > 0 ? 1 : 0} ${at[0] + v[0] * r},${at[1] + v[1] * r}` }, { color: it.color || 'blue' });
      if (it.label) {
        const b = [u[0] + v[0], u[1] + v[1]], d = Math.hypot(b[0], b[1]) || 1;
        text([at[0] + b[0] / d * (r + 14), at[1] + b[1] / d * (r + 14)], it.label, it.color || 'blue');
      }
    }
  }
  return { svg, parts };
}

/* ---------- NDJSON 解析 ---------- */
// 容错:模型偶尔会忘记把 LaTeX 的反斜杠写成 \\,这里把"非法/落单"的反斜杠补成两个
function parseOpLine(line) {
  line = line.trim().replace(/,\s*$/, '');
  if (!line.startsWith('{')) return null;
  const fixed = line.replace(/\\(\\|"|\/|u[0-9a-fA-F]{4})|\\/g, (m, keep) => (keep ? m : '\\\\'));
  try { return JSON.parse(fixed); } catch {}
  try { return JSON.parse(line); } catch {}
  return null;
}

/* ---------- 提问 ---------- */
/**
 * 向 AI 老师提问,板书流式写到黑板上。
 * @param {string} question
 * @param {{fresh?:boolean, image?:string, level?:string}} [opt] fresh: 先擦掉黑板开始新话题;image: 黑板手写内容的 base64 PNG
 */
async function askLesson(question, opt) {
  opt = opt || {};
  question = String(question || '').trim();
  if (!question) return;
  if (player.running || player.streaming) stopLesson();
  if (opt.fresh) wipeLesson();
  player.skip = false;
  player.suggest = null;
  lessonEl.querySelector('.welcome')?.remove();

  const isFollowUp = player.ops.length > 0;
  if (isFollowUp) { player.ops.push({ op: 'divider' }, { op: 'q', text: question }); }

  const content = [];
  if (opt.image) content.push(imageBlock(opt.image));
  content.push({ type: 'text', text: opt.image ? question + '\n\n（附图是黑板上的手写内容,请先读懂它。）' : question });
  convo.push({ role: 'user', content });

  const userMsg = convo[convo.length - 1];
  const myGen = player.gen;
  player.streaming = true;
  aiAbort = new AbortController();
  const ctrl = aiAbort;
  showStatus('老师正在备课…');
  runPlayer();
  onLessonState();

  let buf = '', raw = '', got = 0;
  const feed = line => {
    const op = parseOpLine(line);
    if (!op) return;
    if (!got++) hideStatus();
    pushOp(op);
  };
  try {
    const full = await aiStream({
      system: lessonSystemPrompt(opt.level || document.getElementById('level')?.value),
      messages: convo,
      maxTokens: 24000,
      signal: ctrl.signal,
      onThinking: () => { if (!got && !dead(myGen)) showStatus('老师正在思考…'); },
      onText: delta => {
        if (dead(myGen)) return;
        raw += delta; buf += delta;
        let i;
        while ((i = buf.indexOf('\n')) !== -1) { feed(buf.slice(0, i)); buf = buf.slice(i + 1); }
      },
    });
    if (dead(myGen)) return;
    if (buf.trim()) feed(buf);
    if (!got) {
      // 模型没按格式输出:退化为逐行纯文本板书
      const lines = String(full || raw).split('\n').map(s => s.trim()).filter(Boolean);
      if (!lines.length) throw new Error('AI 没有返回内容');
      hideStatus();
      lines.forEach(text => pushOp({ op: 'p', text }));
    }
    convo.push({ role: 'assistant', content: raw || full });
  } catch (err) {
    if (dead(myGen) || err.name === 'AbortError') return;
    if (convo[convo.length - 1] === userMsg) convo.pop();
    showStatus('讲解失败: ' + err.message, 6000);
  } finally {
    // 中途被停止:把已经写出的部分记入历史,追问时 AI 才知道黑板上有什么
    if (dead(myGen) && convo[convo.length - 1] === userMsg) {
      const partial = raw.slice(0, raw.lastIndexOf('\n') + 1).trim();
      if (partial) convo.push({ role: 'assistant', content: partial });
      else convo.pop();
    }
    if (!dead(myGen)) {
      player.streaming = false;
      aiAbort = null;
      wake();
      onLessonState();
    }
  }
}
