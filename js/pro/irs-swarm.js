/* IRS Swarm 課堂網：讓已直連老師的學生裝置升格為「中繼節點」，替老師分擔扇出。

   拓撲（兩層樹）：老師 ─DataChannel→ 中繼學生 ─DataChannel→ 子學生
   - 握手訊號經由老師轉送：子學生 ⇄ (Durable Object) ⇄ 老師 ⇄ (DataChannel) ⇄ 中繼，不需修改後端。
   - 下行（老師→子學生）：老師以 ECDSA P-256 簽章，子學生驗章；中繼無法偽造或竄改題目、ACK。
   - 上行（子學生→老師）：子學生以 ECDH(P-256) 與老師推導 AES-GCM 金鑰加密；中繼看不到同學答案。
   - 子學生若與中繼斷線，沿用傳輸層既有流程自動改走雲端中繼；messageId 去重確保不重複計分。

   啟用：老師端網址加 ?transport=hybrid&swarm=1（實機驗收前不設為預設）。
   測試用：&swarmDirect=N 可調整「老師保留給一般學生的直連數」。 */
(() => {
    'use strict';

    const DEFAULT_DIRECT_CAP = 10;     // 老師直接服務的一般學生數，超過後新學生改掛中繼
    const MAX_RELAYS = 8;              // 中繼節點上限
    const CHILDREN_PER_RELAY = 12;     // 每個中繼最多子學生
    const ADOPT_TIMEOUT_MS = 10_000;   // 中繼與子學生握手逾時
    const CHILD_OFFLINE_GRACE_MS = 5_000;
    const HEARTBEAT_MS = 2_000;        // 中繼對子學生的心跳間隔
    const HEARTBEAT_DEAD_MS = 7_000;   // 子學生超過此時間沒收到中繼任何封包即判定斷線

    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const unb64u = text => {
        const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
        const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
        return Uint8Array.from(bin, c => c.charCodeAt(0));
    };
    const SIGN_ALG = { name: 'ECDSA', namedCurve: 'P-256' };
    const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' };
    const ECDH_ALG = { name: 'ECDH', namedCurve: 'P-256' };

    async function fingerprintOf(signRaw, ecdhRaw) {
        const joined = new Uint8Array(signRaw.length + ecdhRaw.length);
        joined.set(signRaw, 0);
        joined.set(ecdhRaw, signRaw.length);
        const digest = await crypto.subtle.digest('SHA-256', joined);
        return b64u(digest).slice(0, 22);
    }

    function deviceCaps() {
        const caps = {
            cores: Number(navigator.hardwareConcurrency || 0),
            wide: Math.max(screen.width || 0, screen.height || 0) >= 1000,
            touch: 'ontouchstart' in window,
            charging: null,
            level: null
        };
        const battery = navigator.getBattery ? navigator.getBattery().catch(() => null) : Promise.resolve(null);
        return battery.then(b => {
            if (b) { caps.charging = Boolean(b.charging); caps.level = Number(b.level); }
            return caps;
        });
    }

    function relayScore(caps) {
        if (!caps) return -1;
        if (caps.charging === false && caps.level !== null && caps.level < 0.5) return -1;
        let score = 0;
        if (caps.wide) score += 2;
        if (!caps.touch) score += 2;
        if (caps.charging) score += 2;
        if (caps.cores >= 4) score += 1;
        return score;
    }

    class IrsSwarm {
        constructor(transport) {
            this.t = transport;
            const params = new URLSearchParams(location.search);
            this.enabled = params.get('swarm') === '1';
            this.directCap = Math.max(1, Number.parseInt(params.get('swarmDirect') || '', 10) || DEFAULT_DIRECT_CAP);
            this.expectedFingerprint = params.get('k') || null;
            // 老師端
            this.keys = null;            // { sign: CryptoKeyPair, ecdh: CryptoKeyPair }
            this.publicKeys = null;      // { sign, ecdh }（base64url raw）
            this.fingerprint = null;
            this.relayNodes = new Map(); // relayId -> Set(childId)
            this.childParent = new Map();// childId -> relayId
            this.childReady = new Set();
            this.caps = new Map();       // clientId -> caps
            this.adoptTimers = new Map();
            this.childKeys = new Map();  // epk -> AES key
            this.downChain = Promise.resolve();
            // 中繼端（學生）
            this.children = new Map();   // childId -> record
            // 子學生端
            this.teacherKeys = null;     // { sign: CryptoKey, ecdhAes: CryptoKey, epk }
            this.upChain = Promise.resolve();
            this.lastRelaySeen = 0;
            this.heartbeatTimer = null;
            this.watchdogTimer = null;
        }

        // ───────────────────────── 老師：金鑰 ─────────────────────────
        async prepareTeacher(savedKeys) {
            if (!this.enabled || !crypto?.subtle) return null;
            this.keys = savedKeys?.sign && savedKeys?.ecdh ? savedKeys : {
                sign: await crypto.subtle.generateKey(SIGN_ALG, false, ['sign', 'verify']),
                ecdh: await crypto.subtle.generateKey(ECDH_ALG, false, ['deriveKey'])
            };
            const signRaw = new Uint8Array(await crypto.subtle.exportKey('raw', this.keys.sign.publicKey));
            const ecdhRaw = new Uint8Array(await crypto.subtle.exportKey('raw', this.keys.ecdh.publicKey));
            this.publicKeys = { sign: b64u(signRaw), ecdh: b64u(ecdhRaw) };
            this.fingerprint = await fingerprintOf(signRaw, ecdhRaw);
            return this.keys;
        }

        async sign(data) {
            const sig = await crypto.subtle.sign(SIGN_PARAMS, this.keys.sign.privateKey, enc.encode(data));
            return b64u(sig);
        }

        async childAesKey(epk) {
            if (this.childKeys.has(epk)) return this.childKeys.get(epk);
            const pub = await crypto.subtle.importKey('raw', unb64u(epk), ECDH_ALG, false, []);
            const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, this.keys.ecdh.privateKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
            this.childKeys.set(epk, key);
            return key;
        }

        // ───────────────────────── 老師：拓撲 ─────────────────────────
        activeDirectCount() {
            let n = 0;
            this.t.peers.forEach(record => { if (!record.closed) n += 1; });
            return n;
        }

        /** 新學生上線時呼叫；回傳 true 表示已交由中繼處理。 */
        onStudentOnline(childId) {
            if (!this.enabled || this.t.role !== 'teacher' || !this.keys) return false;
            if (this.childParent.has(childId)) return true;
            const ordinaryDirect = this.activeDirectCount() - this.relayNodes.size;
            if (ordinaryDirect < this.directCap) return false;
            const relayId = this.pickRelay(childId);
            if (!relayId) return false;
            this.adopt(relayId, childId);
            return true;
        }

        pickRelay(childId) {
            const existing = [...this.relayNodes.entries()]
                .filter(([id, kids]) => kids.size < CHILDREN_PER_RELAY && this.t.peerIsDirect(id) && id !== childId)
                .sort((a, b) => a[1].size - b[1].size);
            if (existing.length) return existing[0][0];
            if (this.relayNodes.size >= MAX_RELAYS) return null;
            const candidates = [...this.t.peers.keys()]
                .filter(id => this.t.peerIsDirect(id) && !this.relayNodes.has(id) && relayScore(this.caps.get(id)) >= 0)
                .sort((a, b) => relayScore(this.caps.get(b)) - relayScore(this.caps.get(a)));
            if (!candidates.length) return null;
            this.relayNodes.set(candidates[0], new Set());
            return candidates[0];
        }

        adopt(relayId, childId) {
            this.relayNodes.get(relayId).add(childId);
            this.childParent.set(childId, relayId);
            this.sendToPeer(relayId, { type: 'swarm.adopt', payload: { childId } });
            window.clearTimeout(this.adoptTimers.get(childId));
            this.adoptTimers.set(childId, window.setTimeout(() => {
                if (this.childReady.has(childId)) return;
                this.release(childId, true);
                this.t.relayClients.add(childId); // 留在雲端中繼
            }, ADOPT_TIMEOUT_MS));
        }

        release(childId, notifyRelay) {
            const relayId = this.childParent.get(childId);
            window.clearTimeout(this.adoptTimers.get(childId));
            this.adoptTimers.delete(childId);
            this.childParent.delete(childId);
            this.childReady.delete(childId);
            if (relayId) {
                this.relayNodes.get(relayId)?.delete(childId);
                if (notifyRelay) this.sendToPeer(relayId, { type: 'swarm.release', payload: { childId } });
            }
        }

        sendToPeer(peerId, message) {
            const record = this.t.peers.get(peerId);
            if (record?.ready && record.channel?.readyState === 'open') {
                record.channel.send(JSON.stringify({ v: 1, ...message }));
                return true;
            }
            return false;
        }

        /** 老師的中繼節點斷線：其子學生自行改走雲端中繼，老師端清理對應關係。 */
        onPeerClosed(peerId) {
            if (this.t.role !== 'teacher') return;
            const kids = this.relayNodes.get(peerId);
            if (!kids) return;
            this.relayNodes.delete(peerId);
            [...kids].forEach(childId => {
                this.release(childId, false);
                this.scheduleChildOffline(childId);
            });
        }

        scheduleChildOffline(childId) {
            window.clearTimeout(this.t.offlineTimers.get(childId));
            this.t.offlineTimers.set(childId, window.setTimeout(() => {
                if (this.childReady.has(childId) || this.t.relayClients.has(childId) || this.t.peerIsDirect(childId)) return;
                this.t.connections.delete(childId);
                this.t.onServerEvent({ type: 'server.student-offline', payload: { clientId: childId, mode: 'swarm' } });
            }, CHILD_OFFLINE_GRACE_MS));
        }

        isChildReady(childId) {
            const relayId = this.childParent.get(childId);
            return Boolean(relayId && this.childReady.has(childId) && this.t.peerIsDirect(relayId));
        }

        /** 子學生經 DO 送來、帶 via 的握手訊號 → 轉給中繼。 */
        forwardFromChild(message) {
            const childId = message.senderId;
            const via = message.payload?.via;
            if (!childId || this.childParent.get(childId) !== via) return;
            const kind = message.type === 'signal.answer' ? 'answer' : 'ice';
            this.sendToPeer(via, { type: 'swarm.signal', payload: { from: childId, kind, description: message.payload.description, candidate: message.payload.candidate } });
        }

        /** 老師收到中繼 DataChannel 的 swarm.* 訊息。 */
        async handleFromRelay(relayId, message) {
            const p = message.payload || {};
            switch (message.type) {
                case 'swarm.caps':
                    this.caps.set(relayId, p);
                    return;
                case 'swarm.signal': {
                    if (this.childParent.get(p.to) !== relayId) return;
                    const payload = { via: relayId };
                    if (p.kind === 'offer') {
                        payload.description = p.description;
                        payload.teacherKeys = this.publicKeys;
                        this.t.sendControl('signal.offer', payload, p.to);
                    } else if (p.kind === 'ice') {
                        payload.candidate = p.candidate;
                        this.t.sendControl('signal.ice', payload, p.to);
                    }
                    return;
                }
                case 'swarm.child-ready':
                    if (this.childParent.get(p.childId) !== relayId) return;
                    window.clearTimeout(this.adoptTimers.get(p.childId));
                    this.childReady.add(p.childId);
                    this.t.relayClients.delete(p.childId);
                    window.clearTimeout(this.t.offlineTimers.get(p.childId));
                    this.t.onStateChange({ state: 'direct', role: 'teacher', clientId: p.childId, via: relayId });
                    return;
                case 'swarm.child-left':
                    if (this.childParent.get(p.childId) !== relayId) return;
                    this.release(p.childId, false);
                    this.scheduleChildOffline(p.childId);
                    return;
                case 'swarm.up': {
                    if (this.childParent.get(p.from) !== relayId || typeof p.data !== 'string') return;
                    let inner;
                    try { inner = JSON.parse(p.data); } catch { return; }
                    if (inner?.type !== 'swarm.sealed') return; // 子學生上行必須加密
                    try {
                        const key = await this.childAesKey(inner.epk);
                        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(inner.iv) }, key, unb64u(inner.ct));
                        const envelope = JSON.parse(dec.decode(plain));
                        const legacy = envelope?.payload?.legacy;
                        if (legacy && typeof legacy === 'object') this.t.deliverLegacy(p.from, legacy, envelope);
                    } catch (error) {
                        console.warn('IRS swarm: 無法解密子學生訊息', error);
                    }
                    return;
                }
                default:
            }
        }

        /** 老師送單一子學生（經中繼、簽章）。 */
        sendDown(childId, serialized) {
            const relayId = this.childParent.get(childId);
            this.downChain = this.downChain.then(async () => {
                const sig = await this.sign(serialized);
                this.sendToPeer(relayId, { type: 'swarm.down', payload: { to: childId, data: serialized, sig } });
            }).catch(error => console.warn('IRS swarm sendDown failed', error));
        }

        /** 老師廣播：每個有子學生的中繼只送一次，由中繼扇出。 */
        broadcastDown(serialized, excludeClientId) {
            if (!this.enabled || !this.keys) return;
            const relays = [...this.relayNodes.entries()].filter(([id, kids]) => [...kids].some(k => this.childReady.has(k)) && this.t.peerIsDirect(id));
            if (!relays.length) return;
            this.downChain = this.downChain.then(async () => {
                const sig = await this.sign(serialized);
                relays.forEach(([relayId]) => this.sendToPeer(relayId, { type: 'swarm.down', payload: { to: '*', exclude: excludeClientId || null, data: serialized, sig } }));
            }).catch(error => console.warn('IRS swarm broadcast failed', error));
        }

        stats() {
            return { swarm: this.childReady.size, relayNodes: [...this.relayNodes.values()].filter(k => k.size).length };
        }

        // ───────────────────────── 中繼端（學生） ─────────────────────────
        onStudentDirectOpen(record) {
            if (this.t.role !== 'student' || record.via) return;
            deviceCaps().then(caps => {
                if (record.ready && record.channel?.readyState === 'open') {
                    record.channel.send(JSON.stringify({ v: 1, type: 'swarm.caps', payload: caps }));
                }
            });
        }

        sendUp(message) {
            const record = this.t.studentPeer;
            if (record?.ready && !record.via && record.channel?.readyState === 'open') {
                record.channel.send(JSON.stringify({ v: 1, ...message }));
            }
        }

        handleFromTeacher(message) {
            const p = message.payload || {};
            if (message.type === 'swarm.adopt') return this.adoptChild(p.childId);
            if (message.type === 'swarm.release') return this.dropChild(p.childId, false);
            if (message.type === 'swarm.signal') return this.applyChildSignal(p);
            if (message.type === 'swarm.down') {
                const packet = JSON.stringify({ v: 1, type: 'swarm.deliver', data: p.data, sig: p.sig });
                if (p.to === '*') {
                    this.children.forEach((child, id) => {
                        if (id !== p.exclude && child.ready && child.channel?.readyState === 'open') child.channel.send(packet);
                    });
                } else {
                    const child = this.children.get(p.to);
                    if (child?.ready && child.channel?.readyState === 'open') child.channel.send(packet);
                }
            }
        }

        adoptChild(childId) {
            if (!childId || this.t.studentPeer?.via || this.children.size >= CHILDREN_PER_RELAY || this.children.has(childId)) {
                this.sendUp({ type: 'swarm.child-left', payload: { childId } });
                return;
            }
            const pc = new RTCPeerConnection({ iceServers: this.t.constructor.iceServers() });
            const child = { childId, pc, channel: null, ready: false, pending: [], timer: null };
            this.children.set(childId, child);
            pc.addEventListener('icecandidate', event => {
                if (event.candidate) this.sendUp({ type: 'swarm.signal', payload: { to: childId, kind: 'ice', candidate: event.candidate } });
            });
            pc.addEventListener('connectionstatechange', () => {
                if (['failed', 'closed'].includes(pc.connectionState)) this.dropChild(childId, true);
            });
            const channel = pc.createDataChannel('irs-swarm', { ordered: true });
            child.channel = channel;
            channel.addEventListener('open', () => {
                child.ready = true;
                window.clearTimeout(child.timer);
                this.sendUp({ type: 'swarm.child-ready', payload: { childId } });
                this.t.media?.onChildReady(child);
                this.ensureHeartbeat();
            });
            channel.addEventListener('message', event => {
                if (typeof event.data === 'string' && event.data.startsWith('{"v":1,"type":"media.')) {
                    try {
                        const msg = JSON.parse(event.data);
                        this.t.media?.handle(pc, msg, reply => channel.readyState === 'open' && channel.send(JSON.stringify(reply)));
                    } catch {}
                    return;
                }
                if (typeof event.data === 'string' && event.data.length <= 16_384) {
                    this.sendUp({ type: 'swarm.up', payload: { from: childId, data: event.data } });
                }
            });
            channel.addEventListener('close', () => this.dropChild(childId, true));
            child.timer = window.setTimeout(() => { if (!child.ready) this.dropChild(childId, true); }, ADOPT_TIMEOUT_MS);
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => this.sendUp({ type: 'swarm.signal', payload: { to: childId, kind: 'offer', description: pc.localDescription } }))
                .catch(() => this.dropChild(childId, true));
        }

        async applyChildSignal(p) {
            const child = this.children.get(p.from);
            if (!child) return;
            try {
                if (p.kind === 'answer' && p.description) {
                    await child.pc.setRemoteDescription(p.description);
                    for (const c of child.pending.splice(0)) await child.pc.addIceCandidate(c);
                } else if (p.kind === 'ice' && p.candidate) {
                    if (child.pc.remoteDescription) await child.pc.addIceCandidate(p.candidate);
                    else child.pending.push(p.candidate);
                }
            } catch {
                this.dropChild(p.from, true);
            }
        }

        dropChild(childId, notify) {
            const child = this.children.get(childId);
            if (!child) return;
            this.children.delete(childId);
            window.clearTimeout(child.timer);
            try { child.channel?.close(); } catch {}
            try { child.pc?.close(); } catch {}
            if (notify) this.sendUp({ type: 'swarm.child-left', payload: { childId } });
        }

        ensureHeartbeat() {
            if (this.heartbeatTimer) return;
            this.heartbeatTimer = window.setInterval(() => {
                if (!this.children.size) {
                    window.clearInterval(this.heartbeatTimer);
                    this.heartbeatTimer = null;
                    return;
                }
                const ping = JSON.stringify({ v: 1, type: 'swarm.ping', t: Date.now() });
                this.children.forEach(child => { if (child.ready && child.channel?.readyState === 'open') child.channel.send(ping); });
            }, HEARTBEAT_MS);
        }

        /** 子學生：任何來自中繼的封包都視為存活訊號。 */
        noteRelayAlive() {
            this.lastRelaySeen = Date.now();
            if (this.watchdogTimer) return;
            this.watchdogTimer = window.setInterval(() => {
                const record = this.t.studentPeer;
                if (!record?.via) {
                    window.clearInterval(this.watchdogTimer);
                    this.watchdogTimer = null;
                    return;
                }
                if (record.ready && Date.now() - this.lastRelaySeen > HEARTBEAT_DEAD_MS) {
                    console.warn('IRS swarm: 中繼心跳逾時，改走雲端中繼');
                    this.t.handleDirectFailure(record);
                }
            }, 1_000);
        }

        closeAll() {
            [...this.children.keys()].forEach(id => this.dropChild(id, false));
            window.clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        // ───────────────────────── 子學生端 ─────────────────────────
        /** 驗證老師公鑰（與 QR 指紋比對）並準備加密金鑰；失敗時拒絕經中繼連線。 */
        async acceptTeacherKeys(keys) {
            if (!keys?.sign || !keys?.ecdh || !crypto?.subtle) return false;
            const signRaw = unb64u(keys.sign);
            const ecdhRaw = unb64u(keys.ecdh);
            if (this.expectedFingerprint && await fingerprintOf(signRaw, ecdhRaw) !== this.expectedFingerprint) {
                console.warn('IRS swarm: 老師公鑰指紋不符，拒絕經中繼連線');
                return false;
            }
            const sign = await crypto.subtle.importKey('raw', signRaw, SIGN_ALG, false, ['verify']);
            const teacherEcdh = await crypto.subtle.importKey('raw', ecdhRaw, ECDH_ALG, false, []);
            const eph = await crypto.subtle.generateKey(ECDH_ALG, true, ['deriveKey']);
            const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: teacherEcdh }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
            const epk = b64u(await crypto.subtle.exportKey('raw', eph.publicKey));
            this.teacherKeys = { sign, aes, epk };
            return true;
        }

        /** 子學生收到中繼轉來的封包：驗章通過才交給一般流程。 */
        async openDelivery(message, deliver) {
            if (message?.type !== 'swarm.deliver' || !this.teacherKeys || typeof message.data !== 'string') return;
            try {
                const ok = await crypto.subtle.verify(SIGN_PARAMS, this.teacherKeys.sign, unb64u(message.sig), enc.encode(message.data));
                if (ok) deliver(message.data);
                else console.warn('IRS swarm: 簽章驗證失敗，已丟棄');
            } catch {
                console.warn('IRS swarm: 簽章格式錯誤，已丟棄');
            }
        }

        /** 子學生上行：加密後送給中繼（保持送出順序）。 */
        sealAndSend(channel, serialized) {
            this.upChain = this.upChain.then(async () => {
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.teacherKeys.aes, enc.encode(serialized));
                if (channel.readyState === 'open') {
                    channel.send(JSON.stringify({ v: 1, type: 'swarm.sealed', epk: this.teacherKeys.epk, iv: b64u(iv), ct: b64u(ct) }));
                }
            }).catch(error => console.warn('IRS swarm seal failed', error));
        }
    }

    IrsSwarm.relayScore = relayScore;
    window.IrsSwarm = IrsSwarm;
})();
