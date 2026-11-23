/* IRS 闖關模式聲音引擎（Polik 原創）
   - 全部以 Web Audio 即時合成：旋律、和弦進行、音色皆為本專案原創，無任何外部音檔與版權素材。
   - 曲目：lobby（大廳循環）、think（作答倒數循環，可調緊張度）、reveal（揭曉）、board（排行榜）、podium（頒獎）。
   - 音效：join, riser, tick, tickUrgent, timeUp, tap, correct, wrong, streak, rankUp, podium1/2/3。
   - 混音：主音量／音樂／音效三軌、壓縮限幅、ducking；設定存在 localStorage。
   用法：
     IrsSound.unlock();                 // 在使用者點擊時呼叫一次（iOS 需要）
     IrsSound.playMusic('lobby');       // 切換循環曲（自動淡入淡出）
     IrsSound.setIntensity(2);          // think：0 一般、1 剩 10 秒、2 剩 5 秒（升半音加速）
     IrsSound.stinger('reveal');        // 一次性樂段：reveal / board / podium
     IrsSound.sfx('correct');
     IrsSound.stopMusic();
     IrsSound.setVolume('music', 0.6);  // master / music / sfx，0～1
     IrsSound.duck(true);               // 老師說話時壓低音樂 */
(() => {
    'use strict';

    const STORE_KEY = 'class_irs_sound_v1';
    const LOOKAHEAD_MS = 25;
    const SCHEDULE_AHEAD = 0.12;
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

    // ───────────────────────── 曲目資料（原創） ─────────────────────────
    // 大廳：112 BPM，C 大調，C–G–Am–F 各兩小節，後半段加入原創鐘琴旋律。
    const LOBBY_CHORDS = [
        { root: 36, tones: [60, 64, 67] },  // C
        { root: 43, tones: [59, 62, 67] },  // G
        { root: 45, tones: [60, 64, 69] },  // Am
        { root: 41, tones: [60, 65, 69] }   // F
    ];
    // [小節, 步, MIDI, 長度(步)]
    const LOBBY_MELODY = [
        [4, 0, 81, 3], [4, 4, 84, 2], [4, 6, 83, 2], [4, 8, 81, 4], [4, 12, 76, 4],
        [5, 0, 79, 2], [5, 2, 81, 2], [5, 4, 84, 4], [5, 8, 88, 6],
        [6, 0, 77, 3], [6, 4, 81, 2], [6, 6, 84, 2], [6, 8, 81, 4], [6, 12, 79, 4],
        [7, 0, 76, 2], [7, 2, 77, 2], [7, 4, 79, 6], [7, 12, 74, 2], [7, 14, 76, 2]
    ];
    // 思考：128 BPM，A 小調，Am–F–Dm–E（和聲小調張力），每和弦一小節。
    const THINK_CHORDS = [
        { root: 45, tones: [57, 60, 64] },  // Am
        { root: 41, tones: [57, 60, 65] },  // F
        { root: 38, tones: [57, 62, 65] },  // Dm
        { root: 40, tones: [56, 59, 64] }   // E
    ];
    const THINK_BPM = [128, 132, 140];

    // ───────────────────────── 引擎 ─────────────────────────
    class SoundEngine {
        constructor() {
            this.ctx = null;
            this.settings = { master: 0.8, music: 0.7, sfx: 0.9, muted: false };
            try { Object.assign(this.settings, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch {}
            this.song = null;          // 目前循環曲
            this.songGain = null;
            this.step = 0;
            this.nextTime = 0;
            this.timer = null;
            this.intensity = 0;
            this.ducked = false;
            this.noise = null;
        }

        // 建立節點圖：各來源 → music/sfx bus → master → compressor → limiter → analyser → 輸出
        init(ctx) {
            if (this.ctx) return this.ctx;
            this.ctx = ctx || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
            const c = this.ctx;
            this.master = c.createGain();
            this.musicBus = c.createGain();
            this.sfxBus = c.createGain();
            this.duckGain = c.createGain();
            const comp = c.createDynamicsCompressor();
            comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
            const limiter = c.createDynamicsCompressor();
            limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
            this.analyser = c.createAnalyser();
            this.analyser.fftSize = 512;
            this.musicBus.connect(this.duckGain).connect(this.master);
            this.sfxBus.connect(this.master);
            this.master.connect(comp).connect(limiter).connect(this.analyser).connect(c.destination);
            // 簡易殘響：短回授延遲，讓合成器不那麼乾
            const delay = c.createDelay(1); delay.delayTime.value = 0.23;
            const fb = c.createGain(); fb.gain.value = 0.28;
            const wet = c.createGain(); wet.gain.value = 0.16;
            const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3200;
            this.fxSend = c.createGain();
            this.fxSend.connect(delay); delay.connect(tone).connect(fb).connect(delay); tone.connect(wet).connect(this.master);
            this.applyVolumes(true);
            return c;
        }

        /** 在使用者手勢中呼叫：建立／喚醒音訊，並播放一個無聲緩衝以解鎖 iOS。 */
        unlock() {
            const c = this.init();
            if (c.state === 'suspended') c.resume();
            const b = c.createBuffer(1, 1, 22050);
            const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
            return c.state;
        }

        save() {
            try { localStorage.setItem(STORE_KEY, JSON.stringify(this.settings)); } catch {}
        }

        applyVolumes(immediate = false) {
            if (!this.ctx) return;
            const t = this.ctx.currentTime;
            const set = (param, v) => immediate ? param.setValueAtTime(v, t) : param.setTargetAtTime(v, t, 0.05);
            set(this.master.gain, this.settings.muted ? 0 : this.settings.master);
            set(this.musicBus.gain, this.settings.music * 0.9);
            set(this.sfxBus.gain, this.settings.sfx);
            set(this.duckGain.gain, this.ducked ? 0.4 : 1);
        }

        setVolume(kind, value) {
            if (!['master', 'music', 'sfx'].includes(kind)) return;
            this.settings[kind] = Math.max(0, Math.min(1, Number(value)));
            this.save();
            this.applyVolumes();
        }

        setMuted(muted) {
            this.settings.muted = Boolean(muted);
            this.save();
            this.applyVolumes();
        }

        duck(on) {
            this.ducked = Boolean(on);
            this.applyVolumes();
        }

        noiseBuffer() {
            if (this.noise) return this.noise;
            const c = this.ctx;
            const buf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            this.noise = buf;
            return buf;
        }

        // ───────── 樂器（out 為目標節點） ─────────
        env(g, t, peak, a, d, s = 0, r = 0, hold = 0) {
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
            if (s > 0) {
                g.gain.exponentialRampToValueAtTime(Math.max(peak * s, 0.0002), t + a + d);
                g.gain.setValueAtTime(Math.max(peak * s, 0.0002), t + a + d + hold);
                g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + hold + r);
                return t + a + d + hold + r;
            }
            g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
            return t + a + d;
        }

        kick(out, t, vel = 1) {
            const c = this.ctx, o = c.createOscillator(), g = c.createGain();
            o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
            o.connect(g).connect(out);
            o.start(t); o.stop(this.env(g, t, 0.9 * vel, 0.003, 0.32) + 0.02);
        }

        noiseHit(out, t, { vel = 0.5, type = 'highpass', freq = 6000, q = 0.7, decay = 0.05, attack = 0.001 } = {}) {
            const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
            s.buffer = this.noiseBuffer(); f.type = type; f.frequency.value = freq; f.Q.value = q;
            s.connect(f).connect(g).connect(out);
            s.start(t, Math.random() * 0.5); s.stop(this.env(g, t, vel, attack, decay) + 0.02);
        }

        hat(out, t, vel = 0.2, open = false) {
            this.noiseHit(out, t, { vel, freq: 7500, decay: open ? 0.22 : 0.035 });
        }

        snare(out, t, vel = 0.5) {
            this.noiseHit(out, t, { vel, type: 'bandpass', freq: 1900, q: 0.6, decay: 0.16 });
            const c = this.ctx, o = c.createOscillator(), g = c.createGain();
            o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
            o.connect(g).connect(out); o.start(t); o.stop(this.env(g, t, vel * 0.5, 0.002, 0.1) + 0.02);
        }

        clap(out, t, vel = 0.35) {
            [0, 0.011, 0.023].forEach((dt, i) => this.noiseHit(out, t + dt, { vel: vel * (i === 2 ? 1 : 0.6), type: 'bandpass', freq: 1300, q: 1.1, decay: i === 2 ? 0.14 : 0.012 }));
        }

        crash(out, t, vel = 0.3, decay = 1.4) {
            this.noiseHit(out, t, { vel, freq: 4800, decay });
            this.fxSendFrom(out, t, decay);
        }

        tom(out, t, freq = 110, vel = 0.6, decay = 0.35) {
            const c = this.ctx, o = c.createOscillator(), g = c.createGain();
            o.frequency.setValueAtTime(freq * 1.6, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
            o.connect(g).connect(out); o.start(t); o.stop(this.env(g, t, vel, 0.002, decay) + 0.02);
        }

        bass(out, t, midi, dur, vel = 0.32) {
            const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
            o.type = 'sawtooth'; o.frequency.value = mtof(midi);
            f.type = 'lowpass'; f.Q.value = 5;
            f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(220, t + Math.min(dur, 0.25));
            o.connect(f).connect(g).connect(out);
            o.start(t); o.stop(this.env(g, t, vel, 0.005, 0.06, 0.6, 0.06, Math.max(0, dur - 0.12)) + 0.02);
        }

        pad(out, t, midis, dur, vel = 0.05) {
            const c = this.ctx, f = c.createBiquadFilter(), g = c.createGain();
            f.type = 'lowpass'; f.frequency.value = 1500; f.Q.value = 0.4;
            f.connect(g).connect(out);
            g.connect(this.fxSend);
            const end = this.env(g, t, vel, 0.35, 0.3, 0.8, 0.7, Math.max(0, dur - 0.65));
            midis.forEach(m => [-7, 7].forEach(cents => {
                const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = cents;
                o.connect(f); o.start(t); o.stop(end + 0.05);
            }));
        }

        pluck(out, t, midi, vel = 0.08, type = 'triangle', decay = 0.28, cutoff = 2600) {
            const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
            o.type = type; o.frequency.value = mtof(midi);
            f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(500, t + decay);
            o.connect(f).connect(g).connect(out); g.connect(this.fxSend);
            o.start(t); o.stop(this.env(g, t, vel, 0.003, decay) + 0.02);
        }

        bell(out, t, midi, dur = 0.8, vel = 0.15) {
            const c = this.ctx, g = c.createGain();
            g.connect(out); g.connect(this.fxSend);
            const end = this.env(g, t, vel, 0.004, Math.max(0.4, dur));
            [[1, 1], [2.76, 0.35], [5.4, 0.12]].forEach(([ratio, amp]) => {
                const o = c.createOscillator(), og = c.createGain();
                o.frequency.value = mtof(midi) * ratio; og.gain.value = amp;
                o.connect(og).connect(g); o.start(t); o.stop(end + 0.02);
            });
        }

        brass(out, t, midi, dur, vel = 0.12) {
            const c = this.ctx, f = c.createBiquadFilter(), g = c.createGain();
            f.type = 'lowpass'; f.Q.value = 1.2;
            f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.06); f.frequency.exponentialRampToValueAtTime(1400, t + 0.3);
            f.connect(g).connect(out); g.connect(this.fxSend);
            const end = this.env(g, t, vel, 0.035, 0.12, 0.75, 0.25, Math.max(0, dur - 0.4));
            [-6, 6].forEach(cents => {
                const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(midi); o.detune.value = cents;
                o.connect(f); o.start(t); o.stop(end + 0.03);
            });
        }

        blip(out, t, f0, f1, dur = 0.09, vel = 0.25, type = 'sine') {
            const c = this.ctx, o = c.createOscillator(), g = c.createGain();
            o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
            o.connect(g).connect(out); o.start(t); o.stop(this.env(g, t, vel, 0.004, dur) + 0.02);
        }

        fxSendFrom(_out, _t, _d) { /* 保留：crash 已有自然衰減 */ }

        // ───────── 循環曲：每 16 分音符呼叫一次 ─────────
        lobbyStep(out, s, t, spb) {
            const bar = Math.floor(s / 16) % 8, st = s % 16, ch = LOBBY_CHORDS[Math.floor(bar / 2)];
            if (st === 0 || st === 10) this.kick(out, t, st === 0 ? 0.8 : 0.55);
            if (st === 4 || st === 12) this.clap(out, t, 0.28);
            if (st % 4 === 2) this.hat(out, t, 0.14); else if (st % 2 === 1) this.hat(out, t, 0.05);
            if ([0, 3, 6, 8, 11, 14].includes(st)) this.bass(out, t, ch.root + (st === 6 || st === 14 ? 12 : 0), spb * 1.6, 0.26);
            if (st === 0 && bar % 2 === 0) this.pad(out, t, ch.tones, spb * 32, 0.035);
            if (st % 2 === 0) this.pluck(out, t, ch.tones[[0, 1, 2, 1][(st / 2) % 4]] + 12, 0.05);
            LOBBY_MELODY.forEach(([b, ms, m, len]) => { if (b === bar && ms === st) this.bell(out, t, m, spb * len, 0.11); });
        }

        thinkStep(out, s, t, spb) {
            const bar = Math.floor(s / 16) % 4, st = s % 16, ch = THINK_CHORDS[bar];
            const up = this.intensity >= 2 ? 1 : 0, lvl = this.intensity;
            if (st % 4 === 0) this.kick(out, t, 0.75);
            if (lvl >= 1 && (st === 4 || st === 12)) this.snare(out, t, 0.38);
            if (lvl >= 2 && st === 14) this.snare(out, t, 0.22);
            if (st % 4 === 2) this.hat(out, t, 0.16, lvl >= 1 && st === 14);
            else if (lvl >= 1 || st % 2 === 0) this.hat(out, t, 0.05);
            if (st % 2 === 0) this.bass(out, t, ch.root + up + (st % 4 === 2 ? 12 : 0), spb * 1.4, 0.28);
            this.pluck(out, t, ch.tones[[0, 1, 2, 1][st % 4]] + 12 + up, st % 4 === 0 ? 0.06 : 0.035, 'square', 0.12, 1800 + lvl * 900);
            if (st === 0) this.pad(out, t, ch.tones.map(m => m - 12 + up), spb * 16, 0.03 + lvl * 0.01);
        }

        // ───────── 循環播放控制 ─────────
        playMusic(name) {
            this.init();
            if (this.song === name) return;
            this.stopMusic(0.5);
            const songs = { lobby: { bpm: () => 112, step: this.lobbyStep }, think: { bpm: () => THINK_BPM[this.intensity] || 128, step: this.thinkStep } };
            const song = songs[name];
            if (!song) return;
            if (name === 'think') this.intensity = 0;
            this.song = name;
            this.songDef = song;
            this.songGain = this.ctx.createGain();
            this.songGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
            this.songGain.gain.exponentialRampToValueAtTime(1, this.ctx.currentTime + 0.4);
            this.songGain.connect(this.musicBus);
            this.step = 0;
            this.nextTime = this.ctx.currentTime + 0.06;
            this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS);
            this.tick();
        }

        tick() {
            if (!this.songDef) return;
            while (this.nextTime < this.ctx.currentTime + SCHEDULE_AHEAD) {
                const spb = 60 / this.songDef.bpm() / 4;
                this.songDef.step.call(this, this.songGain, this.step, this.nextTime, spb);
                this.nextTime += spb;
                this.step += 1;
            }
        }

        stopMusic(fade = 0.6) {
            window.clearInterval(this.timer);
            this.timer = null;
            if (this.songGain && this.ctx) {
                const g = this.songGain, t = this.ctx.currentTime;
                g.gain.cancelScheduledValues(t);
                g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
                g.gain.exponentialRampToValueAtTime(0.0001, t + fade);
                window.setTimeout(() => g.disconnect(), (fade + 0.3) * 1000);
            }
            this.song = null;
            this.songDef = null;
            this.songGain = null;
        }

        setIntensity(level) {
            this.intensity = Math.max(0, Math.min(2, level | 0));
        }

        // ───────── 一次性樂段 ─────────
        stinger(name, at) {
            this.init();
            const out = this.ctx.createGain();
            out.connect(this.musicBus);
            const t = at ?? this.ctx.currentTime + 0.03;
            if (name === 'reveal') {
                [60, 64, 67, 72, 76, 79].forEach((m, i) => this.pluck(out, t + i * 0.035, m, 0.09, 'sawtooth', 0.5, 4000));
                this.kick(out, t + 0.22, 1); this.crash(out, t + 0.22, 0.25, 1.2);
                this.brass(out, t + 0.22, 60, 0.7, 0.07); this.brass(out, t + 0.22, 67, 0.7, 0.06); this.brass(out, t + 0.22, 76, 0.7, 0.05);
                return 1.4;
            }
            if (name === 'board') {
                for (let i = 0; i < 24; i++) this.tom(out, t + i * 0.06, 92, 0.12 + i * 0.022, 0.18);
                const hit = t + 1.5;
                this.kick(out, hit, 1); this.crash(out, hit, 0.3, 1.6);
                [48, 55, 64, 67, 72].forEach(m => this.brass(out, hit, m, 0.9, 0.05));
                return 2.6;
            }
            if (name === 'podium') {
                const spb = 60 / 104 / 4;
                const tune = [[0, 67, 2], [2, 67, 2], [4, 72, 6], [10, 76, 2], [12, 79, 4], [16, 76, 2], [18, 79, 2], [20, 84, 10], [32, 81, 3], [36, 79, 2], [38, 77, 2], [40, 76, 4], [44, 74, 4], [48, 72, 16]];
                tune.forEach(([s, m, len]) => { this.brass(out, t + s * spb, m, len * spb, 0.1); this.brass(out, t + s * spb, m - 12, len * spb, 0.05); });
                [[0, [48, 55, 64]], [16, [53, 57, 65]], [32, [50, 57, 65]], [40, [55, 59, 67]], [48, [48, 55, 64]]].forEach(([s, ch]) => this.pad(out, t + s * spb, ch, (s === 48 ? 16 : 8) * spb + 0.6, 0.04));
                for (let s = 0; s < 64; s += 4) this.kick(out, t + s * spb, s % 16 === 0 ? 0.9 : 0.5);
                [0, 16, 48].forEach(s => this.crash(out, t + s * spb, 0.22, 1.6));
                for (let i = 0; i < 10; i++) this.tom(out, t + 46 * spb + i * 0.035, 100, 0.1 + i * 0.05, 0.14);
                return 64 * spb + 1.5;
            }
            return 0;
        }

        // ───────── 音效 ─────────
        sfx(name, at) {
            this.init();
            if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function' && !(window.OfflineAudioContext && this.ctx instanceof OfflineAudioContext)) this.ctx.resume();
            const out = this.sfxBus, t = at ?? this.ctx.currentTime + 0.01;
            switch (name) {
                case 'join': {
                    const base = 620 + Math.random() * 260;
                    this.blip(out, t, base, base * 2, 0.07, 0.22);
                    this.blip(out, t + 0.05, base * 1.5, base * 2.6, 0.06, 0.12);
                    break;
                }
                case 'riser': {
                    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
                    s.buffer = this.noiseBuffer(); f.type = 'bandpass'; f.Q.value = 3;
                    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(6000, t + 1.4);
                    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
                    s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + 1.55);
                    this.blip(out, t, 180, 720, 1.4, 0.09, 'sawtooth');
                    this.kick(out, t + 1.45, 0.8);
                    break;
                }
                case 'tick': this.blip(out, t, 1250, 1150, 0.035, 0.28, 'triangle'); break;
                case 'tickUrgent':
                    this.blip(out, t, 1700, 1550, 0.04, 0.34, 'triangle');
                    this.blip(out, t + 0.09, 1700, 1550, 0.03, 0.18, 'triangle');
                    break;
                case 'timeUp':
                    this.bell(out, t, 76, 1.2, 0.28); this.bell(out, t + 0.18, 69, 1.6, 0.3);
                    this.tom(out, t + 0.18, 70, 0.6, 0.6);
                    break;
                case 'tap':
                    this.blip(out, t, 900, 520, 0.03, 0.2, 'sine');
                    if (navigator.vibrate) { try { navigator.vibrate(15); } catch {} }
                    break;
                case 'correct':
                    [72, 76, 79, 84].forEach((m, i) => this.bell(out, t + i * 0.07, m, 0.7, 0.18));
                    this.pad(out, t + 0.2, [60, 64, 67], 0.6, 0.04);
                    break;
                case 'wrong':
                    this.pluck(out, t, 64, 0.14, 'triangle', 0.3, 1200);
                    this.pluck(out, t + 0.16, 60, 0.12, 'triangle', 0.45, 900);
                    break;
                case 'streak':
                    this.noiseHit(out, t, { vel: 0.18, type: 'bandpass', freq: 2500, q: 1.5, decay: 0.35, attack: 0.18 });
                    [79, 83, 86, 91].forEach((m, i) => this.pluck(out, t + 0.12 + i * 0.06, m, 0.12, 'square', 0.18, 5000));
                    break;
                case 'rankUp':
                    this.blip(out, t, 500, 1500, 0.18, 0.16, 'triangle');
                    [88, 91, 96].forEach((m, i) => this.bell(out, t + 0.16 + i * 0.05, m, 0.4, 0.07));
                    break;
                case 'podium3': case 'podium2': case 'podium1': {
                    const lift = { podium3: 0, podium2: 4, podium1: 7 }[name];
                    this.kick(out, t, 1);
                    [48, 55, 64, 67].forEach(m => this.brass(out, t, m + lift, name === 'podium1' ? 1.4 : 0.8, 0.07));
                    this.crash(out, t, name === 'podium1' ? 0.32 : 0.2, 1.4);
                    if (name === 'podium1') [84, 88, 91, 96].forEach((m, i) => this.bell(out, t + 0.1 + i * 0.08, m, 0.9, 0.1));
                    break;
                }
                default:
            }
        }

        /** 給測試用：以 OfflineAudioContext 渲染一段循環曲，回傳 AudioBuffer。 */
        async renderOffline(name, seconds = 8, intensity = 0) {
            const off = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
            const eng = new SoundEngine();
            eng.settings = { master: 0.8, music: 0.7, sfx: 0.9, muted: false };
            eng.init(off);
            eng.intensity = intensity;
            const out = off.createGain(); out.connect(eng.musicBus);
            if (name === 'lobby' || name === 'think') {
                const stepFn = name === 'lobby' ? eng.lobbyStep : eng.thinkStep;
                const bpm = name === 'lobby' ? 112 : THINK_BPM[intensity];
                const spb = 60 / bpm / 4;
                for (let s = 0, t = 0.05; t < seconds - 0.5; s++, t += spb) stepFn.call(eng, out, s, t, spb);
            } else if (['reveal', 'board', 'podium'].includes(name)) {
                eng.stinger(name, 0.05);
            } else {
                eng.sfx(name, 0.05);
            }
            return off.startRendering();
        }
    }

    window.IrsSound = new SoundEngine();
    window.IrsSound.SoundEngine = SoundEngine;
})();
