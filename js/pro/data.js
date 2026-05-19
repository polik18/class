    // ----------------------------------------------------------------------
    // 課堂資料長久儲存 (匯出/匯入)
    // ----------------------------------------------------------------------
    window.showDataModal = () => {
        document.getElementById('data-manage-modal').classList.remove('hidden');
        lucide.createIcons(); // 確保新畫出的圖示正常載入
    };

    window.hideDataModal = () => {
        document.getElementById('data-manage-modal').classList.add('hidden');
    };

    function parseCSV(text) {
        let result = [];
        let col = "";
        let row = [];
        let inQuote = false;
        for (let i = 0; i < text.length; i++) {
            let c = text[i];
            if (inQuote) {
                if (c === '"') {
                    if (i + 1 < text.length && text[i+1] === '"') {
                        col += '"'; i++;
                    } else {
                        inQuote = false;
                    }
                } else {
                    col += c;
                }
            } else {
                if (c === '"') {
                    inQuote = true;
                } else if (c === ',') {
                    row.push(col);
                    col = "";
                } else if (c === '\n') {
                    row.push(col);
                    result.push(row);
                    row = [];
                    col = "";
                } else if (c !== '\r') {
                    col += c;
                }
            }
        }
        if (col !== "" || text[text.length - 1] === ',') {
            row.push(col);
        }
        if (row.length > 0) result.push(row);
        return result;
    }

    window.exportClassData = () => {
        const exportRoster = document.getElementById('export-roster-cb').checked;
        const exportScores = document.getElementById('export-scores-cb').checked;
        const exportIRS = document.getElementById('export-irs-cb').checked;
        
        if (!exportRoster && !exportScores && !exportIRS) {
            alert("請至少選擇一項欲匯出的資料！");
            return;
        }

        let csvContent = "\ufeff資料類型,名稱(學生/小組),數值(性別/分數),詳細(作答內容/名單),狀態\n";

        if (exportRoster) {
            const names = drawEls.nameInput.value.split(/[\n,，、]+/).map(n => n.trim()).filter(n => n);
            names.forEach(name => {
                const safeName = name.replace(/"/g, '""');
                csvContent += `名單,"${safeName}","","",""\n`;
            });
        }
        
        if (exportScores) {
            scoreState.teams.forEach(team => {
                const teamName = team.name.replace(/"/g, '""');
                // Fix: members are objects {name, score}, serialize only names
                const members = (team.members || []).map(m => (typeof m === 'object' ? m.name : m)).join(',').replace(/"/g, '""');
                csvContent += `小組,"${teamName}","${team.score}","${members}",""\n`;
            });
        }

        if (exportIRS) {
            // Export all history records (each ended question)
            irsState.history.forEach(rec => {
                const timeStr = rec.timestamp || '';
                rec.records.forEach(s => {
                    const safeName = (s.name || '').replace(/"/g, '""');
                    const safeAns = String(s.answer || '').replace(/"/g, '""');
                    csvContent += `IRS紀錄,"${safeName}","${s.gender || ''}","${safeAns}","${s.status || ''}"\n`;
                });
            });
            // Also export current active session answers if question is active / just ended
            const currentStudents = Object.values(irsState.studentsInfo);
            if (currentStudents.length > 0 && !irsState.isQuestionActive && irsState.currentQ) {
                // already snapshotted in history on stop – skip to avoid duplicates
            } else if (irsState.isQuestionActive) {
                // Export current live question state
                currentStudents.forEach(s => {
                    const safeName = s.name.replace(/"/g, '""');
                    let ans = s.answer || "";
                    if (irsState.currentQ === 'BUZZER' && s.hasAnswered) {
                        const peerId = Object.keys(irsState.studentsInfo).find(key => irsState.studentsInfo[key] === s);
                        const rank = irsState.buzzerList.indexOf(peerId) + 1;
                        ans = rank > 0 ? `第 ${rank} 位搶答` : "已答";
                    }
                    const safeAns = String(ans).replace(/"/g, '""');
                    const status = s.hasAnswered ? "已答" : "未答";
                    csvContent += `IRS紀錄,"${safeName}","${s.gender || ''}","${safeAns}","${status}"\n`;
                });
            }
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const downloadAnchorNode = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        downloadAnchorNode.setAttribute("href", url);
        downloadAnchorNode.setAttribute("download", `智慧課堂_備份與紀錄_${dateStr}.csv`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        document.body.removeChild(downloadAnchorNode);
        showGlobalToast("資料匯出成功！已下載 Excel (.csv) 檔案。", "check-circle", "text-emerald-400");
    };

    window.importClassData = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        const importRoster = document.getElementById('import-roster-cb').checked;
        const importScores = document.getElementById('import-scores-cb').checked;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const rows = parseCSV(e.target.result);
                let importedNames = [];
                let importedTeams = [];
                
                for (let i = 1; i < rows.length; i++) {
                    const cols = rows[i];
                    if (!cols || cols.length < 2) continue;
                    
                    const type = cols[0];
                    if (type === '名單') {
                        if (cols[1]) importedNames.push(cols[1]);
                    } else if (type === '小組') {
                        importedTeams.push({
                            name: cols[1] || '未命名小組',
                            score: parseInt(cols[2]) || 0,
                            // Fix: reconstruct members as objects {name, score}
                            members: cols[3] ? cols[3].split(',').map(n => n.trim()).filter(n => n && n !== '[object Object]').map(n => ({ name: n, score: 0 })) : []
                        });
                    }
                }

                let importedMsg = [];
                
                if (importRoster) {
                    if (importedNames.length > 0) {
                        const newText = importedNames.join('\n');
                        drawEls.nameInput.value = newText;
                        drawState.nameText = newText;
                        updateAvailableList();
                        importedMsg.push("學生名單");
                    } else {
                        alert("提示：上傳的檔案中不包含名單資料，已略過。");
                    }
                }
                
                if (importScores) {
                    if (importedTeams.length > 0) {
                        scoreState.teams = importedTeams;
                        renderScoreboard();
                        importedMsg.push("小組與分數");
                    } else {
                        alert("提示：上傳的檔案中不包含小組分數資料，已略過。");
                    }
                }
                
                if (importedMsg.length > 0) {
                    showGlobalToast(`匯入成功！已從 Excel 還原 ${importedMsg.join(' 和 ')}。`, "check-circle", "text-emerald-400");
                    hideDataModal();
                } else if (!importRoster && !importScores) {
                    alert("提示：您沒有勾選任何欲匯入的選項。");
                }
            } catch (err) {
                console.error("Import error:", err);
                alert("匯入失敗：Excel (CSV) 檔案格式錯誤或損毀");
            }
            event.target.value = ""; // 清空 input
        };
        reader.readAsText(file);
    };

    // 初始載入時設定一次畫布大小與解析網址參數
    window.addEventListener('load', () => {
        // 移除 FOUC 載入遮罩層
        const foucOverlay = document.getElementById('fouc-overlay');
        if (foucOverlay) {
            foucOverlay.style.transition = 'opacity 0.4s ease';
            foucOverlay.style.opacity = '0';
            setTimeout(() => { if (foucOverlay.parentNode) foucOverlay.parentNode.removeChild(foucOverlay); }, 450);
        }

        const navContainer = document.getElementById('main-nav-container');
        if (navContainer) {
            let isNavDown = false;
            let navStartX;
            let navScrollLeft;
            navContainer.addEventListener('mousedown', (e) => {
                isNavDown = true;
                navContainer.style.cursor = 'grabbing';
                navStartX = e.pageX - navContainer.offsetLeft;
                navScrollLeft = navContainer.scrollLeft;
            });
            navContainer.addEventListener('mouseleave', () => {
                isNavDown = false;
                navContainer.style.cursor = 'grab';
            });
            navContainer.addEventListener('mouseup', () => {
                isNavDown = false;
                navContainer.style.cursor = 'grab';
            });
            navContainer.addEventListener('mousemove', (e) => {
                if (!isNavDown) return;
                e.preventDefault();
                const x = e.pageX - navContainer.offsetLeft;
                navContainer.scrollLeft = navScrollLeft - (x - navStartX) * 2;
            });
            navContainer.style.cursor = 'grab';
        }

        if(appState.currentMode === 'board') resizeCanvas();

        // 偵測網址是否帶有 room 參數，供學生掃碼後自動進入即時問答
        const urlParams = new URLSearchParams(window.location.search);
        const roomParam = urlParams.get('room');
        if (roomParam) {
            // 標記此頁面以學生模式開啟，避免 switchAppMode 或 leaveIRS 誤觸老師初始化
            window._irsIsStudentMode = true;
            document.body.classList.add('is-student');
            // 設定標記，避免 Welcome Modal 被其他 load 事件觸發顯示
            localStorage.setItem('classroom_assistant_pro_seen', 'true');
            // 強制隱藏 Welcome Modal
            const welcomeModal = document.getElementById('welcome-guide-modal');
            if (welcomeModal) welcomeModal.classList.add('hidden');
            
            // 徹底隱藏頂部的老師端導覽列，提供純淨的學生登入區
            const mainHeader = document.querySelector('header');
            if (mainHeader) mainHeader.classList.add('hidden');

            // 自動切換至即時問答模組
            switchAppMode('irs');
            // 自動開啟學生登入畫面
            showIRSStudentLogin();
            // 自動填入代碼並鎖定，避免學生誤改
            irsEls.joinId.value = roomParam;
            irsEls.joinId.readOnly = true;
            irsEls.joinId.classList.add('opacity-60', 'cursor-not-allowed', 'bg-slate-800/50');
            
            // 隱藏返回與登出按鈕，避免學生切換回老師介面
            const returnBtn = document.querySelector('#irs-student-login button[onclick="leaveIRS()"]');
            if (returnBtn) returnBtn.classList.add('hidden');
            const logoutBtn = document.querySelector('#irs-student-view button[onclick="leaveIRS()"]');
            if (logoutBtn) logoutBtn.classList.add('hidden');
            
            // 延遲聚焦到姓名輸入框，提升使用者體驗
            setTimeout(() => {
                irsEls.joinName.focus();
            }, 500);
        }
    });

    window.sendToAllStudents = (data, excludePeerId = null) => {
        if (typeof irsState === 'undefined' || !irsState.connections) return;
        Object.entries(irsState.connections).forEach(([peerId, conn]) => {
           if (peerId !== excludePeerId && conn && conn.open) {
               conn.send(data);
           }
        });
    };

    // -- 聊天室功能邏輯 --
    let isChatOpen = false;
    let isChatAllowed = true;

    window.toggleTeacherChat = () => {
        isChatAllowed = !isChatAllowed;
        const btnText = document.getElementById('irs-chat-toggle-text');
        const btn = document.getElementById('irs-chat-toggle-btn');
        if (isChatAllowed) {
            btnText.textContent = '聊天室：已開啟';
            btn.className = "w-full py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-bold transition-all flex items-center justify-center gap-2 border border-emerald-500/30 shadow-sm text-sm";
        } else {
            btnText.textContent = '聊天室：已關閉';
            btn.className = "w-full py-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 font-bold transition-all flex items-center justify-center gap-2 border border-rose-500/30 shadow-sm text-sm";
        }
        sendToAllStudents({ type: 'chat_toggle', enabled: isChatAllowed });
    };

    window.toggleChatPanel = () => {
        const panel = document.getElementById('chat-panel');
        const dot = document.getElementById('chat-unread-dot');
        isChatOpen = !isChatOpen;
        if (isChatOpen) {
            panel.classList.replace('scale-0', 'scale-100');
            panel.classList.replace('opacity-0', 'opacity-100');
            panel.classList.replace('pointer-events-none', 'pointer-events-auto');
            dot.classList.add('hidden');
            setTimeout(() => document.getElementById('chat-input').focus(), 100);
        } else {
            panel.classList.replace('scale-100', 'scale-0');
            panel.classList.replace('opacity-100', 'opacity-0');
            panel.classList.replace('pointer-events-auto', 'pointer-events-none');
        }
    };

    window.appendChatMessage = (name, msg, timestamp, isMe) => {
        const chatMsgs = document.getElementById('chat-messages');
        const bubbleColor = isMe ? 'bg-indigo-600' : 'bg-slate-700';
        const align = isMe ? 'self-end' : 'self-start';

        // Build message using DOM API to prevent XSS in name/msg
        const wrapper = document.createElement('div');
        wrapper.className = `flex flex-col ${align} max-w-[85%] animate-pop-in`;

        if (!isMe) {
            const nameEl = document.createElement('div');
            nameEl.className = 'text-[10px] text-slate-400 mb-1 ml-1';
            nameEl.textContent = name; // Safe: textContent, no XSS
            wrapper.appendChild(nameEl);
        }

        const bubble = document.createElement('div');
        bubble.className = `${bubbleColor} text-white text-sm px-3 py-2 rounded-2xl shadow-sm break-words`;
        bubble.textContent = msg; // Safe: textContent, no XSS
        wrapper.appendChild(bubble);

        const tsEl = document.createElement('div');
        tsEl.className = `text-[9px] text-slate-500 mt-1 mr-1 ${align}`;
        tsEl.textContent = timestamp;
        wrapper.appendChild(tsEl);

        chatMsgs.appendChild(wrapper);
        chatMsgs.scrollTop = chatMsgs.scrollHeight;

        if (!isChatOpen && !isMe) {
            document.getElementById('chat-unread-dot').classList.remove('hidden');
            if (audioCtx.state === 'suspended') audioCtx.resume();
            playScoreSound('add');
        }
    };

    window.sendChatMessage = () => {
        const input = document.getElementById('chat-input');
        if (input.disabled) return;
        const msg = input.value.trim();
        if (!msg) return;
        
        let senderName = "老師";
        if (typeof irsState !== 'undefined' && irsState.hostConn) {
             const mName = document.getElementById('irs-my-name')?.textContent || "學生";
             // 去除(性別)後綴，只取名字
             senderName = mName.split('(')[0].trim() || "學生";
        }

        const timestamp = new Date().toLocaleTimeString('zh-TW', {hour: '2-digit', minute:'2-digit'});
        appendChatMessage(senderName, msg, timestamp, true);
        
        const payload = { type: 'chat_msg', name: senderName, msg: msg, timestamp: timestamp };
        if (typeof irsState !== 'undefined') {
            if (irsState.hostConn && irsState.hostConn.open) {
                irsState.hostConn.send(payload);
            } else if (typeof sendToAllStudents === 'function') {
                sendToAllStudents(payload);
            }
        }
        input.value = "";
    };

    window.showGlobalRoomWidget = () => {
        if (typeof irsState === 'undefined' || !irsState.roomId) return;
        const w = document.getElementById('global-room-widget');
        const d = document.getElementById('global-room-id-display');
        if(d) d.textContent = irsState.roomId;
        if(w) { w.classList.remove('hidden'); w.classList.add('flex'); }
        
        const qrContainer = document.getElementById('global-qrcode');
        if (qrContainer && typeof QRCode !== 'undefined') {
            qrContainer.innerHTML = '';
            const joinUrl = window.location.origin + window.location.pathname + '?room=' + irsState.roomId;
            new QRCode(qrContainer, {
                text: joinUrl,
                width: 96,
                height: 96,
                colorDark : "#312e81",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.L
            });
        }
    };
    
    window.hideGlobalRoomWidget = () => {
        const w = document.getElementById('global-room-widget');
        if(w) { w.classList.add('hidden'); w.classList.remove('flex'); }
    };

    window.showJoinNotification = (name, gender) => {
        const container = document.getElementById('join-toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = "bg-emerald-500/90 backdrop-blur-md text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-pop-in w-full text-sm font-bold border border-emerald-400/50 pointer-events-auto";
        let iconClass = "user";
        let displayGender = "";
        if (gender === '男') { displayGender = "(男)"; }
        else if (gender === '女') { displayGender = "(女)"; }
        toast.innerHTML = `<i data-lucide="${iconClass}" class="w-5 h-5 opacity-80 shrink-0"></i> <div class="truncate flex-1">學生 ${escapeHTML(name)}${displayGender} 已加入課堂</div>`;
        container.appendChild(toast);
        if (window.lucide) lucide.createIcons({root: toast});
        setTimeout(() => {
            toast.classList.replace('animate-pop-in', 'opacity-0');
            toast.style.transform = 'translateY(-10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => {
                if (toast.parentNode === container) container.removeChild(toast);
            }, 300);
        }, 3000);
    };

    window.showStudentListModal = () => {
        const modal = document.getElementById('irs-student-list-modal');
        const content = document.getElementById('modal-student-list-content');
        const count = document.getElementById('modal-student-count');
        if (!modal || !content || !count) return;
        const students = Object.values(irsState.studentsInfo);
        count.textContent = students.length;
        if (students.length === 0) {
            content.innerHTML = '<div class="text-slate-500 text-center w-full py-8 font-bold">目前尚無學生連線</div>';
        } else {
            content.innerHTML = students.map(s => {
                const displayName = s.gender ? `${s.name}(${s.gender})` : s.name;
                const statusClass = s.hasAnswered ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-800 border-white/10 text-slate-300';
                const peerId = Object.keys(irsState.studentsInfo).find(key => irsState.studentsInfo[key] === s);
                return `<div class="px-3 py-2 rounded-lg border ${statusClass} font-medium flex items-center justify-between gap-3 w-full sm:w-[calc(50%-0.25rem)]">
                   <div class="truncate flex-1" title="${displayName}">${escapeHTML(displayName)}</div>
                   <button onclick="requestStudentScreen('${peerId}')" class="text-xs bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-300 py-1 px-2 rounded shrink-0 flex items-center gap-1" title="觀看學生畫面"><i data-lucide="monitor" class="w-3 h-3"></i> 觀看</button>
                   ${s.hasAnswered ? '<i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-500 shrink-0"></i>' : ''}
                </div>`;
            }).join('');
        }
        if (window.lucide) lucide.createIcons({root: content});
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    };

    window.hideStudentListModal = () => {
        const modal = document.getElementById('irs-student-list-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    };

    window.requestStudentScreen = (studentId) => {
        if (irsState.connections && irsState.connections[studentId]) {
            irsState.connections[studentId].send({ type: 'teacher_request_screen' });
            showGlobalToast("已傳送觀看畫面請求給該學生", "monitor-up", "text-cyan-400");
        }
    };

