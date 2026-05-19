    // ----------------------------------------------------------------------
    // 模組 2: 考試大鐘 (CLOCK MODE)
    // ----------------------------------------------------------------------
    const clockEls = {
      date: document.getElementById('clock-date'),
      time: document.getElementById('clock-time'),
      secBar: document.getElementById('clock-seconds-bar')
    };

    const daysStr = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

    const updateClock = () => {
      // 只有在當前模式是大鐘時才執行完整 DOM 更新，節省效能
      if (appState.currentMode !== 'clock') return; 
      
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth() + 1;
      const d = now.getDate();
      const day = daysStr[now.getDay()];
      
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');

      clockEls.date.textContent = `${y}年${m}月${d}日 ${day}`;
      clockEls.time.textContent = `${hh}:${mm}:${ss}`;
      
      // 秒數進度條：0秒時 0%，59秒時近乎 100%
      const secPercentage = (now.getSeconds() / 60) * 100;
      clockEls.secBar.style.width = `${secPercentage}%`;
    };

    // 每秒更新大時鐘
    setInterval(updateClock, 1000);

    // ==========================================
    // 時間管理：子功能切換與邏輯 (Clock Sub Modes)
    // ==========================================
    let currentClockSubMode = 'exam'; // 'exam', 'bell', 'pomo'
    
    window.switchClockSubMode = (mode) => {
        currentClockSubMode = mode;
        const examTab = document.getElementById('clock-tab-exam');
        const bellTab = document.getElementById('clock-tab-bell');
        const pomoTab = document.getElementById('clock-tab-pomo');
        const examSub = document.getElementById('clock-sub-exam');
        const bellSub = document.getElementById('clock-sub-bell');
        const pomoSub = document.getElementById('clock-sub-pomo');

        // Reset Nav
        [examTab, bellTab, pomoTab].forEach(t => {
            if(t) t.className = "flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 font-bold transition-all whitespace-nowrap min-w-[120px]";
        });
        
        // Hide all subs
        [examSub, bellSub, pomoSub].forEach(sub => {
            if(sub) {
                sub.classList.remove('flex', 'opacity-100');
                sub.classList.add('hidden', 'opacity-0');
            }
        });

        // Activate Sub
        if (mode === 'exam') {
            if(examTab) examTab.className = "flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 text-white font-bold transition-all shadow-md whitespace-nowrap min-w-[120px]";
            if(examSub) {
                examSub.classList.remove('hidden', 'opacity-0');
                examSub.classList.add('flex', 'opacity-100');
            }
            updateClock();
        } else if (mode === 'bell') {
            if(bellTab) bellTab.className = "flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 text-white font-bold transition-all shadow-md whitespace-nowrap min-w-[120px]";
            if(bellSub) {
                bellSub.classList.remove('hidden', 'opacity-0');
                bellSub.classList.add('flex', 'opacity-100');
            }
        } else if (mode === 'pomo') {
            if(pomoTab) pomoTab.className = "flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 text-white font-bold transition-all shadow-md whitespace-nowrap min-w-[120px]";
            if(pomoSub) {
                pomoSub.classList.remove('hidden', 'opacity-0');
                pomoSub.classList.add('flex', 'opacity-100');
            }
        }
    };

    // --- 考試資訊面板功能 (Exam Info Panel) ---
    window.formatTimeInput = (elem) => {
        let val = elem.value.replace(/\D/g, ''); // 移除非數字
        let invalid = false;

        // 1. 小時十位數：大於 2 (如 3-9)，自動前方補 0
        if (val.length >= 1 && parseInt(val[0]) > 2) {
            val = '0' + val;
        }
        // 2. 小時個位數：如果十位數是 2，個位數只能 0-3 (24小時制)
        if (val.length >= 2 && val[0] === '2' && parseInt(val[1]) > 3) {
            val = val.substring(0, 1);
            invalid = true;
        }
        // 3. 分鐘十位數：不能大於 5 (每小時60分)
        if (val.length >= 3 && parseInt(val[2]) > 5) {
            val = val.substring(0, 2);
            invalid = true;
        }
        // 限制最多 4 個數字
        if (val.length > 4) {
            val = val.substring(0, 4);
        }

        // 組合成 HH:MM 格式
        elem.value = val.length > 2 ? val.substring(0, 2) + ':' + val.substring(2) : val;

        // 錯誤輸入提示：文字閃爍紅燈
        if (invalid) {
            elem.classList.add('text-rose-400');
            elem.classList.remove('text-purple-300');
            setTimeout(() => {
                elem.classList.remove('text-rose-400');
                elem.classList.add('text-purple-300');
            }, 300);
        }
    };

    window.saveExamInfo = () => {
        const subject = document.getElementById('exam-subject-input')?.value || '';
        const expected = document.getElementById('exam-expected-input')?.value || '';
        const actual = document.getElementById('exam-actual-input')?.value || '';
        const timeStart = document.getElementById('exam-time-start')?.value || '';
        const timeEnd = document.getElementById('exam-time-end')?.value || '';
        const proctor = document.getElementById('exam-proctor-input')?.value || '';
        try { localStorage.setItem('proExamInfo', JSON.stringify({ subject, expected, actual, timeStart, timeEnd, proctor })); } catch(e) {}
        updateAbsentCount();
    };

    window.switchToAdvancedExam = () => {
        saveExamInfo();
        const data = JSON.parse(localStorage.getItem('proExamInfo')) || {};
        const examSchedule = [{
            id: Date.now(),
            startH: (data.timeStart && data.timeStart.includes(':')) ? data.timeStart.split(':')[0] : '08',
            startM: (data.timeStart && data.timeStart.includes(':')) ? data.timeStart.split(':')[1] : '30',
            endH: (data.timeEnd && data.timeEnd.includes(':')) ? data.timeEnd.split(':')[0] : '09',
            endM: (data.timeEnd && data.timeEnd.includes(':')) ? data.timeEnd.split(':')[1] : '20',
            subject: data.subject || '',
            proctor: data.proctor || 'OOO老師'
        }];
        const examAttendance = {
            expected: parseInt(data.expected) || 28,
            actual: parseInt(data.actual) || 28,
            absentNumbers: ''
        };
        localStorage.setItem('examSchedule', JSON.stringify(examSchedule));
        localStorage.setItem('examAttendance', JSON.stringify(examAttendance));
        window.location.href = 'exam.html';
    };

    function loadExamInfo() {
        try {
            const data = JSON.parse(localStorage.getItem('proExamInfo'));
            if (data) {
                const subjectEl = document.getElementById('exam-subject-input');
                const expectedEl = document.getElementById('exam-expected-input');
                const actualEl = document.getElementById('exam-actual-input');
                const timeStartEl = document.getElementById('exam-time-start');
                const timeEndEl = document.getElementById('exam-time-end');
                const proctorEl = document.getElementById('exam-proctor-input');
                if (subjectEl && data.subject) subjectEl.value = data.subject;
                if (expectedEl && data.expected) expectedEl.value = data.expected;
                if (actualEl && data.actual) actualEl.value = data.actual;
                if (timeStartEl && data.timeStart) timeStartEl.value = data.timeStart;
                if (timeEndEl && data.timeEnd) timeEndEl.value = data.timeEnd;
                if (proctorEl && data.proctor) proctorEl.value = data.proctor;
                updateAbsentCount();
            }
        } catch(e) {}
    }

    function updateAbsentCount() {
        const expected = parseInt(document.getElementById('exam-expected-input')?.value);
        const actual = parseInt(document.getElementById('exam-actual-input')?.value);
        const display = document.getElementById('exam-absent-display');
        if (display) {
            if (!isNaN(expected) && !isNaN(actual)) {
                const absent = expected - actual;
                display.textContent = absent >= 0 ? absent : 0;
            } else {
                display.textContent = '--';
            }
        }
    }

    loadExamInfo();

    // --- 考試資訊面板全螢幕功能 ---
    window.toggleExamFullscreen = (forceExit = false) => {
        const elem = document.getElementById('clock-sub-exam');
        if (!elem) return;

        if (!document.fullscreenElement && !forceExit) {
            // 進入全螢幕
            elem.classList.add('bg-slate-950'); // 加上背景色避免黑屏
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) { /* Safari */
                elem.webkitRequestFullscreen();
            }
        } else {
            // 退出全螢幕
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) { /* Safari */
                document.webkitExitFullscreen();
            }
        }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    function handleFullscreenChange() {
        const elem = document.getElementById('clock-sub-exam');
        const enterBtn = document.getElementById('exam-fullscreen-btn');
        const exitBtn = document.getElementById('exam-exit-fullscreen-btn');
        const clockDate = document.getElementById('clock-date');
        const clockTime = document.getElementById('clock-time');
        const infoPanel = document.getElementById('exam-info-panel-container');

        if (document.fullscreenElement || document.webkitFullscreenElement) {
            // 取得實際螢幕尺寸
            const sw = screen.width;
            const sh = screen.height;

            // 水平限制：HH:MM:SS 共 8 個等寬字元，每字元約 0.6em
            const timeSize_h = Math.floor(sw * 0.95 / 4.8);
            // 垂直限制：扣掉日期列、進度條、考試面板、按鈕、內距後剩餘空間
            const timeSize_v = Math.floor((sh - 360) / 1.31);
            const timeSize = Math.min(timeSize_h, timeSize_v);
            const dateSize = Math.floor(timeSize * 0.22);
            const infoPanelScale = Math.min(sw / 900, sh / 560, 1.6);

            // 套用動態大小
            clockDate.style.fontSize = dateSize + 'px';
            clockTime.style.fontSize = timeSize + 'px';
            clockTime.style.transition = 'font-size 0.5s ease';
            clockDate.style.transition = 'font-size 0.5s ease';

            // 縮放資訊面板
            if (infoPanel) {
                infoPanel.style.transform = `scale(${infoPanelScale})`;
                infoPanel.style.transformOrigin = 'top center';
                infoPanel.style.marginTop = `${Math.floor(timeSize * 0.4)}px`;
            }

            // 顯示/隱藏按鈕
            enterBtn.classList.add('hidden');
            exitBtn.classList.remove('hidden');
            exitBtn.classList.add('flex');
            elem.classList.add('p-6');
            elem.classList.remove('py-10');

        } else {
            // 退出全螢幕：還原所有動態樣式
            clockDate.style.fontSize = '';
            clockTime.style.fontSize = '';
            clockDate.style.transition = '';
            clockTime.style.transition = '';

            if (infoPanel) {
                infoPanel.style.transform = '';
                infoPanel.style.transformOrigin = '';
                infoPanel.style.marginTop = '';
            }

            elem.classList.remove('bg-slate-950', 'p-6');
            elem.classList.add('py-10');
            enterBtn.classList.remove('hidden');
            exitBtn.classList.add('hidden');
            exitBtn.classList.remove('flex');
        }
    }

    // --- 上下課鐘功能 (Class Bell) ---
    // 使用 Web Audio API 合成極度真實的雙音校園鐘聲
    window.playSchoolBell = (type) => {
        if (window._irsIsStudentMode) {
            alert("⚠️ 此功能僅限老師使用。\n\n學生模式下无法播放上下課鐘聲，請聯繫老師操作。");
            return;
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        const mainGain = audioCtx.createGain();
        mainGain.connect(audioCtx.destination);
        mainGain.gain.setValueAtTime(0.5, audioCtx.currentTime);

        const playChime = (freq, startTime, duration) => {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);
            
            // 鐘聲的獨特音色處理 (主要依靠包絡線 Envelope)
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(1, startTime + 0.05); // 敲擊瞬間
            gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration); // 餘音繞樑
            
            osc.connect(gainNode);
            gainNode.connect(mainGain);
            
            osc.start(startTime);
            osc.stop(startTime + duration);
        };

        const now = audioCtx.currentTime;
        
        if (type === 'start') {
            // 上課鐘：西敏寺鐘聲 (長鈴聲) ＋ 高音
            const notes = [
                659.25, 523.25, 587.32, 392.00, // Mi Do Re Sol (高)
                392.00, 587.32, 659.25, 523.25  // Sol Re Mi Do
            ];
            const delays = [0, 1.2, 2.4, 3.6, 5.4, 6.6, 7.8, 9.0];
            
            for(let i=0; i<notes.length; i++) {
                playChime(notes[i], now + delays[i], 3.5);
            }
        } else if (type === 'end') {
            // 下課鐘：簡單雙音 (短鈴聲) ＋ 低音
            playChime(329.63, now, 2);         // Mi (低)
            playChime(261.63, now + 0.8, 2.5); // Do (低)
        }
    };

    let quickBreakInterval = null;
    let quickBreakRemaining = 0;
    let quickBreakTargetMode = 'class'; // 'class' or 'break'

    const runQuickBreakPhase = () => {
        clearInterval(quickBreakInterval);
        const min = quickBreakTargetMode === 'class' ? parseInt(document.getElementById('quick-class-min').value) || 50 : parseInt(document.getElementById('quick-break-min').value) || 10;
        quickBreakRemaining = min * 60;
        
        document.getElementById('quick-break-buttons').classList.add('hidden');
        document.getElementById('quick-break-active').classList.remove('hidden');
        document.getElementById('quick-break-active').classList.add('flex');
        
        const titleEl = document.getElementById('quick-break-title');
        if (titleEl) {
            titleEl.textContent = quickBreakTargetMode === 'class' ? '上課中...' : '休息中...';
            titleEl.className = quickBreakTargetMode === 'class' ? 'text-sm font-bold text-rose-400 mb-[-10px]' : 'text-sm font-bold text-emerald-400 mb-[-10px]';
        }
        
        updateQuickBreakDisplay();
        
        quickBreakInterval = setInterval(() => {
            quickBreakRemaining--;
            updateQuickBreakDisplay();
            
            if (quickBreakRemaining <= 0) {
                clearInterval(quickBreakInterval);
                if (quickBreakTargetMode === 'class') {
                    playSchoolBell('end');
                    quickBreakTargetMode = 'break';
                    runQuickBreakPhase();
                } else {
                    playSchoolBell('start');
                    quickBreakTargetMode = 'class';
                    runQuickBreakPhase();
                }
            }
        }, 1000);
    };

    window.startQuickBreakCountdown = () => {
        if (window._irsIsStudentMode) {
            alert("⚠️ 此功能僅限老師使用。\n\n學生模式下無法啟動快速上下課倒數計時，請聯繫老師操作。");
            return;
        }
        quickBreakTargetMode = 'class';
        runQuickBreakPhase();
    };

    window.stopQuickBreakCountdown = () => {
        clearInterval(quickBreakInterval);
        document.getElementById('quick-break-active').classList.add('hidden');
        document.getElementById('quick-break-active').classList.remove('flex');
        document.getElementById('quick-break-buttons').classList.remove('hidden');
    };

    const updateQuickBreakDisplay = () => {
        const m = String(Math.floor(quickBreakRemaining / 60)).padStart(2, '0');
        const s = String(quickBreakRemaining % 60).padStart(2, '0');
        const el = document.getElementById('quick-break-display');
        if(el) el.textContent = `${m}:${s}`;
    };

    // --- 自動校園響鈴 (Schedule Bell) ---
    let scheduleBellInterval = null;
    let isScheduleBellActive = false;
    let lastPlayedMinuteStr = null;
    
    const defaultSchedule = [
        { name: '第0節', start: '08:00', end: '08:40' },
        { name: '第1節', start: '08:45', end: '09:25' },
        { name: '第2節', start: '09:35', end: '10:15' },
        { name: '第3節', start: '10:30', end: '11:10' },
        { name: '第4節', start: '11:20', end: '12:00', isLunchStart: true },
        { name: '午休結束', start: '13:20', end: '13:20', isLunchEnd: true },
        { name: '第5節', start: '13:30', end: '14:10' },
        { name: '第6節', start: '14:20', end: '15:00' },
        { name: '第7節', start: '15:20', end: '16:00' }
    ];
    let classSchedule = [];

    const loadSchedule = () => {
        const saved = localStorage.getItem('classAssistantSchedule');
        if (saved) {
            classSchedule = JSON.parse(saved);
        } else {
            classSchedule = JSON.parse(JSON.stringify(defaultSchedule));
        }
        renderScheduleTable();
    };

    const saveSchedule = () => {
        localStorage.setItem('classAssistantSchedule', JSON.stringify(classSchedule));
        renderScheduleTable();
    };

    window.resetScheduleClasses = () => {
        if(confirm('確定要還原成預設的上下課時間表嗎？目前的修改將會遺失。')) {
            classSchedule = JSON.parse(JSON.stringify(defaultSchedule));
            saveSchedule();
        }
    };

    window.addScheduleClass = () => {
        classSchedule.push({ name: '新節次', start: '00:00', end: '00:00' });
        saveSchedule();
        setTimeout(() => {
            const table = document.getElementById('schedule-table');
            if(table) table.scrollTop = table.scrollHeight;
        }, 50);
    };

    window.removeScheduleClass = (idx) => {
        classSchedule.splice(idx, 1);
        saveSchedule();
    };

    window.updateScheduleItem = (idx, field, val) => {
        classSchedule[idx][field] = val;
        localStorage.setItem('classAssistantSchedule', JSON.stringify(classSchedule)); // 不重新渲染以避免失去焦點
    };

    const renderScheduleTable = () => {
        const container = document.getElementById('schedule-table');
        if (!container) return;
        
        container.innerHTML = classSchedule.map((item, idx) => `
            <div class="flex items-center gap-2 bg-slate-900 border border-white/10 p-2 rounded-lg relative group transition-all">
                <input type="text" value="${escapeHTML(item.name)}" onchange="updateScheduleItem(${idx}, 'name', this.value)" class="w-16 sm:w-20 bg-transparent border-b border-transparent focus:border-indigo-400 text-white focus:outline-none text-xs sm:text-sm text-center px-1" placeholder="名稱">
                <div class="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded shadow-inner flex-1">
                    <input type="time" value="${item.start}" onchange="updateScheduleItem(${idx}, 'start', this.value)" class="bg-transparent text-emerald-400 focus:outline-none text-sm w-full" required>
                </div>
                <span class="text-slate-500 text-xs px-1">~</span>
                <div class="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded shadow-inner flex-1">
                    <input type="time" value="${item.end}" onchange="updateScheduleItem(${idx}, 'end', this.value)" class="bg-transparent text-rose-400 focus:outline-none text-sm w-full" required>
                </div>
                <button onclick="removeScheduleClass(${idx})" class="ml-1 text-slate-500 hover:text-rose-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" title="刪除此節"><i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i></button>
            </div>
        `).join('');
        lucide.createIcons({ root: container });
    };

    // 掛載事件與初始化
    window.addEventListener('load', () => { setTimeout(loadSchedule, 300); });

    window.toggleScheduleBell = () => {
        if (window._irsIsStudentMode) {
            alert("⚠️ 此功能僅限老師使用。\n\n學生模式下無法啟動自動校園響鈴功能，請聯繫老師操作。");
            return;
        }
        isScheduleBellActive = !isScheduleBellActive;
        const btn = document.getElementById('schedule-bell-btn');
        const status = document.getElementById('schedule-bell-status');
        const text = document.getElementById('schedule-bell-text');
        
        if (isScheduleBellActive) {
            btn.classList.add('border-emerald-500/50');
            status.classList.replace('bg-rose-500', 'bg-emerald-500');
            status.classList.replace('shadow-[0_0_8px_rgba(225,29,72,0.8)]', 'shadow-[0_0_8px_rgba(16,185,129,0.8)]');
            text.textContent = '自動響鈴中';
            text.classList.add('text-emerald-400');
            
            // run once immediately to set lastPlayedMinuteStr without ringing multiple times
            checkScheduleBell(true); 
            scheduleBellInterval = setInterval(() => checkScheduleBell(false), 20000);
            showGlobalToast("已啟用自動校園響鈴", "calendar-clock", "text-emerald-400");
            
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        } else {
            btn.classList.remove('border-emerald-500/50');
            status.classList.replace('bg-emerald-500', 'bg-rose-500');
            status.classList.replace('shadow-[0_0_8px_rgba(16,185,129,0.8)]', 'shadow-[0_0_8px_rgba(225,29,72,0.8)]');
            text.textContent = '未啟用';
            text.classList.remove('text-emerald-400');
            
            clearInterval(scheduleBellInterval);
            showGlobalToast("已關閉自動校園響鈴", "bell-off", "text-rose-400");
        }
    };

    const checkScheduleBell = (isInit = false) => {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const currentTimeStr = `${hh}:${mm}`;
        
        if (currentTimeStr === lastPlayedMinuteStr) return;
        
        let shouldPlayStart = false;
        let shouldPlayEnd = false;
        
        for (const p of classSchedule) {
            if (p.start === currentTimeStr) shouldPlayStart = true;
            if (p.end === currentTimeStr) shouldPlayEnd = true;
        }
        
        if (isInit) {
           lastPlayedMinuteStr = currentTimeStr;
           return;
        }
        
        if (shouldPlayStart) {
           playSchoolBell('start');
           lastPlayedMinuteStr = currentTimeStr;
        } else if (shouldPlayEnd) {
           playSchoolBell('end');
           lastPlayedMinuteStr = currentTimeStr;
        }
    };


    // --- 讀書蕃茄鐘功能 (Pomodoro) ---
    let pomoState = {
        mode: 'focus', // 'focus' | 'break'
        isRunning: false,
        remainingSecs: 25 * 60,
        intervalId: null
    };
    let POMO_SECONDS_WORK = 25 * 60;
    let POMO_SECONDS_BREAK = 5 * 60;

    window.updatePomoConfig = () => {
        const workMin = parseInt(document.getElementById('pomo-work-min').value);
        const breakMin = parseInt(document.getElementById('pomo-break-min').value);
        if(workMin > 0) POMO_SECONDS_WORK = workMin * 60;
        if(breakMin > 0) POMO_SECONDS_BREAK = breakMin * 60;
        
        if (!pomoState.isRunning) {
            pomoState.remainingSecs = pomoState.mode === 'focus' ? POMO_SECONDS_WORK : POMO_SECONDS_BREAK;
            updatePomoDisplay();
        }
    };

    const playCuckooSound = () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const playNote = (freq, startTime, dur) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.5, startTime + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, startTime + dur);
            osc.start(startTime);
            osc.stop(startTime + dur);
        };
        const now = audioCtx.currentTime;
        playNote(659.25, now, 0.3); // E5
        playNote(523.25, now + 0.4, 0.4); // C5
    };

    const playRelaxSound = () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(1046.50, audioCtx.currentTime + 1.5); // C6
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.5);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 2.0);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 2.0);
    };

    window.togglePomoTimer = () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const icon = document.getElementById('pomo-toggle-icon');
        const btn = document.getElementById('pomo-toggle-btn');
        const colorShadow = pomoState.mode === 'focus' ? 'rgba(139,69,19,0.8)' : 'rgba(16,185,129,0.8)';
        
        if (pomoState.isRunning) {
            clearInterval(pomoState.intervalId);
            pomoState.isRunning = false;
            icon.setAttribute('data-lucide', 'play');
            btn.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
        } else {
            pomoState.isRunning = true;
            icon.setAttribute('data-lucide', 'pause');
            btn.style.boxShadow = `0 0 25px ${colorShadow}`;
            pomoState.intervalId = setInterval(tickPomoTimer, 1000);
            
            if (pomoState.remainingSecs === POMO_SECONDS_WORK) playCuckooSound();
            else if (pomoState.remainingSecs === POMO_SECONDS_BREAK) playRelaxSound();
        }
        lucide.createIcons();
        updatePomoDisplay(); // Update bird state
    };

    const tickPomoTimer = () => {
        if (pomoState.remainingSecs <= 0) {
            skipPomoPhase();
            if (pomoState.mode === 'focus') playCuckooSound();
            else playRelaxSound();
            return;
        }
        pomoState.remainingSecs--;
        updatePomoDisplay();
    };

    window.skipPomoPhase = () => {
        if (pomoState.mode === 'focus') {
            pomoState.mode = 'break';
            pomoState.remainingSecs = POMO_SECONDS_BREAK;
        } else {
            pomoState.mode = 'focus';
            pomoState.remainingSecs = POMO_SECONDS_WORK;
        }
        updatePomoDisplay();
        
        if (pomoState.isRunning) {
           const btn = document.getElementById('pomo-toggle-btn');
           const colorShadow = pomoState.mode === 'focus' ? 'rgba(139,69,19,0.8)' : 'rgba(16,185,129,0.8)';
           btn.style.boxShadow = `0 0 25px ${colorShadow}`;
        }
    };

    window.resetPomoTimer = () => {
        clearInterval(pomoState.intervalId);
        pomoState.isRunning = false;
        pomoState.mode = 'focus';
        pomoState.remainingSecs = POMO_SECONDS_WORK;
        
        const icon = document.getElementById('pomo-toggle-icon');
        icon.setAttribute('data-lucide', 'play');
        document.getElementById('pomo-toggle-btn').style.boxShadow = '0 0 20px rgba(255,255,255,0.4)';
        lucide.createIcons();
        
        updatePomoDisplay();
    };

    const updatePomoDisplay = () => {
        const m = String(Math.floor(pomoState.remainingSecs / 60)).padStart(2, '0');
        const s = String(pomoState.remainingSecs % 60).padStart(2, '0');
        document.getElementById('pomo-time-display').textContent = `${m}:${s}`;

        const badge = document.getElementById('pomo-mode-badge');
        
        if(badge) {
            if (pomoState.mode === 'focus') {
                badge.textContent = '專注時間';
                badge.className = 'bg-[#3E2723] text-amber-200 px-6 py-1.5 rounded-full border border-amber-900 shadow-[0_2px_10px_rgba(0,0,0,0.5)] tracking-widest text-sm font-black mb-5 transition-colors duration-500 whitespace-nowrap';
            } else {
                badge.textContent = '休息時間';
                badge.className = 'bg-emerald-800 text-emerald-100 px-6 py-1.5 rounded-full border border-emerald-900 shadow-[0_2px_10px_rgba(16,185,129,0.5)] tracking-widest text-sm font-black mb-5 transition-colors duration-500 whitespace-nowrap';
            }
        }
        
        const bird = document.getElementById('cuckoo-bird');
        const doorL = document.getElementById('cuckoo-door-l');
        const doorR = document.getElementById('cuckoo-door-r');
        if(bird && doorL && doorR) {
           if (pomoState.isRunning && pomoState.mode === 'focus') {
              bird.classList.add('cuckoo-active');
              doorL.style.transform = 'rotateY(-130deg)';
              doorR.style.transform = 'rotateY(130deg)';
           } else {
              bird.classList.remove('cuckoo-active');
              doorL.style.transform = 'rotateY(0deg)';
              doorR.style.transform = 'rotateY(0deg)';
           }
        }
    };

