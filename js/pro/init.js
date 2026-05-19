    // ===========================================================================
    // ✨ 六：抽籤得獎者加分至計分板
    // ===========================================================================
    window.addScoreToWinnerPrompt = (winnerName) => {
        if (!scoreState || !scoreState.teams || scoreState.teams.length === 0) {
            alert('計分板目前沒有組別，請先在「計分板」建立組別後再使用此功能。');
            return;
        }
        const existing = document.getElementById('winner-score-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'winner-score-modal';
        modal.className = 'fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4';
        modal.innerHTML = `
          <div class="bg-slate-900 border border-amber-500/30 rounded-3xl shadow-2xl w-full max-w-sm animate-pop-in overflow-hidden">
            <div class="p-5 border-b border-white/10 flex justify-between items-center bg-gradient-to-r from-amber-900/30 to-slate-800/60">
              <h3 class="font-bold text-amber-400 flex items-center gap-2 text-lg">
                <i data-lucide="award" class="w-5 h-5"></i> 加分至計分板
              </h3>
              <button onclick="document.getElementById('winner-score-modal').remove()" class="text-slate-400 hover:text-rose-400 transition-colors p-1">
                <i data-lucide="x" class="w-5 h-5"></i>
              </button>
            </div>
            <div class="p-5 space-y-2">
              <p class="text-sm text-slate-400 mb-3">替 <strong class="text-amber-300">${escapeHTML(winnerName)}</strong> 選擇加分的組別：</p>
              ${scoreState.teams.map(t => `
                <button onclick="doAddScoreToTeam(${t.id}, '${escapeHTML(t.name)}')"
                  class="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-amber-500/20 text-white hover:text-amber-300 font-bold transition-all flex items-center justify-between border border-white/10 hover:border-amber-500/40 active:scale-95 text-left">
                  <span>${escapeHTML(t.name)}</span>
                  <span class="text-xs text-slate-400 bg-slate-700 px-2 py-0.5 rounded-full">${t.score} 分</span>
                </button>
              `).join('')}
            </div>
          </div>`;
        document.body.appendChild(modal);
        if (window.lucide) lucide.createIcons({ root: modal });
    };

    window.doAddScoreToTeam = (teamId, teamName) => {
        const modal = document.getElementById('winner-score-modal');
        if (modal) modal.remove();
        const team = scoreState.teams.find(t => t.id === teamId);
        if (!team) return;
        team.score += 1;
        renderScoreboard();
        if (typeof sendToAllStudents === 'function') {
            sendToAllStudents({ type: 'sync_score', teams: scoreState.teams });
        }
        showToast(`🏆 已幫 ${team.name} +1 分！`, 'amber');
    };

    // ===========================================================================
    // ✨ 七：手機左右滑動切換功能分頁
    // ===========================================================================
    (() => {
        const modes = ['draw', 'clock', 'timer', 'score', 'board', 'irs'];
        let touchStartX = 0;
        let touchStartY = 0;
        const mainEl = document.querySelector('main');
        if (!mainEl) return;

        mainEl.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        mainEl.addEventListener('touchend', (e) => {
            // 在無限畫板模式下，觸控手勢保留給畫畫使用，不觸發頁面切換
            if (appState.currentMode === 'board') return;
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;
            // 只有水平滑動 > 80px 且垂直位移 < 60px 才觸發切換
            if (Math.abs(dx) < 80 || Math.abs(dy) > 60) return;
            const cur = appState.currentMode;
            const idx = modes.indexOf(cur);
            if (idx === -1) return;
            const nextIdx = dx < 0
                ? (idx + 1) % modes.length              // 向左滑：下一分頁
                : (idx - 1 + modes.length) % modes.length;  // 向右滑：上一分頁
            switchAppMode(modes[nextIdx]);
            // 顯示滑動提示
            const modeNames = { draw: '抽籤機', clock: '時鐘', timer: '計時器', score: '計分板', board: '無限畫板', irs: '即時問答' };
            showToast(`<i data-lucide="${dx < 0 ? 'chevron-right' : 'chevron-left'}" class="w-4 h-4"></i> ${modeNames[modes[nextIdx]] || modes[nextIdx]}`, 'indigo');
        }, { passive: true });
    })();

    // ===========================================================================
    // ✨ 三(JS)：MutationObserver 自動更新10台上限警告
    // ===========================================================================
    (() => {
        const countEl = document.getElementById('irs-student-count');
        if (!countEl) return;
        const observer = new MutationObserver(() => {
            const w = document.getElementById('irs-capacity-warning');
            if (!w) return;
            const count = parseInt(countEl.textContent || '0');
            const isInternet = window._irsNetworkMode !== 'lan';
            if (isInternet && count >= 8) {
                w.classList.remove('hidden');
                w.classList.add('flex');
                if (window.lucide) lucide.createIcons({ root: w });
            } else {
                w.classList.add('hidden');
                w.classList.remove('flex');
            }
        });
        observer.observe(countEl, { childList: true, characterData: true, subtree: true });
    })();

