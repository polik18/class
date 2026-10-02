(() => {
    'use strict';

    const PROD_API_URL = 'https://class-realtime-api.vote-platform-api.workers.dev';
    const LOCAL_API_URL = 'http://localhost:8790';
    const NEGOTIATION_TIMEOUT_MS = 8_000;
    const ICE_SERVERS = [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' }
    ];

    class HybridRelayTransport {
        constructor(options = {}) {
            this.apiUrl = options.apiUrl || HybridRelayTransport.apiUrl();
            this.socket = null;
            this.role = null;
            this.clientId = null;
            this.roomId = null;
            this.ownerToken = null;
            this.directLimit = 0;
            this.sequence = 0;
            this.connections = new Map();
            this.peers = new Map();
            this.relayClients = new Set();
            this.offlineTimers = new Map();
            this.studentPeer = null;
            this.studentJoinData = null;
            this.pendingMessages = [];
            this.fallbackOnly = false;
            this.activatingRelay = false;
            this.intentionalControlClose = false;
            this.shuttingDown = false;
            this.onData = options.onData || (() => {});
            this.onServerEvent = options.onServerEvent || (() => {});
            this.onStateChange = options.onStateChange || (() => {});
        }

        static apiUrl() {
            if (window.CLASS_REALTIME_API_URL) return String(window.CLASS_REALTIME_API_URL).replace(/\/$/, '');
            return ['localhost', '127.0.0.1'].includes(location.hostname) ? LOCAL_API_URL : PROD_API_URL;
        }

        static isEnabled() {
            const params = new URLSearchParams(location.search);
            return params.get('transport') === 'hybrid' || params.get('irsTransport') === 'hybrid';
        }

        static clientId(role) {
            return `${role}_${IrsProtocol.randomId('client').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)}`;
        }

        async createTeacher() {
            this.role = 'teacher';
            this.clientId = HybridRelayTransport.clientId('teacher');
            const response = await fetch(`${this.apiUrl}/api/rooms`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
                cache: 'no-store'
            });
            const room = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(room.error || `room_create_${response.status}`);
            this.roomId = room.roomId;
            this.ownerToken = room.ownerToken;
            this.directLimit = Number(room.directLimit || 0);
            await this.openSocket(room.websocketUrl, ['classroom.v1', `owner.${room.ownerToken}`], 'control');
            return room;
        }

        async joinStudent(roomId) {
            this.role = 'student';
            this.clientId = HybridRelayTransport.clientId('student');
            this.roomId = String(roomId || '').trim().toUpperCase();
            await this.openSocket(this.websocketUrl(this.roomId), ['classroom.v1'], 'negotiating');
            return { roomId: this.roomId, clientId: this.clientId };
        }

        websocketUrl(roomId) {
            const url = new URL(this.apiUrl);
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            url.pathname = `/api/rooms/${roomId}/connect`;
            url.search = '';
            return url.toString();
        }

        openSocket(baseUrl, protocols, mode = 'negotiating') {
            return new Promise((resolve, reject) => {
                const url = new URL(baseUrl);
                url.searchParams.set('role', this.role);
                url.searchParams.set('clientId', this.clientId);
                if (this.role === 'student') url.searchParams.set('mode', mode);
                const socket = new WebSocket(url, protocols);
                this.socket = socket;
                this.intentionalControlClose = false;
                let settled = false;

                socket.addEventListener('open', () => {
                    settled = true;
                    this.onStateChange({ state: 'open', role: this.role, mode });
                    this.flushPendingMessages();
                    resolve();
                }, { once: true });
                socket.addEventListener('error', () => {
                    if (!settled) reject(new Error('websocket_connect_failed'));
                    this.onStateChange({ state: 'error', role: this.role, mode });
                });
                socket.addEventListener('close', event => {
                    if (this.socket === socket) this.socket = null;
                    this.onStateChange({ state: 'closed', role: this.role, mode, code: event.code, reason: event.reason });
                    if (this.role === 'student' && !this.shuttingDown && !this.intentionalControlClose && !this.hasDirectChannel()) {
                        this.activateRelay();
                    }
                });
                socket.addEventListener('message', event => this.handleMessage(event.data));
            });
        }

        handleMessage(rawMessage) {
            let message;
            try {
                message = JSON.parse(rawMessage);
            } catch {
                return;
            }
            if (typeof message.type !== 'string') return;
            if (message.type.startsWith('server.')) {
                if (message.type === 'server.welcome') {
                    this.directLimit = Number(message.payload?.directLimit || this.directLimit || 0);
                }
                if (message.type === 'server.student-online' && this.role === 'teacher') {
                    const clientId = message.payload?.clientId;
                    if (clientId && message.payload?.mode === 'relay') {
                        this.relayClients.add(clientId);
                        window.clearTimeout(this.offlineTimers.get(clientId));
                        this.offlineTimers.delete(clientId);
                    } else if (clientId) {
                        this.startTeacherPeer(clientId);
                    }
                }
                if (message.type === 'server.student-offline' && message.payload?.clientId) {
                    this.connections.delete(message.payload.clientId);
                    this.relayClients.delete(message.payload.clientId);
                    this.closePeer(message.payload.clientId, false);
                }
                this.onServerEvent(message);
                return;
            }
            if (message.type.startsWith('signal.')) {
                this.handleSignal(message);
                return;
            }
            if (message.type === 'control.direct-ready' && this.role === 'teacher') {
                this.onStateChange({ state: 'direct', role: 'teacher', clientId: message.senderId });
                return;
            }
            const legacy = message.payload?.legacy;
            if (!legacy || typeof legacy !== 'object') return;
            this.deliverLegacy(message.senderId, legacy, message);
        }

        async startTeacherPeer(clientId) {
            if (!clientId || this.peers.has(clientId)) return;
            const activePeers = [...this.peers.values()].filter(peer => !peer.closed).length;
            if (activePeers >= this.directLimit) return;

            const record = this.createPeerRecord(clientId);
            const channel = record.pc.createDataChannel('irs-data', { ordered: true });
            this.attachDataChannel(record, channel);
            try {
                const offer = await record.pc.createOffer();
                await record.pc.setLocalDescription(offer);
                this.sendControl('signal.offer', { description: record.pc.localDescription }, clientId);
            } catch (error) {
                console.warn('IRS direct offer failed', error);
                this.closePeer(clientId, false);
            }
        }

        createPeerRecord(clientId) {
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            const record = {
                clientId,
                pc,
                channel: null,
                ready: false,
                closed: false,
                pendingCandidates: [],
                timer: null
            };
            if (this.role === 'teacher') this.peers.set(clientId, record);
            else this.studentPeer = record;

            pc.addEventListener('icecandidate', event => {
                if (event.candidate && this.isOpen()) {
                    this.sendControl('signal.ice', { candidate: event.candidate }, this.role === 'teacher' ? clientId : null);
                }
            });
            pc.addEventListener('datachannel', event => this.attachDataChannel(record, event.channel));
            pc.addEventListener('connectionstatechange', () => {
                if (['failed', 'closed'].includes(pc.connectionState)) this.handleDirectFailure(record);
                if (pc.connectionState === 'disconnected') {
                    window.setTimeout(() => {
                        if (pc.connectionState === 'disconnected') this.handleDirectFailure(record);
                    }, 5_000);
                }
            });
            record.timer = window.setTimeout(() => {
                if (!record.ready) this.handleDirectFailure(record);
            }, NEGOTIATION_TIMEOUT_MS);
            return record;
        }

        attachDataChannel(record, channel) {
            record.channel = channel;
            channel.addEventListener('open', () => {
                record.ready = true;
                window.clearTimeout(record.timer);
                this.onStateChange({ state: 'direct', role: this.role, clientId: record.clientId });
                if (this.role === 'student') this.enterDirectStandby(record);
            });
            channel.addEventListener('message', event => this.handleDirectMessage(event.data, record.clientId));
            channel.addEventListener('close', () => {
                record.ready = false;
                if (!this.shuttingDown) this.handleDirectFailure(record);
            });
            channel.addEventListener('error', () => this.handleDirectFailure(record));
        }

        async handleSignal(message) {
            const senderId = message.senderId;
            const payload = message.payload || {};
            try {
                if (this.role === 'student' && message.type === 'signal.offer') {
                    if (this.fallbackOnly) return;
                    const record = this.studentPeer || this.createPeerRecord('teacher');
                    await record.pc.setRemoteDescription(payload.description);
                    await this.flushIceCandidates(record);
                    const answer = await record.pc.createAnswer();
                    await record.pc.setLocalDescription(answer);
                    this.sendControl('signal.answer', { description: record.pc.localDescription });
                    return;
                }

                const record = this.role === 'teacher' ? this.peers.get(senderId) : this.studentPeer;
                if (!record) return;
                if (message.type === 'signal.answer') {
                    await record.pc.setRemoteDescription(payload.description);
                    await this.flushIceCandidates(record);
                } else if (message.type === 'signal.ice' && payload.candidate) {
                    if (record.pc.remoteDescription) await record.pc.addIceCandidate(payload.candidate);
                    else record.pendingCandidates.push(payload.candidate);
                }
            } catch (error) {
                console.warn('IRS direct signaling failed', error);
                const record = this.role === 'teacher' ? this.peers.get(senderId) : this.studentPeer;
                if (record) this.handleDirectFailure(record);
            }
        }

        async flushIceCandidates(record) {
            const candidates = record.pendingCandidates.splice(0);
            for (const candidate of candidates) await record.pc.addIceCandidate(candidate);
        }

        enterDirectStandby(record) {
            if (!this.isOpen() || this.shuttingDown) return;
            this.sendControl('control.direct-ready', { connectedAt: Date.now() });
            const closeControl = () => {
                if (!record.ready || !this.isOpen() || this.shuttingDown) return;
                this.intentionalControlClose = true;
                this.socket.close(1000, 'P2P direct standby');
            };
            if (record.pc.iceGatheringState === 'complete') {
                window.setTimeout(closeControl, 150);
            } else {
                record.pc.addEventListener('icegatheringstatechange', () => {
                    if (record.pc.iceGatheringState === 'complete') window.setTimeout(closeControl, 150);
                }, { once: true });
                window.setTimeout(closeControl, 2_000);
            }
        }

        handleDirectFailure(record) {
            if (!record || record.closed) return;
            const wasReady = record.ready;
            record.ready = false;
            record.closed = true;
            window.clearTimeout(record.timer);
            try { record.channel?.close(); } catch {}
            try { record.pc?.close(); } catch {}

            if (this.role === 'teacher') {
                this.peers.delete(record.clientId);
                if (wasReady && this.isOpen()) {
                    this.sendControl('control.direct-left', { disconnectedAt: Date.now() }, record.clientId);
                    window.clearTimeout(this.offlineTimers.get(record.clientId));
                    this.offlineTimers.set(record.clientId, window.setTimeout(() => {
                        if (this.relayClients.has(record.clientId) || this.peerIsDirect(record.clientId)) return;
                        this.connections.delete(record.clientId);
                        this.onServerEvent({ type: 'server.student-offline', payload: { clientId: record.clientId, mode: 'direct' } });
                    }, 5_000));
                }
            } else {
                this.studentPeer = null;
                if (!this.shuttingDown) this.activateRelay();
            }
        }

        async activateRelay() {
            if (this.role !== 'student' || this.shuttingDown || this.activatingRelay || this.isOpen()) return;
            this.activatingRelay = true;
            this.fallbackOnly = true;
            this.intentionalControlClose = false;
            this.onStateChange({ state: 'relay-connecting', role: 'student' });
            try {
                await this.openSocket(this.websocketUrl(this.roomId), ['classroom.v1'], 'relay');
                this.onStateChange({ state: 'relay', role: 'student' });
                if (this.studentJoinData) this.sendLegacy(this.studentJoinData);
            } catch (error) {
                this.onStateChange({ state: 'error', role: 'student', error });
            } finally {
                this.activatingRelay = false;
            }
        }

        handleDirectMessage(rawMessage, peerId) {
            let message;
            try {
                message = JSON.parse(rawMessage);
            } catch {
                return;
            }
            const legacy = message.payload?.legacy;
            if (!legacy || typeof legacy !== 'object') return;
            this.deliverLegacy(this.role === 'teacher' ? peerId : 'teacher', legacy, message);
        }

        deliverLegacy(senderId, legacy, envelope) {
            const connection = this.role === 'teacher' ? this.connectionFor(senderId) : this.hostConnection();
            this.onData({ senderId, data: legacy, connection, envelope });
        }

        sendControl(type, payload = {}, targetClientId = null) {
            if (!this.isOpen()) return false;
            this.sequence += 1;
            const envelope = {
                v: 1,
                type,
                messageId: IrsProtocol.randomId('control'),
                sequence: this.sequence,
                sentAt: Date.now(),
                payload
            };
            if (targetClientId) envelope.targetClientId = targetClientId;
            this.socket.send(JSON.stringify(envelope));
            return true;
        }

        connectionFor(clientId) {
            if (!this.connections.has(clientId)) {
                const transport = this;
                this.connections.set(clientId, {
                    peer: clientId,
                    get open() { return transport.peerIsDirect(clientId) || transport.isOpen(); },
                    send(data) { transport.sendLegacy(data, clientId); },
                    close() { transport.closePeer(clientId, true); }
                });
            }
            return this.connections.get(clientId);
        }

        hostConnection() {
            const transport = this;
            return {
                peer: 'teacher',
                get open() { return transport.hasDirectChannel() || transport.isOpen(); },
                send(data) { transport.sendLegacy(data); },
                close() { transport.close(); }
            };
        }

        createLegacyEnvelope(data, targetClientId = null) {
            this.sequence += 1;
            return IrsProtocol.createEnvelope(data, this.sequence, targetClientId);
        }

        sendLegacy(data, targetClientId = null) {
            if (this.role === 'student' && data?.type === 'join') this.studentJoinData = { ...data };
            const envelope = this.createLegacyEnvelope(data, targetClientId);
            const serialized = JSON.stringify(envelope);

            if (this.role === 'student' && this.hasDirectChannel()) {
                this.studentPeer.channel.send(serialized);
                return;
            }
            if (this.role === 'teacher' && targetClientId && this.peerIsDirect(targetClientId)) {
                this.peers.get(targetClientId).channel.send(serialized);
                return;
            }
            if (this.isOpen()) {
                this.socket.send(serialized);
                return;
            }
            this.pendingMessages.push(serialized);
            if (this.role === 'student') this.activateRelay();
        }

        broadcast(data, excludeClientId = null) {
            const envelope = this.createLegacyEnvelope(data);
            if (excludeClientId) envelope.excludeClientId = excludeClientId;
            const serialized = JSON.stringify(envelope);

            this.peers.forEach((record, clientId) => {
                if (record.ready && record.channel?.readyState === 'open' && clientId !== excludeClientId) {
                    record.channel.send(serialized);
                }
            });
            if (this.isOpen()) this.socket.send(serialized);
        }

        flushPendingMessages() {
            if (!this.isOpen()) return;
            const pending = this.pendingMessages.splice(0);
            pending.forEach(message => this.socket.send(message));
        }

        peerIsDirect(clientId) {
            const record = this.peers.get(clientId);
            return Boolean(record?.ready && record.channel?.readyState === 'open');
        }

        hasDirectChannel() {
            return Boolean(this.studentPeer?.ready && this.studentPeer.channel?.readyState === 'open');
        }

        isOpen() {
            return this.socket?.readyState === WebSocket.OPEN;
        }

        closePeer(clientId, notifyServer) {
            const record = this.peers.get(clientId);
            if (!record) return;
            record.ready = false;
            record.closed = true;
            window.clearTimeout(record.timer);
            try { record.channel?.close(); } catch {}
            try { record.pc?.close(); } catch {}
            this.peers.delete(clientId);
            this.connections.delete(clientId);
            if (notifyServer && this.isOpen()) this.sendControl('control.direct-left', {}, clientId);
        }

        close() {
            this.shuttingDown = true;
            this.peers.forEach((_, clientId) => this.closePeer(clientId, false));
            if (this.studentPeer) {
                this.studentPeer.closed = true;
                window.clearTimeout(this.studentPeer.timer);
                try { this.studentPeer.channel?.close(); } catch {}
                try { this.studentPeer.pc?.close(); } catch {}
                this.studentPeer = null;
            }
            if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
                this.socket.close(1000, 'Client closed');
            }
            this.socket = null;
            this.connections.clear();
            this.relayClients.clear();
            this.offlineTimers.forEach(timer => window.clearTimeout(timer));
            this.offlineTimers.clear();
            this.pendingMessages = [];
        }
    }

    window.IrsHybridTransport = HybridRelayTransport;
})();
