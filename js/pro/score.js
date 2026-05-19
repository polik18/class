    // ----------------------------------------------------------------------
    // 模組 4: 課堂計分板 (SCORE MODE) 與 噪音偵測
    // ----------------------------------------------------------------------
    // 升級：scoreState 支援記錄組內成員
    const scoreState = {
      teams: [
        { id: 1, name: "第一組", score: 0, members: [] },
        { id: 2, name: "第二組", score: 0, members: [] },
        { id: 3, name: "第三組", score: 0, members: [] },
        { id: 4, name: "第四組", score: 0, members: [] }
      ],
      maxTeams: 12
    };

    // 擴充噪音偵測狀態
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
      deductPoints: 1, // 自訂扣幾分
      cooldown: false,
      cooldownTimer: null,

      autoReward: false,
      rewardTime: 30, // 自訂安靜幾秒加分
      rewardPoints: 1, // 自訂加幾分
      quietTimeElapsed: 0, // 目前已經安靜了多久(毫秒)
      lastTickTime: null, // 用來精準計算時間差
      
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

    const playScoreSound = (type) => {
      if (appState.isMuted) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      if (type === 'add') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
      } else if (type === 'sub') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.1);
      } else if (type === 'warning') {
        // 噪音警告聲
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.3);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      }

      gain.gain.setValueAtTime(0, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(type==='warning' ? 0.4 : 0.3, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + (type==='warning'?0.4:0.2));
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (type==='warning'?0.4:0.2));
    };

    const renderScoreboard = () => {
      // 加入 XSS 防護 (在 input 的 value 中轉義)
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
        const safeTeamName = escapeHTML(team.name);
        
        return `
          <div class="bg-gradient-to-br ${colorClass} border rounded-3xl p-5 flex flex-col items-center gap-3 relative group shadow-lg backdrop-blur-sm transition-transform hover:-translate-y-1 h-full">
            <input type="text" data-id="${team.id}" value="${safeTeamName}" class="team-name-input w-full bg-transparent border-b border-transparent focus:border-white/30 text-center text-xl font-bold text-white focus:outline-none transition-colors px-2 py-1 placeholder-white/30" placeholder="輸入隊名">
            <div class="text-5xl md:text-6xl font-black font-mono tracking-tighter drop-shadow-md relative py-2 w-full text-center score-display transition-transform duration-200" data-id="${team.id}">
              ${team.score}
            </div>
            
            <!-- 個人分數區塊 -->
            ${team.members && team.members.length > 0 ? `
            <div class="w-full flex flex-col gap-1.5 mt-2 mb-2 max-h-32 overflow-y-auto no-scrollbar border-t border-white/10 pt-3">
              ${team.members.map((m, mIdx) => `
                <div class="flex items-center justify-between bg-slate-950/30 px-2 py-1.5 rounded-lg border border-white/5">
                  <span class="text-sm text-slate-200 truncate pr-2 w-full text-left" title="${escapeHTML(m.name)}">${renderName(m.name, false)}</span>
                  <div class="flex items-center gap-1 shrink-0">
                    <button data-action="sub-member" data-team-id="${team.id}" data-member-idx="${mIdx}" class="text-slate-400 hover:text-rose-400 p-1 active:scale-90"><i data-lucide="minus-circle" class="w-4 h-4 pointer-events-none"></i></button>
                    <span class="font-mono text-sm w-5 text-center font-bold member-score-display" data-team-id="${team.id}" data-member-idx="${mIdx}">${m.score}</span>
                    <button data-action="add-member" data-team-id="${team.id}" data-member-idx="${mIdx}" class="text-slate-400 hover:text-emerald-400 p-1 active:scale-90"><i data-lucide="plus-circle" class="w-4 h-4 pointer-events-none"></i></button>
                  </div>
                </div>
              `).join('')}
            </div>
            ` : `<div class="flex-1"></div>`}

            <div class="flex items-center justify-center gap-2 w-full mt-auto pt-2">
              <button data-action="sub" data-team-id="${team.id}" class="w-12 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all active:scale-95">
                <i data-lucide="minus" class="w-5 h-5 pointer-events-none"></i>
              </button>
              <button data-action="add" data-team-id="${team.id}" class="flex-1 h-10 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white font-bold text-lg transition-all active:scale-95 shadow-inner">
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

    const broadcastScore = () => {
        if (typeof sendToAllStudents === 'function') {
            sendToAllStudents({ type: 'sync_score', teams: scoreState.teams });
        }
    };

    const showFloatingScoreEffect = (targetEl, type, pointsDiff) => {
        const container = targetEl.closest('.bg-gradient-to-br');
        if (!container) return;

        // Create floating text
        const floatEl = document.createElement('div');
        const sign = pointsDiff > 0 ? '+' : '';
        floatEl.textContent = `${sign}${pointsDiff}`;
        floatEl.className = `absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-6xl md:text-7xl font-black drop-shadow-[0_0_15px_rgba(0,0,0,0.5)] z-50 pointer-events-none transition-all duration-700 ease-out opacity-100 ${type === 'add' ? 'text-emerald-400' : 'text-rose-400'}`;
        container.appendChild(floatEl);

        // Flash container border and shadow
        container.classList.add('scale-105', 'z-10');
        if (type === 'add') container.classList.add('border-emerald-400', 'shadow-[0_0_30px_rgba(16,185,129,0.5)]');
        else container.classList.add('border-rose-400', 'shadow-[0_0_30px_rgba(244,63,94,0.5)]');

        // Animate float
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                floatEl.style.transform = 'translate(-50%, -200%) scale(1.5)';
                floatEl.style.opacity = '0';
            });
        });

        // Cleanup
        setTimeout(() => {
            if (floatEl.parentNode === container) container.removeChild(floatEl);
            container.classList.remove('scale-105', 'z-10', 'border-emerald-400', 'border-rose-400', 'shadow-[0_0_30px_rgba(16,185,129,0.5)]', 'shadow-[0_0_30px_rgba(244,63,94,0.5)]');
        }, 700);
    };

    const updateTeamScoreUI = (id, score, type, diff = null) => {
      const scoreDisplay = document.querySelector(`.score-display[data-id="${id}"]`);
      if (scoreDisplay) {
        scoreDisplay.textContent = score;
        const colorClass = type === 'add' ? 'text-emerald-400' : 'text-rose-400';
        scoreDisplay.classList.add('scale-125', colorClass);
        if (diff !== null) showFloatingScoreEffect(scoreDisplay, type, diff);
        setTimeout(() => {
          scoreDisplay.classList.remove('scale-125', colorClass);
        }, 200);
      }
    };

    const updateMemberScoreUI = (teamId, memberIdx, score, type, diff = null) => {
      const scoreDisplay = document.querySelector(`.member-score-display[data-team-id="${teamId}"][data-member-idx="${memberIdx}"]`);
      if (scoreDisplay) {
        scoreDisplay.textContent = score;
        const colorClass = type === 'add' ? 'text-emerald-400' : 'text-rose-400';
        scoreDisplay.classList.add('scale-125', colorClass);
        if (diff !== null) showFloatingScoreEffect(scoreDisplay, type, diff);
        setTimeout(() => {
          scoreDisplay.classList.remove('scale-125', colorClass);
        }, 200);
      }
    };

    // 支援傳入不同顏色來區分加減分的動畫 (用於噪音自動扣分)
    const animateScoreUpdate = (type, pointsDiff = null) => {
      const colorClass = type === 'add' ? 'text-emerald-400' : 'text-rose-400';
      scoreState.teams.forEach(team => {
        const scoreDisplay = document.querySelector(`.score-display[data-id="${team.id}"]`);
        if (scoreDisplay) {
          scoreDisplay.classList.add('scale-125', colorClass);
          if (pointsDiff !== null) showFloatingScoreEffect(scoreDisplay, type, pointsDiff);
          setTimeout(() => {
            scoreDisplay.classList.remove('scale-125', colorClass);
          }, 300);
        }
      });
    };

    // 事件委派：加減分數與更改名稱
    scoreEls.grid.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      
      const action = btn.getAttribute('data-action');
      const id = parseInt(btn.getAttribute('data-team-id'));
      const memberIdx = btn.getAttribute('data-member-idx');
      const team = scoreState.teams.find(t => t.id === id);
      
      if (team) {
        if (action === 'add') {
          team.score += 1;
          playScoreSound('add');
          updateTeamScoreUI(id, team.score, 'add', 1);
        } else if (action === 'sub') {
          team.score -= 1;
          playScoreSound('sub');
          updateTeamScoreUI(id, team.score, 'sub', -1);
        } else if (action === 'add-member' && memberIdx !== null) {
          team.members[memberIdx].score += 1;
          team.score += 1; // 預設個人加分也會幫小組加分
          playScoreSound('add');
          updateMemberScoreUI(id, memberIdx, team.members[memberIdx].score, 'add', 1);
          updateTeamScoreUI(id, team.score, 'add', 1);
        } else if (action === 'sub-member' && memberIdx !== null) {
          team.members[memberIdx].score -= 1;
          team.score -= 1; // 預設個人扣分也會幫小組扣分
          playScoreSound('sub');
          updateMemberScoreUI(id, memberIdx, team.members[memberIdx].score, 'sub', -1);
          updateTeamScoreUI(id, team.score, 'sub', -1);
        }
        broadcastScore();
      }
    });

    scoreEls.grid.addEventListener('change', (e) => {
      if (e.target.classList.contains('team-name-input')) {
        const id = parseInt(e.target.getAttribute('data-id'));
        const team = scoreState.teams.find(t => t.id === id);
        if (team) {
          team.name = e.target.value.trim() || `第 ${id} 組`;
          e.target.value = team.name; // 這裡不轉義是因為我們直接更新 input value，DOM 會處理
          broadcastScore();
        }
      }
    });

    // 控制列按鈕
    scoreEls.addBtn.addEventListener('click', () => {
      if (scoreState.teams.length < scoreState.maxTeams) {
        const nextId = (scoreState.teams[scoreState.teams.length - 1]?.id || 0) + 1;
        scoreState.teams.push({ id: nextId, name: `第 ${scoreState.teams.length + 1} 組`, score: 0, members: [] });
        renderScoreboard();
        broadcastScore();
      }
    });

    scoreEls.removeBtn.addEventListener('click', () => {
      if (scoreState.teams.length > 1) {
        scoreState.teams.pop();
        renderScoreboard();
        broadcastScore();
      }
    });

    scoreEls.resetBtn.addEventListener('click', () => {
      if (scoreEls.resetBtn.dataset.confirm === 'true') {
        scoreState.teams.forEach(t => {
            t.score = 0;
            if(t.members) t.members.forEach(m => m.score = 0);
        });
        renderScoreboard();
        broadcastScore();
        scoreEls.resetBtn.dataset.confirm = 'false';
        scoreEls.resetBtn.innerHTML = `<i data-lucide="rotate-ccw" class="w-4 h-4 pointer-events-none"></i> 分數歸零`;
        lucide.createIcons();
      } else {
        scoreEls.resetBtn.dataset.confirm = 'true';
        scoreEls.resetBtn.innerHTML = `<i data-lucide="alert-triangle" class="w-4 h-4 pointer-events-none"></i> 再次點擊確認`;
        lucide.createIcons();
        setTimeout(() => {
          if (scoreEls.resetBtn.dataset.confirm === 'true') {
            scoreEls.resetBtn.dataset.confirm = 'false';
            scoreEls.resetBtn.innerHTML = `<i data-lucide="rotate-ccw" class="w-4 h-4 pointer-events-none"></i> 分數歸零`;
            lucide.createIcons();
          }
        }, 3000);
      }
    });

    // ====== 噪音偵測系統邏輯 ======

    // 展開/折疊面板
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

    // 顯示噪音系統的提示訊息
    const showNoiseMessage = (msg, colorClass, iconName = 'bell') => {
      noiseEls.messageArea.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4"></i> ${msg}`;
      // 動態替換顏色
      noiseEls.messageArea.className = `flex items-center justify-center gap-2 font-bold text-sm h-6 transition-opacity duration-300 opacity-100 text-${colorClass}-400`;
      lucide.createIcons({ root: noiseEls.messageArea });
      
      if (noiseState.msgTimer) clearTimeout(noiseState.msgTimer);
      noiseState.msgTimer = setTimeout(() => {
        noiseEls.messageArea.classList.replace('opacity-100', 'opacity-0');
      }, 4000);
    };

    // 更新安靜進度條 UI
    const updateQuietProgressUI = () => {
      if (!noiseState.autoReward || !noiseState.isMicActive) return;
      
      const targetMs = noiseState.rewardTime * 1000;
      const progressPercent = Math.min(100, (noiseState.quietTimeElapsed / targetMs) * 100);
      const currentSeconds = Math.floor(noiseState.quietTimeElapsed / 1000);
      
      noiseEls.progressBar.style.width = `${progressPercent}%`;
      noiseEls.progressText.textContent = `${currentSeconds} / ${noiseState.rewardTime} 秒`;
    };

    // 麥克風音量監聽迴圈
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

      // 檢查是否超過門檻
      if (volumePercent >= noiseState.threshold) {
        // UI 變色
        noiseEls.currentVal.classList.replace('text-rose-400', 'text-red-500');
        noiseEls.bar.classList.add('from-red-500', 'via-red-600', 'to-red-500');
        
        // 如果吵鬧，安靜進度歸零
        if (noiseState.autoReward && noiseState.quietTimeElapsed > 0) {
           noiseState.quietTimeElapsed = 0;
           updateQuietProgressUI();
        }

        // 觸發自動扣分 (若開啟且不在冷卻中)
        if (noiseState.autoDeduct && !noiseState.cooldown) {
          triggerAutoDeduct();
        }
      } else {
        // 在門檻以下 (安靜狀態)
        noiseEls.currentVal.classList.replace('text-red-500', 'text-rose-400');
        noiseEls.bar.classList.remove('from-red-500', 'via-red-600', 'to-red-500');

        // 安靜挑戰加分邏輯
        if (noiseState.autoReward) {
           noiseState.quietTimeElapsed += dt;
           updateQuietProgressUI();

           // 達成指定時間
           if (noiseState.quietTimeElapsed >= (noiseState.rewardTime * 1000)) {
               triggerAutoReward();
           }
        }
      }

      noiseState.animationId = requestAnimationFrame(updateNoiseLevel);
    };

    // 觸發自動扣分
    const triggerAutoDeduct = () => {
      noiseState.cooldown = true;
      playScoreSound('warning');
      
      scoreState.teams.forEach(t => t.score -= noiseState.deductPoints);
      renderScoreboard();
      animateScoreUpdate('sub', -noiseState.deductPoints);
      broadcastScore();

      showNoiseMessage(`音量過大！全班已扣 ${noiseState.deductPoints} 分！(冷卻中...)`, 'rose', 'alert-octagon');
      
      noiseState.cooldownTimer = setTimeout(() => {
        noiseState.cooldown = false;
      }, 5000);
    };

    // 觸發自動加分
    const triggerAutoReward = () => {
      playScoreSound('add');
      
      scoreState.teams.forEach(t => t.score += noiseState.rewardPoints);
      renderScoreboard();
      animateScoreUpdate('add', noiseState.rewardPoints);
      broadcastScore();
      
      // 歸零重新開始計算下一輪
      noiseState.quietTimeElapsed = 0;
      updateQuietProgressUI();

      showNoiseMessage(`達成安靜挑戰！全班已加 ${noiseState.rewardPoints} 分！`, 'emerald', 'party-popper');
    };

    // 啟動/關閉麥克風
    noiseEls.micBtn.addEventListener('click', async () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();

      if (noiseState.isMicActive) {
        // 關閉
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
        
        // 重置安靜進度
        noiseState.quietTimeElapsed = 0;
        updateQuietProgressUI();

        lucide.createIcons();
      } else {
        // 開啟
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
          alert("無法存取麥克風，請確認瀏覽器權限設定或是否於 HTTPS 環境下執行。");
        }
      }
    });

    // 設定：門檻調整
    if(noiseEls.thresholdSlider) {
       noiseEls.thresholdSlider.addEventListener('input', (e) => {
         noiseState.threshold = parseInt(e.target.value);
         noiseEls.thresholdVal.textContent = `${noiseState.threshold}%`;
         noiseEls.thresholdMarker.style.left = `${noiseState.threshold}%`;
       });
    }

    // 設定：自訂扣分數
    noiseEls.deductPtsInput.addEventListener('input', (e) => {
      let val = parseInt(e.target.value) || 1;
      if (val < 1) val = 1;
      noiseState.deductPoints = val;
    });

    // 設定：自動扣分開關
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

    // 設定：自訂加分秒數與分數
    noiseEls.rewardTimeInput.addEventListener('input', (e) => {
      let val = parseInt(e.target.value) || 30;
      if (val < 5) val = 5;
      noiseState.rewardTime = val;
      updateQuietProgressUI(); // 即時更新 UI 的總秒數文字
    });

    noiseEls.rewardPtsInput.addEventListener('input', (e) => {
      let val = parseInt(e.target.value) || 1;
      if (val < 1) val = 1;
      noiseState.rewardPoints = val;
    });

    // 設定：自動加分開關
    noiseEls.autoRewardToggle.addEventListener('click', () => {
      noiseState.autoReward = !noiseState.autoReward;
      
      if (noiseState.autoReward) {
        noiseEls.autoRewardToggle.classList.replace('bg-slate-700', 'bg-emerald-500');
        noiseEls.autoRewardKnob.classList.replace('translate-x-1', 'translate-x-6');
        noiseEls.progressContainer.classList.remove('hidden');
        noiseState.quietTimeElapsed = 0; // 開啟時從 0 開始算
        noiseState.lastTickTime = Date.now();
      } else {
        noiseEls.autoRewardToggle.classList.replace('bg-emerald-500', 'bg-slate-700');
        noiseEls.autoRewardKnob.classList.replace('translate-x-6', 'translate-x-1');
        noiseEls.progressContainer.classList.add('hidden');
      }
    });

    // 初始化渲染計分板
    renderScoreboard();

