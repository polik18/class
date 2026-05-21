// 系統初始化：全域狀態、DOM 快取、導覽切換、頂部時鐘
lucide.createIcons();

const appState = {
  currentMode: 'draw',
  isMuted: false
};

// DOM 快取：頂部導覽
const navEls = {
  draw: document.getElementById('nav-draw'),
  clock: document.getElementById('nav-clock'),
  timer: document.getElementById('nav-timer'),
  score: document.getElementById('nav-score'),
  board: document.getElementById('nav-board'),
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
  board: document.getElementById('app-board')
};

// 靜音切換
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
updateHeaderTime();

// 主功能切換邏輯
window.switchAppMode = (mode) => {
  appState.currentMode = mode;

  const activeClass = ['bg-indigo-600', 'text-white', 'shadow-md'];
  const inactiveClass = ['text-slate-400', 'hover:text-slate-200', 'hover:bg-white/5'];

  ['draw', 'clock', 'timer', 'score', 'board'].forEach(m => {
    const btn = navEls[m];
    if (m === mode) {
      btn.classList.remove(...inactiveClass);
      btn.classList.add(...activeClass);

      viewEls[m].classList.remove('hidden');

      if (m === 'timer') {
        viewEls[m].classList.add('grid');
      } else {
        viewEls[m].classList.add((m === 'clock' || m === 'score' || m === 'board') ? 'flex' : 'grid');
      }

      if (m === 'clock') updateClock();
      if (m === 'timer') updateTimerDisplay();
      if (m === 'board') {
        setTimeout(resizeCanvas, 50);
      }
    } else {
      btn.classList.remove(...activeClass);
      btn.classList.add(...inactiveClass);
      viewEls[m].classList.add('hidden');
      viewEls[m].classList.remove('grid', 'flex');
    }
  });
};
