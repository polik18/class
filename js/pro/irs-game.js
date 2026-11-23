/* IRS 闖關模式（原創）：題目上投影幕、學生手機按色塊，倒數＋速度計分＋連對＋排行榜＋頒獎台。
   - 老師端為唯一權威：狀態機 LIBRARY → LOBBY → PREVIEW → ANSWER → REVEAL → BOARD → … → PODIUM。
   - 訊息：老師→學生用 { type: 'game', g: '<階段>' }；學生答案沿用既有 'answer'（含 ACK、重送、去重）。
   - 正確答案在揭曉前不送到學生裝置；圖片只在投影幕顯示。
   依賴：irsState、sendToAllStudents、buildIRSJoinUrl、startIRSClassroom（irs.js / data.js），IrsSound，IrsQuizBank，QRCode。 */
(() => {
    'use strict';

    const LETTERS = ['A', 'B', 'C', 'D'];
    const SHAPES = [
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 22 12 12 22 2 12z"/></svg>',
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>',
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 23 21H1z"/></svg>',
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>'
    ];
    const SHAPE_NAMES = ['菱形', '圓形', '三角形', '方形'];
    const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e'];
    const PREVIEW_MS = 3000;
    const SETTINGS_KEY = 'class_irs_game_settings_v1';

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const sound = () => window.IrsSound;
    const muted = () => typeof appState !== 'undefined' && appState.isMuted;
    const safeSfx = (name) => { try { sound()?.setMuted(muted()); sound()?.sfx(name); } catch {} };
    const toast = (msg, icon = 'info', color = 'text-indigo-300') => { if (typeof showGlobalToast === 'function') showGlobalToast(msg, icon, color); };

    /** 計分：答對 500＋速度加成最高 500（取到十位），雙倍題 ×2，連對 3 題起每題 +100（上限 +500）。 */
    function scoreAnswer({ correct, elapsedMs, limitMs, double, streak }) {
        if (!correct) return 0;
        const ratio = Math.max(0, Math.min(1, elapsedMs / limitMs));
        let pts = Math.round((500 + 500 * (1 - ratio)) / 10) * 10;
        if (double) pts *= 2;
        if (streak >= 3) pts += Math.min(500, (streak - 2) * 100);
        return pts;
    }

    /** 防作弊：學生回報的作答時間必須落在老師端量測的合理範圍內，否則以老師端時間計。 */
    function trustedElapsed(reported, teacherElapsed, limitMs) {
        const r = Number(reported);
        const ok = Number.isFinite(r) && r >= 0 && r <= teacherElapsed + 50 && r >= teacherElapsed - 2500;
        return Math.max(0, Math.min(limitMs, ok ? r : teacherElapsed));
    }

    // ═════════════════════════ 老師端 ═════════════════════════
    const T = {
        root: null,
        quiz: null,
        idx: -1,
        phase: 'closed',
        players: new Map(),   // clientId -> { name, score, streak, correctCount, rank, prevRank, answers: [] }
        answers: new Map(),   // 本題：clientId -> { choice, elapsed, correct, points }
        answerStartAt: 0,
        remainingMs: 0,
        timer: null,
        paused: false,
        qid: null,
        settings: { team: false, hideBoard: false, quiet: false, autoLock: true },
        editing: null,
        prevBoard: []
    };
    try { Object.assign(T.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch {}
    const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(T.settings)); } catch {} };

    function send(data) { if (typeof sendToAllStudents === 'function') sendToAllStudents({ type: 'game', ...data }); }
    function sendTo(clientId, data) {
        const conn = typeof irsState !== 'undefined' ? irsState.connections[clientId] : null;
        try { conn?.send({ type: 'game', ...data }); } catch {}
    }

    function studentsOnline() {
        return typeof irsState !== 'undefined' ? Object.entries(irsState.studentsInfo || {}) : [];
    }

    function ensurePlayer(clientId) {
        if (!T.players.has(clientId)) {
            const info = irsState.studentsInfo[clientId];
            T.players.set(clientId, { name: info?.name || '同學', score: 0, streak: 0, correctCount: 0, rank: 0, prevRank: 0, answers: [] });
        }
        return T.players.get(clientId);
    }

    function el(html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstElementChild;
    }

    function mountRoot() {
        if (T.root) return T.root;
        T.root = el(`<div class="gm-root" role="dialog" aria-label="闖關模式">
            <div class="gm-bar">
              <div class="gm-title"><span class="gm-kicker"><b>POLIK</b> · 闖關模式</span><span data-title>題庫</span></div>
              <span data-controls style="display:flex;gap:8px;flex-wrap:wrap"></span>
              <button type="button" data-act="close" aria-label="離開闖關模式">✕ 離開</button>
            </div>
            <div class="gm-main" data-main></div>
            <svg width="0" height="0" style="position:absolute"><defs><linearGradient id="gmRingGrad"><stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs></svg>
          </div>`);
        T.root.addEventListener('click', onClick);
        T.root.addEventListener('change', onChange);
        document.body.appendChild(T.root);
        document.addEventListener('keydown', onKey);
        return T.root;
    }

    const $main = () => T.root.querySelector('[data-main]');
    function setTitle(text) { T.root.querySelector('[data-title]').textContent = text; }
    function setControls(html) { T.root.querySelector('[data-controls]').innerHTML = html; }
    function render(html) { $main().innerHTML = html; }

    function onKey(e) {
        if (!T.root || T.phase === 'closed' || T.phase === 'library' || T.phase === 'editor') return;
        if (e.target.closest('input, textarea, select')) return;
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next(); }
        if (e.key.toLowerCase() === 'p') togglePause();
    }

    function onChange(e) {
        const s = e.target.dataset.setting;
        if (s) { T.settings[s] = e.target.checked; saveSettings(); if (s === 'quiet' && e.target.checked) sound()?.stopMusic(0.3); return; }
        if (e.target.dataset.import) importFile(e.target);
        if (e.target.dataset.qimg !== undefined) attachImage(e.target);
    }

    async function onClick(e) {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act, id = btn.dataset.id;
        try { sound()?.unlock(); } catch {}
        switch (act) {
            case 'close': return close();
            case 'start': return startGame(id);
            case 'edit': return openEditor(id);
            case 'new': return openEditor(null);
            case 'export': { const q = await IrsQuizBank.get(id); if (q) IrsQuizBank.exportJSON(q); return; }
            case 'delete': {
                const q = await IrsQuizBank.get(id);
                if (q && confirm(`確定刪除題庫「${q.title}」？`)) { await IrsQuizBank.remove(id); showLibrary(); }
                return;
            }
            case 'template': return IrsQuizBank.csvTemplate();
            case 'next': return next();
            case 'pause': return togglePause();
            case 'lock': return lock();
            case 'end': if (confirm('確定提前結束本場遊戲？')) return showPodium(); return;
            case 'quiet': T.settings.quiet = !T.settings.quiet; saveSettings(); if (T.settings.quiet) sound()?.stopMusic(0.3); else resumeMusicForPhase(); refreshControls(); return;
            case 'hideboard': T.settings.hideBoard = !T.settings.hideBoard; saveSettings(); refreshControls(); return;
            case 'csv': return exportResults();
            case 'toscore': return addTeamsToScoreboard(btn);
            case 'again': return startGame(T.quiz.id);
            case 'library': return showLibrary();
            // 編輯器
            case 'q-add': return editorAddQuestion();
            case 'q-del': T.editing.questions.splice(Number(btn.dataset.i), 1); return renderEditor();
            case 'q-up': case 'q-down': {
                const i = Number(btn.dataset.i), j = act === 'q-up' ? i - 1 : i + 1;
                const qs = T.editing.questions;
                if (j < 0 || j >= qs.length) return;
                editorCollect(); [qs[i], qs[j]] = [qs[j], qs[i]]; return renderEditor();
            }
            case 'q-noimg': editorCollect(); T.editing.questions[Number(btn.dataset.i)].image = null; return renderEditor();
            case 'save': return editorSave();
            case 'cancel': return showLibrary();
            default:
        }
    }

    // ───────── 開啟／關閉 ─────────
    async function open() {
        if (typeof irsState === 'undefined') return;
        if (irsState.role !== 'teacher' || !irsState.roomId) {
            if (typeof startIRSClassroom === 'function' && !irsState.roomId) startIRSClassroom();
            toast('已建立教室，學生加入後即可開始闖關', 'radio', 'text-emerald-400');
        }
        mountRoot();
        T.root.style.display = 'flex';
        try { await IrsQuizBank.ensureSamples(); } catch (error) { console.warn('quiz bank unavailable', error); }
        showLibrary();
    }

    function close() {
        if (['answer', 'preview', 'reveal', 'board', 'lobby'].includes(T.phase) && !confirm('離開會結束本場遊戲，確定嗎？')) return;
        endGameCleanup();
        T.phase = 'closed';
        if (T.root) T.root.style.display = 'none';
    }

    function endGameCleanup() {
        clearInterval(T.timer); T.timer = null;
        sound()?.stopMusic(0.4);
        if (typeof irsState !== 'undefined' && irsState.currentQ === 'GAME') {
            irsState.currentQ = null; irsState.isQuestionActive = false; irsState.currentQuestionId = null;
        }
        if (T.phase !== 'closed' && T.phase !== 'library' && T.phase !== 'editor') send({ g: 'exit' });
        document.querySelector('.gm-confetti')?.remove();
    }

    // ───────── 題庫 ─────────
    async function showLibrary() {
        endGameCleanup();
        T.phase = 'library';
        setTitle('選擇題庫');
        setControls('');
        let quizzes = [];
        try { quizzes = await IrsQuizBank.list(); } catch {}
        const hasTeams = typeof scoreState !== 'undefined' && scoreState.teams.some(t => (t.members || []).length);
        const online = studentsOnline().length;
        render(`<div class="gm-lib">
          <div class="gm-lib-head">
            <h2>闖關題庫</h2>
            <span style="color:var(--g-muted);font-size:14px">教室 ${esc(irsState.roomId || '建立中…')} · 已加入 ${online} 人</span>
            <button type="button" class="gm-primary" data-act="new">＋ 新增題庫</button>
            <label class="gm-btnlike"><button type="button" onclick="this.nextElementSibling.click()">匯入 JSON</button><input type="file" accept=".json,application/json" data-import="json" hidden></label>
            <label class="gm-btnlike"><button type="button" onclick="this.nextElementSibling.click()">匯入 Excel（CSV）</button><input type="file" accept=".csv,text/csv" data-import="csv" hidden></label>
            <button type="button" data-act="template">下載 CSV 範本</button>
            <a href="sound-lab.html" target="_blank" rel="noopener" style="color:#c7d2fe;font-size:14px;text-decoration:none;padding:10px 6px">🎧 試聽音效</a>
          </div>
          <div class="gm-settings">
            <label><input type="checkbox" data-setting="autoLock" ${T.settings.autoLock ? 'checked' : ''}> 全員作答後自動結束倒數</label>
            <label><input type="checkbox" data-setting="hideBoard" ${T.settings.hideBoard ? 'checked' : ''}> 不顯示排行榜（只公布答案）</label>
            <label><input type="checkbox" data-setting="quiet" ${T.settings.quiet ? 'checked' : ''}> 安靜模式（不播背景音樂）</label>
            <label title="${hasTeams ? '' : '請先在抽籤機分組'}"><input type="checkbox" data-setting="team" ${T.settings.team && hasTeams ? 'checked' : ''} ${hasTeams ? '' : 'disabled'}> 團隊模式（依抽籤分組計分）</label>
          </div>
          <div class="gm-cards">${quizzes.map(q => `
            <div class="gm-card">
              <span class="gm-kicker">${q.questions.length} 題 · 約 ${Math.ceil(q.questions.reduce((a, x) => a + x.time + 12, 0) / 60)} 分鐘</span>
              <h3>${esc(q.title)}</h3>
              <p>${esc(q.questions.slice(0, 2).map(x => x.text).join('／'))}</p>
              <div class="gm-actions">
                <button type="button" class="gm-primary" data-act="start" data-id="${esc(q.id)}" ${q.questions.length ? '' : 'disabled'}>▶ 開始</button>
                <button type="button" data-act="edit" data-id="${esc(q.id)}">編輯</button>
                <button type="button" data-act="export" data-id="${esc(q.id)}">匯出</button>
                <button type="button" class="gm-danger" data-act="delete" data-id="${esc(q.id)}">刪除</button>
              </div>
            </div>`).join('') || '<p style="color:var(--g-muted)">還沒有題庫，按「新增題庫」開始。</p>'}
          </div>
          <p style="color:var(--g-muted);font-size:13px;line-height:1.7">題庫只存在這台電腦的瀏覽器裡，不會上傳雲端；換電腦前請先「匯出」。遊戲中可按空白鍵進入下一步、P 鍵暫停。</p>
        </div>`);
    }

    async function importFile(input) {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        try {
            const text = await file.text();
            const result = input.dataset.import === 'csv'
                ? IrsQuizBank.fromCSV(text, file.name.replace(/\.csv$/i, ''))
                : IrsQuizBank.normalize({ ...JSON.parse(text), id: undefined });
            if (!result.quiz.questions.length) throw new Error('沒有可用的題目');
            await IrsQuizBank.save(result.quiz);
            toast(`已匯入 ${result.quiz.questions.length} 題${result.skipped ? `，略過 ${result.skipped} 題格式不符` : ''}`, 'upload', 'text-emerald-400');
            showLibrary();
        } catch (error) {
            alert(`匯入失敗：${error.message || error}`);
        }
    }

    // ───────── 編輯器 ─────────
    async function openEditor(id) {
        T.phase = 'editor';
        const quiz = id ? await IrsQuizBank.get(id) : { id: IrsQuizBank.uid('quiz'), title: '', questions: [] };
        T.editing = JSON.parse(JSON.stringify(quiz));
        if (!T.editing.questions.length) editorBlank();
        renderEditor();
    }
    function editorBlank() { T.editing.questions.push({ id: IrsQuizBank.uid('q'), text: '', options: ['', '', '', ''], correct: [0], time: 20, double: false, image: null }); }
    function editorAddQuestion() { editorCollect(); editorBlank(); renderEditor(); $main().scrollTop = $main().scrollHeight; }

    function renderEditor() {
        setTitle(T.editing.title || '新題庫');
        setControls('<button type="button" data-act="cancel">取消</button><button type="button" class="gm-primary" data-act="save">儲存題庫</button>');
        const L = IrsQuizBank.LIMITS;
        render(`<div class="gm-lib">
          <input type="text" data-f="title" maxlength="${L.title}" placeholder="題庫名稱（例如：第三單元複習）" value="${esc(T.editing.title)}" style="font-size:22px;font-weight:800">
          ${T.editing.questions.map((q, i) => `
            <div class="gm-edit-q" data-q="${i}">
              <div class="gm-row">
                <b style="font-size:18px">第 ${i + 1} 題</b>
                <select data-f="time" aria-label="限時">${IrsQuizBank.TIME_CHOICES.map(t => `<option value="${t}" ${q.time === t ? 'selected' : ''}>${t} 秒</option>`).join('')}</select>
                <label style="display:flex;gap:6px;align-items:center;font-size:14px"><input type="checkbox" data-f="double" ${q.double ? 'checked' : ''}> 雙倍分數</label>
                <span style="margin-left:auto;display:flex;gap:6px">
                  <button type="button" data-act="q-up" data-i="${i}" aria-label="上移">↑</button>
                  <button type="button" data-act="q-down" data-i="${i}" aria-label="下移">↓</button>
                  <button type="button" class="gm-danger" data-act="q-del" data-i="${i}">刪除</button>
                </span>
              </div>
              <textarea data-f="text" rows="2" maxlength="${L.text}" placeholder="題目（顯示在投影幕）">${esc(q.text)}</textarea>
              ${[0, 1, 2, 3].map(k => `
                <div class="gm-opt">
                  <span class="gm-shape gm-c${k}" title="${SHAPE_NAMES[k]}">${SHAPES[k]}</span>
                  <input type="text" data-f="opt" data-k="${k}" maxlength="${L.option}" placeholder="選項 ${LETTERS[k]}${k >= 2 ? '（可留空）' : ''}" value="${esc(q.options[k] || '')}">
                  <label><input type="checkbox" data-f="correct" data-k="${k}" ${q.correct.includes(k) ? 'checked' : ''}> 正確</label>
                </div>`).join('')}
              <div class="gm-row">
                ${q.image ? `<img src="${q.image}" alt="題目圖片"><button type="button" data-act="q-noimg" data-i="${i}">移除圖片</button>` : ''}
                <label style="font-size:13px;color:var(--g-muted)">題目圖片（選用，只在投影幕顯示）：<input type="file" accept="image/*" data-qimg="${i}"></label>
              </div>
            </div>`).join('')}
          <button type="button" data-act="q-add" style="padding:16px;font-weight:800">＋ 新增一題</button>
        </div>`);
    }

    function editorCollect() {
        if (!T.editing || !T.root) return;
        const t = T.root.querySelector('[data-f="title"]');
        if (t) T.editing.title = t.value;
        T.root.querySelectorAll('[data-q]').forEach(box => {
            const q = T.editing.questions[Number(box.dataset.q)];
            if (!q) return;
            q.text = box.querySelector('[data-f="text"]').value;
            q.time = Number(box.querySelector('[data-f="time"]').value);
            q.double = box.querySelector('[data-f="double"]').checked;
            q.options = [...box.querySelectorAll('[data-f="opt"]')].map(i => i.value);
            q.correct = [...box.querySelectorAll('[data-f="correct"]')].filter(c => c.checked).map(c => Number(c.dataset.k));
        });
    }

    async function attachImage(input) {
        const i = Number(input.dataset.qimg), file = input.files?.[0];
        if (!file) return;
        editorCollect();
        try { T.editing.questions[i].image = await IrsQuizBank.compressImage(file); renderEditor(); }
        catch { alert('圖片無法使用，請換一張較小的圖片'); }
    }

    async function editorSave() {
        editorCollect();
        // 把選項壓縮掉空白，同時重新對應正確答案索引
        const problems = [];
        const questions = T.editing.questions.map((q, n) => {
            const kept = q.options.map((o, k) => ({ o: o.trim(), k })).filter(x => x.o);
            const correct = kept.map((x, idx) => (q.correct.includes(x.k) ? idx : -1)).filter(x => x >= 0);
            if (!q.text.trim()) problems.push(`第 ${n + 1} 題沒有題目`);
            else if (kept.length < 2) problems.push(`第 ${n + 1} 題至少需要 2 個選項`);
            else if (!correct.length) problems.push(`第 ${n + 1} 題還沒勾選正確答案`);
            return { ...q, options: kept.map(x => x.o), correct };
        });
        if (!T.editing.title.trim()) problems.unshift('請輸入題庫名稱');
        if (problems.length) { alert(problems.slice(0, 5).join('\n')); return; }
        await IrsQuizBank.save({ ...T.editing, questions });
        toast('題庫已儲存', 'save', 'text-emerald-400');
        showLibrary();
    }

    // ───────── 遊戲流程 ─────────
    async function startGame(id) {
        const quiz = await IrsQuizBank.get(id);
        if (!quiz?.questions.length) return;
        T.quiz = quiz; T.idx = -1; T.players = new Map(); T.prevBoard = [];
        studentsOnline().forEach(([cid]) => ensurePlayer(cid));
        showLobby();
    }

    function refreshControls() {
        const p = T.phase;
        const nextLabel = { lobby: '開始遊戲 ▶', reveal: T.settings.hideBoard ? (isLast() ? '頒獎 🏆' : '下一題 ▶') : '排行榜 ▶', board: isLast() ? '頒獎 🏆' : '下一題 ▶' }[p];
        setControls([
            p === 'answer' ? `<button type="button" data-act="pause">${T.paused ? '▶ 繼續' : '⏸ 暫停'}</button><button type="button" data-act="lock">提早結束作答</button>` : '',
            nextLabel ? `<button type="button" class="gm-primary" data-act="next">${nextLabel}</button>` : '',
            p !== 'podium' ? `<button type="button" data-act="quiet" class="${T.settings.quiet ? 'gm-on' : ''}">${T.settings.quiet ? '🔇 安靜' : '🎵 音樂'}</button>` : '',
            ['lobby', 'preview', 'answer', 'reveal', 'board'].includes(p) ? `<button type="button" data-act="hideboard" class="${T.settings.hideBoard ? 'gm-on' : ''}">${T.settings.hideBoard ? '排行榜：隱藏' : '排行榜：顯示'}</button>` : '',
            ['preview', 'answer', 'reveal', 'board'].includes(p) ? '<button type="button" class="gm-danger" data-act="end">結束</button>' : ''
        ].join(''));
    }

    const isLast = () => T.idx >= T.quiz.questions.length - 1;
    const currentQ = () => T.quiz.questions[T.idx];

    function resumeMusicForPhase() {
        if (T.settings.quiet) return;
        sound()?.setMuted(muted());
        if (T.phase === 'lobby') sound()?.playMusic('lobby');
        if (T.phase === 'answer' && !T.paused) sound()?.playMusic('think');
    }

    function next() {
        if (T.phase === 'lobby') return showPreview(0);
        if (T.phase === 'answer') return lock();
        if (T.phase === 'reveal') return T.settings.hideBoard ? (isLast() ? showPodium() : showPreview(T.idx + 1)) : showBoard();
        if (T.phase === 'board') return isLast() ? showPodium() : showPreview(T.idx + 1);
    }

    function showLobby() {
        T.phase = 'lobby';
        setTitle(T.quiz.title);
        refreshControls();
        const url = typeof buildIRSJoinUrl === 'function' ? buildIRSJoinUrl(irsState.roomId) : location.href;
        render(`<div class="gm-view"><div class="gm-lobby">
            <div class="gm-qr"><div data-qr></div><span class="gm-code">${esc(irsState.roomId)}</span><small>掃描 QR Code 或輸入代碼加入</small></div>
            <div>
              <span class="gm-kicker"><b>READY</b> · ${T.quiz.questions.length} 題</span>
              <h2>${esc(T.quiz.title)}</h2>
              <div style="display:flex;align-items:baseline;gap:12px"><span class="gm-count" data-count>${T.players.size}</span><span style="color:var(--g-muted);font-size:18px">位同學已加入</span></div>
              <div class="gm-chips" data-chips>${[...T.players.values()].map(p => `<span class="gm-chip">${esc(p.name)}</span>`).join('')}</div>
            </div>
          </div></div>`);
        try { new QRCode(T.root.querySelector('[data-qr]'), { text: url, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M }); } catch {}
        send({ g: 'lobby', title: T.quiz.title, total: T.quiz.questions.length });
        resumeMusicForPhase();
    }

    /** irs.js 在學生加入時呼叫。 */
    function onStudentJoin(clientId, conn) {
        if (T.phase === 'closed' || T.phase === 'library' || T.phase === 'editor') return false;
        const isNew = !T.players.has(clientId);
        const p = ensurePlayer(clientId);
        p.name = irsState.studentsInfo[clientId]?.name || p.name;
        if (T.phase === 'lobby' && isNew) {
            safeSfx('join');
            const chips = T.root.querySelector('[data-chips]');
            chips?.appendChild(el(`<span class="gm-chip">${esc(p.name)}</span>`));
            const count = T.root.querySelector('[data-count]');
            if (count) count.textContent = T.players.size;
        }
        syncStudent(clientId, conn);
        return true;
    }

    function syncStudent(clientId, conn) {
        const p = T.players.get(clientId);
        const msg = T.phase === 'lobby' ? { g: 'lobby', title: T.quiz.title, total: T.quiz.questions.length }
            : T.phase === 'answer' && !T.answers.has(clientId) ? { g: 'answer', qid: T.qid, i: T.idx, total: T.quiz.questions.length, n: currentQ().options.length, time: Math.ceil(T.remainingMs / 1000) }
            : T.phase === 'podium' ? { g: 'end', rank: p?.rank || 0, score: p?.score || 0, correct: p?.correctCount || 0, total: T.quiz.questions.length }
            : { g: 'wait', i: T.idx, total: T.quiz.questions.length, score: p?.score || 0, rank: p?.rank || 0 };
        try { conn?.send({ type: 'game', ...msg }); } catch {}
    }

    function showPreview(i) {
        T.idx = i; T.phase = 'preview';
        T.qid = IrsProtocol.randomId('game');
        T.answers = new Map();
        const q = currentQ();
        setTitle(`${T.quiz.title} · 第 ${i + 1}／${T.quiz.questions.length} 題`);
        refreshControls();
        sound()?.stopMusic(0.3);
        safeSfx('riser');
        render(`<div class="gm-view">
            <div class="gm-qhead"><span class="gm-kicker"><b>QUESTION</b> ${i + 1} / ${T.quiz.questions.length}</span>${q.double ? '<span class="gm-badge-double">★ 雙倍分數</span>' : ''}</div>
            <div class="gm-question">${esc(q.text)}</div>
            ${q.image ? `<img class="gm-qimg" src="${q.image}" alt="">` : ''}
            <div class="gm-preview-bar"><i></i></div>
          </div>`);
        send({ g: 'preview', i, total: T.quiz.questions.length, double: q.double, time: q.time });
        clearTimeout(T.previewTimer);
        T.previewTimer = setTimeout(() => { if (T.phase === 'preview' && T.idx === i) showAnswer(); }, PREVIEW_MS);
    }

    function showAnswer() {
        const q = currentQ();
        T.phase = 'answer'; T.paused = false;
        T.remainingMs = q.time * 1000;
        T.answerStartAt = Date.now();
        // 讓 irs.js 既有的答案流程（ACK、去重、保存）接受本題答案
        irsState.currentQ = 'GAME';
        irsState.currentQuestionId = T.qid;
        irsState.currentQuestionStartedAt = T.answerStartAt;
        irsState.isQuestionActive = true;
        Object.values(irsState.studentsInfo).forEach(s => { s.hasAnswered = false; s.answer = null; });
        refreshControls();
        render(`<div class="gm-view">
            <div class="gm-answer-top">
              <div class="gm-ring" data-ring><svg viewBox="0 0 120 120"><circle class="gm-ring-bg" cx="60" cy="60" r="52"/><circle class="gm-ring-fg" cx="60" cy="60" r="52" stroke-dasharray="326.7" stroke-dashoffset="0" data-ringfg/></svg><b data-sec>${q.time}</b></div>
              <div class="gm-question" style="font-size:clamp(24px,3.4vw,46px)">${esc(q.text)}</div>
              <div class="gm-answered"><b data-answered>0</b><span>/ <span data-total>${T.players.size}</span> 已作答</span></div>
            </div>
            ${q.image ? `<img class="gm-qimg" style="max-height:26vh" src="${q.image}" alt="">` : ''}
            <div class="gm-options" data-options>${q.options.map((o, k) => `
              <div class="gm-option gm-c${k}" data-opt="${k}"><span class="gm-shape">${SHAPES[k]}</span><span>${esc(o)}</span><span class="gm-num" data-num>0</span><span class="gm-count-bar" data-bar style="width:0"></span></div>`).join('')}
            </div>
          </div>`);
        send({ g: 'answer', qid: T.qid, i: T.idx, total: T.quiz.questions.length, n: q.options.length, time: q.time });
        sound()?.setIntensity(0);
        resumeMusicForPhase();
        let lastSec = q.time;
        clearInterval(T.timer);
        let lastTickAt = Date.now();
        T.timer = setInterval(() => {
            const now = Date.now();
            if (!T.paused) T.remainingMs -= now - lastTickAt;
            lastTickAt = now;
            const sec = Math.max(0, Math.ceil(T.remainingMs / 1000));
            const ring = T.root.querySelector('[data-ring]');
            if (ring) {
                T.root.querySelector('[data-sec]').textContent = sec;
                T.root.querySelector('[data-ringfg]').style.strokeDashoffset = String(326.7 * (1 - Math.max(0, T.remainingMs) / (q.time * 1000)));
                ring.classList.toggle('urgent', sec <= 5);
            }
            if (sec !== lastSec && !T.paused) {
                lastSec = sec;
                const level = sec <= 5 ? 2 : sec <= 10 ? 1 : 0;
                if (sound()?.intensity !== level) sound()?.setIntensity(level);
                if (sec > 0 && sec <= 5) safeSfx('tickUrgent');
                else if (sec > 0 && sec <= 10) safeSfx('tick');
            }
            if (T.remainingMs <= 0) lock();
        }, 100);
    }

    function togglePause() {
        if (T.phase !== 'answer') return;
        T.paused = !T.paused;
        if (T.paused) { sound()?.stopMusic(0.3); send({ g: 'pause' }); }
        else { resumeMusicForPhase(); send({ g: 'answer', qid: T.qid, i: T.idx, total: T.quiz.questions.length, n: currentQ().options.length, time: Math.ceil(T.remainingMs / 1000), resume: true }); }
        refreshControls();
    }

    /** irs.js 收到學生答案（已通過去重、每題一次）時呼叫。 */
    function onAnswer(clientId, data) {
        if (T.phase !== 'answer' || data.questionId !== T.qid || T.answers.has(clientId)) return;
        const q = currentQ();
        const choice = Number.parseInt(data.val, 10);
        if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;
        ensurePlayer(clientId);
        const limitMs = q.time * 1000;
        const elapsed = trustedElapsed(data.elapsedMs, Date.now() - T.answerStartAt, limitMs);
        T.answers.set(clientId, { choice, elapsed, correct: q.correct.includes(choice) });
        const answered = T.root?.querySelector('[data-answered]');
        if (answered) answered.textContent = T.answers.size;
        const total = T.root?.querySelector('[data-total]');
        if (total) total.textContent = T.players.size;
        if (T.settings.autoLock && T.answers.size >= T.players.size && T.players.size > 0) setTimeout(() => lock(), 600);
    }

    function lock() {
        if (T.phase !== 'answer') return;
        clearInterval(T.timer); T.timer = null;
        T.phase = 'reveal';
        irsState.isQuestionActive = false;
        const q = currentQ();
        sound()?.stopMusic(0.12);
        safeSfx('timeUp');
        send({ g: 'locked', qid: T.qid });

        // 計分
        const counts = q.options.map(() => 0);
        T.players.forEach((p, cid) => {
            p.prevRank = p.rank;
            const a = T.answers.get(cid);
            if (a) counts[a.choice] += 1;
            if (a?.correct) {
                p.streak += 1; p.correctCount += 1;
                a.points = scoreAnswer({ correct: true, elapsedMs: a.elapsed, limitMs: q.time * 1000, double: q.double, streak: p.streak });
                p.score += a.points;
            } else {
                p.streak = 0;
                if (a) a.points = 0;
            }
            p.answers[T.idx] = a ? { choice: a.choice, correct: a.correct, elapsed: a.elapsed, points: a.points } : null;
        });
        const ranking = rankPlayers();

        // 投影幕揭曉
        setTimeout(() => {
            if (T.phase !== 'reveal') return;
            try { sound()?.setMuted(muted()); sound()?.stinger('reveal'); } catch {}
            const box = T.root.querySelector('[data-options]');
            if (!box) return;
            const max = Math.max(1, ...counts);
            box.querySelectorAll('[data-opt]').forEach(opt => {
                const k = Number(opt.dataset.opt);
                opt.classList.toggle('correct', q.correct.includes(k));
                opt.querySelector('[data-num]').textContent = counts[k];
                opt.querySelector('[data-bar]').style.width = `${(counts[k] / max) * 100}%`;
            });
            box.classList.add('revealed');
            refreshControls();
        }, 900);

        // 個別結果：每 20 人一批，避免瞬間送出大量訊息
        const entries = [...T.players.entries()];
        const above = new Map();
        ranking.forEach((cid, i) => { if (i > 0) above.set(cid, T.players.get(ranking[i - 1]).score - T.players.get(cid).score); });
        entries.forEach(([cid, p], i) => {
            setTimeout(() => {
                const a = T.answers.get(cid);
                sendTo(cid, {
                    g: 'result', qid: T.qid, answered: Boolean(a), correct: Boolean(a?.correct), points: a?.points || 0,
                    score: p.score, rank: p.rank, prevRank: p.prevRank, streak: p.streak, behind: above.get(cid) || 0,
                    right: q.correct, total: T.players.size, hideRank: T.settings.hideBoard
                });
            }, 1000 + Math.floor(i / 20) * 60);
        });
    }

    function rankPlayers() {
        const ids = [...T.players.keys()].sort((a, b) => T.players.get(b).score - T.players.get(a).score || T.players.get(a).name.localeCompare(T.players.get(b).name, 'zh-Hant'));
        let lastScore = null, lastRank = 0;
        ids.forEach((cid, i) => {
            const p = T.players.get(cid);
            if (p.score !== lastScore) { lastRank = i + 1; lastScore = p.score; }
            p.rank = lastRank;
        });
        return ids;
    }

    function teamStandings() {
        if (!T.settings.team || typeof scoreState === 'undefined') return null;
        const norm = s => String(s || '').replace(/\s+/g, '').replace(/^\d+號?/, '');
        const teams = scoreState.teams.filter(t => (t.members || []).length).map(t => ({ id: t.id, name: t.name, members: t.members.map(m => norm(m.name)), score: 0, n: 0 }));
        if (!teams.length) return null;
        T.players.forEach(p => {
            const team = teams.find(t => t.members.some(m => m && (m === norm(p.name) || m.includes(norm(p.name)) || norm(p.name).includes(m))));
            if (team) { team.score += p.score; team.n += 1; }
        });
        teams.forEach(t => { t.avg = t.n ? Math.round(t.score / t.n) : 0; });
        return teams.sort((a, b) => b.avg - a.avg);
    }

    function showBoard() {
        T.phase = 'board';
        refreshControls();
        try { sound()?.setMuted(muted()); sound()?.stinger('board'); } catch {}
        send({ g: 'board' });
        const teams = teamStandings();
        const rowsData = teams
            ? teams.slice(0, 5).map((t, i) => ({ id: `team_${t.id}`, name: `${t.name}（${t.n} 人）`, score: t.avg, rank: i + 1, prev: null, streak: 0 }))
            : rankPlayers().slice(0, 5).map(cid => { const p = T.players.get(cid); return { id: cid, name: p.name, score: p.score, rank: p.rank, prev: p.prevRank, streak: p.streak }; });
        const prevOrder = T.prevBoard;
        let mvp = null;
        if (!teams) {
            T.players.forEach(p => {
                if (p.prevRank && p.rank < p.prevRank && (!mvp || p.prevRank - p.rank > mvp.prevRank - mvp.rank)) mvp = p;
            });
        }
        render(`<div class="gm-view">
            <span class="gm-kicker"><b>LEADERBOARD</b> · 第 ${T.idx + 1} 題後${teams ? ' · 團隊平均' : ''}</span>
            <div class="gm-board" data-board style="height:${Math.max(1, rowsData.length) * 90}px">${rowsData.map(r => {
                const start = prevOrder.indexOf(r.id);
                const startPos = start >= 0 ? start : rowsData.length;
                return `<div class="gm-board-row ${r.rank === 1 ? 'first' : ''}" data-row="${esc(r.id)}" data-target="${rowsData.indexOf(r)}" style="top:${startPos * 90}px">
                  <span class="gm-rank">${r.rank}</span><span class="gm-name">${esc(r.name)}</span>
                  ${r.prev && r.rank < r.prev ? `<span class="gm-up">▲${r.prev - r.rank}</span>` : ''}
                  ${r.streak >= 3 ? `<span class="gm-fire">🔥${r.streak}</span>` : ''}
                  <span class="gm-score" data-score="${r.score}">0</span></div>`;
            }).join('')}</div>
            ${mvp ? `<div class="gm-mvp">🚀 進步最多：${esc(mvp.name)}（上升 ${mvp.prevRank - mvp.rank} 名）</div>` : ''}
          </div>`);
        T.prevBoard = rowsData.map(r => r.id);
        requestAnimationFrame(() => setTimeout(() => {
            T.root.querySelectorAll('[data-row]').forEach(row => { row.style.top = `${Number(row.dataset.target) * 90}px`; });
            animateNumbers(T.root.querySelectorAll('[data-score]'));
        }, 1500));
    }

    function animateNumbers(nodes) {
        const start = performance.now();
        const step = now => {
            const k = Math.min(1, (now - start) / 900), e = 1 - Math.pow(1 - k, 3);
            nodes.forEach(n => { n.textContent = Math.round(Number(n.dataset.score) * e).toLocaleString(); });
            if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    function showPodium() {
        clearInterval(T.timer); T.timer = null;
        clearTimeout(T.previewTimer);
        T.phase = 'podium';
        irsState.isQuestionActive = false;
        irsState.currentQ = null;
        sound()?.stopMusic(0.3);
        setTitle(`${T.quiz.title} · 頒獎`);
        refreshControls();
        const ranking = rankPlayers();
        const teams = teamStandings();
        const top = teams
            ? teams.slice(0, 3).map((t, i) => ({ name: t.name, score: t.avg, rank: i + 1 }))
            : ranking.slice(0, 3).map(cid => ({ name: T.players.get(cid).name, score: T.players.get(cid).score, rank: T.players.get(cid).rank }));
        top.forEach((x, i) => { if (i > 0 && x.score === top[i - 1].score) x.rank = top[i - 1].rank; });
        const slot = (place, cls) => top[place - 1] ? `<div class="gm-step ${cls}" data-step="${place}"><span class="gm-who">${esc(top[place - 1].name)}</span>${top[place - 1].rank !== place ? `<span class="gm-tie">同分並列第 ${top[place - 1].rank} 名</span>` : ''}<span class="gm-pts">${top[place - 1].score.toLocaleString()} 分</span><div class="gm-block">${place}</div></div>` : '<div class="gm-step"></div>';
        render(`<div class="gm-view">
            <span class="gm-kicker"><b>PODIUM</b> · ${esc(T.quiz.title)}</span>
            <div class="gm-podium">${slot(2, 'p2')}${slot(1, 'p1')}${slot(3, 'p3')}</div>
            <div class="gm-end-actions">
              <button type="button" data-act="csv">下載成績（CSV）</button>
              ${teams ? '<button type="button" data-act="toscore">把小組分數加到計分板</button>' : ''}
              <button type="button" data-act="again">再玩一次</button>
              <button type="button" class="gm-primary" data-act="library">回題庫</button>
            </div>
          </div>`);
        const showStep = (n, delay, sfx) => setTimeout(() => {
            const s = T.root.querySelector(`[data-step="${n}"]`);
            if (s) s.classList.add('show');
            safeSfx(sfx);
        }, delay);
        showStep(3, 600, 'podium3');
        showStep(2, 1900, 'podium2');
        setTimeout(() => { try { sound()?.setMuted(muted()); sound()?.stinger('podium'); } catch {} }, 3000);
        showStep(1, 3100, 'podium1');
        setTimeout(confetti, 3200);
        T.players.forEach((p, cid) => sendTo(cid, { g: 'end', rank: p.rank, score: p.score, correct: p.correctCount, total: T.quiz.questions.length }));
    }

    function confetti() {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        document.querySelector('.gm-confetti')?.remove();
        const cv = document.createElement('canvas');
        cv.className = 'gm-confetti';
        cv.width = innerWidth; cv.height = innerHeight;
        document.body.appendChild(cv);
        const g = cv.getContext('2d');
        const count = (navigator.hardwareConcurrency || 4) >= 4 ? 150 : 70;
        const colors = ['#818cf8', '#f472b6', '#fbbf24', '#34d399', '#60a5fa'];
        const parts = Array.from({ length: count }, () => ({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 8, c: colors[Math.floor(Math.random() * colors.length)] }));
        const start = performance.now();
        const frame = now => {
            if (!cv.isConnected) return;
            g.clearRect(0, 0, cv.width, cv.height);
            parts.forEach(p => {
                p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.03;
                g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2); g.restore();
            });
            if (now - start < 5000) requestAnimationFrame(frame); else cv.remove();
        };
        requestAnimationFrame(frame);
    }

    function exportResults() {
        const qs = T.quiz.questions;
        const header = ['名次', '姓名', '總分', '答對題數', ...qs.flatMap((q, i) => [`第${i + 1}題作答`, `第${i + 1}題對錯`, `第${i + 1}題秒數`, `第${i + 1}題得分`])];
        const rows = rankPlayers().map(cid => {
            const p = T.players.get(cid);
            return [p.rank, p.name, p.score, p.correctCount, ...qs.flatMap((q, i) => {
                const a = p.answers[i];
                return a ? [LETTERS[a.choice], a.correct ? '○' : '×', (a.elapsed / 1000).toFixed(1), a.points] : ['未作答', '×', '', 0];
            })];
        });
        const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const stamp = new Date().toLocaleString('sv-SE').slice(0, 16).replace(/[: ]/g, '');
        IrsQuizBank.download(new Blob(['﻿' + csv], { type: 'text/csv' }), `${T.quiz.title}_闖關成績_${stamp}.csv`);
    }

    function addTeamsToScoreboard(btn) {
        const teams = teamStandings();
        if (!teams || typeof scoreState === 'undefined') return;
        teams.forEach(t => {
            const team = scoreState.teams.find(x => x.id === t.id);
            if (team) team.score += Math.round(t.avg / 100);
        });
        if (typeof renderScoreboard === 'function') renderScoreboard();
        btn.disabled = true;
        btn.textContent = '已加到計分板（每 100 分＝1 點）';
        toast('小組分數已加到計分板', 'trophy', 'text-amber-400');
    }

    // ═════════════════════════ 學生端 ═════════════════════════
    const S = { root: null, qid: null, receivedAt: 0, answered: false, chosen: null, lastRank: 0, soundOn: true, n: 4, total: 0, i: 0 };
    try { S.soundOn = localStorage.getItem('class_irs_game_student_sound') !== 'off'; } catch {}

    function studentSfx(name) { if (S.soundOn) safeSfx(name); }

    function studentRoot() {
        if (S.root) return S.root;
        S.root = el(`<div class="gm-student" role="dialog" aria-label="闖關模式">
            <div class="gm-s-top"><span data-s-title>闖關模式</span><button type="button" data-s-sound>${S.soundOn ? '🔊 音效開' : '🔇 音效關'}</button></div>
            <div class="gm-s-body" data-s-body></div>
          </div>`);
        S.root.querySelector('[data-s-sound]').addEventListener('click', e => {
            S.soundOn = !S.soundOn;
            try { localStorage.setItem('class_irs_game_student_sound', S.soundOn ? 'on' : 'off'); } catch {}
            e.target.textContent = S.soundOn ? '🔊 音效開' : '🔇 音效關';
            if (S.soundOn) { try { sound()?.unlock(); } catch {} }
        });
        S.root.addEventListener('click', e => {
            const b = e.target.closest('[data-choice]');
            if (b) submit(Number(b.dataset.choice));
        });
        document.body.appendChild(S.root);
        return S.root;
    }

    function sBody(html, mood = '') {
        const r = studentRoot();
        r.style.display = 'flex';
        r.classList.toggle('good', mood === 'good');
        r.classList.toggle('miss', mood === 'miss');
        const body = r.querySelector('[data-s-body]');
        body.style.padding = '';
        body.innerHTML = html;
    }
    function sTitle(t) { studentRoot().querySelector('[data-s-title]').textContent = t; }
    const myName = () => (typeof irsState !== 'undefined' && irsState.studentName) || '';

    function onStudentMessage(d) {
        switch (d.g) {
            case 'lobby':
                S.total = d.total; S.lastRank = 0;
                sTitle(d.title || '闖關模式');
                sBody(`<div class="gm-s-big">已加入！</div><div class="gm-s-sub">${esc(myName())}<br>請看大螢幕，等老師開始</div><div class="gm-s-chosen gm-pulse" style="background:linear-gradient(135deg,#6366f1,#ec4899)">${SHAPES[0]}</div>`);
                break;
            case 'preview':
                S.i = d.i; S.total = d.total;
                sTitle(`第 ${d.i + 1}／${d.total} 題`);
                sBody(`<div class="gm-s-big">準備！</div>${d.double ? '<div class="gm-s-streak">★ 雙倍分數題</div>' : ''}<div class="gm-s-sub">題目在大螢幕上<br>限時 ${d.time} 秒</div>`);
                break;
            case 'answer': {
                if (d.resume && S.qid === d.qid && S.answered) break;
                S.qid = d.qid; S.n = d.n; S.answered = false; S.chosen = null;
                S.receivedAt = performance.now() - (d.resume ? 0 : 0);
                if (d.resume) S.receivedAt = performance.now() - ((S.timeLimit || d.time) - d.time) * 1000;
                else S.timeLimit = d.time;
                sTitle(`第 ${d.i + 1}／${d.total} 題`);
                const r = studentRoot();
                r.style.display = 'flex'; r.classList.remove('good', 'miss');
                r.querySelector('[data-s-body]').innerHTML = `<div class="gm-s-grid ${d.n === 2 ? 'n2' : ''}" style="width:100%;height:100%">${Array.from({ length: d.n }, (_, k) =>
                    `<button type="button" class="gm-s-btn" data-choice="${k}" style="background:${COLORS[k]}" aria-label="${LETTERS[k]} ${SHAPE_NAMES[k]}">${SHAPES[k]}<span>${LETTERS[k]}</span></button>`).join('')}</div>`;
                r.querySelector('[data-s-body]').style.padding = '0';
                break;
            }
            case 'pause':
                if (!S.answered) sBody('<div class="gm-s-big">⏸ 暫停中</div><div class="gm-s-sub">老師暫停了倒數</div>');
                break;
            case 'locked':
                if (!S.answered && d.qid === S.qid) sBody('<div class="gm-s-big">時間到！</div><div class="gm-s-sub">看大螢幕公布答案</div>');
                break;
            case 'result': {
                if (d.qid !== S.qid) break;
                const rankLine = d.hideRank ? '' : `<div class="gm-s-sub">目前第 <b>${d.rank}</b> 名${d.rank > 1 && d.behind ? `，距前一名 ${d.behind.toLocaleString()} 分` : ''}</div>`;
                const rightShapes = (d.right || []).map(k => `<span class="gm-shape" style="width:44px;height:44px;background:${COLORS[k]}">${SHAPES[k]}</span>`).join(' ');
                if (d.correct) {
                    sBody(`<div class="gm-s-big">答對了！</div><div class="gm-s-pts">+${d.points.toLocaleString()}</div>${d.streak >= 3 ? `<div class="gm-s-streak">🔥 連對 ${d.streak} 題</div>` : ''}<div class="gm-s-sub">總分 ${d.score.toLocaleString()}</div>${rankLine}`, 'good');
                    studentSfx('correct');
                    if (d.streak >= 3) setTimeout(() => studentSfx('streak'), 500);
                } else {
                    sBody(`<div class="gm-s-big">${d.answered ? '差一點！' : '這題沒作答'}</div><div class="gm-s-sub">正確答案</div><div>${rightShapes}</div><div class="gm-s-sub">總分 ${d.score.toLocaleString()}</div>${rankLine}`, 'miss');
                    studentSfx('wrong');
                }
                if (!d.hideRank && S.lastRank && d.rank < S.lastRank) setTimeout(() => studentSfx('rankUp'), 900);
                S.lastRank = d.rank;
                break;
            }
            case 'board':
                sBody(`<div class="gm-s-big">🏆 排行榜</div><div class="gm-s-sub">請看大螢幕${S.lastRank ? `<br>你目前第 ${S.lastRank} 名` : ''}</div>`);
                break;
            case 'wait':
                sTitle(d.total ? `第 ${d.i + 1}／${d.total} 題` : '闖關模式');
                sBody(`<div class="gm-s-big">已連線</div><div class="gm-s-sub">下一題開始時會自動出現選項${d.score ? `<br>目前總分 ${d.score.toLocaleString()}` : ''}</div>`);
                break;
            case 'end': {
                const medal = d.rank === 1 ? '🥇' : d.rank === 2 ? '🥈' : d.rank === 3 ? '🥉' : '🎉';
                sTitle('遊戲結束');
                sBody(`<div style="font-size:72px">${medal}</div><div class="gm-s-big">第 ${d.rank} 名</div><div class="gm-s-pts">${(d.score || 0).toLocaleString()}</div><div class="gm-s-sub">答對 ${d.correct}／${d.total} 題<br>謝謝參加！</div>`, d.rank <= 3 ? 'good' : '');
                if (d.rank >= 1 && d.rank <= 3) studentSfx(`podium${d.rank}`);
                break;
            }
            case 'exit':
                if (S.root) S.root.style.display = 'none';
                break;
            default:
        }
    }

    function submit(choice) {
        if (S.answered || !S.qid || typeof irsState === 'undefined' || !irsState.hostConn) return;
        S.answered = true; S.chosen = choice;
        studentSfx('tap');
        const elapsedMs = Math.round(performance.now() - S.receivedAt);
        irsState.hostConn.send({ type: 'answer', val: String(choice), questionId: S.qid, elapsedMs });
        sBody(`<div class="gm-s-chosen" style="background:${COLORS[choice]}">${SHAPES[choice]}</div><div class="gm-s-big">已送出！</div><div class="gm-s-sub">看大螢幕，等待揭曉</div>`);
        studentRoot().querySelector('[data-s-body]').style.padding = '';
    }

    window.IrsGame = { open, close, onAnswer, onStudentJoin, onStudentMessage, isActive: () => !['closed', 'library', 'editor'].includes(T.phase), _test: { scoreAnswer, trustedElapsed, T, S } };
})();
