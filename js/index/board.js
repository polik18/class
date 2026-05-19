// 模組：互動白板 (Board Mode)
const boardEls = {
  canvas: document.getElementById('whiteboard-canvas'),
  container: document.getElementById('canvas-container'),
  colorBtns: document.querySelectorAll('.color-btn'),
  brushSize: document.getElementById('brush-size'),
  eraserBtn: document.getElementById('eraser-btn'),
  clearBtn: document.getElementById('clear-board-btn')
};

const boardCtx = boardEls.canvas.getContext('2d', { willReadFrequently: true });

let boardState = {
  isDrawing: false,
  color: '#ffffff',
  lineWidth: 4,
  isErasing: false,
  lastX: 0,
  lastY: 0
};

const resizeCanvas = () => {
  if (appState.currentMode !== 'board') return;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = boardEls.canvas.width;
  tempCanvas.height = boardEls.canvas.height;
  const tempCtx = tempCanvas.getContext('2d');
  if (boardEls.canvas.width > 0 && boardEls.canvas.height > 0) {
    tempCtx.drawImage(boardEls.canvas, 0, 0);
  }

  const rect = boardEls.container.getBoundingClientRect();
  boardEls.canvas.width = rect.width;
  boardEls.canvas.height = rect.height;

  boardCtx.lineCap = 'round';
  boardCtx.lineJoin = 'round';

  if (tempCanvas.width > 0 && tempCanvas.height > 0) {
    boardCtx.drawImage(tempCanvas, 0, 0);
  }
};

window.addEventListener('resize', resizeCanvas);

const getPointerPos = (e) => {
  const rect = boardEls.canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
};

const startDrawing = (e) => {
  boardState.isDrawing = true;
  const pos = getPointerPos(e);
  boardState.lastX = pos.x;
  boardState.lastY = pos.y;
  draw(e);
};

const stopDrawing = () => {
  boardState.isDrawing = false;
  boardCtx.beginPath();
};

const draw = (e) => {
  if (!boardState.isDrawing) return;
  e.preventDefault();

  const pos = getPointerPos(e);

  boardCtx.lineWidth = boardState.lineWidth;
  boardCtx.lineCap = 'round';
  boardCtx.lineJoin = 'round';

  if (boardState.isErasing) {
    boardCtx.globalCompositeOperation = 'destination-out';
    boardCtx.lineWidth = boardState.lineWidth * 2;
  } else {
    boardCtx.globalCompositeOperation = 'source-over';
    boardCtx.strokeStyle = boardState.color;
  }

  boardCtx.beginPath();
  boardCtx.moveTo(boardState.lastX, boardState.lastY);
  boardCtx.lineTo(pos.x, pos.y);
  boardCtx.stroke();

  boardState.lastX = pos.x;
  boardState.lastY = pos.y;
};

boardEls.canvas.addEventListener('mousedown', startDrawing);
boardEls.canvas.addEventListener('mousemove', draw);
boardEls.canvas.addEventListener('mouseup', stopDrawing);
boardEls.canvas.addEventListener('mouseout', stopDrawing);

boardEls.canvas.addEventListener('touchstart', startDrawing, { passive: false });
boardEls.canvas.addEventListener('touchmove', draw, { passive: false });
boardEls.canvas.addEventListener('touchend', stopDrawing);
boardEls.canvas.addEventListener('touchcancel', stopDrawing);

boardEls.colorBtns.forEach(btn => {
  btn.addEventListener('click', (e) => {
    boardState.isErasing = false;
    boardState.color = e.target.dataset.color;

    boardEls.colorBtns.forEach(b => b.classList.replace('border-indigo-500', 'border-transparent'));
    boardEls.colorBtns.forEach(b => b.classList.remove('shadow-[0_0_10px_rgba(255,255,255,0.5)]'));
    e.target.classList.replace('border-transparent', 'border-indigo-500');
    if (boardState.color === '#ffffff') {
      e.target.classList.add('shadow-[0_0_10px_rgba(255,255,255,0.5)]');
    }

    boardEls.eraserBtn.classList.remove('bg-indigo-600', 'text-white');
    boardEls.eraserBtn.classList.add('bg-slate-800', 'text-slate-300');
  });
});

boardEls.brushSize.addEventListener('input', (e) => {
  boardState.lineWidth = e.target.value;
});

boardEls.eraserBtn.addEventListener('click', () => {
  boardState.isErasing = true;
  boardEls.eraserBtn.classList.replace('bg-slate-800', 'bg-indigo-600');
  boardEls.eraserBtn.classList.replace('text-slate-300', 'text-white');

  boardEls.colorBtns.forEach(b => b.classList.replace('border-indigo-500', 'border-transparent'));
  boardEls.colorBtns.forEach(b => b.classList.remove('shadow-[0_0_10px_rgba(255,255,255,0.5)]'));
});

boardEls.clearBtn.addEventListener('click', () => {
  boardCtx.clearRect(0, 0, boardEls.canvas.width, boardEls.canvas.height);
});

window.addEventListener('load', () => {
  if (appState.currentMode === 'board') resizeCanvas();
});
