    // ----------------------------------------------------------------------
    // 模組 5: 無限畫板 (BOARD MODE)
    // ----------------------------------------------------------------------
    const boardEls = {
      canvas: document.getElementById('whiteboard-canvas'),
      container: document.getElementById('canvas-container'),
      colorBtns: document.querySelectorAll('.color-btn'),
      brushSize: document.getElementById('brush-size'),
      panBtn: document.getElementById('pan-btn'),
      eraserBtn: document.getElementById('eraser-btn'),
      undoBtn: document.getElementById('undo-btn'),
      clearBtn: document.getElementById('clear-board-btn')
    };

    const boardCtx = boardEls.canvas.getContext('2d', { willReadFrequently: true });
    
    let boardState = {
      isDrawing: false,
      tool: 'pen', // 'pen', 'eraser', 'pan'
      color: '#ffffff',
      lineWidth: 4,
      lastX: 0,
      lastY: 0,
      offsetX: 0,
      offsetY: 0,
      paths: [], // 儲存所有畫過的筆劃路徑
      currentPath: null // 正在畫的這筆路徑
    };

    // 重新繪製整個畫布 (包含平移與所有筆劃)
    const redrawBoard = () => {
      // 1. 清空完整畫布
      boardCtx.clearRect(0, 0, boardEls.canvas.width, boardEls.canvas.height);
      
      // 2. 保存當前 Context 狀態並套用平移
      boardCtx.save();
      boardCtx.translate(boardState.offsetX, boardState.offsetY);
      
      // 3. 設定共同的畫筆屬性
      boardCtx.lineCap = 'round';
      boardCtx.lineJoin = 'round';
      
      // 4. 重新繪製所有儲存的筆劃
      boardState.paths.forEach(path => {
        if (path.points.length < 2) return;
        
        boardCtx.beginPath();
        if (path.tool === 'eraser') {
            boardCtx.globalCompositeOperation = 'destination-out';
            boardCtx.lineWidth = path.lineWidth * 2;
        } else {
            boardCtx.globalCompositeOperation = 'source-over';
            boardCtx.strokeStyle = path.color;
            boardCtx.lineWidth = path.lineWidth;
        }
        
        boardCtx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
            boardCtx.lineTo(path.points[i].x, path.points[i].y);
        }
        boardCtx.stroke();
      });
      
      boardCtx.restore();
    };

    // 處理畫布響應式大小與重繪內容
    const resizeCanvas = () => {
      if (appState.currentMode !== 'board') return;
      
      // 重新取得容器大小並設定
      const rect = boardEls.container.getBoundingClientRect();
      boardEls.canvas.width = rect.width;
      boardEls.canvas.height = rect.height;

      // 觸發重新繪製以套用既有筆劃與平移
      redrawBoard();
    };

    // 引入 ResizeObserver 自動監聽容器大小變化，確保無縫適應螢幕
    // 加上 requestAnimationFrame 避免 ResizeObserver loop limit exceeded 錯誤
    const boardResizeObserver = new ResizeObserver(() => {
       if (appState.currentMode === 'board') {
           requestAnimationFrame(() => {
               resizeCanvas();
           });
       }
    });
    boardResizeObserver.observe(boardEls.container);

    window.addEventListener('resize', () => {
        requestAnimationFrame(() => {
            resizeCanvas();
        });
    });

    // 取得指標在 Canvas 內的絕對位置 (考慮縮放與畫布本身的偏移 offsetX/offsetY)
    const getPointerPos = (e) => {
      const rect = boardEls.canvas.getBoundingClientRect();
      let clientX, clientY;
      
      if (e.touches && e.touches.length > 0) {
          clientX = e.touches[0].clientX;
          clientY = e.touches[0].clientY;
      } else {
          clientX = e.clientX;
          clientY = e.clientY;
      }
      
      const scaleX = boardEls.canvas.width / rect.width;
      const scaleY = boardEls.canvas.height / rect.height;
      
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    };

    const startDrawing = (e) => {
      boardState.isDrawing = true;
      
      // 觸控雙指、滑鼠中鍵、或是按住空白鍵，都強制進入暫時平移模式
      if ((e.touches && e.touches.length >= 2) || e.button === 1 || boardState.isSpacePressed) {
          boardState.tempPan = true;
      } else {
          boardState.tempPan = false;
      }

      const pos = getPointerPos(e);
      boardState.lastX = pos.x;
      boardState.lastY = pos.y;
      
      const isPanning = boardState.tool === 'pan' || boardState.tempPan;
      
      if (!isPanning) {
          // 開啟一筆新繪圖路徑 (記錄相對於原點的座標)
          boardState.currentPath = {
              tool: boardState.tool,
              color: boardState.color,
              lineWidth: boardState.lineWidth,
              points: [{ x: pos.x - boardState.offsetX, y: pos.y - boardState.offsetY }]
          };
      } else {
          boardEls.canvas.style.cursor = 'grabbing';
      }
    };

    const stopDrawing = (e) => {
      if (!boardState.isDrawing) return;
      boardState.isDrawing = false;
      boardState.tempPan = false;
      boardCtx.beginPath();
      
      // 恢復原始游標外觀 (若是空白鍵按住則維持 grab，否則 crosshair)
      boardEls.canvas.style.cursor = boardState.isSpacePressed ? 'grab' : '';
      
      // 如果剛剛結束的是畫筆或橡皮擦，而且有畫出點，就把這個筆劃存下來
      if (boardState.currentPath && boardState.currentPath.points.length > 0) {
          boardState.paths.push(boardState.currentPath);
          
          if (irsState.hostConn && irsState.hostConn.open) {
              irsState.hostConn.send({ type: 'draw_path', path: boardState.currentPath });
          } else if (typeof sendToAllStudents === 'function') {
              sendToAllStudents({ type: 'draw_path', path: boardState.currentPath });
          }

          boardState.currentPath = null;
      }
    };

    // RAF throttle state for draw
    let _drawRafPending = false;

    const draw = (e) => {
      if (!boardState.isDrawing) return;
      if (_drawRafPending) return; // RAF throttle: skip if a frame is already queued
      _drawRafPending = true;
      requestAnimationFrame(() => { _drawRafPending = false; });
      
      // 在畫布上操作時阻止預設的全螢幕滑動效果
      if(e.cancelable) {
         e.preventDefault(); 
      }
      
      // 若觸控中途變成雙指，強制轉為平移
      if (e.touches && e.touches.length >= 2) {
         boardState.tempPan = true;
         boardEls.canvas.style.cursor = 'grabbing';
      }

      const pos = getPointerPos(e);
      const isPanning = boardState.tool === 'pan' || boardState.tempPan;

      if (isPanning) {
          // 平移模式：計算拖曳差值，更新畫布偏移並重繪
          const dx = pos.x - boardState.lastX;
          const dy = pos.y - boardState.lastY;
          boardState.offsetX += dx;
          boardState.offsetY += dy;
          boardState.lastX = pos.x;
          boardState.lastY = pos.y;
          redrawBoard();
          
          if (typeof sendToAllStudents === 'function') {
              sendToAllStudents({ type: 'sync_board_pan', offsetX: boardState.offsetX, offsetY: boardState.offsetY });
          }
      } else {
          // 畫圖模式：即時繪製線條並記錄點座標
          boardCtx.save();
          boardCtx.translate(boardState.offsetX, boardState.offsetY);
          boardCtx.lineWidth = boardState.lineWidth;
          boardCtx.lineCap = 'round';
          boardCtx.lineJoin = 'round';
          
          if (boardState.tool === 'eraser') {
            boardCtx.globalCompositeOperation = 'destination-out';
            boardCtx.lineWidth = boardState.lineWidth * 2;
          } else {
            boardCtx.globalCompositeOperation = 'source-over';
            boardCtx.strokeStyle = boardState.color;
          }

          const relativeX = pos.x - boardState.offsetX;
          const relativeY = pos.y - boardState.offsetY;

          boardCtx.beginPath();
          const lastPoint = boardState.currentPath.points[boardState.currentPath.points.length - 1];
          boardCtx.moveTo(lastPoint.x, lastPoint.y);
          boardCtx.lineTo(relativeX, relativeY);
          boardCtx.stroke();
          boardCtx.restore();

          boardState.currentPath.points.push({ x: relativeX, y: relativeY });
          boardState.lastX = pos.x;
          boardState.lastY = pos.y;
      }
    };

    // 綁定滑鼠事件
    boardEls.canvas.addEventListener('mousedown', startDrawing);
    boardEls.canvas.addEventListener('mousemove', draw);
    boardEls.canvas.addEventListener('mouseup', stopDrawing);
    boardEls.canvas.addEventListener('mouseout', stopDrawing);

    // 綁定觸控事件
    boardEls.canvas.addEventListener('touchstart', startDrawing, { passive: false });
    boardEls.canvas.addEventListener('touchmove', draw, { passive: false });
    boardEls.canvas.addEventListener('touchend', stopDrawing);
    boardEls.canvas.addEventListener('touchcancel', stopDrawing);

    // 電腦版無限畫布增強體驗: 支援觸控板與滑鼠滾輪平移
    boardEls.canvas.addEventListener('wheel', (e) => {
        if (appState.currentMode !== 'board') return;
        e.preventDefault();
        // 放大縮小或是平移，此處運用滾輪的差值來直接位移畫布
        boardState.offsetX -= e.deltaX;
        boardState.offsetY -= e.deltaY;
        redrawBoard();
        if (typeof sendToAllStudents === 'function') {
            sendToAllStudents({ type: 'sync_board_pan', offsetX: boardState.offsetX, offsetY: boardState.offsetY });
        }
    }, { passive: false });

    // 電腦版無限畫布增強體驗: 支援空白鍵按住啟動平移 (如同 Photoshop)
    window.addEventListener('keydown', (e) => {
        if (appState.currentMode === 'board' && e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            if (!boardState.isSpacePressed) {
                e.preventDefault();
                boardState.isSpacePressed = true;
                if (!boardState.isDrawing) {
                    boardEls.canvas.style.cursor = 'grab';
                }
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            boardState.isSpacePressed = false;
            // 恢復原本的游標 (如果正在畫就算了)
            if (!boardState.isDrawing) {
                boardEls.canvas.style.cursor = '';
            }
        }
    });

    window.toggleBoardToolbar = () => {
        const toolbar = document.getElementById('board-toolbar');
        const icon = document.getElementById('board-toolbar-icon');
        const text = document.getElementById('board-toolbar-text');
        const toggleBtn = document.getElementById('board-toolbar-toggle');

        const isCollapsed = toolbar.classList.contains('scale-y-0');

        if (isCollapsed) {
            // 展開
            toolbar.classList.remove('scale-y-0', 'opacity-0', 'h-0', 'pointer-events-none', 'py-0', 'px-0', 'mb-0');
            toolbar.classList.add('p-3', 'sm:p-4', 'scale-y-100', 'opacity-100', 'mb-2', 'sm:mb-4');
            const hint = document.getElementById('board-toolbar-hint');
            if (hint) hint.classList.add('opacity-0');
            
            icon.setAttribute('data-lucide', 'chevron-down');
            text.textContent = '收合工具';
            toggleBtn.classList.replace('bg-indigo-600', 'bg-slate-800');
            toggleBtn.classList.replace('hover:bg-indigo-500', 'hover:bg-slate-700');
            toggleBtn.classList.replace('shadow-[0_10px_20px_rgba(79,70,229,0.4)]', 'shadow-[0_10px_20px_rgba(0,0,0,0.4)]');
            toggleBtn.classList.replace('border-indigo-400/50', 'border-white/10');
            icon.classList.replace('text-white', 'text-slate-300');
        } else {
            // 收合
            toolbar.classList.remove('p-3', 'sm:p-4', 'scale-y-100', 'opacity-100', 'mb-2', 'sm:mb-4');
            toolbar.classList.add('scale-y-0', 'opacity-0', 'h-0', 'pointer-events-none', 'py-0', 'px-0', 'mb-0');
            
            icon.setAttribute('data-lucide', 'pen-tool');
            text.textContent = '展開工具';
            toggleBtn.classList.replace('bg-slate-800', 'bg-indigo-600');
            toggleBtn.classList.replace('hover:bg-slate-700', 'hover:bg-indigo-500');
            toggleBtn.classList.replace('shadow-[0_10px_20px_rgba(0,0,0,0.4)]', 'shadow-[0_10px_20px_rgba(79,70,229,0.4)]');
            toggleBtn.classList.replace('border-white/10', 'border-indigo-400/50');
            icon.classList.replace('text-slate-300', 'text-white');
        }
        lucide.createIcons();
    };

    // 白板工具控制邏輯
    const updateToolUI = () => {
        boardEls.colorBtns.forEach(b => b.classList.replace('border-indigo-500', 'border-transparent'));
        boardEls.colorBtns.forEach(b => b.classList.remove('shadow-[0_0_10px_rgba(255,255,255,0.5)]'));
        
        boardEls.eraserBtn.classList.remove('bg-indigo-600', 'text-white');
        boardEls.eraserBtn.classList.add('bg-slate-800', 'text-slate-300');
        
        boardEls.panBtn.classList.remove('bg-indigo-600', 'text-white');
        boardEls.panBtn.classList.add('bg-slate-800', 'text-slate-300');
        
        if (boardState.tool === 'pen') {
            const activeColorBtn = Array.from(boardEls.colorBtns).find(b => b.dataset.color === boardState.color);
            if (activeColorBtn) {
                activeColorBtn.classList.replace('border-transparent', 'border-indigo-500');
                if(boardState.color === '#ffffff') {
                   activeColorBtn.classList.add('shadow-[0_0_10px_rgba(255,255,255,0.5)]');
                }
            }
        } else if (boardState.tool === 'eraser') {
            boardEls.eraserBtn.classList.replace('bg-slate-800', 'bg-indigo-600');
            boardEls.eraserBtn.classList.replace('text-slate-300', 'text-white');
        } else if (boardState.tool === 'pan') {
            boardEls.panBtn.classList.replace('bg-slate-800', 'bg-indigo-600');
            boardEls.panBtn.classList.replace('text-slate-300', 'text-white');
        }
    };

    boardEls.colorBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        boardState.tool = 'pen';
        boardState.color = e.target.dataset.color;
        updateToolUI();
      });
    });

    boardEls.brushSize.addEventListener('input', (e) => {
      boardState.lineWidth = e.target.value;
    });

    boardEls.panBtn.addEventListener('click', () => {
      boardState.tool = 'pan';
      updateToolUI();
    });

    boardEls.eraserBtn.addEventListener('click', () => {
      boardState.tool = 'eraser';
      updateToolUI();
    });

    boardEls.undoBtn.addEventListener('click', () => {
      if (boardState.paths.length > 0) {
          boardState.paths.pop();
          redrawBoard();
          if (typeof irsState !== 'undefined') {
              if (irsState.hostConn && irsState.hostConn.open) {
                 irsState.hostConn.send({ type: 'undo_path' });
              } else if (typeof sendToAllStudents === 'function') {
                 sendToAllStudents({ type: 'undo_path' });
              }
          }
      }
    });

    boardEls.clearBtn.addEventListener('click', () => {
      if (confirm("確定要清空畫布嗎？")) {
          boardState.paths = [];
          boardState.offsetX = 0;
          boardState.offsetY = 0;
          redrawBoard();
          if (typeof irsState !== 'undefined') {
              if (irsState.hostConn && irsState.hostConn.open) {
                 irsState.hostConn.send({ type: 'clear_board' });
              } else if (typeof sendToAllStudents === 'function') {
                 sendToAllStudents({ type: 'clear_board' });
              }
          }
      }
    });

