/* 闖關模式題庫：存在老師瀏覽器的 IndexedDB（不上傳雲端），支援 JSON／CSV 匯入匯出。
   題庫格式：{ id, title, updatedAt, questions: [{ id, text, options: [2~4], correct: [索引], time, double, image? }] } */
(() => {
    'use strict';

    const DB_NAME = 'class-irs-quiz';
    const STORE = 'quizzes';
    const TIME_CHOICES = [5, 10, 20, 30, 60];
    const LIMITS = { title: 60, text: 120, option: 60, questions: 100, image: 300 * 1024 };

    let dbPromise = null;
    function db() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }
    async function tx(mode, fn) {
        const d = await db();
        return new Promise((resolve, reject) => {
            const t = d.transaction(STORE, mode);
            const result = fn(t.objectStore(STORE));
            t.oncomplete = () => resolve(result?.result ?? result);
            t.onerror = () => reject(t.error);
        });
    }

    const uid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

    /** 驗證並正規化一份題庫；不合格的題目略過，回傳 { quiz, skipped }。 */
    function normalize(raw) {
        const quiz = { id: clip(raw?.id, 40) || uid('quiz'), title: clip(raw?.title, LIMITS.title) || '未命名題庫', updatedAt: Date.now(), questions: [] };
        let skipped = 0;
        (Array.isArray(raw?.questions) ? raw.questions : []).slice(0, LIMITS.questions).forEach(q => {
            const options = (Array.isArray(q?.options) ? q.options : []).map(o => clip(o, LIMITS.option)).filter(Boolean).slice(0, 4);
            const correct = [...new Set((Array.isArray(q?.correct) ? q.correct : [q?.correct]).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < options.length))];
            const text = clip(q?.text, LIMITS.text);
            if (!text || options.length < 2 || !correct.length) { skipped += 1; return; }
            const time = TIME_CHOICES.includes(Number(q?.time)) ? Number(q.time) : 20;
            const image = typeof q?.image === 'string' && q.image.startsWith('data:image/') && q.image.length <= LIMITS.image * 1.4 ? q.image : null;
            quiz.questions.push({ id: clip(q?.id, 40) || uid('q'), text, options, correct, time, double: Boolean(q?.double), image });
        });
        return { quiz, skipped };
    }

    // ───────── 範例題庫（原創內容） ─────────
    const SAMPLES = [
        {
            id: 'sample_warmup', title: '暖身題：生活小常識', questions: [
                { text: '一年有幾個月份是 31 天？', options: ['5 個', '6 個', '7 個', '8 個'], correct: [2], time: 20 },
                { text: '彩虹通常出現在太陽的哪一邊？', options: ['和太陽同一邊', '背對太陽的那一邊', '正上方', '都有可能'], correct: [1], time: 20 },
                { text: '下列哪一種動物是哺乳類？', options: ['企鵝', '海豚', '鯊魚', '烏龜'], correct: [1], time: 10 },
                { text: '水在攝氏幾度會結冰？', options: ['0 度', '10 度', '32 度', '100 度'], correct: [0], time: 10 },
                { text: '臺灣最高的山是哪一座？', options: ['雪山', '合歡山', '玉山', '阿里山'], correct: [2], time: 20, double: true },
                { text: '地球繞太陽一圈大約需要多久？', options: ['一天', '一個月', '一年', '十年'], correct: [2], time: 10 }
            ]
        },
        {
            id: 'sample_math', title: '速算挑戰：四則運算', questions: [
                { text: '25 × 4 = ?', options: ['90', '100', '110', '125'], correct: [1], time: 10 },
                { text: '144 ÷ 12 = ?', options: ['11', '12', '13', '14'], correct: [1], time: 10 },
                { text: '下列哪些是偶數？（可複選）', options: ['17', '28', '35', '46'], correct: [1, 3], time: 20 },
                { text: '3 + 4 × 5 = ?', options: ['35', '23', '27', '60'], correct: [1], time: 20 },
                { text: '一盒鉛筆 12 枝，5 盒共有幾枝？', options: ['50', '55', '60', '65'], correct: [2], time: 20 },
                { text: '1000 − 387 = ?', options: ['613', '623', '713', '687'], correct: [0], time: 30, double: true }
            ]
        }
    ];

    async function ensureSamples() {
        const all = await list();
        if (all.length) return;
        for (const s of SAMPLES) await save(normalize(s).quiz);
    }

    async function list() {
        const rows = await tx('readonly', store => store.getAll());
        return (rows || []).sort((a, b) => b.updatedAt - a.updatedAt);
    }
    async function get(id) { return tx('readonly', store => store.get(id)); }
    async function save(quiz) {
        const { quiz: clean } = normalize({ ...quiz, id: quiz.id });
        clean.updatedAt = Date.now();
        await tx('readwrite', store => store.put(clean));
        return clean;
    }
    async function remove(id) { await tx('readwrite', store => store.delete(id)); }

    function exportJSON(quiz) {
        const blob = new Blob([JSON.stringify({ format: 'polik-classroom-quiz', version: 1, ...quiz }, null, 2)], { type: 'application/json' });
        download(blob, `${quiz.title || 'quiz'}.json`);
    }

    function download(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename.replace(/[\\/:*?"<>|]/g, '_');
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    /** 解析 CSV（支援引號、逗號、換行）。 */
    function parseCSV(text) {
        const rows = []; let row = [], cell = '', quoted = false;
        const s = String(text).replace(/^﻿/, '');
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (quoted) {
                if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
                else if (ch === '"') quoted = false;
                else cell += ch;
            } else if (ch === '"') quoted = true;
            else if (ch === ',') { row.push(cell); cell = ''; }
            else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && s[i + 1] === '\n') i++;
                row.push(cell); rows.push(row); row = []; cell = '';
            } else cell += ch;
        }
        if (cell || row.length) { row.push(cell); rows.push(row); }
        return rows.filter(r => r.some(c => String(c).trim()));
    }

    /** CSV 欄位：題目, 選項A, 選項B, 選項C, 選項D, 正確答案(A/B/AC…), 秒數；第一列若是標題會自動略過。 */
    function fromCSV(text, title = '匯入的題庫') {
        const rows = parseCSV(text);
        if (rows.length && /題目|question/i.test(rows[0][0] || '')) rows.shift();
        const questions = rows.map(r => {
            const options = r.slice(1, 5).map(v => String(v).trim()).filter(Boolean);
            const letters = String(r[5] || '').toUpperCase().replace(/[^A-D]/g, '');
            return { text: r[0], options, correct: [...letters].map(l => 'ABCD'.indexOf(l)), time: Number(r[6]) || 20 };
        });
        return normalize({ title, questions });
    }

    function csvTemplate() {
        const lines = ['題目,選項A,選項B,選項C,選項D,正確答案,秒數', '"臺灣最高的山是？",雪山,玉山,合歡山,阿里山,B,20', '"下列哪些是偶數？（可複選）",17,28,35,46,BD,20'];
        download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }), '闖關題庫範本.csv');
    }

    /** 把圖片壓成 ≤ 1280px、≤ 300 KB 的 JPEG data URL（只在投影幕顯示，不傳給學生）。 */
    function compressImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
                const cv = document.createElement('canvas');
                cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                let q = 0.85, url = cv.toDataURL('image/jpeg', q);
                while (url.length > LIMITS.image * 1.33 && q > 0.35) { q -= 0.1; url = cv.toDataURL('image/jpeg', q); }
                URL.revokeObjectURL(img.src);
                url.length > LIMITS.image * 1.4 ? reject(new Error('image_too_large')) : resolve(url);
            };
            img.onerror = () => reject(new Error('image_unreadable'));
            img.src = URL.createObjectURL(file);
        });
    }

    window.IrsQuizBank = { TIME_CHOICES, LIMITS, normalize, ensureSamples, list, get, save, remove, exportJSON, fromCSV, parseCSV, csvTemplate, compressImage, download, uid };
})();
