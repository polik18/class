// 模組：課堂計分板 (Score Mode) 與 噪音偵測
const scoreState = {
  teams: [
    { id: 1, name: "第一組", score: 0 },
    { id: 2, name: "第二組", score: 0 },
    { id: 3, name: "第三組", score: 0 },
    { id: 4, name: "第四組", score: 0 }
  ],
  maxTeams: 12
};

const noiseState = {
  isPanelOpen: false,
  isMicActive: false,
  stream: null,
  source: null,
  analyser: null,
  dataArray: null,
  animationId: null,
  threshold: 80,

  autoDeduct: false,
  deductPoints: 1,
  cooldown: false,
  cooldownTimer: null,

  autoReward: false,
  rewardTime: 30,
  rewardPoints: 1,
  quietTimeElapsed: 0,
  lastTickTime: null,

  msgTimer: null
};

const scoreEls = {
  grid: document.getElementById('score-grid'),
  addBtn: document.getElementById('score-add-btn'),
  removeBtn: document.getElementById('score-remove-btn'),
  resetBtn: document.getElementById('score-reset-btn')
};

const noiseEls = {
  toggleBtn: document.getElementById('noise-toggle-btn'),
  toggleIcon: document.getElementById('noise-toggle-icon'),
  panelContent: document.getElementById('noise-panel-content'),
  micBtn: document.getElementById('noise-mic-btn'),
  micIcon: document.getElementById('noise-mic-icon'),
  micText: document.getElementById('noise-mic-text'),
  currentVal: document.getElementById('noise-current-val'),
  bar: document.getElementById('noise-bar'),
  thresholdMarker: document.getElementById('noise-threshold-marker'),
  thresholdVal: document.getElementById('noise-threshold-val'),
  thresholdSlider: document.getElementById('noise-threshold-slider'),

  autoDeductToggle: document.getElementById('noise-auto-deduct-toggle'),
  autoDeductKnob: document.getElementById('noise-auto-deduct-knob'),
  deductPtsInput: document.getElementById('noise-deduct-pts'),

  autoRewardToggle: document.getElementById('noise-auto-reward-toggle'),
  autoRewardKnob: document.getElementById('noise-auto-reward-knob'),
  rewardTimeInput: document.getElementById('noise-reward-time'),
  rewardPtsInput: document.getElementById('noise-reward-pts'),

  progressContainer: document.getElementById('quiet-progress-container'),
  progressText: document.getElementById('quiet-progress-text'),
  progressBar: document.getElementById('quiet-progress-bar'),

  messageArea: document.getElementById('noise-message-area')
};

const renderScoreboard = () => {
  scoreEls.grid.innerHTML = scoreState.teams.map((team, index) => {
    const colors = [
      'from-indigo-500/20 to-purple-500/20 border-indigo-500/30 text-indigo-300',
      'from-emerald-500/20 to-teal-500/20 border-emerald-500/30 text-emerald-300',
      'from-amber-500/20 to-orange-500/20 border-amber-500/30 text-amber-300',
      'from-rose-500/20 to-pink-500/20 border-rose-500/30 text-rose-300',
      'from-cyan-500/20 to-blue-500/20 border-cyan-500/30 text-cyan-300',
      'from-fuchsia-500/20 to-purple-500/20 border-fuchsia-500/30 text-fuchsia-300'
    ];
    const colorClass = colors[index % colors.length];

    return `
      <div class="bg-gradient-to-br ${colorClass} border rounded-3xl p-5 flex flex-col items-center gap-4 relative group shadow-lg backdrop-blur-sm transition-transform hover:-translate-y-1">
        <input type="text" data-id="${team.id}" value="${team.name}" class="team-name-input w-full bg-transparent border-b border-transparent focus:border-white/30 text-center text-xl font-bold text-white focus:outline-none transition-colors px-2 py-1 placeholder-white/30" placeholder="輸入隊名">
        <div class="text-6xl md:text-7xl font-black font-mono tracking-tighter drop-shadow-md relative py-2 w-full text-center score-display transition-transform duration-200" data-id="${team.id}">
          ${team.score}
        </div>
        <div class="flex items-center justify-center gap-2 w-full mt-auto pt-2">
          <button data-action="sub" data-id="${team.id}" class="w-12 h-12 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all active:scale-95">
            <i data-lucide="minus" class="w-6 h-6"></i>
          </button>
          <button data-action="add" data-id="${team.id}" class="flex-1 h-12 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white font-bold text-xl transition-all active:scale-95 shadow-inner">
            + 1
          </button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
  scoreEls.addBtn.disabled = scoreState.teams.length >= scoreState.maxTeams;
  scoreEls.removeBtn.disabled = scoreState.teams.length <= 1;
  scoreEls.addBtn.style.opacity = scoreEls.addBtn.disabled ? '0.5' : '1';
  scoreEls.removeBtn.style.opacity = scoreEls.removeBtn.disabled ? '0.5' : '1';
};

const animateScoreUpdate = (type) => {
  const colorClass = type === 'add' ? 'text-emerald-400' : 'text-rose-400';
  scoreState.teams.forEach(team => {
    const scoreDisplay = document.querySelector(`.score-display[data-id="${team.id}"]`);
    if (scoreDisplay) {
      scoreDisplay.classList.add('scale-125', colorClass);
      setTimeout(() => {
        scoreDisplay.classList.remove('scale-125', colorClass);
      }, 300);
    }
  });
};

scoreEls.grid.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.getAttribute('data-action');
  const id = parseInt(btn.getAttribute('data-id'));
  const team = scoreState.teams.find(t => t.id === id);

  if (team) {
    if (action === 'add') {
      team.score += 1;
      playScoreSound('add');
    } else if (action === 'sub') {
      team.score -= 1;
      playScoreSound('sub');
    }

    const scoreDisplay = document.querySelector(`.score-display[data-id="${id}"]`);
    if (scoreDisplay) {
      scoreDisplay.textContent = team.score;
      scoreDisplay.classList.add('scale-125', 'text-white');
      setTimeout(() => {
        scoreDisplay.classList.remove('scale-125', 'text-white');
      }, 200);
    }
  }
});

scoreEls.grid.addEventListener('change', (e) => {
  if (e.target.classList.contains('team-name-input')) {
    const id = parseInt(e.target.getAttribute('data-id'));
    const team = scoreState.teams.find(t => t.id === id);
    if (team) {
      team.name = e.target.value.trim() || `第 ${id} 組`;
      e.target.value = team.name;
    }
  }
});

scoreEls.addBtn.addEventListener('click', () => {
  if (scoreState.teams.length < scoreState.maxTeams) {
    const nextId = (scoreState.teams[scoreState.teams.length - 1]?.id || 0) + 1;
    scoreState.teams.push({ id: nextId, name: `第 ${scoreState.teams.length + 1} 組`, score: 0 });
    renderScoreboard();
  }
});

scoreEls.removeBtn.addEventListener('click', () => {
  if (scoreState.teams.length > 1) {
    scoreState.teams.pop();
    renderScoreboard();
  }
});

scoreEls.resetBtn.addEventListener('click', () => {
  if (scoreEls.resetBtn.dataset.confirm === 'true') {
    scoreState.teams.forEach(t => t.score = 0);
    renderScoreboard();
    scoreEls.resetBtn.dataset.confirm = 'false';
    scoreEls.resetBtn.innerHTML = `<i data-lucide="rotate-ccw" class="w-4 h-4"></i> 分數歸零`;
    lucide.createIcons();
  } else {
    scoreEls.resetBtn.dataset.confirm = 'true';
    scoreEls.resetBtn.innerHTML = `<i data-lucide="alert-triangle" class="w-4 h-4"></i> 再次點擊確認`;
    lucide.createIcons();
    setTimeout(() => {
      if (scoreEls.resetBtn.dataset.confirm === 'true') {
        scoreEls.resetBtn.dataset.confirm = 'false';
        scoreEls.resetBtn.innerHTML = `<i data-lucide="rotate-ccw" class="w-4 h-4"></i> 分數歸零`;
        lucide.createIcons();
      }
    }, 3000);
  }
});

// ====== 噪音偵測系統邏輯 ======

noiseEls.toggleBtn.addEventListener('click', () => {
  noiseState.isPanelOpen = !noiseState.isPanelOpen;
  if (noiseState.isPanelOpen) {
    noiseEls.panelContent.classList.remove('hidden');
    noiseEls.toggleIcon.classList.add('rotate-180');
  } else {
    noiseEls.panelContent.classList.add('hidden');
    noiseEls.toggleIcon.classList.remove('rotate-180');
  }
});

const showNoiseMessage = (msg, colorClass, iconName = 'bell') => {
  noiseEls.messageArea.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4"></i> ${msg}`;
  noiseEls.messageArea.className = `flex items-center justify-center gap-2 font-bold text-sm h-6 transition-opacity duration-300 opacity-100 text-${colorClass}-400`;
  lucide.createIcons({ root: noiseEls.messageArea });

  if (noiseState.msgTimer) clearTimeout(noiseState.msgTimer);
  noiseState.msgTimer = setTimeout(() => {
    noiseEls.messageArea.classList.replace('opacity-100', 'opacity-0');
  }, 4000);
};

const updateQuietProgressUI = () => {
  if (!noiseState.autoReward || !noiseState.isMicActive) return;

  const targetMs = noiseState.rewardTime * 1000;
  const progressPercent = Math.min(100, (noiseState.quietTimeElapsed / targetMs) * 100);
  const currentSeconds = Math.floor(noiseState.quietTimeElapsed / 1000);

  noiseEls.progressBar.style.width = `${progressPercent}%`;
  noiseEls.progressText.textContent = `${currentSeconds} / ${noiseState.rewardTime} 秒`;
};

const updateNoiseLevel = () => {
  if (!noiseState.isMicActive || !noiseState.analyser) return;

  const now = Date.now();
  const dt = noiseState.lastTickTime ? (now - noiseState.lastTickTime) : 0;
  noiseState.lastTickTime = now;

  noiseState.analyser.getByteFrequencyData(noiseState.dataArray);
  let sum = 0;
  for (let i = 0; i < noiseState.dataArray.length; i++) {
    sum += noiseState.dataArray[i];
  }
  let average = sum / noiseState.dataArray.length;
  let volumePercent = Math.min(100, Math.round((average / 150) * 100));

  noiseEls.currentVal.textContent = `${volumePercent}%`;
  noiseEls.bar.style.width = `${volumePercent}%`;

  if (volumePercent >= noiseState.threshold) {
    noiseEls.currentVal.classList.replace('text-rose-400', 'text-red-500');
    noiseEls.bar.classList.add('from-red-500', 'via-red-600', 'to-red-500');

    if (noiseState.autoReward && noiseState.quietTimeElapsed > 0) {
      noiseState.quietTimeElapsed = 0;
      updateQuietProgressUI();
    }

    if (noiseState.autoDeduct && !noiseState.cooldown) {
      triggerAutoDeduct();
    }
  } else {
    noiseEls.currentVal.classList.replace('text-red-500', 'text-rose-400');
    noiseEls.bar.classList.remove('from-red-500', 'via-red-600', 'to-red-500');

    if (noiseState.autoReward) {
      noiseState.quietTimeElapsed += dt;
      updateQuietProgressUI();

      if (noiseState.quietTimeElapsed >= (noiseState.rewardTime * 1000)) {
        triggerAutoReward();
      }
    }
  }

  noiseState.animationId = requestAnimationFrame(updateNoiseLevel);
};

const triggerAutoDeduct = () => {
  noiseState.cooldown = true;
  playScoreSound('warning');

  scoreState.teams.forEach(t => t.score -= noiseState.deductPoints);
  renderScoreboard();
  animateScoreUpdate('sub');

  showNoiseMessage(`音量過大！全班已扣 ${noiseState.deductPoints} 分！(冷卻中...)`, 'rose', 'alert-octagon');

  noiseState.cooldownTimer = setTimeout(() => {
    noiseState.cooldown = false;
  }, 5000);
};

const triggerAutoReward = () => {
  playScoreSound('add');

  scoreState.teams.forEach(t => t.score += noiseState.rewardPoints);
  renderScoreboard();
  animateScoreUpdate('add');

  noiseState.quietTimeElapsed = 0;
  updateQuietProgressUI();

  showNoiseMessage(`達成安靜挑戰！全班已加 ${noiseState.rewardPoints} 分！`, 'emerald', 'party-popper');
};

noiseEls.micBtn.addEventListener('click', async () => {
  if (audioCtx.state === 'suspended') audioCtx.resume();

  if (noiseState.isMicActive) {
    noiseState.isMicActive = false;
    noiseState.lastTickTime = null;
    if (noiseState.stream) {
      noiseState.stream.getTracks().forEach(track => track.stop());
    }
    if (noiseState.animationId) cancelAnimationFrame(noiseState.animationId);

    noiseEls.micBtn.classList.replace('bg-rose-600', 'bg-slate-800');
    noiseEls.micBtn.classList.replace('hover:bg-rose-500', 'hover:bg-slate-700');
    noiseEls.micIcon.setAttribute('data-lucide', 'mic-off');
    noiseEls.micText.textContent = "開啟麥克風";
    noiseEls.bar.style.width = "0%";
    noiseEls.currentVal.textContent = "0%";

    noiseState.quietTimeElapsed = 0;
    updateQuietProgressUI();

    lucide.createIcons();
  } else {
    try {
      noiseState.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      noiseState.source = audioCtx.createMediaStreamSource(noiseState.stream);
      noiseState.analyser = audioCtx.createAnalyser();
      noiseState.analyser.fftSize = 256;
      noiseState.source.connect(noiseState.analyser);

      noiseState.dataArray = new Uint8Array(noiseState.analyser.frequencyBinCount);
      noiseState.isMicActive = true;
      noiseState.lastTickTime = Date.now();
      noiseState.quietTimeElapsed = 0;

      noiseEls.micBtn.classList.replace('bg-slate-800', 'bg-rose-600');
      noiseEls.micBtn.classList.replace('hover:bg-slate-700', 'hover:bg-rose-500');
      noiseEls.micIcon.setAttribute('data-lucide', 'mic');
      noiseEls.micText.textContent = "關閉麥克風";
      lucide.createIcons();

      updateNoiseLevel();
    } catch (err) {
      alert("無法存取麥克風，請確認瀏覽器權限設定。");
    }
  }
});

noiseEls.thresholdSlider.addEventListener('input', (e) => {
  noiseState.threshold = parseInt(e.target.value);
  noiseEls.thresholdVal.textContent = `${noiseState.threshold}%`;
  noiseEls.thresholdMarker.style.left = `${noiseState.threshold}%`;
});

noiseEls.deductPtsInput.addEventListener('input', (e) => {
  let val = parseInt(e.target.value) || 1;
  if (val < 1) val = 1;
  noiseState.deductPoints = val;
});

noiseEls.autoDeductToggle.addEventListener('click', () => {
  noiseState.autoDeduct = !noiseState.autoDeduct;
  if (noiseState.autoDeduct) {
    noiseEls.autoDeductToggle.classList.replace('bg-slate-700', 'bg-rose-500');
    noiseEls.autoDeductKnob.classList.replace('translate-x-1', 'translate-x-6');
  } else {
    noiseEls.autoDeductToggle.classList.replace('bg-rose-500', 'bg-slate-700');
    noiseEls.autoDeductKnob.classList.replace('translate-x-6', 'translate-x-1');
  }
});

noiseEls.rewardTimeInput.addEventListener('input', (e) => {
  let val = parseInt(e.target.value) || 30;
  if (val < 5) val = 5;
  noiseState.rewardTime = val;
  updateQuietProgressUI();
});

noiseEls.rewardPtsInput.addEventListener('input', (e) => {
  let val = parseInt(e.target.value) || 1;
  if (val < 1) val = 1;
  noiseState.rewardPoints = val;
});

noiseEls.autoRewardToggle.addEventListener('click', () => {
  noiseState.autoReward = !noiseState.autoReward;

  if (noiseState.autoReward) {
    noiseEls.autoRewardToggle.classList.replace('bg-slate-700', 'bg-emerald-500');
    noiseEls.autoRewardKnob.classList.replace('translate-x-1', 'translate-x-6');
    noiseEls.progressContainer.classList.remove('hidden');
    noiseState.quietTimeElapsed = 0;
    noiseState.lastTickTime = Date.now();
  } else {
    noiseEls.autoRewardToggle.classList.replace('bg-emerald-500', 'bg-slate-700');
    noiseEls.autoRewardKnob.classList.replace('translate-x-6', 'translate-x-1');
    noiseEls.progressContainer.classList.add('hidden');
  }
});

// 初始化
renderScoreboard();
