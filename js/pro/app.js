    // 全域 Toast 提示
    window.showToast = (msg, color = 'indigo') => {
        const toast = document.getElementById('global-toast');
        const content = document.getElementById('global-toast-content');
        
        const colors = {
           'emerald': 'border-emerald-500/50 shadow-emerald-500/20 text-emerald-100',
           'indigo': 'border-indigo-500/50 shadow-indigo-500/20 text-indigo-100',
           'amber': 'border-amber-500/50 shadow-amber-500/20 text-amber-100'
        };
        
        content.className = `bg-slate-800/90 px-6 py-3 rounded-full shadow-2xl border flex items-center gap-3 font-bold text-sm backdrop-blur-md ${colors[color] || colors['indigo']}`;
        content.innerHTML = msg;
        
        toast.classList.remove('opacity-0', '-translate-y-4');
        toast.classList.add('opacity-100', 'translate-y-0');
        
        setTimeout(() => {
            toast.classList.add('opacity-0', '-translate-y-4');
            toast.classList.remove('opacity-100', 'translate-y-0');
        }, 4000);
    };

    // ----------------------------------------------------------------------
    // 系統初始化與通用函數
    lucide.createIcons();

    // 初始化時顯示 Pro 版導覽視窗
    window.addEventListener('load', () => {
        const welcomeModal = document.getElementById('welcome-guide-modal');
        if (welcomeModal && !localStorage.getItem('classroom_assistant_pro_seen')) {
            welcomeModal.classList.remove('hidden');
        }
    });

    window.closeWelcomeGuide = () => {
        const welcomeModal = document.getElementById('welcome-guide-modal');
        if (welcomeModal) {
            welcomeModal.classList.add('hidden');
            localStorage.setItem('classroom_assistant_pro_seen', 'true');
        }
    };

    // ----------------------------------------------------------------------
    // 滾動提示邏輯 (左右與上下)
    const scrollHintEls = {
        navContainer: document.getElementById('main-nav-container'),
        navLeft: document.getElementById('nav-scroll-left'),
        navRight: document.getElementById('nav-scroll-right'),
        globalScroll: document.getElementById('global-scroll-hint')
    };

    window.scrollMainNav = (dir) => {
        if (!scrollHintEls.navContainer) return;
        scrollHintEls.navContainer.scrollBy({ left: dir * 200, behavior: 'smooth' });
    };

    const updateNavScrollHints = () => {
        if (!scrollHintEls.navContainer || !scrollHintEls.navLeft || !scrollHintEls.navRight) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollHintEls.navContainer;
        
        // 是否可以向左滾
        if (scrollLeft > 5) {
            scrollHintEls.navLeft.classList.replace('opacity-0', 'opacity-100');
            scrollHintEls.navLeft.classList.replace('pointer-events-none', 'pointer-events-auto');
        } else {
            scrollHintEls.navLeft.classList.replace('opacity-100', 'opacity-0');
            scrollHintEls.navLeft.classList.replace('pointer-events-auto', 'pointer-events-none');
        }
        
        // 是否可以向右滾 (容許一些誤差)
        if (Math.ceil(scrollLeft + clientWidth) < scrollWidth - 5) {
            scrollHintEls.navRight.classList.replace('opacity-0', 'opacity-100');
            scrollHintEls.navRight.classList.replace('pointer-events-none', 'pointer-events-auto');
        } else {
            scrollHintEls.navRight.classList.replace('opacity-100', 'opacity-0');
            scrollHintEls.navRight.classList.replace('pointer-events-auto', 'pointer-events-none');
        }
    };

    const updateGlobalScrollHint = () => {
        if (!scrollHintEls.globalScroll) return;
        // 檢查是否需要上下滾動 (網頁總高度大於視窗高度)
        const { scrollY, innerHeight } = window;
        const scrollHeight = document.documentElement.scrollHeight;
        
        // 如果可以滾動，且還沒滾動超過 20px
        if (scrollHeight > innerHeight + 50 && scrollY < 20) {
            scrollHintEls.globalScroll.classList.replace('opacity-0', 'opacity-100');
        } else {
            scrollHintEls.globalScroll.classList.replace('opacity-100', 'opacity-0');
        }
    };

    // 綁定滾動事件
    if (scrollHintEls.navContainer) {
        scrollHintEls.navContainer.addEventListener('scroll', updateNavScrollHints);
    }
    window.addEventListener('scroll', updateGlobalScrollHint);
    window.addEventListener('resize', () => {
        updateNavScrollHints();
        updateGlobalScrollHint();
    });

    // 初始偵測 (延遲確保 DOM 渲染完畢)
    setTimeout(() => {
        updateNavScrollHints();
        updateGlobalScrollHint();
    }, 800);

    // 應用程式全域狀態
    const appState = {
      currentMode: 'draw', // 'draw', 'clock', 'timer', 'score', 'board', 'irs'
      isMuted: false
    };

    // DOM 快取：頂部導覽
    const navEls = {
      draw: document.getElementById('nav-draw'),
      clock: document.getElementById('nav-clock'),
      timer: document.getElementById('nav-timer'),
      score: document.getElementById('nav-score'),
      board: document.getElementById('nav-board'),
      irs: document.getElementById('nav-irs'),
      dotPing: document.getElementById('timer-running-dot'),
      dotStatic: document.getElementById('timer-running-dot-static'),
      muteBtn: document.getElementById('mute-btn'),
      muteIcon: document.getElementById('mute-icon')
    };

    // DOM 快取：容器
    const viewEls = {
      draw: document.getElementById('app-draw'),
      clock: document.getElementById('app-clock'),
      timer: document.getElementById('app-timer'),
      score: document.getElementById('app-score'),
      board: document.getElementById('app-board'),
      irs: document.getElementById('app-irs')
    };

    // 音效系統 (利用 Proxy 延遲建立 AudioContext，以符合瀏覽器避免自動播放的政策)
    const audioCtx = new Proxy({}, {
        get: (target, prop) => {
            if (!target._ctx) target._ctx = new (window.AudioContext || window.webkitAudioContext)();
            let val = target._ctx[prop];
            return typeof val === 'function' ? val.bind(target._ctx) : val;
        }
    });
    
    // 共用靜音切換
    navEls.muteBtn.addEventListener('click', () => {
      appState.isMuted = !appState.isMuted;
      if (appState.isMuted) {
        navEls.muteIcon.setAttribute('data-lucide', 'volume-x');
        navEls.muteIcon.classList.replace('text-indigo-400', 'text-slate-400');
      } else {
        navEls.muteIcon.setAttribute('data-lucide', 'volume-2');
        navEls.muteIcon.classList.replace('text-slate-400', 'text-indigo-400');
      }
      lucide.createIcons();
    });

    // 頂部全域時間顯示
    const updateHeaderTime = () => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const headerTimeSpan = document.querySelector('#header-time span');
      if (headerTimeSpan) {
        headerTimeSpan.textContent = `${hh}:${mm}:${ss}`;
      }
    };
    setInterval(updateHeaderTime, 1000);
    updateHeaderTime(); // 初始化立即執行一次

    // 主功能切換邏輯
    window.switchAppMode = (mode) => {
      appState.currentMode = mode;
      
      // 更新導覽列樣式
      const activeClass = ['bg-indigo-600', 'text-white', 'shadow-md'];
      const inactiveClass = ['text-slate-400', 'hover:text-slate-200', 'hover:bg-white/5'];

      ['draw', 'clock', 'timer', 'score', 'board', 'irs'].forEach(m => {
        const btn = navEls[m];
        if (m === mode) {
          btn.classList.remove(...inactiveClass);
          btn.classList.add(...activeClass);
          
          viewEls[m].classList.remove('hidden');
          
          if (m === 'timer') {
             viewEls[m].classList.add('grid');
          } else {
             // 讓 draw 以外的其他模組切換為 flex
             viewEls[m].classList.add((m === 'clock' || m === 'score' || m === 'board' || m === 'irs') ? 'flex' : 'grid');
          }

          if (m === 'irs') {
              if (typeof irsState !== 'undefined' && !irsState.roomId && !irsState.hostConn && !window._irsIsStudentMode) {
                  // 如果尚未建立過連線，且不是學生掃碼進入的模式，自動以老師身分初始化
                  if (typeof initIRSTeacher === 'function') initIRSTeacher();
              }
          }

          // 觸發特定模式的重新計算/排版
          if (m === 'clock') updateClock(); 
          if (m === 'timer') updateTimerDisplay();
          if (m === 'board') {
            // 切換到白板時，確保容器佔滿空間後再調整畫布大小，加入緩衝避免報錯
            requestAnimationFrame(() => {
                resizeCanvas();
            });
          }
          
          // 切換畫面後，動態更新所有的滾動提示
          setTimeout(() => {
              updateNavScrollHints();
              updateGlobalScrollHint();
          }, 300);
          
          // 廣播自動跟隨
          if (typeof irsState !== 'undefined' && !irsState.hostConn && Object.keys(irsState.connections).length > 0) {
              if (typeof sendToAllStudents === 'function') {
                  sendToAllStudents({ type: 'sync_mode', mode: mode });
                  if (mode === 'board') {
                      sendToAllStudents({ type: 'sync_board', paths: boardState.paths, offsetX: boardState.offsetX, offsetY: boardState.offsetY });
                  }
              }
          }
        } else {
          btn.classList.remove(...activeClass);
          btn.classList.add(...inactiveClass);
          viewEls[m].classList.add('hidden');
          viewEls[m].classList.remove('grid', 'flex'); // 確保被隱藏時不會帶有 display class
        }
      });
    };

