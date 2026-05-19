// 音效系統 — 共用 AudioContext 與所有音效函式
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

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

const playTimerAlarm = () => {
  if (appState.isMuted) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  for (let i = 0; i < 3; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime + i * 0.3);
    gain.gain.setValueAtTime(0, audioCtx.currentTime + i * 0.3);
    gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + i * 0.3 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i * 0.3 + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + i * 0.3);
    osc.stop(audioCtx.currentTime + i * 0.3 + 0.2);
  }
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
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.3);
  } else {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
  }

  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(type === 'warning' ? 0.4 : 0.3, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + (type === 'warning' ? 0.4 : 0.2));

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + (type === 'warning' ? 0.4 : 0.2));
};
