    // ----------------------------------------------------------------------
    // 模組 6: 即時問答 (IRS MODE - WebRTC via PeerJS)
    // ----------------------------------------------------------------------
    
    // 全域方法，用於開啟/關閉使用須知 Modal
    window.showIRSInfo = () => {
        const modal = document.getElementById('irs-info-modal');
        if (modal) {
            modal.classList.remove('hidden');
            lucide.createIcons({ root: modal });
        }
    };
    
    window.hideIRSInfo = () => {
        const modal = document.getElementById('irs-info-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    };

    let qrCodeInstance = null;

    // 全域方法，用於產生並顯示 QR Code
    window.showIRSQR = () => {
        if (!irsState.roomId) return;
        const modal = document.getElementById('irs-qr-modal');
        const container = document.getElementById('qrcode-container');
        document.getElementById('qr-modal-room-id').textContent = irsState.roomId;

        // 產生帶有 room 參數的網址（校內模式加上 &lan=1）
        const baseUrl = window.location.href.split('?')[0];
        const lanSuffix = window._irsNetworkMode === 'lan' ? '&lan=1' : '';
        const joinUrl = `${baseUrl}?room=${irsState.roomId}${lanSuffix}`;

        if (!qrCodeInstance) {
            qrCodeInstance = new QRCode(container, {
                text: joinUrl,
                width: 256,
                height: 256,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.M
            });
        } else {
            qrCodeInstance.clear();
            qrCodeInstance.makeCode(joinUrl);
        }

        modal.classList.remove('hidden');
    };

    window.hideIRSQR = () => {
        const modal = document.getElementById('irs-qr-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    };

    // ===== 校內 / 校外連線模式 =====
    window._irsNetworkMode = (() => {
        const p = new URLSearchParams(window.location.search);
        return p.get('lan') === '1' ? 'lan' : 'internet';
    })();

    const getIrsIceServers = () => {
        if (window._irsNetworkMode === 'lan') {
            // 校內模式：加入基本 STUN 提升相容性，師生需在同一 Wi-Fi
            // 空陣列在部分瀏覽器中可能導致 ICE 候選完全失敗
            return [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ];
        }
        // 校外模式：完整 STUN + TURN (建議最多 10 台同時連線)
        return [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
        ];
    };

    window.updateNetworkModeUI = () => {
        const btn = document.getElementById('irs-network-mode-btn');
        const desc = document.getElementById('irs-mode-desc');
        if (!btn) return;
        if (window._irsNetworkMode === 'lan') {
            btn.textContent = '校內模式';
            btn.className = 'shrink-0 px-3 py-1.5 rounded-lg text-xs font-black transition-all bg-emerald-600/40 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 whitespace-nowrap';
            if (desc) desc.textContent = '校內：師生須同 Wi-Fi，可突破 10 台連線限制';
        } else {
            btn.textContent = '校外模式';
            btn.className = 'shrink-0 px-3 py-1.5 rounded-lg text-xs font-black transition-all bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/40 whitespace-nowrap';
            if (desc) desc.textContent = '校外：支援不同 Wi-Fi 跨網域連線';
        }
    };

    window.toggleIRSNetworkMode = () => {
        const newMode = window._irsNetworkMode === 'internet' ? 'lan' : 'internet';
        const modeLabel = newMode === 'lan' ? '校內模式（師生須同 Wi-Fi）' : '校外模式（支援跨網域）';
        if (irsState.roomId) {
            if (!confirm('切換為「' + modeLabel + '」需要重新建立教室，目前所有學生將斷線。\\n\\n確定切換嗎？')) return;
            cleanupIRS();
        }
        window._irsNetworkMode = newMode;
        updateNetworkModeUI();
        setTimeout(() => initIRSTeacher(), 100);
    };

    const irsState = {
      peer: null,
      role: null, // 'teacher' | 'student'
      roomId: '',
      connections: {}, // peerId => connection (Teacher side)
      hostConn: null, // connection to host (Student side)
      studentsInfo: {}, // peerId => { name: string, gender: string, hasAnswered: boolean, answer: string }
      currentQ: null, // 'ABCD' | 'OX' | 'BUZZER' | 'VOTE' | 'TEXT' | null
      isQuestionActive: false,
      buzzerList: [], // Track buzzer order
      history: [], // Array of { questionNo, qType, qTypeName, timestamp, records: [{name, gender, answer, status}] }
      studentName: ''
    };

    // 下載作答結果 CSV (Fix 4: now exports ALL historical questions)
    window.exportIRSResults = () => {
        if (irsState.history.length === 0 && Object.keys(irsState.studentsInfo).length === 0) {
            alert("目前沒有學生連線或問答紀錄可供下載。");
            return;
        }
        if (irsState.history.length === 0) {
            alert("目前尚未結束任何一道題目，請先結束作答再下載紀錄。");
            return;
        }

        // CSV 表頭 (加上 BOM 解決 Excel 中文亂碼問題)
        let csvContent = "\ufeff";
        csvContent += "題次,題型,時間,學生姓名,性別,作答內容,狀態\n";

        irsState.history.forEach(rec => {
            rec.records.forEach(s => {
                const safeName = (s.name || '').replace(/"/g, '""');
                const safeAns = String(s.answer || '').replace(/"/g, '""');
                csvContent += `"Q${rec.questionNo} ${rec.qTypeName}","${rec.qTypeName}","${rec.timestamp}","${safeName}","${s.gender || ''}","${safeAns}","${s.status}"\n`;
            });
        });

        // 建立 Blob 並觸發下載
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const dateStr = new Date().toISOString().slice(0, 10);
        link.setAttribute("href", url);
        link.setAttribute("download", `智慧助手_IRS全部紀錄_${irsState.roomId}_${dateStr}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showGlobalToast(`已下載 ${irsState.history.length} 道題目的完整紀錄！`, "check-circle", "text-emerald-400");
    };

    const irsEls = {
      roomId: document.getElementById('irs-room-id'),
      teacherView: document.getElementById('irs-teacher-view'),
      studentLogin: document.getElementById('irs-student-login'),
      studentView: document.getElementById('irs-student-view'),
      roomIdMini: document.getElementById('irs-room-id-mini'),
      studentCount: document.getElementById('irs-student-count'),
      studentCountMini: document.getElementById('irs-student-count-mini'),
      infoPanelIcon: document.getElementById('irs-info-panel-icon'),
      infoPanelContent: document.getElementById('irs-info-panel-content'),
      chartArea: document.getElementById('irs-chart-area'),
      chartPlaceholder: document.getElementById('irs-chart-placeholder'),
      studentList: document.getElementById('irs-student-list'),
      answerStatus: document.getElementById('irs-answer-status'),
      joinId: document.getElementById('irs-join-id'),
      joinName: document.getElementById('irs-join-name'),
      joinBtn: document.getElementById('irs-join-btn'),
      loginError: document.getElementById('irs-login-error'),
      myName: document.getElementById('irs-my-name'),
      studentWaiting: document.getElementById('irs-student-waiting'),
      studentOptions: document.getElementById('irs-student-options'),
      qLauncher: document.getElementById('irs-q-launcher'),
      qPanel: document.getElementById('irs-q-panel'),
      qPanelIcon: document.getElementById('irs-q-panel-icon'),
      qActive: document.getElementById('irs-q-active'),
      activeQType: document.getElementById('irs-active-q-type'),
      textLauncherCard: document.getElementById('irs-text-launcher-card'),
      downloadBtn: document.getElementById('irs-download-btn')
    };

    // 共用：清理 IRS 狀態
    const cleanupIRS = () => {
      if (irsState.peer) {
        irsState.peer.destroy();
        irsState.peer = null;
      }
      irsState.role = null;
      irsState.roomId = '';
      irsState.connections = {};
      irsState.hostConn = null;
      irsState.studentsInfo = {};
      irsState.currentQ = null;
      irsState.buzzerList = [];
      
      // 復原老師面板 UI 狀態
      if (irsEls.qActive && !irsEls.qActive.classList.contains('hidden')) {
          irsEls.qActive.classList.add('hidden');
          irsEls.qActive.classList.remove('flex');
          irsEls.qLauncher.classList.remove('hidden');
          irsEls.qLauncher.classList.add('flex');
          if (irsEls.textLauncherCard) irsEls.textLauncherCard.classList.remove('hidden');
      }
    };

    // 共用：離開 IRS
    window.leaveIRS = () => {
      cleanupIRS();
      if(window.hideGlobalRoomWidget) window.hideGlobalRoomWidget();
      
      document.body.classList.remove('is-student');
      
      irsEls.teacherView.classList.add('hidden');
      irsEls.teacherView.classList.remove('flex');
      irsEls.studentLogin.classList.add('hidden');
      irsEls.studentLogin.classList.remove('flex');
      irsEls.studentView.classList.add('hidden');
      irsEls.studentView.classList.remove('flex');
      
      // 清除網址列上的 room 參數，避免重新整理後又自動進入學生端
      const newUrl = window.location.href.split('?')[0];
      window.history.replaceState({}, document.title, newUrl);
      
      // 若為學生掃碼進入的模式，返回後顯示學生登入畫面；否則進入老師視圖
      if (window._irsIsStudentMode) {
          showIRSStudentLogin();
      } else {
          initIRSTeacher();
      }
    };

    // ===== 老師端邏輯 =====
    
    // 生成好記的隨機代碼
    const generateRoomId = () => Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    window.initIRSTeacher = () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      irsEls.studentLogin.classList.add('hidden');
      irsEls.studentLogin.classList.remove('flex');
      irsEls.teacherView.classList.replace('hidden', 'flex');
      irsEls.roomId.textContent = "建立中...";
      irsEls.roomIdMini.textContent = "建立中...";
      
      const newRoomId = generateRoomId();
      irsState.peer = new Peer(newRoomId, {
          debug: 2,
          config: { 'iceServers': getIrsIceServers() }
      });
      
      irsState.peer.on('open', (id) => {
        irsState.roomId = id;
        irsState.role = 'teacher';
        irsEls.roomId.textContent = id;
        irsEls.roomIdMini.textContent = id;
        updateTeacherUI();
        if (typeof updateNetworkModeUI === 'function') updateNetworkModeUI();
      });

      irsState.peer.on('connection', (conn) => {
        conn.on('data', (data) => handleTeacherReceive(conn.peer, data, conn));
        conn.on('close', () => {
           delete irsState.connections[conn.peer];
           delete irsState.studentsInfo[conn.peer];
           updateTeacherUI();
        });
      });

      irsState.peer.on('call', (call) => {
          call.answer();
          call.on('stream', (remoteStream) => {
              openScreenViewModal(remoteStream, '學生投影畫面中...');
          });
      });

      irsState.peer.on('disconnected', () => {
        const statusLed = document.getElementById('peer-status-led');
        if (statusLed) { statusLed.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse'; statusLed.title = '重連中...'; }
        console.warn('PeerJS: disconnected, attempting reconnect...');
        try { if (irsState.peer && !irsState.peer.destroyed) irsState.peer.reconnect(); } catch(e) { console.error('Reconnect error:', e); }
      });

      irsState.peer.on('open', (id) => {
        const statusLed = document.getElementById('peer-status-led');
        if (statusLed) { statusLed.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'; statusLed.title = '已連線'; }
      });

      irsState.peer.on('close', () => {
        const statusLed = document.getElementById('peer-status-led');
        if (statusLed) { statusLed.className = 'w-2.5 h-2.5 rounded-full bg-rose-500'; statusLed.title = '已斷線'; }
      });

      irsState.peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        const statusLed = document.getElementById('peer-status-led');
        if (statusLed) { statusLed.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse'; statusLed.title = '連線錯誤'; }
        alert("網路連線發生錯誤，請稍後再試！");
        leaveIRS();
      });
    };

    window.copyIRSLink = () => {
       if(!irsState.roomId) return;
       
       const baseUrl = window.location.href.split('?')[0];
       const lanSuffix = window._irsNetworkMode === 'lan' ? '&lan=1' : '';
       const joinUrl = `${baseUrl}?room=${irsState.roomId}${lanSuffix}`;
       
       const showSuccessUI = () => {
          if (audioCtx.state === 'suspended') audioCtx.resume();
          playScoreSound('add');
          
          // 在 QRCode 視窗內的按鈕顯示成功提示
          const modalBtn = document.querySelector('#irs-qr-modal button i[data-lucide="link"]')?.parentNode;
          if (modalBtn) {
              const origText = modalBtn.innerHTML;
              modalBtn.innerHTML = `<i data-lucide="check" class="w-5 h-5"></i> 網址已複製！請貼上至群組`;
              modalBtn.classList.replace('bg-indigo-50/50', 'bg-emerald-100');
              modalBtn.classList.replace('text-indigo-700', 'text-emerald-700');
              lucide.createIcons();
              setTimeout(() => {
                  modalBtn.innerHTML = origText;
                  modalBtn.classList.replace('bg-emerald-100', 'bg-indigo-50/50');
                  modalBtn.classList.replace('text-emerald-700', 'text-indigo-700');
                  lucide.createIcons();
              }, 2000);
          }
          
          // 在老師控制面板內的按鈕顯示成功提示
          const panelBtn = document.querySelector('#irs-teacher-view button i[data-lucide="link"]')?.parentNode;
          if (panelBtn) {
              const origText = panelBtn.innerHTML;
              panelBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> 已複製連結`;
              panelBtn.classList.replace('bg-indigo-600', 'bg-emerald-500');
              panelBtn.classList.replace('hover:bg-indigo-500', 'hover:bg-emerald-400');
              lucide.createIcons();
              setTimeout(() => {
                  panelBtn.innerHTML = origText;
                  panelBtn.classList.replace('bg-emerald-500', 'bg-indigo-600');
                  panelBtn.classList.replace('hover:bg-emerald-400', 'hover:bg-indigo-500');
                  lucide.createIcons();
              }, 2000);
          }
       };

       // Fallback for clipboard blocking
       const fallbackCopyTextToClipboard = (text) => {
         const textArea = document.createElement("textarea");
         textArea.value = text;
         textArea.style.top = "0";
         textArea.style.left = "0";
         textArea.style.position = "fixed";
         document.body.appendChild(textArea);
         textArea.focus();
         textArea.select();
         try {
           document.execCommand('copy');
           showSuccessUI();
         } catch (err) {
           console.error('Fallback: Oops, unable to copy', err);
           alert("複製失敗，請手動選取複製網址: " + joinUrl);
         }
         document.body.removeChild(textArea);
       };

       if (navigator.clipboard && navigator.clipboard.writeText) {
         navigator.clipboard.writeText(joinUrl).then(() => {
            showSuccessUI();
         }).catch(err => {
            fallbackCopyTextToClipboard(joinUrl);
         });
       } else {
         fallbackCopyTextToClipboard(joinUrl);
       }
    };

    window.copyIRSRoomId = () => {
       if(!irsState.roomId) return;
       
       const showSuccessUI = () => {
          // 加入音效提示
          if (audioCtx.state === 'suspended') audioCtx.resume();
          playScoreSound('add');

          const idEl = irsEls.roomId;
          const idMiniEl = irsEls.roomIdMini;
          const orig = idEl.textContent;
          const origMini = idMiniEl.textContent;
          idEl.textContent = "已複製！";
          idMiniEl.textContent = "已複製！";
          idEl.classList.add('text-emerald-400');
          idMiniEl.classList.replace('text-indigo-300', 'text-emerald-400');
          setTimeout(() => {
            idEl.textContent = orig;
            idMiniEl.textContent = origMini;
            idEl.classList.remove('text-emerald-400');
            idMiniEl.classList.replace('text-emerald-400', 'text-indigo-300');
          }, 1500);
       };

       // Fallback for iframe environments where navigator.clipboard is blocked
       const fallbackCopyTextToClipboard = (text) => {
         const textArea = document.createElement("textarea");
         textArea.value = text;
         // Avoid scrolling to bottom
         textArea.style.top = "0";
         textArea.style.left = "0";
         textArea.style.position = "fixed";
         document.body.appendChild(textArea);
         textArea.focus();
         textArea.select();
         try {
           document.execCommand('copy');
           showSuccessUI();
         } catch (err) {
           console.error('Fallback: Oops, unable to copy', err);
           alert("複製失敗，請手動選取複製");
         }
         document.body.removeChild(textArea);
       };

       // Try modern API first, catch and fallback
       if (navigator.clipboard && navigator.clipboard.writeText) {
         navigator.clipboard.writeText(irsState.roomId).then(() => {
            showSuccessUI();
         }).catch(err => {
            console.warn("Clipboard API blocked, using fallback", err);
            fallbackCopyTextToClipboard(irsState.roomId);
         });
       } else {
         fallbackCopyTextToClipboard(irsState.roomId);
       }
    };




    const handleTeacherReceive = (peerId, data, conn) => {
      if (data.type === 'join') {
        irsState.connections[peerId] = conn;
        irsState.studentsInfo[peerId] = { name: data.name, gender: data.gender, hasAnswered: false, answer: null };
        updateTeacherUI();
        
        // --- 新增：浮動通知 ---
        if (typeof showJoinNotification === 'function') {
            showJoinNotification(data.name, data.gender);
        }

        // --- 新增：自動將 IRS 學生加入抽籤機的姓名名單中 (帶有性別標記) ---
        const formattedName = data.gender ? `${data.name}(${data.gender})` : data.name;
        const currentNames = drawEls.nameInput.value.split(/[\n,，、]+/).map(n => n.trim()).filter(n => n);
        if (!currentNames.includes(formattedName)) {
            currentNames.push(formattedName);
            const newText = currentNames.join('\n');
            drawEls.nameInput.value = newText;
            drawState.nameText = newText;
            
            // 如果老師當前不在抽籤動畫中，自動刷新抽籤池選項數量 (不再清除歷史紀錄)
            if (!drawState.isDrawing) {
                updateAvailableList();
            }
        }
        // ----------------------------------------

        // 告知學生當前的模式與狀態 (Handshake)
        conn.send({ type: 'sync_mode', mode: appState.currentMode });
        if (appState.currentMode === 'board') {
            conn.send({ type: 'sync_board', paths: boardState.paths, offsetX: boardState.offsetX, offsetY: boardState.offsetY });
        } else if (appState.currentMode === 'score') {
            conn.send({ type: 'sync_score', teams: scoreState.teams });
        }
        
        // 確保剛加入的學生能同步目前的聊天室狀態
        if (typeof isChatAllowed !== 'undefined') {
            conn.send({ type: 'chat_toggle', enabled: isChatAllowed });
        }

        // 如果目前有題目，補發給剛加入的學生
        if (irsState.currentQ) {
           conn.send({ type: 'question', qType: irsState.currentQ });
        }
      } else if (data.type === 'answer') {
        if (irsState.studentsInfo[peerId] && irsState.isQuestionActive) {
           if (!irsState.studentsInfo[peerId].hasAnswered) {
               irsState.studentsInfo[peerId].hasAnswered = true;
               irsState.studentsInfo[peerId].answer = data.val;
               
               // 如果是搶答模式，記錄搶答順序並發出提示音
               if (irsState.currentQ === 'BUZZER') {
                   irsState.buzzerList.push(peerId);
                   if (audioCtx.state === 'suspended') audioCtx.resume();
                   playScoreSound('add'); 
               } else if (irsState.currentQ === 'TEXT') {
                   // 文字作答送出提示音
                   if (audioCtx.state === 'suspended') audioCtx.resume();
                   playScoreSound('add'); 
               }
               updateTeacherUI();
           }
        }
      } else if (data.type === 'chat_msg') {
        appendChatMessage(data.name, data.msg, data.timestamp, false);
        if (typeof sendToAllStudents === 'function') {
            sendToAllStudents({ type: 'chat_msg', name: data.name, msg: data.msg, timestamp: data.timestamp }, peerId);
        }
      } else if (data.type === 'draw_path') {
        boardState.paths.push(data.path);
        redrawBoard();
        if (typeof sendToAllStudents === 'function') {
            sendToAllStudents({ type: 'draw_path', path: data.path }, peerId);
        }
      } else if (data.type === 'undo_path') {
        boardState.paths.pop();
        redrawBoard();
        if (typeof sendToAllStudents === 'function') {
            sendToAllStudents({ type: 'undo_path' }, peerId);
        }
      } else if (data.type === 'clear_board') {
        boardState.paths = [];
        boardState.offsetX = 0;
        boardState.offsetY = 0;
        redrawBoard();
        if (typeof sendToAllStudents === 'function') {
            sendToAllStudents({ type: 'clear_board' }, peerId);
        }
      } else if (data.type === 'request_screen_share') {
        showShareRequestModal(peerId, data.name);
      } else if (data.type === 'stop_screen_share') {
        closeScreenViewModal();
      }
    };

    const updateTeacherUI = () => {
      // 學生人數
      const totalStudents = Object.keys(irsState.studentsInfo).length;
      irsEls.studentCount.textContent = totalStudents;
      irsEls.studentCountMini.textContent = totalStudents;

      // 控制下載按鈕顯示 (有題目且有人連線時顯示)
      if (irsEls.downloadBtn) {
          if (totalStudents > 0 && irsState.currentQ) {
              irsEls.downloadBtn.classList.remove('hidden');
              irsEls.downloadBtn.classList.add('flex');
          } else {
              irsEls.downloadBtn.classList.add('hidden');
              irsEls.downloadBtn.classList.remove('flex');
          }
      }

      // 名單與作答狀態
      let answeredCount = 0;
      irsEls.studentList.innerHTML = Object.values(irsState.studentsInfo).map(student => {
        if(student.hasAnswered) answeredCount++;
        const bgClass = student.hasAnswered ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' : 'bg-slate-800 border-white/10 text-slate-400';
        const displayName = student.gender ? `${student.name}(${student.gender})` : student.name;
        return `<span class="px-3 py-1 text-sm rounded-full border ${bgClass} font-medium shadow-sm transition-colors">${renderName(displayName, false)}</span>`;
      }).join('');

      // 繪製結果圖表
      if (irsState.currentQ === 'BUZZER') {
         irsEls.answerStatus.textContent = irsState.isQuestionActive ? `搶答人數: ${answeredCount} / ${totalStudents}` : `搶答結算: ${answeredCount} / ${totalStudents}`;
         irsEls.chartPlaceholder.classList.add('hidden');
         
         if (irsState.buzzerList.length === 0) {
            irsEls.chartArea.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-slate-500 font-bold tracking-widest animate-pulse">準備中，等待學生搶答...</div>';
         } else {
            // 繪製搶答排行榜
            irsEls.chartArea.innerHTML = `<div class="w-full h-full flex flex-col gap-3 overflow-y-auto no-scrollbar p-2 items-center">` + 
                irsState.buzzerList.map((id, index) => {
                    const st = irsState.studentsInfo[id];
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<span class="text-slate-500 text-sm">${index+1}.</span>`;
                    const bgClass = index === 0 ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/10 border-amber-500/50 text-amber-300 scale-105 shadow-[0_0_15px_rgba(245,158,11,0.2)]' : 'bg-slate-800/80 border-white/10 text-slate-300';
                    const stNameWithGender = st ? (st.gender ? `${st.name}(${st.gender})` : st.name) : '';
                    const displayName = st ? renderName(stNameWithGender, false) : '未知';
                    return `<div class="flex items-center gap-4 p-3 rounded-xl border ${bgClass} transition-all w-full max-w-md">
                        <div class="text-3xl w-8 text-center drop-shadow-md">${medal}</div>
                        <div class="font-bold text-xl flex-1 tracking-wide">${displayName}</div>
                    </div>`;
                }).join('') + `</div>`;
         }
      } else if (irsState.currentQ === 'TEXT') {
         // ===== 開放式問答：動態文字雲渲染 =====
         irsEls.answerStatus.textContent = irsState.isQuestionActive ? `作答進度: ${answeredCount} / ${totalStudents}` : `作答結算: ${answeredCount} / ${totalStudents}`;
         irsEls.chartPlaceholder.classList.add('hidden');
         
         const counts = {};
         Object.values(irsState.studentsInfo).forEach(s => {
            if (s.hasAnswered && s.answer) {
               const text = String(s.answer).trim();
               if (text) counts[text] = (counts[text] || 0) + 1;
            }
         });

         if (Object.keys(counts).length === 0) {
            irsEls.chartArea.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-slate-500 font-bold tracking-widest animate-pulse">等待學生送出文字...</div>';
         } else {
            let maxFreq = Math.max(...Object.values(counts), 1);
            
            // 將結果依照頻率排序，讓高頻率的文字更容易被看到
            const sortedEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

            let wordsHTML = sortedEntries.map(([text, freq], index) => {
               // 計算加權倍率 (文字大小：介於 1rem ~ 3.5rem)
               const scaleRatio = maxFreq > 1 ? (freq - 1) / (maxFreq - 1) : 0; 
               const fontSize = 1 + (scaleRatio * 2.5); 
               
               const colors = [
                  'from-fuchsia-500/30 to-purple-600/30 border-fuchsia-400/50 text-fuchsia-100 shadow-[0_0_15px_rgba(217,70,239,0.3)]',
                  'from-cyan-500/30 to-blue-600/30 border-cyan-400/50 text-cyan-100 shadow-[0_0_15px_rgba(6,182,212,0.3)]',
                  'from-emerald-500/30 to-teal-600/30 border-emerald-400/50 text-emerald-100 shadow-[0_0_15px_rgba(16,185,129,0.3)]',
                  'from-amber-500/30 to-orange-600/30 border-amber-400/50 text-amber-100 shadow-[0_0_15px_rgba(245,158,11,0.3)]',
                  'from-rose-500/30 to-pink-600/30 border-rose-400/50 text-rose-100 shadow-[0_0_15px_rgba(225,29,72,0.3)]'
               ];
               const bgClass = colors[index % colors.length];
               const delay = Math.random() * 0.3; // 隨機進場延遲
               const floatDur = 3 + Math.random() * 3; // 隨機漂浮速度 (3~6秒)

               return `
                  <div class="animate-pop-in inline-block m-2" style="animation-delay: ${delay}s">
                      <div class="px-5 py-3 rounded-3xl bg-gradient-to-br ${bgClass} backdrop-blur-sm border relative group transition-transform duration-500 ease-out hover:scale-110 flex items-center justify-center" 
                           style="font-size: ${fontSize}rem; animation: float ${floatDur}s ease-in-out infinite alternate;">
                          <span class="font-black tracking-wide drop-shadow-md break-all leading-tight max-w-sm text-center">${escapeHTML(text)}</span>
                          ${freq > 1 ? `<div class="absolute -top-3 -right-3 bg-white text-slate-900 text-sm font-black w-8 h-8 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.8)] border-2 border-slate-900 z-10 animate-bounce-soft">x${freq}</div>` : ''}
                      </div>
                  </div>
               `;
            }).join('');
            
            irsEls.chartArea.innerHTML = `<div class="w-full h-full flex flex-wrap content-start justify-center overflow-y-auto no-scrollbar p-2 gap-2 relative z-10">` + wordsHTML + `</div>`;
         }
      } else if (irsState.currentQ) {
         irsEls.answerStatus.textContent = irsState.isQuestionActive ? `作答進度: ${answeredCount} / ${totalStudents}` : `作答結算: ${answeredCount} / ${totalStudents}`;
         irsEls.chartPlaceholder.classList.add('hidden');
         
         let opts = [];
         if (irsState.currentQ === 'ABCD') opts = ['A', 'B', 'C', 'D'];
         else if (irsState.currentQ === 'OX') opts = ['O', 'X'];
         else if (irsState.currentQ === 'VOTE') opts = ['贊成', '反對', '棄權'];

         const counts = {};
         opts.forEach(o => counts[o] = 0);
         
         Object.values(irsState.studentsInfo).forEach(s => {
            if (s.hasAnswered && counts[s.answer] !== undefined) counts[s.answer]++;
         });

         const maxCount = Math.max(...Object.values(counts), 1); // 避免除以0
         
         const colors = {
            'A': 'from-indigo-500 to-purple-500', 'B': 'from-emerald-500 to-teal-500',
            'C': 'from-amber-500 to-orange-500', 'D': 'from-rose-500 to-pink-500',
            'O': 'from-emerald-500 to-teal-500', 'X': 'from-rose-500 to-pink-500',
            '贊成': 'from-emerald-500 to-teal-500', '反對': 'from-rose-500 to-pink-500', '棄權': 'from-slate-500 to-slate-700'
         };

         irsEls.chartArea.innerHTML = opts.map(opt => {
            const hPercent = (counts[opt] / maxCount) * 100;
            // 動態調整文字大小以適應中文字
            const textClass = opt.length > 1 ? 'text-lg' : 'text-xl';
            return `
              <div class="flex flex-col items-center flex-1 h-full justify-end gap-2 group">
                 <span class="text-sm font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity absolute -mt-6 z-10 bg-slate-800 px-2 py-1 rounded shadow">${counts[opt]}人</span>
                 <div class="w-full max-w-[4rem] rounded-t-xl bg-gradient-to-t ${colors[opt]} transition-all duration-500 min-h-[4px] relative shadow-[0_0_15px_rgba(255,255,255,0.1)]" style="height: ${hPercent}%">
                    <div class="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity rounded-t-xl"></div>
                 </div>
                 <span class="font-black ${textClass} text-slate-300 whitespace-nowrap">${opt}</span>
              </div>
            `;
         }).join('');
      } else {
         irsEls.answerStatus.textContent = `等待發佈題目...`;
         irsEls.chartPlaceholder.classList.remove('hidden');
         irsEls.chartArea.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-slate-600 font-bold tracking-widest pointer-events-none" id="irs-chart-placeholder">暫無數據</div>';
      }
    };

    window.toggleIRSInfoPanel = () => {
        const panel = irsEls.infoPanelContent;
        const icon = irsEls.infoPanelIcon;
        if (panel.classList.contains('hidden')) {
            panel.classList.remove('hidden');
            icon.classList.add('rotate-180');
            if (window.showGlobalRoomWidget) window.showGlobalRoomWidget();
        } else {
            panel.classList.add('hidden');
            icon.classList.remove('rotate-180');
        }
    };

    window.toggleIRSQuestionPanel = () => {
        const panel = irsEls.qPanel;
        const icon = irsEls.qPanelIcon;
        if (panel.classList.contains('hidden')) {
            panel.classList.remove('hidden');
            panel.classList.add('flex');
            icon.classList.add('rotate-180');
        } else {
            panel.classList.add('hidden');
            panel.classList.remove('flex');
            icon.classList.remove('rotate-180');
        }
    };

    window.sendIRSQuestion = (type) => {
      irsState.currentQ = type;
      irsState.isQuestionActive = true;
      irsState.buzzerList = []; // 發佈新題目時清空搶答榜單
      // 重置所有學生作答狀態
      Object.keys(irsState.studentsInfo).forEach(k => {
         irsState.studentsInfo[k].hasAnswered = false;
         irsState.studentsInfo[k].answer = null;
      });
      // 廣播給所有連線
      Object.values(irsState.connections).forEach(conn => {
         conn.send({ type: 'question', qType: type });
      });
      
      // 更新老師控制面板 UI (切換至進行中狀態)
      if (irsEls.qLauncher) {
          irsEls.qLauncher.classList.add('hidden');
          irsEls.qLauncher.classList.remove('flex');
          irsEls.qPanel.classList.add('hidden');
          irsEls.qPanel.classList.remove('flex');
          irsEls.qPanelIcon.classList.remove('rotate-180');
          if (irsEls.textLauncherCard) irsEls.textLauncherCard.classList.add('hidden');
          
          irsEls.qActive.classList.remove('hidden');
          irsEls.qActive.classList.add('flex');
          
          const typeNames = {
              'ABCD': '單選 (A, B, C, D)',
              'OX': '是非 (O, X)',
              'VOTE': '投票表決',
              'BUZZER': '搶答模式',
              'TEXT': '開放式問答 (文字輸入)'
          };
          irsEls.activeQType.textContent = typeNames[type] || '進行中';
      }

      updateTeacherUI();
    };

    window.stopIRSQuestion = () => {
      // Fix 4: Snapshot current question's answers into history BEFORE resetting
      if (irsState.currentQ && irsState.isQuestionActive) {
          const qNum = irsState.history.length + 1;
          const typeNames = {
              'ABCD': '單選(ABCD)', 'OX': '是非(OX)', 'VOTE': '投票', 'BUZZER': '搶答', 'TEXT': '開放問答'
          };
          const snapshot = {
              questionNo: qNum,
              qType: irsState.currentQ,
              qTypeName: typeNames[irsState.currentQ] || irsState.currentQ,
              timestamp: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
              records: Object.entries(irsState.studentsInfo).map(([peerId, s]) => {
                  let ans = s.answer || '';
                  if (irsState.currentQ === 'BUZZER' && s.hasAnswered) {
                      const rank = irsState.buzzerList.indexOf(peerId) + 1;
                      ans = rank > 0 ? `第 ${rank} 位搶答` : '已答';
                  }
                  return { name: s.name, gender: s.gender || '', answer: ans, status: s.hasAnswered ? '已答' : '未答' };
              })
          };
          irsState.history.push(snapshot);
      }

      irsState.isQuestionActive = false;
      Object.values(irsState.connections).forEach(conn => {
         conn.send({ type: 'stop' });
      });
      
      // 更新老師控制面板 UI (恢復至待命狀態)
      if (irsEls.qActive) {
          irsEls.qActive.classList.add('hidden');
          irsEls.qActive.classList.remove('flex');
          
          irsEls.qLauncher.classList.remove('hidden');
          irsEls.qLauncher.classList.add('flex');
          if (irsEls.textLauncherCard) irsEls.textLauncherCard.classList.remove('hidden');
      }

      updateTeacherUI();
    };

    // ===== 學生端邏輯 =====
    
    window.showIRSStudentLogin = () => {
      irsEls.teacherView.classList.add('hidden');
      irsEls.teacherView.classList.remove('flex');
      irsEls.studentLogin.classList.replace('hidden', 'flex');
      irsEls.loginError.classList.add('hidden');
      // 確保欄位為可編輯狀態 (若之前透過網址加入被鎖定)
      irsEls.joinId.readOnly = false;
      irsEls.joinId.classList.remove('opacity-60', 'cursor-not-allowed', 'bg-slate-800/50');
    };

    window.joinIRS = () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const joinId = irsEls.joinId.value.trim().toUpperCase();
      const joinName = irsEls.joinName.value.trim();
      const joinGender = document.querySelector('input[name="irs-gender"]:checked')?.value || "";
      
      if (!joinId || !joinName) {
         irsEls.loginError.textContent = "請輸入代碼與名稱！";
         irsEls.loginError.classList.remove('hidden');
         return;
      }

      irsEls.joinBtn.innerHTML = '<div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-[spin_1s_linear_infinite]"></div>';
      irsEls.joinBtn.disabled = true;

      irsState.studentName = joinName;
      const studentId = 'irs_' + Math.random().toString(36).substring(2, 10);
      irsState.peer = new Peer(studentId, {
          config: { 'iceServers': getIrsIceServers() }
      });

      irsState.peer.on('call', (call) => {
          call.answer();
          call.on('stream', (remoteStream) => {
              openScreenViewModal(remoteStream, '老師畫面廣播中...');
          });
      });

      // Fix 2a: 儲存老師的 Peer ID，以便學生端 peer.call() 時使用
      irsState.hostId = joinId;

      irsState.peer.on('open', () => {
         const conn = irsState.peer.connect(joinId, { reliable: true });
         
         // 設定連線逾時機制 (10秒)
         const connTimeout = setTimeout(() => {
             if (irsEls.joinBtn.disabled) {
                 irsState.peer.destroy();
                 irsEls.loginError.textContent = "連線逾時！此台電腦可能遭受防火牆阻擋，或瀏覽器禁用了WebRTC(防追蹤/擋廣告外掛)。請嘗試更換瀏覽器或網路。";
                 irsEls.loginError.classList.remove('hidden');
                 irsEls.joinBtn.innerHTML = '連線加入';
                 irsEls.joinBtn.disabled = false;
             }
         }, 10000);

         conn.on('open', () => {
            clearTimeout(connTimeout);
            irsState.hostConn = conn;
            conn.send({ type: 'join', name: joinName, gender: joinGender });
            
            // 只有在學生模式且進入別人教室的時候才鎖住教師功能
            document.body.classList.add('is-student');
            // 學生模式下不應顯示抽籤機，若目前在抽籤機頁面則切換到時間管理
            if (appState.currentMode === 'draw') switchAppMode('clock');
            
            // UI 切換
            irsEls.studentLogin.classList.add('hidden');
            irsEls.studentView.classList.replace('hidden', 'flex');
            // 學生端顯示姓名加上性別圖示
            const joinedNameWithGender = joinGender ? `${joinName}(${joinGender})` : joinName;
            irsEls.myName.innerHTML = renderName(joinedNameWithGender, false);
            
            // 恢復按鈕
            irsEls.joinBtn.innerHTML = '連線加入';
            irsEls.joinBtn.disabled = false;
         });

         conn.on('data', handleStudentReceive);

         conn.on('close', () => {
            alert("老師已結束課堂或連線中斷。");
            leaveIRS();
         });

         irsState.peer.on('error', (err) => {
            clearTimeout(connTimeout);
            console.error("PeerJS Error:", err);
            let errMsg = "連線發生未知的錯誤！";
            if (err.type === 'peer-unavailable') {
                errMsg = "連線失敗，請確認代碼是否正確或老師是否已開房！";
            } else if (err.type === 'webrtc') {
                errMsg = "WebRTC 建立失敗。請確認防火牆未阻擋，或更換 Chrome/Edge 瀏覽器。";
            } else if (err.type === 'network') {
                errMsg = "網路連線中斷，無法連接至訊號伺服器。";
            }
            irsEls.loginError.textContent = errMsg;
            irsEls.loginError.classList.remove('hidden');
            irsEls.joinBtn.innerHTML = '連線加入';
            irsEls.joinBtn.disabled = false;
         });
      });
    };

    // 專門處理文字送出的函式
    window.submitIRSTextAnswer = () => {
        const inputEl = document.getElementById('irs-text-input');
        if (!inputEl) return;
        const val = inputEl.value.trim();
        if (!val) {
            alert("請先輸入文字再送出喔！");
            return;
        }
        submitIRSAnswer(val);
    };

    const handleStudentReceive = (data) => {
       if (data.type === 'sync_mode') {
          if (data.mode !== appState.currentMode) {
             switchAppMode(data.mode);
          }
       } else if (data.type === 'sync_board') {
          boardState.paths = data.paths || [];
          if (data.offsetX !== undefined) boardState.offsetX = data.offsetX;
          if (data.offsetY !== undefined) boardState.offsetY = data.offsetY;
          redrawBoard();
       } else if (data.type === 'sync_board_pan') {
          boardState.offsetX = data.offsetX;
          boardState.offsetY = data.offsetY;
          redrawBoard();
       } else if (data.type === 'sync_score') {
          let structureChanged = false;
          if (scoreState.teams.length !== data.teams.length) {
              structureChanged = true;
          } else {
              for (let i = 0; i < scoreState.teams.length; i++) {
                  const localTeam = scoreState.teams[i];
                  const remoteTeam = data.teams[i];
                  if (localTeam.id !== remoteTeam.id || localTeam.name !== remoteTeam.name || (localTeam.members && remoteTeam.members && localTeam.members.length !== remoteTeam.members.length)) {
                      structureChanged = true;
                      break;
                  }
                  
                  if (localTeam.score !== remoteTeam.score) {
                      const diff = remoteTeam.score - localTeam.score;
                      const type = diff > 0 ? 'add' : 'sub';
                      updateTeamScoreUI(localTeam.id, remoteTeam.score, type, diff);
                  }
                  
                  if (localTeam.members && remoteTeam.members) {
                      for (let j = 0; j < localTeam.members.length; j++) {
                          if (localTeam.members[j].name !== remoteTeam.members[j].name) {
                              structureChanged = true;
                              break;
                          }
                          if (localTeam.members[j].score !== remoteTeam.members[j].score) {
                              const mDiff = remoteTeam.members[j].score - localTeam.members[j].score;
                              const mType = mDiff > 0 ? 'add' : 'sub';
                              updateMemberScoreUI(localTeam.id, j, remoteTeam.members[j].score, mType, mDiff);
                          }
                      }
                  }
              }
          }
          
          scoreState.teams = data.teams;
          if (structureChanged) {
              renderScoreboard();
          }
       } else if (data.type === 'draw_path') {
          boardState.paths.push(data.path);
          redrawBoard();
       } else if (data.type === 'undo_path') {
          boardState.paths.pop();
          redrawBoard();
       } else if (data.type === 'clear_board') {
          boardState.paths = [];
          boardState.offsetX = 0;
          boardState.offsetY = 0;
          redrawBoard();
       } else if (data.type === 'chat_toggle') {
          const chatInput = document.getElementById('chat-input');
          if (data.enabled) {
              chatInput.disabled = false;
              chatInput.placeholder = "輸入訊息...";
              appendChatMessage("系統", "老師已開啟聊天室", new Date().toLocaleTimeString('zh-TW', { hour12: false }), false);
          } else {
              chatInput.disabled = true;
              chatInput.placeholder = "老師已關閉聊天室";
              appendChatMessage("系統", "老師已關閉聊天室", new Date().toLocaleTimeString('zh-TW', { hour12: false }), false);
          }
       } else if (data.type === 'chat_msg') {
          appendChatMessage(data.name, data.msg, data.timestamp, false);
       } else if (data.type === 'question') {
          if (audioCtx.state === 'suspended') audioCtx.resume();
          playScoreSound('add'); // 提示音
          
          irsEls.studentWaiting.classList.add('hidden');
          irsEls.studentOptions.classList.remove('hidden');
          
          let optsHTML = '';
          if (data.qType === 'ABCD') {
             optsHTML = `
               <button onclick="submitIRSAnswer('A')" class="py-8 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 hover:opacity-80 active:scale-95 text-white font-black text-4xl shadow-lg transition-all border border-white/20">A</button>
               <button onclick="submitIRSAnswer('B')" class="py-8 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 hover:opacity-80 active:scale-95 text-white font-black text-4xl shadow-lg transition-all border border-white/20">B</button>
               <button onclick="submitIRSAnswer('C')" class="py-8 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 hover:opacity-80 active:scale-95 text-white font-black text-4xl shadow-lg transition-all border border-white/20">C</button>
               <button onclick="submitIRSAnswer('D')" class="py-8 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 hover:opacity-80 active:scale-95 text-white font-black text-4xl shadow-lg transition-all border border-white/20">D</button>
             `;
          } else if (data.qType === 'OX') {
             optsHTML = `
               <button onclick="submitIRSAnswer('O')" class="py-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 hover:opacity-80 active:scale-95 text-white font-black text-6xl shadow-lg transition-all border border-white/20">O</button>
               <button onclick="submitIRSAnswer('X')" class="py-12 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 hover:opacity-80 active:scale-95 text-white font-black text-6xl shadow-lg transition-all border border-white/20">X</button>
             `;
          } else if (data.qType === 'VOTE') {
             optsHTML = `
               <button onclick="submitIRSAnswer('贊成')" class="py-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 hover:opacity-80 active:scale-95 text-white font-black text-3xl shadow-lg transition-all border border-white/20">贊成</button>
               <button onclick="submitIRSAnswer('反對')" class="py-10 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 hover:opacity-80 active:scale-95 text-white font-black text-3xl shadow-lg transition-all border border-white/20">反對</button>
               <button onclick="submitIRSAnswer('棄權')" class="col-span-2 py-6 rounded-2xl bg-gradient-to-br from-slate-600 to-slate-800 hover:opacity-80 active:scale-95 text-white font-black text-2xl shadow-lg transition-all border border-white/20 tracking-widest">棄權</button>
             `;
          } else if (data.qType === 'BUZZER') {
             // 強化後的搶答按鈕介面，加上全螢幕紅色閃爍警報與巨型立體按鈕
             optsHTML = `
               <div class="absolute inset-0 bg-rose-600/10 animate-[pulse_1s_infinite] pointer-events-none rounded-[2rem] z-0"></div>
               <div class="flex flex-col items-center justify-center w-full h-full gap-8 relative z-10">
                   <div class="text-rose-400 font-black text-3xl md:text-4xl tracking-widest flex items-center gap-3 drop-shadow-[0_0_15px_rgba(225,29,72,0.8)] bg-slate-900/50 px-6 py-2 rounded-full border border-rose-500/30">
                     <i data-lucide="zap" class="w-8 h-8 animate-bounce"></i> 準備搶答 <i data-lucide="zap" class="w-8 h-8 animate-bounce"></i>
                   </div>
                   <button onclick="submitIRSAnswer('BUZZ')" class="w-[75vw] max-w-[280px] aspect-square rounded-full bg-gradient-to-b from-rose-500 to-red-700 hover:from-rose-400 hover:to-red-600 active:scale-90 text-white shadow-[0_0_80px_rgba(225,29,72,0.8)] transition-all border-[10px] border-rose-300/50 flex flex-col items-center justify-center gap-2 group">
                      <i data-lucide="bell-ring" class="w-20 h-20 md:w-24 md:h-24 group-hover:animate-ping-slow drop-shadow-lg"></i>
                      <span class="font-black text-5xl md:text-6xl tracking-widest drop-shadow-lg">按！</span>
                   </button>
               </div>
             `;
          } else if (data.qType === 'TEXT') {
             optsHTML = `
               <div class="col-span-2 flex flex-col gap-4 w-full h-full justify-center relative z-10">
                   <textarea id="irs-text-input" rows="4" class="w-full bg-slate-900 border border-fuchsia-500/30 rounded-2xl p-4 text-xl text-white focus:outline-none focus:border-fuchsia-500 transition-colors shadow-inner resize-none placeholder-slate-500" placeholder="請自由輸入你的答案..."></textarea>
                   <button onclick="submitIRSTextAnswer()" class="w-full py-5 rounded-2xl bg-gradient-to-br from-fuchsia-600 to-purple-600 hover:opacity-90 active:scale-95 text-white font-black text-2xl shadow-[0_0_30px_rgba(192,38,211,0.3)] transition-all border border-white/20 flex items-center justify-center gap-2">
                      <i data-lucide="send" class="w-6 h-6"></i> 送出答案
                   </button>
               </div>
             `;
          }
          
          // 若是搶答或開放問答，移除 grid 設定讓按鈕能完美置中並佔滿區域
          if (data.qType === 'BUZZER' || data.qType === 'TEXT') {
             irsEls.studentOptions.classList.remove('grid', 'grid-cols-2');
             irsEls.studentOptions.classList.add('flex', 'flex-col');
          } else {
             irsEls.studentOptions.classList.add('grid', 'grid-cols-2');
             irsEls.studentOptions.classList.remove('flex', 'flex-col');
          }

          irsEls.studentOptions.innerHTML = optsHTML;
          lucide.createIcons({ root: irsEls.studentOptions });
       } else if (data.type === 'stop') {
          irsEls.studentWaiting.classList.remove('hidden');
          irsEls.studentOptions.classList.add('hidden');
          irsEls.studentWaiting.innerHTML = '<i data-lucide="check-circle" class="w-16 h-16 text-emerald-400 mx-auto"></i><p class="text-xl font-bold text-slate-300">本題已結束作答</p>';
          lucide.createIcons();
       } else if (data.type === 'approve_screen_share') {
          startStudentCasting();
       } else if (data.type === 'deny_screen_share') {
          alert('老師拒絕了您的投影申請。');
       } else if (data.type === 'stop_screen_share') {
          closeScreenViewModal();
       } else if (data.type === 'teacher_request_screen') {
          startStudentCasting();
       }
    };

    window.submitIRSAnswer = (val) => {
       if (irsState.hostConn) {
          irsState.hostConn.send({ type: 'answer', val: val });
          
          // 畫面上替換為已送出
          irsEls.studentOptions.classList.add('hidden');
          irsEls.studentWaiting.classList.remove('hidden');
          
          if (val === 'BUZZ') {
             irsEls.studentWaiting.innerHTML = `<div class="p-6 rounded-full bg-rose-500/20 inline-block mb-4 border border-rose-500/30"><i data-lucide="bell-ring" class="w-12 h-12 text-rose-400 animate-pulse mx-auto"></i></div><p class="text-xl font-bold text-slate-300">已送出搶答！<br>請看前方名次...</p>`;
          } else {
             // 防止文字過長破版 (先截斷再轉義，避免切斷 HTML Entity 導致亂碼)
             const rawVal = String(val);
             const rawDisplay = rawVal.length > 10 ? rawVal.substring(0, 10) + '...' : rawVal;
             const displayStr = escapeHTML(rawDisplay);
             const textSize = rawVal.length > 4 ? 'text-2xl' : 'text-4xl';
             
             irsEls.studentWaiting.innerHTML = `<div class="px-6 py-4 rounded-3xl bg-emerald-500/20 inline-block mb-4 font-black text-emerald-400 max-w-[90%] border border-emerald-500/30 shadow-inner"><span class="${textSize} break-all">${displayStr}</span></div><p class="text-xl font-bold text-slate-300">已送出答案！<br>等待老師公佈結果...</p>`;
          }
          
          lucide.createIcons();
       }
    };


    // ==========================================
    // Screen Sharing Logic (WebRTC Media)
    // ==========================================
    let localScreenStream = null;
    let isBroadcasting = false;

    // 老師：廣播螢幕給全班
    window.toggleTeacherBroadcast = async () => {
        if (isBroadcasting) {
            window.stopTeacherBroadcast();
            return;
        }

        try {
            localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            isBroadcasting = true;

            const btn = document.getElementById('teacher-broadcast-btn');
            const icon = document.getElementById('broadcast-icon');
            const text = document.getElementById('broadcast-text');
            if(btn) {
                btn.classList.replace('bg-emerald-600/20', 'bg-rose-600/20');
                btn.classList.replace('hover:bg-emerald-600', 'hover:bg-rose-600');
                btn.classList.replace('border-emerald-500/30', 'border-rose-500/30');
                btn.classList.replace('text-emerald-300', 'text-rose-300');
            }
            if(text) text.textContent = '停止廣播';
            if(icon) icon.setAttribute('data-lucide', 'monitor-x');
            lucide.createIcons();

            localScreenStream.getVideoTracks()[0].addEventListener('ended', () => {
                window.stopTeacherBroadcast();
            });

            // 播打給目前所有連線的學生
            Object.keys(irsState.connections).forEach(peerId => {
                if(irsState.peer) irsState.peer.call(peerId, localScreenStream);
            });
            
            showGlobalToast("正在廣播螢幕畫面給全班", "monitor-up", "text-emerald-400");
        } catch (err) {
            console.error("Error sharing screen:", err);
            // 用戶取消或無權限
        }
    };

    window.stopTeacherBroadcast = () => {
        if (localScreenStream) {
            localScreenStream.getTracks().forEach(t => t.stop());
            localScreenStream = null;
        }
        isBroadcasting = false;

        const btn = document.getElementById('teacher-broadcast-btn');
        const icon = document.getElementById('broadcast-icon');
        const text = document.getElementById('broadcast-text');
        if(btn) {
            btn.classList.replace('bg-rose-600/20', 'bg-emerald-600/20');
            btn.classList.replace('hover:bg-rose-600', 'hover:bg-emerald-600');
            btn.classList.replace('border-rose-500/30', 'border-emerald-500/30');
            btn.classList.replace('text-rose-300', 'text-emerald-300');
        }
        if(text) text.textContent = '廣播螢幕';
        if(icon) icon.setAttribute('data-lucide', 'monitor-up');
        lucide.createIcons();

        // 通知學生停止顯示
        Object.values(irsState.connections).forEach(conn => {
            conn.send({ type: 'stop_screen_share' });
        });
    };

    // 學生：申請投影畫面給老師 (Fix 2c: 直接開始投影，不需老師同意的中間步驟)
    window.requestCastToTeacher = () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            alert("您的裝置或瀏覽器不支援螢幕畫面分享功能。\n\n造成原因：大多數手機、平板或非 Chrome/Edge 瀏覽器不支持此 API。\n請改用電腦，並以 Chrome 或 Edge 瀏覽器開啟。");
            return;
        }
        // 直接開始投影，同時通知老師
        if(irsState.hostConn) {
            irsState.hostConn.send({ type: 'request_screen_share', name: irsEls.myName?.textContent || '學生' });
        }
        startStudentCasting();
    };

    let studentCastStream = null;
    window.startStudentCasting = async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            showGlobalToast("您的裝置或瀏覽器不支援螢幕畫面分享 (多數手機不支援)", "monitor-x", "text-rose-400");
            return;
        }
        try {
            studentCastStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            if(irsState.peer && irsState.hostId) {
                irsState.peer.call(irsState.hostId, studentCastStream);
            }
            showGlobalToast("您正在投影畫面給老師", "monitor-up", "text-emerald-400");
            
            studentCastStream.getVideoTracks()[0].addEventListener('ended', () => {
                if(irsState.hostConn) irsState.hostConn.send({ type: 'stop_screen_share' });
                studentCastStream = null;
            });
        } catch (err) {
            console.error("Error casting screen:", err);
            if(irsState.hostConn) irsState.hostConn.send({ type: 'stop_screen_share' });
        }
    };

    // 關閉檢視視窗
    window.closeScreenViewModal = () => {
        const modal = document.getElementById('screen-view-modal');
        const video = document.getElementById('screen-view-video');
        if(modal) modal.classList.add('hidden');
        if(video && video.srcObject) {
            // 如果這不是自己的 localScreenStream，則關閉串流 (適用於老師收學生的串流)
            if (video.srcObject !== localScreenStream && video.srcObject !== studentCastStream) {
                video.srcObject.getTracks().forEach(t => t.stop());
            }
            video.srcObject = null;
        }
        
        // 推播停止事件
        if(!window._irsIsStudentMode) {
            Object.values(irsState.connections).forEach(conn => {
                conn.send({ type: 'stop_screen_share' });
            });
        } else if (irsState.hostConn && studentCastStream) {
            studentCastStream.getTracks().forEach(t => t.stop());
            studentCastStream = null;
            irsState.hostConn.send({ type: 'stop_screen_share' });
        }
    };

    // 開啟畫面播放
    window.openScreenViewModal = (stream, titleText) => {
        const modal = document.getElementById('screen-view-modal');
        const video = document.getElementById('screen-view-video');
        const title = document.getElementById('screen-view-title');
        if(modal && video && title) {
            title.textContent = titleText;
            video.srcObject = stream;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    };

    window.showShareRequestModal = (studentId, studentName) => {
        const modal = document.getElementById('share-request-modal');
        const nameEl = document.getElementById('share-request-name');
        const confirmBtn = document.getElementById('share-request-confirm');
        const denyBtn = document.getElementById('share-request-deny');
        
        if(modal && nameEl) {
            nameEl.textContent = studentName;
            
            confirmBtn.onclick = () => {
                modal.classList.add('hidden');
                if(irsState.connections[studentId]) {
                    irsState.connections[studentId].send({ type: 'approve_screen_share' });
                }
            };
            
            denyBtn.onclick = () => {
                modal.classList.add('hidden');
                if(irsState.connections[studentId]) {
                    irsState.connections[studentId].send({ type: 'deny_screen_share' });
                }
            };
            
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    };

    // ===========================================================================
    // ✨ 四：學生登入頁 QR Code 切換功能
    // ===========================================================================
    let _studentQRGenerated = false;
    window.toggleStudentQRSection = () => {
        const section = document.getElementById('student-qr-section');
        const chevron = document.getElementById('student-qr-chevron');
        if (!section) return;
        const isHidden = section.classList.contains('hidden');
        section.classList.toggle('hidden', !isHidden);
        if (chevron) chevron.style.transform = isHidden ? 'rotate(180deg)' : '';
        // 初次展開時生成 QR Code
        if (isHidden && !_studentQRGenerated && typeof QRCode !== 'undefined') {
            const container = document.getElementById('student-join-qrcode');
            if (container) {
                container.innerHTML = '';
                new QRCode(container, {
                    text: window.location.href.split('?')[0],
                    width: 160, height: 160,
                    colorDark: '#000000', colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
                _studentQRGenerated = true;
            }
        }
    };

