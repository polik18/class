    // 模組 1: 抽籤機 (DRAW MODE)
    // ----------------------------------------------------------------------
    let drawState = {
      mode: 'number',
      startNum: 1, endNum: 50, drawCount: 1,
      excludeText: "", nameText: "",
      isDrawing: false, uniqueDraw: true,
      drawnNumbers: [], availableList: [],
      currentGroups: [] // 儲存當前分組與組長狀態
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
      groupSize: document.getElementById('group-size'),
      groupRule: document.getElementById('group-rule'),
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
      groupBtn: document.getElementById('group-btn'),
      groupBtnContent: document.getElementById('group-btn-content'),
      groupBtnFx: document.getElementById('group-btn-fx'),
      resetBtn: document.getElementById('reset-btn'),
      standbyView: document.getElementById('standby-view'),
      rollingView: document.getElementById('rolling-view'),
      resultView: document.getElementById('result-view'),
      resultTitleContainer: document.getElementById('result-title-container'),
      resultTitleText: document.getElementById('result-title-text'),
      winnersContainer: document.getElementById('winners-container'),
      canvas: document.getElementById('confetti-canvas')
    };

    // 音效 (抽籤用)
    const playTick = () => {
      if (appState.isMuted) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    };

    const playWin = () => {
      if (appState.isMuted) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const notes = [261.63, 329.63, 392.00, 523.25]; 
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const startTime = audioCtx.currentTime + i * 0.1;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 1.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + 1.5);
      });
    };

    // 彩帶特效
    let confettiAnimationId = null;
    let confettiParticles = [];
    const ctx = drawEls.canvas.getContext('2d');

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
      ctx.clearRect(0, 0, drawEls.canvas.width, drawEls.canvas.height);
      let activeParticles = false;
      confettiParticles.forEach((p) => {
        if (p.opacity <= 0) return;
        activeParticles = true;
        p.x += p.vx; p.y += p.vy; p.vy += 0.8; p.vx *= 0.98;
        p.rotation += p.rotationSpeed; p.opacity -= 0.005;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = Math.max(0, p.opacity); ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
      });
      if (activeParticles) confettiAnimationId = requestAnimationFrame(animateConfetti);
      else { confettiParticles = []; ctx.clearRect(0, 0, drawEls.canvas.width, drawEls.canvas.height); }
    };

    // 抽籤邏輯
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

      const typeStr = drawState.mode === 'number' ? '個號碼' : '人';
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
      let hasGlobalError = false;
      let hasDrawCountError = false;
      let hasGenderError = false;
      let errMsg = "";

      if (drawState.mode === 'number' && drawState.startNum > drawState.endNum) {
        errMsg = "起始編號不能大於結束編號！"; hasGlobalError = true;
      } else if (drawState.availableList.length === 0 && !drawState.isDrawing) {
        errMsg = drawState.mode === 'number' ? "沒有可抽的號碼了！" : "名單為空或已抽完！"; hasGlobalError = true;
      } 
      
      if (!hasGlobalError) {
          if (drawState.drawCount < 1 || drawState.drawCount > drawState.availableList.length) {
              errMsg = `單次抽出數量必須介於 1 到 ${drawState.availableList.length} 之間！`; hasDrawCountError = true;
          }
          
          const groupRule = drawEls.groupRule ? drawEls.groupRule.value : 'random';
          if (drawState.availableList.length >= 2 && (groupRule === 'mixed' || groupRule === 'separated')) {
              const hasGenderData = drawState.availableList.some(name => name.includes('(男)') || name.includes('(女)'));
              if (!hasGenderData) {
                  hasGenderError = true;
                  // 若單抽規則無誤，優先顯示分組的性別錯誤
                  if (!hasDrawCountError) {
                      errMsg = "名單內沒有性別標記，無法依男女分組！請更改【進階規則】或在字尾輸入 (男) 或 (女)。";
                  }
              }
          }
      }
      showError(errMsg);

      // 單抽按鈕狀態
      if (hasGlobalError || hasDrawCountError || drawState.isDrawing) {
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

      // 分組按鈕狀態 (分組只需要總人數 >= 2 且性別資料有效)
      if (hasGlobalError || drawState.isDrawing || drawState.availableList.length < 2 || hasGenderError) {
        drawEls.groupBtn.classList.replace('bg-emerald-600', 'bg-slate-800');
        drawEls.groupBtn.classList.remove('hover:bg-emerald-500', 'text-white', 'shadow-lg');
        drawEls.groupBtn.classList.add('text-slate-500', 'cursor-not-allowed');
        drawEls.groupBtn.disabled = true; drawEls.groupBtnFx.classList.add('hidden');
      } else {
        drawEls.groupBtn.classList.replace('bg-slate-800', 'bg-emerald-600');
        drawEls.groupBtn.classList.add('hover:bg-emerald-500', 'text-white', 'shadow-lg');
        drawEls.groupBtn.classList.remove('text-slate-500', 'cursor-not-allowed');
        drawEls.groupBtn.disabled = false; drawEls.groupBtnFx.classList.remove('hidden');
      }

      drawEls.resetBtn.disabled = drawState.isDrawing || (drawState.drawnNumbers.length === 0 && drawEls.resultView.classList.contains('hidden'));
    };

    const renderHistory = () => {
      if (drawState.uniqueDraw && drawState.drawnNumbers.length > 0) {
        drawEls.historyContainer.classList.remove('hidden');
        drawEls.historyCount.textContent = `已抽出結果 (${drawState.drawnNumbers.length})`;
        
        drawEls.historyList.innerHTML = drawState.drawnNumbers.map(num => {
          const safeNum = escapeHTML(num);
          return `<button data-val="${safeNum}" title="點擊將 [${safeNum}] 加回籤筒" class="group relative px-3 py-1 min-w-[3rem] bg-slate-800 hover:bg-indigo-600 transition-all cursor-pointer text-slate-300 rounded-lg text-sm border border-slate-700 hover:border-indigo-400 font-medium shadow-sm overflow-hidden flex justify-center items-center">
            <span class="group-hover:opacity-0 transition-opacity">${renderName(safeNum, false)}</span>
            <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-600">
              <i data-lucide="rotate-ccw" class="w-4 h-4 text-white pointer-events-none"></i>
            </div>
          </button>`
        }).join('');
        lucide.createIcons({ root: drawEls.historyList });
      } else drawEls.historyContainer.classList.add('hidden');
    };

    const fullReset = () => {
      drawState.drawnNumbers = [];
      drawState.currentGroups = []; // 清空分組資料
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
      drawEls.drawBtnContent.innerHTML = `<div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-[spin_1s_linear_infinite] pointer-events-none"></div> 抽籤中...`;
      validateInputs(); 

      let elapsed = 0;
      drawInterval = setInterval(() => {
        const preview = shuffle(drawState.availableList).slice(0, drawState.drawCount);
        
        drawEls.rollingView.innerHTML = preview.map(name => `
          <div class="px-8 py-6 bg-gradient-to-br from-indigo-600 to-purple-700 border border-white/20 rounded-2xl text-4xl md:text-5xl font-black text-white shadow-[0_0_40px_rgba(99,102,241,0.6)] backdrop-blur-md" 
               style="transform: scale(${0.95 + Math.random() * 0.1}) translateY(${(Math.random() - 0.5) * 10}px); filter: blur(${Math.random() * 1.5}px);">
            ${renderName(name, true)}
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

      // 恢復單抽的版面與標題
      drawEls.winnersContainer.className = "flex flex-wrap justify-center gap-6 w-full max-w-4xl";
      if (drawEls.resultTitleText) drawEls.resultTitleText.textContent = '🎉 恭喜以下得獎者 🎉';
      
      // 移除全班抽組長按鈕 (如果有的話)
      const groupLeaderBtn = document.getElementById('draw-all-leaders-btn');
      if (groupLeaderBtn) groupLeaderBtn.remove();

      drawEls.winnersContainer.innerHTML = finalWinners.map((name, idx) => `
        <div class="animate-pop-in relative group" style="animation-delay: ${idx * 0.1}s">
          <div class="absolute inset-0 bg-gradient-to-r from-amber-300 to-orange-500 rounded-2xl blur-xl opacity-40 group-hover:opacity-100 transition-opacity"></div>
          <div class="relative px-12 py-10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-amber-400/50 rounded-2xl flex flex-col items-center gap-4 hover:scale-110 hover:-translate-y-4 transition-all animate-float shadow-2xl overflow-hidden">
            <i data-lucide="trophy" class="w-12 h-12 text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.8)]"></i>
            <span class="text-4xl md:text-6xl font-black bg-gradient-to-b from-yellow-200 via-amber-400 to-orange-500 bg-clip-text text-transparent drop-shadow-md break-all">${renderName(name, true)}</span>
            <!-- ✨ 六：加分至計分板按鈕 -->
            <button onclick="event.stopPropagation(); addScoreToWinnerPrompt('${escapeHTML(name)}')"
              class="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-white text-sm font-bold border border-emerald-500/40 hover:border-emerald-400 transition-all shadow-md active:scale-95 group-hover:opacity-100 pointer-events-auto">
              <i data-lucide="plus-circle" class="w-4 h-4"></i> 加分至計分板
            </button>
          </div>
        </div>
      `).join('');
      
      drawEls.drawBtnContent.innerHTML = `<i data-lucide="play" class="w-5 h-5 fill-current pointer-events-none"></i> 單次抽籤`;
      lucide.createIcons(); playWin(); triggerConfetti();
      updateAvailableList(); renderHistory(); validateInputs();
    };

    // 分組邏輯
    const startGroupDraw = () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      drawState.isDrawing = true; updateAvailableList();
      
      drawEls.standbyView.classList.add('hidden');
      drawEls.resultView.classList.add('hidden');
      drawEls.rollingView.classList.remove('hidden');
      drawEls.groupBtnContent.innerHTML = `<div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-[spin_1s_linear_infinite] pointer-events-none"></div> 分組中...`;
      validateInputs(); 

      // 分組過場動畫 (時間較短)
      let elapsed = 0;
      drawInterval = setInterval(() => {
        const preview = shuffle(drawState.availableList).slice(0, 4);
        drawEls.rollingView.innerHTML = preview.map(name => `
          <div class="px-6 py-4 bg-gradient-to-br from-emerald-600 to-teal-700 border border-white/20 rounded-2xl text-2xl md:text-3xl font-black text-white shadow-[0_0_30px_rgba(16,185,129,0.5)] backdrop-blur-md" 
               style="transform: scale(${0.95 + Math.random() * 0.1}) translateY(${(Math.random() - 0.5) * 10}px); filter: blur(${Math.random() * 1.5}px);">
            ${renderName(name, false)}
          </div>
        `).join('');
        playTick(); elapsed += 80;
        if (elapsed >= 1500) { clearInterval(drawInterval); finishGroupDraw(); }
      }, 80);
    };

    const finishGroupDraw = () => {
      const gSize = parseInt(drawEls.groupSize.value) || 4;
      const rule = drawEls.groupRule ? drawEls.groupRule.value : 'random';
      let shuffled = shuffle(drawState.availableList);
      
      let groups = [];

      // 執行分組演算法
      if (rule === 'random') {
          for (let i = 0; i < shuffled.length; i += gSize) {
              groups.push(shuffled.slice(i, i + gSize));
          }
      } else {
          // 男女混合 or 男女分開
          let males = [];
          let females = [];
          let unknowns = [];

          shuffled.forEach(name => {
              if (name.endsWith('(男)')) males.push(name);
              else if (name.endsWith('(女)')) females.push(name);
              else unknowns.push(name);
          });

          if (rule === 'separated') {
              // 男女分開：男生滿人一組，女生滿人一組
              let allSeparated = [];
              [males, females, unknowns].forEach(list => {
                  for (let i = 0; i < list.length; i += gSize) {
                      allSeparated.push(list.slice(i, i + gSize));
                  }
              });
              groups = allSeparated;
          } else if (rule === 'mixed') {
              // 男女混合：計算總組數，像發牌一樣平均分配
              const numGroups = Math.ceil(shuffled.length / gSize);
              groups = Array.from({length: numGroups}, () => []);
              
              let groupIdx = 0;
              // 為了均衡，先排女生，再排男生，最後排未知
              [females, males, unknowns].forEach(list => {
                  list.forEach(member => {
                      let attempts = 0;
                      while(groups[groupIdx].length >= gSize && attempts < numGroups) {
                          groupIdx = (groupIdx + 1) % numGroups;
                          attempts++;
                      }
                      groups[groupIdx].push(member);
                      groupIdx = (groupIdx + 1) % numGroups;
                  });
              });
              // 過濾掉可能的空組
              groups = groups.filter(g => g.length > 0);
          }
      }

      if (drawState.uniqueDraw) drawState.drawnNumbers = [...drawState.drawnNumbers, ...shuffled];

      drawState.isDrawing = false;
      drawEls.rollingView.classList.add('hidden');
      drawEls.resultView.classList.remove('hidden');

      // 初始化分組狀態
      drawState.currentGroups = groups.map(g => ({
          members: g,
          leader: null,
          pastLeaders: []
      }));

      // 切換為分組用的格線版面
      drawEls.winnersContainer.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-6xl";
      if (drawEls.resultTitleText) drawEls.resultTitleText.textContent = `🎉 全班隨機分組結果 (共 ${groups.length} 組) 🎉`;

      // 確保「一鍵全班抽組長」按鈕存在
      let groupLeaderBtn = document.getElementById('draw-all-leaders-btn');
      if (!groupLeaderBtn) {
          groupLeaderBtn = document.createElement('button');
          groupLeaderBtn.id = 'draw-all-leaders-btn';
          groupLeaderBtn.className = "px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-full text-sm font-bold shadow-md transition-all shadow-amber-500/30 flex items-center gap-1.5 shrink-0 active:scale-95";
          groupLeaderBtn.innerHTML = `<i data-lucide="crown" class="w-4 h-4 pointer-events-none"></i> 一鍵抽各組組長`;
          groupLeaderBtn.onclick = drawAllLeaders;
          drawEls.resultTitleContainer.appendChild(groupLeaderBtn);
      }

      renderGroups();
      
      drawEls.groupBtnContent.innerHTML = `<i data-lucide="layout-grid" class="w-5 h-5 fill-current pointer-events-none"></i> 隨機分組`;
      lucide.createIcons(); playWin(); triggerConfetti();
      updateAvailableList(); renderHistory(); validateInputs();

      // 自動同步到計分板
      scoreState.teams = drawState.currentGroups.map((g, idx) => ({
          id: idx + 1,
          name: `第 ${idx + 1} 組`,
          score: 0,
          members: g.members.map(m => ({ name: m, score: 0 }))
      }));
      renderScoreboard();
      
      // 顯示連動提示
      showToast('<i data-lucide="check-circle" class="w-5 h-5 text-emerald-400"></i> 分組完成！名單已自動同步至【計分板】', 'emerald');
    };

    // 渲染分組畫面 (包含組長 UI)
    const renderGroups = () => {
      drawEls.winnersContainer.innerHTML = drawState.currentGroups.map((g, idx) => `
        <div class="animate-pop-in relative group" style="animation-delay: ${idx * 0.05}s">
          <div class="absolute inset-0 bg-gradient-to-br from-emerald-400/20 to-teal-500/10 rounded-2xl blur opacity-50 group-hover:opacity-100 transition-opacity"></div>
          <div class="relative p-5 bg-slate-900 border border-emerald-500/30 rounded-2xl flex flex-col gap-3 shadow-xl hover:-translate-y-1 transition-transform h-full">
            <div class="flex items-center gap-2 border-b border-white/10 pb-2">
               <i data-lucide="users" class="w-5 h-5 text-emerald-400"></i>
               <h4 class="text-emerald-300 font-bold text-lg tracking-wide">第 ${idx + 1} 組</h4>
               <span class="ml-auto text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-white/5 mr-2">${g.members.length} 人</span>
               <button onclick="drawGroupLeader(${idx})" class="text-xs bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors shrink-0 shadow-sm" title="不重複抽組長">
                  <i data-lucide="crown" class="w-3 h-3 pointer-events-none"></i> ${g.leader ? '換組長' : '抽組長'}
               </button>
            </div>
            <div class="flex flex-wrap gap-2">
              ${g.members.map(name => {
                  const isLeader = name === g.leader;
                  const bgClass = isLeader ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-[0_0_10px_rgba(245,158,11,0.4)] border-amber-400 scale-105 z-10' : 'bg-slate-800 text-slate-200 border border-white/5';
                  // 組長皇冠圖示 (保留性別圖示)
                  const leaderIcon = isLeader ? '<i data-lucide="crown" class="w-3.5 h-3.5 mr-1 inline pointer-events-none"></i>' : '';
                  return `<span class="${bgClass} px-3 py-1.5 rounded-lg text-sm font-medium shadow-sm transition-all flex items-center relative">${leaderIcon}${renderName(name, false)}</span>`;
              }).join('')}
            </div>
          </div>
        </div>
      `).join('');
      lucide.createIcons({ root: drawEls.winnersContainer });
    };

    // 抽單一組別的組長 (不重複機制)
    window.drawGroupLeader = (index) => {
        const group = drawState.currentGroups[index];
        if (!group || group.members.length === 0) return;

        if (audioCtx.state === 'suspended') audioCtx.resume();
        playTick();

        // 找出還沒當過組長的成員
        let eligible = group.members.filter(m => !group.pastLeaders.includes(m));
        
        // 如果大家都當過了，就重置名單（保留當前組長，避免連抽同一個人）
        if (eligible.length === 0) {
            group.pastLeaders = group.leader ? [group.leader] : [];
            eligible = group.members.filter(m => !group.pastLeaders.includes(m));
            // 防呆：如果這組只有 1 個人，還是只能抽他
            if (eligible.length === 0) eligible = group.members;
        }

        // 隨機抽出一名新組長
        const newLeader = eligible[Math.floor(Math.random() * eligible.length)];
        group.leader = newLeader;
        group.pastLeaders.push(newLeader);

        renderGroups();
    };

    // 一鍵抽全班各組組長
    window.drawAllLeaders = () => {
        drawState.currentGroups.forEach((_, idx) => {
            window.drawGroupLeader(idx);
        });
        triggerConfetti();
    };

    // 綁定事件
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
    drawEls.startNum.addEventListener('input', () => { drawState.startNum = parseInt(drawEls.startNum.value)||0; updateAvailableList(); });
    drawEls.endNum.addEventListener('input', () => { drawState.endNum = parseInt(drawEls.endNum.value)||0; updateAvailableList(); });
    drawEls.drawCount.addEventListener('input', () => { drawState.drawCount = parseInt(drawEls.drawCount.value)||1; validateInputs(); });
    drawEls.groupSize.addEventListener('input', validateInputs); // 只驗證不重置
    if(drawEls.groupRule) drawEls.groupRule.addEventListener('change', validateInputs); // 變更規則不重置
    drawEls.excludeInput.addEventListener('input', (e) => { drawState.excludeText = e.target.value; updateAvailableList(); });
    drawEls.nameInput.addEventListener('input', (e) => { drawState.nameText = e.target.value; updateAvailableList(); });
    
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
    drawEls.groupBtn.addEventListener('click', () => { if (!drawEls.groupBtn.disabled) startGroupDraw(); });
    drawEls.resetBtn.addEventListener('click', () => { if (!drawEls.resetBtn.disabled) fullReset(); });
    updateAvailableList();


