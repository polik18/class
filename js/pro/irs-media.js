/* IRS 混合模式畫面廣播：沿用 Swarm 樹傳送視訊，不經任何伺服器。

   老師 ─視訊→ 直連學生（含中繼節點）
   中繼節點 ─轉送收到的視訊軌→ 子學生
   - 重新協商（offer／answer）走既有 DataChannel：老師端連線由老師發起，中繼→子學生連線由中繼發起，不會撞車。
   - 每路限制 1.2 Mbps／15 fps，畫面以文字清晰度優先（contentHint = detail）。
   - 已知限制：中繼節點可替換子學生看到的畫面（媒體無法用老師簽章保護）；問答資料仍受簽章與加密保護。 */
(() => {
    'use strict';

    const MAX_BITRATE = 1_200_000;
    const MAX_FRAMERATE = 15;

    class IrsMedia {
        constructor(transport) {
            this.t = transport;
            this.stream = null;      // 老師：正在廣播的畫面；學生：收到的畫面
            this.senders = new WeakMap();// RTCPeerConnection -> RTCRtpSender[]
            this.pendingRenegotiation = new WeakSet();
        }

        // ───────── 共用：在指定連線上加入／移除視訊並重新協商 ─────────
        bindNegotiation(pc, send) {
            if (pc.__irsMediaBound) return;
            pc.__irsMediaBound = true;
            pc.__irsMediaSend = send;
            pc.addEventListener('negotiationneeded', () => this.offer(pc));
        }

        async offer(pc) {
            if (pc.signalingState !== 'stable') {
                this.pendingRenegotiation.add(pc);
                return;
            }
            try {
                await pc.setLocalDescription();
                pc.__irsMediaSend({ v: 1, type: 'media.offer', description: pc.localDescription });
            } catch (error) {
                console.warn('IRS media offer failed', error);
            }
        }

        async handle(pc, message, send) {
            try {
                if (message.type === 'media.offer') {
                    await pc.setRemoteDescription(message.description);
                    await pc.setLocalDescription();
                    send({ v: 1, type: 'media.answer', description: pc.localDescription });
                } else if (message.type === 'media.answer') {
                    await pc.setRemoteDescription(message.description);
                    if (this.pendingRenegotiation.has(pc)) {
                        this.pendingRenegotiation.delete(pc);
                        this.offer(pc);
                    }
                } else if (message.type === 'media.stop') {
                    this.handleUpstreamStop();
                }
            } catch (error) {
                console.warn('IRS media negotiation failed', error);
            }
        }

        attach(pc, stream, send) {
            if (!stream || this.senders.has(pc) || pc.connectionState === 'closed') return;
            this.bindNegotiation(pc, send);
            const list = stream.getTracks().map(track => {
                const sender = pc.addTrack(track, stream);
                const params = sender.getParameters();
                params.encodings = params.encodings?.length ? params.encodings : [{}];
                params.encodings.forEach(encoding => {
                    encoding.maxBitrate = MAX_BITRATE;
                    encoding.maxFramerate = MAX_FRAMERATE;
                });
                sender.setParameters(params).catch(() => {});
                return sender;
            });
            this.senders.set(pc, list);
        }

        detach(pc) {
            const list = this.senders.get(pc);
            if (!list) return;
            this.senders.delete(pc);
            if (pc.connectionState === 'closed') return;
            list.forEach(sender => { try { pc.removeTrack(sender); } catch {} });
        }

        // ───────── 老師 ─────────
        startTeacher(stream) {
            stream.getVideoTracks().forEach(track => { try { track.contentHint = 'detail'; } catch {} });
            this.stream = stream;
            this.t.peers.forEach(record => this.onTeacherPeerReady(record));
        }

        onTeacherPeerReady(record) {
            if (this.t.role !== 'teacher' || !this.stream || !record.ready) return;
            this.attach(record.pc, this.stream, msg => this.sendOnChannel(record.channel, msg));
        }

        stopTeacher() {
            this.t.peers.forEach(record => {
                this.sendOnChannel(record.channel, { v: 1, type: 'media.stop' });
                this.detach(record.pc);
            });
            this.stream = null;
        }

        sendOnChannel(channel, message) {
            if (channel?.readyState === 'open') channel.send(JSON.stringify(message));
        }

        // ───────── 學生（直連或經中繼） ─────────
        bindStudentPeer(record) {
            if (record.__irsTrackBound) return;
            record.__irsTrackBound = true;
            record.pc.addEventListener('track', event => {
                const stream = event.streams[0] || new MediaStream([event.track]);
                if (this.stream === stream) return;
                this.stream = stream;
                this.t.onStateChange({ state: 'media-stream', role: 'student', stream });
                this.forwardToChildren();
            });
        }

        /** 中繼節點：把收到的畫面轉給子學生。 */
        forwardToChildren() {
            const swarm = this.t.swarm;
            if (!swarm || !this.stream) return;
            swarm.children.forEach(child => this.onChildReady(child));
        }

        onChildReady(child) {
            if (!this.stream || !child.ready || this.t.role !== 'student' || this.t.studentPeer?.via) return;
            this.attach(child.pc, this.stream, msg => this.sendOnChannel(child.channel, msg));
        }

        handleUpstreamStop() {
            const swarm = this.t.swarm;
            if (swarm) {
                swarm.children.forEach(child => {
                    this.sendOnChannel(child.channel, { v: 1, type: 'media.stop' });
                    this.detach(child.pc);
                });
            }
            this.stream = null;
            this.t.onStateChange({ state: 'media-stopped', role: this.t.role });
        }
    }

    window.IrsMedia = IrsMedia;
})();
