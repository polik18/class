// 模組：考試大鐘 (Clock Mode)
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

  const secPercentage = (now.getSeconds() / 60) * 100;
  clockEls.secBar.style.width = `${secPercentage}%`;
};

setInterval(updateClock, 1000);
