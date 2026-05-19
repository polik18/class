    // ----------------------------------------------------------------------
    // 模組 3: 小組計時器 (TIMER MODE)
    // ----------------------------------------------------------------------
    let timerState = {
      totalSeconds: 300,
      remainingSeconds: 300,
      isRunning: false,
      intervalId: null
    };

    const timerEls = {
      inputM: document.getElementById('timer-input-m'),
      inputS: document.getElementById('timer-input-s'),
      display: document.getElementById('timer-display'),
      progress: document.getElementById('timer-progress'),
      toggleBtn: document.getElementById('timer-toggle-btn'),
      toggleIcon: document.getElementById('timer-toggle-icon'),
      toggleText: document.getElementById('timer-toggle-text'),
      resetBtn: document.getElementById('timer-reset-btn'),
      presetBtns: document.querySelectorAll('.timer-preset-btn'),
      statusText: document.getElementById('timer-status-text')
    };

    // 計算 SVG 圓環周長，將總長度設為 1000 方便百分比計算
    timerEls.progress.setAttribute('pathLength', '1000');
    timerEls.progress.style.strokeDasharray = '1000';

    const playTimerAlarm = () => {
      if (appState.isMuted) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      // 發出急促的滴滴聲 (響3次)
      for(let i=0; i<3; i++){
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime + i*0.3);
        
        gain.gain.setValueAtTime(0, audioCtx.currentTime + i*0.3);
        gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + i*0.3 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i*0.3 + 0.2);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + i*0.3);
        osc.stop(audioCtx.currentTime + i*0.3 + 0.2);
      }
    };

    const updateTimerDisplay = () => {
      const m = String(Math.floor(timerState.remainingSeconds / 60)).padStart(2, '0');
      const s = String(timerState.remainingSeconds % 60).padStart(2, '0');
      timerEls.display.textContent = `${m}:${s}`;

      // 更新圓環進度 (1000 -> 0)
      if (timerState.totalSeconds > 0) {
        const ratio = timerState.remainingSeconds / timerState.totalSeconds;
        timerEls.progress.style.strokeDashoffset = 1000 - (1000 * ratio);
        
        // 如果剩下不到 10 秒，改變圓環顏色為警告色 (利用切換 stroke)
        if (timerState.remainingSeconds <= 10 && timerState.remainingSeconds > 0) {
          timerEls.progress.setAttribute('stroke', 'url(#gradient-warn)');
          timerEls.display.classList.add('text-red-400', 'animate-pulse');
          timerEls.display.classList.remove('text-white');
        } else {
          timerEls.progress.setAttribute('stroke', 'url(#gradient)');
          timerEls.display.classList.remove('text-red-400', 'animate-pulse');
          timerEls.display.classList.add('text-white');
        }
      }
    };

    const applyInputsToTimer = () => {
      if (timerState.isRunning) return;
      const m = parseInt(timerEls.inputM.value) || 0;
      const s = parseInt(timerEls.inputS.value) || 0;
      const total = (m * 60) + s;
      
      if (total > 0) {
        timerState.totalSeconds = total;
        timerState.remainingSeconds = total;
        timerEls.statusText.classList.remove('opacity-100', 'animate-bounce-soft');
        timerEls.statusText.classList.add('opacity-0');
        updateTimerDisplay();
      }
    };

    timerEls.inputM.addEventListener('change', applyInputsToTimer);
    timerEls.inputS.addEventListener('change', applyInputsToTimer);

    // 快速設定按鈕
    timerEls.presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (timerState.isRunning) stopTimer();
        const sec = parseInt(btn.getAttribute('data-sec'));
        timerEls.inputM.value = Math.floor(sec / 60);
        timerEls.inputS.value = sec % 60;
        applyInputsToTimer();
      });
    });

    const stopTimer = () => {
      timerState.isRunning = false;
      clearInterval(timerState.intervalId);
      
      // 更新按鈕UI
      timerEls.toggleBtn.classList.replace('bg-amber-500', 'bg-indigo-600');
      timerEls.toggleBtn.classList.replace('hover:bg-amber-400', 'hover:bg-indigo-500');
      timerEls.toggleBtn.classList.replace('shadow-[0_0_20px_rgba(245,158,11,0.4)]', 'shadow-[0_0_20px_rgba(99,102,241,0.4)]');
      timerEls.toggleBtn.classList.replace('hover:shadow-[0_0_30px_rgba(245,158,11,0.6)]', 'hover:shadow-[0_0_30px_rgba(99,102,241,0.6)]');
      timerEls.toggleIcon.setAttribute('data-lucide', 'play');
      timerEls.toggleText.textContent = "開始計時";
      
      // 更新導覽列小紅點
      navEls.dotPing.classList.add('hidden');
      navEls.dotStatic.classList.add('hidden');
      
      lucide.createIcons();
    };

    const startTimer = () => {
      if (timerState.remainingSeconds <= 0) applyInputsToTimer();
      if (timerState.remainingSeconds <= 0) return; // 依然是 0 就不啟動

      timerState.isRunning = true;
      timerEls.statusText.classList.remove('opacity-100', 'animate-bounce-soft');
      timerEls.statusText.classList.add('opacity-0');
      
      // 更新按鈕UI (改為暫停狀態)
      timerEls.toggleBtn.classList.replace('bg-indigo-600', 'bg-amber-500');
      timerEls.toggleBtn.classList.replace('hover:bg-indigo-500', 'hover:bg-amber-400');
      timerEls.toggleBtn.classList.replace('shadow-[0_0_20px_rgba(99,102,241,0.4)]', 'shadow-[0_0_20px_rgba(245,158,11,0.4)]');
      timerEls.toggleBtn.classList.replace('hover:shadow-[0_0_30px_rgba(99,102,241,0.6)]', 'hover:shadow-[0_0_30px_rgba(245,158,11,0.6)]');
      timerEls.toggleIcon.setAttribute('data-lucide', 'pause');
      timerEls.toggleText.textContent = "暫停計時";
      
      // 更新導覽列小紅點
      navEls.dotPing.classList.remove('hidden');
      navEls.dotStatic.classList.remove('hidden');

      lucide.createIcons();

      timerState.intervalId = setInterval(() => {
        timerState.remainingSeconds--;
        if (appState.currentMode === 'timer') updateTimerDisplay();

        if (timerState.remainingSeconds <= 0) {
          stopTimer();
          updateTimerDisplay(); // 強制更新一次顯示 00:00
          timerEls.statusText.classList.remove('opacity-0');
          timerEls.statusText.classList.add('opacity-100', 'animate-bounce-soft');
          playTimerAlarm();
        }
      }, 1000);
    };

    timerEls.toggleBtn.addEventListener('click', () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      if (timerState.isRunning) {
        stopTimer();
      } else {
        startTimer();
      }
    });

    timerEls.resetBtn.addEventListener('click', () => {
      stopTimer();
      applyInputsToTimer();
      timerEls.statusText.classList.remove('opacity-100', 'animate-bounce-soft');
      timerEls.statusText.classList.add('opacity-0');
    });

    // 初始載入設定
    applyInputsToTimer();

