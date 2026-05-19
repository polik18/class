// 模組：抽籤機 (Draw Mode)
let drawState = {
  mode: 'number',
  startNum: 1, endNum: 50, drawCount: 1,
  excludeText: "", nameText: "",
  isDrawing: false, uniqueDraw: true,
  drawnNumbers: [], availableList: []
};

const drawEls = {
  modeNumberBtn: document.getElementById('mode-number-btn'),
  modeNameBtn: document.getElementById('mode-name-btn'),
  numberSettings: document.getElementById('number-settings'),
  nameSettings: document.getElementById('name-settings'),
  nameInput: document.getElementById('name-input'),
  startNum: document.getElementById('start-num'),
  endNum: document.getElementById('end-num'),
  drawCount: document.getElementById('draw-count'),
  excludeInput: document.getElementById('exclude-input'),
  poolInfo: document.getElementById('pool-info'),
  uniqueToggle: document.getElementById('unique-toggle'),
  uniqueToggleKnob: document.getElementById('unique-toggle-knob'),
  historyContainer: document.getElementById('history-container'),
  historyCount: document.getElementById('history-count'),
  historyList: document.getElementById('history-list'),
  errorMsg: document.getElementById('error-msg'),
  drawBtn: document.getElementById('draw-btn'),
  drawBtnContent: document.getElementById('draw-btn-content'),
  drawBtnFx: document.getElementById('draw-btn-fx'),
  resetBtn: document.getElementById('reset-btn'),
  standbyView: document.getElementById('standby-view'),
  rollingView: document.getElementById('rolling-view'),
  resultView: document.getElementById('result-view'),
  winnersContainer: document.getElementById('winners-container'),
  canvas: document.getElementById('confetti-canvas')
};

// 彩帶特效
let confettiAnimationId = null;
let confettiParticles = [];
const confettiCtx = drawEls.canvas.getContext('2d');

const triggerConfetti = () => {
  drawEls.canvas.width = window.innerWidth;
  drawEls.canvas.height = window.innerHeight;
  confettiParticles = [];
  for (let i = 0; i < 150; i++) {
    confettiParticles.push({
      x: drawEls.canvas.width / 2, y: drawEls.canvas.height / 2,
      vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 1) * 30 - 10,
      size: Math.random() * 10 + 8, color: `hsl(${Math.random() * 360}, 100%, 60%)`,
      rotation: Math.random() * 360, rotationSpeed: (Math.random() - 0.5) * 20,
      opacity: 1
    });
  }
  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
  animateConfetti();
};

const animateConfetti = () => {
  confettiCtx.clearRect(0, 0, drawEls.canvas.width, drawEls.canvas.height);
  let activeParticles = false;
  confettiParticles.forEach((p) => {
    if (p.opacity <= 0) return;
    activeParticles = true;
    p.x += p.vx; p.y += p.vy; p.vy += 0.8; p.vx *= 0.98;
    p.rotation += p.rotationSpeed; p.opacity -= 0.005;
    confettiCtx.save(); confettiCtx.translate(p.x, p.y); confettiCtx.rotate((p.rotation * Math.PI) / 180);
    confettiCtx.globalAlpha = Math.max(0, p.opacity); confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); confettiCtx.restore();
  });
  if (activeParticles) confettiAnimationId = requestAnimationFrame(animateConfetti);
  else { confettiParticles = []; confettiCtx.clearRect(0, 0, drawEls.canvas.width, drawEls.canvas.height); }
};

// 工具函式
const shuffle = (array) => {
  let currentIndex = array.length, randomIndex;
  const newArray = [...array];
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [newArray[currentIndex], newArray[randomIndex]] = [newArray[randomIndex], newArray[currentIndex]];
  }
  return newArray;
};

const parseExcludes = (text) => {
  if (!text) return [];
  const parts = text.split(/[,，、]/).map(p => p.trim());
  const excludes = new Set();
  parts.forEach(part => {
    const rangeMatch = part.match(/^(\d+)[-~～](\d+)$/);
    if (rangeMatch) {
      const min = Math.min(parseInt(rangeMatch[1]), parseInt(rangeMatch[2]));
      const max = Math.max(parseInt(rangeMatch[1]), parseInt(rangeMatch[2]));
      for (let i = min; i <= max; i++) excludes.add(i.toString());
    } else {
      if (!isNaN(parseInt(part))) excludes.add(parseInt(part).toString());
    }
  });
  return Array.from(excludes);
};

const updateAvailableList = () => {
  const itemsList = [];
  if (drawState.mode === 'number') {
    const excludes = parseExcludes(drawState.excludeText);
    if (drawState.startNum <= drawState.endNum) {
      for (let i = drawState.startNum; i <= drawState.endNum; i++) {
        if (!excludes.includes(i.toString())) itemsList.push(i.toString());
      }
    }
  } else {
    if (drawState.nameText.trim()) {
      drawState.nameText.split(/[\n,，、]+/).forEach(part => {
        if (part.trim()) itemsList.push(part.trim());
      });
    }
  }

  drawState.availableList = drawState.uniqueDraw ? itemsList.filter(n => !drawState.drawnNumbers.includes(n)) : itemsList;

  const typeStr = drawState.mode === 'number' ? '個號碼' : '個人';
  let infoText = `共 ${itemsList.length} ${typeStr}`;
  if (drawState.uniqueDraw && drawState.drawnNumbers.length > 0) infoText = `剩餘 ${drawState.availableList.length} / ${infoText}`;
  drawEls.poolInfo.textContent = infoText;
  validateInputs();
};

const showError = (msg) => {
  if (msg) { drawEls.errorMsg.textContent = msg; drawEls.errorMsg.classList.remove('hidden'); }
  else drawEls.errorMsg.classList.add('hidden');
};

const validateInputs = () => {
  let isValid = true;
  if (drawState.mode === 'number' && drawState.startNum > drawState.endNum) {
    showError("起始編號不能大於結束編號！"); isValid = false;
  } else if (drawState.availableList.length === 0 && !drawState.isDrawing) {
    showError(drawState.mode === 'number' ? "沒有可抽的號碼了！" : "名單為空或已抽完！"); isValid = false;
  } else if (drawState.drawCount < 1 || drawState.drawCount > drawState.availableList.length) {
    showError(`抽出數量必須介於 1 到 ${drawState.availableList.length} 之間！`); isValid = false;
  } else showError("");

  if (!isValid || drawState.isDrawing) {
    drawEls.drawBtn.classList.replace('bg-indigo-600', 'bg-slate-800');
    drawEls.drawBtn.classList.remove('hover:bg-indigo-500', 'text-white', 'shadow-lg', 'animate-glow');
    drawEls.drawBtn.classList.add('text-slate-500', 'cursor-not-allowed');
    drawEls.drawBtn.disabled = true; drawEls.drawBtnFx.classList.add('hidden');
  } else {
    drawEls.drawBtn.classList.replace('bg-slate-800', 'bg-indigo-600');
    drawEls.drawBtn.classList.add('hover:bg-indigo-500', 'text-white', 'shadow-lg', 'animate-glow');
    drawEls.drawBtn.classList.remove('text-slate-500', 'cursor-not-allowed');
    drawEls.drawBtn.disabled = false; drawEls.drawBtnFx.classList.remove('hidden');
  }
  drawEls.resetBtn.disabled = drawState.isDrawing || (drawState.drawnNumbers.length === 0 && drawEls.resultView.classList.contains('hidden'));
};

const renderHistory = () => {
  if (drawState.uniqueDraw && drawState.drawnNumbers.length > 0) {
    drawEls.historyContainer.classList.remove('hidden');
    drawEls.historyCount.textContent = `已抽出結果 (${drawState.drawnNumbers.length})`;
    drawEls.historyList.innerHTML = drawState.drawnNumbers.map(num =>
      `<button data-val="${num}" title="點擊將 [${num}] 加回籤筒" class="group relative px-3 py-1 min-w-[3rem] bg-slate-800 hover:bg-indigo-600 transition-all cursor-pointer text-slate-300 rounded-lg text-sm border border-slate-700 hover:border-indigo-400 font-medium shadow-sm overflow-hidden flex justify-center items-center">
        <span class="group-hover:opacity-0 transition-opacity">${num}</span>
        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-600">
          <i data-lucide="rotate-ccw" class="w-4 h-4 text-white"></i>
        </div>
      </button>`
    ).join('');
    lucide.createIcons({ root: drawEls.historyList });
  } else drawEls.historyContainer.classList.add('hidden');
};

const fullReset = () => {
  drawState.drawnNumbers = [];
  drawEls.standbyView.classList.remove('hidden');
  drawEls.rollingView.classList.add('hidden');
  drawEls.resultView.classList.add('hidden');
  updateAvailableList(); renderHistory();
};

let drawInterval;
const startDraw = () => {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  drawState.isDrawing = true; updateAvailableList();

  drawEls.standbyView.classList.add('hidden');
  drawEls.resultView.classList.add('hidden');
  drawEls.rollingView.classList.remove('hidden');
  drawEls.drawBtnContent.innerHTML = `<div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-[spin_1s_linear_infinite]"></div> 抽籤中...`;
  validateInputs();

  let elapsed = 0;
  drawInterval = setInterval(() => {
    const preview = shuffle(drawState.availableList).slice(0, drawState.drawCount);
    drawEls.rollingView.innerHTML = preview.map(name => `
      <div class="px-8 py-6 bg-gradient-to-br from-indigo-600 to-purple-700 border border-white/20 rounded-2xl text-4xl md:text-5xl font-black text-white shadow-[0_0_40px_rgba(99,102,241,0.6)] backdrop-blur-md"
           style="transform: scale(${0.95 + Math.random() * 0.1}) translateY(${(Math.random() - 0.5) * 10}px); filter: blur(${Math.random() * 1.5}px);">
        ${name}
      </div>
    `).join('');
    playTick(); elapsed += 80;
    if (elapsed >= 3000) { clearInterval(drawInterval); finishDraw(); }
  }, 80);
};

const finishDraw = () => {
  const finalWinners = shuffle(drawState.availableList).slice(0, drawState.drawCount);
  if (drawState.uniqueDraw) drawState.drawnNumbers = [...drawState.drawnNumbers, ...finalWinners];

  drawState.isDrawing = false;
  drawEls.rollingView.classList.add('hidden');
  drawEls.resultView.classList.remove('hidden');

  drawEls.winnersContainer.innerHTML = finalWinners.map((name, idx) => `
    <div class="animate-pop-in relative group" style="animation-delay: ${idx * 0.1}s">
      <div class="absolute inset-0 bg-gradient-to-r from-amber-300 to-orange-500 rounded-2xl blur-xl opacity-40 group-hover:opacity-100 transition-opacity"></div>
      <div class="relative px-12 py-10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-amber-400/50 rounded-2xl flex flex-col items-center gap-4 hover:scale-110 hover:-translate-y-4 transition-all animate-float shadow-2xl overflow-hidden">
        <i data-lucide="trophy" class="w-12 h-12 text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.8)]"></i>
        <span class="text-4xl md:text-6xl font-black bg-gradient-to-b from-yellow-200 via-amber-400 to-orange-500 bg-clip-text text-transparent drop-shadow-md break-all">${name}</span>
      </div>
    </div>
  `).join('');

  drawEls.drawBtnContent.innerHTML = `<i data-lucide="play" class="w-5 h-5 fill-current"></i> 開始抽籤`;
  lucide.createIcons(); playWin(); triggerConfetti();
  updateAvailableList(); renderHistory(); validateInputs();
};

const switchDrawMode = (mode) => {
  if (drawState.isDrawing) return;
  drawState.mode = mode;
  if (mode === 'number') {
    drawEls.modeNumberBtn.className = "flex-1 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white shadow-md transition-all relative z-10";
    drawEls.modeNameBtn.className = "flex-1 py-2 text-sm font-bold rounded-lg text-slate-400 hover:text-slate-200 transition-all relative z-10";
    drawEls.numberSettings.classList.remove('hidden'); drawEls.nameSettings.classList.add('hidden');
  } else {
    drawEls.modeNameBtn.className = "flex-1 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white shadow-md transition-all relative z-10";
    drawEls.modeNumberBtn.className = "flex-1 py-2 text-sm font-bold rounded-lg text-slate-400 hover:text-slate-200 transition-all relative z-10";
    drawEls.nameSettings.classList.remove('hidden'); drawEls.numberSettings.classList.add('hidden');
  }
  fullReset();
};

drawEls.modeNumberBtn.addEventListener('click', () => switchDrawMode('number'));
drawEls.modeNameBtn.addEventListener('click', () => switchDrawMode('name'));
drawEls.startNum.addEventListener('input', () => { drawState.startNum = parseInt(drawEls.startNum.value) || 0; fullReset(); });
drawEls.endNum.addEventListener('input', () => { drawState.endNum = parseInt(drawEls.endNum.value) || 0; fullReset(); });
drawEls.drawCount.addEventListener('input', () => { drawState.drawCount = parseInt(drawEls.drawCount.value) || 1; validateInputs(); });
drawEls.excludeInput.addEventListener('input', (e) => { drawState.excludeText = e.target.value; fullReset(); });
drawEls.nameInput.addEventListener('input', (e) => { drawState.nameText = e.target.value; fullReset(); });

drawEls.uniqueToggle.addEventListener('click', () => {
  if (drawState.isDrawing) return;
  drawState.uniqueDraw = !drawState.uniqueDraw;
  if (drawState.uniqueDraw) {
    drawEls.uniqueToggle.classList.replace('bg-slate-700', 'bg-indigo-500');
    drawEls.uniqueToggleKnob.classList.replace('translate-x-1', 'translate-x-6');
  } else {
    drawEls.uniqueToggle.classList.replace('bg-indigo-500', 'bg-slate-700');
    drawEls.uniqueToggleKnob.classList.replace('translate-x-6', 'translate-x-1');
  }
  updateAvailableList(); renderHistory();
});

drawEls.historyList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-val]');
  if (!btn || drawState.isDrawing) return;
  drawState.drawnNumbers = drawState.drawnNumbers.filter(n => n !== btn.getAttribute('data-val'));
  updateAvailableList(); renderHistory(); validateInputs();
});

drawEls.drawBtn.addEventListener('click', () => { if (!drawEls.drawBtn.disabled) startDraw(); });
drawEls.resetBtn.addEventListener('click', () => { if (!drawEls.resetBtn.disabled) fullReset(); });

// 初始化
updateAvailableList();
