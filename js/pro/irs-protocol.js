(() => {
    'use strict';

    const TYPE_MAP = Object.freeze({
        join: 'app.join',
        sync_mode: 'app.sync-mode',
        sync_board: 'app.sync-board',
        sync_score: 'app.sync-score',
        chat_toggle: 'app.chat-toggle',
        chat_msg: 'app.chat-message',
        question: 'app.question',
        answer: 'app.answer',
        ack: 'app.ack',
        stop: 'app.stop',
        draw_path: 'app.draw-path',
        undo_path: 'app.undo-path',
        clear_board: 'app.clear-board',
        sync_board_pan: 'app.board-pan',
        request_screen_share: 'app.request-screen-share',
        stop_screen_share: 'app.stop-screen-share',
        teacher_request_screen: 'app.teacher-request-screen',
        approve_screen_share: 'app.approve-screen-share',
        deny_screen_share: 'app.deny-screen-share'
    });

    function randomId(prefix = 'msg') {
        const id = typeof crypto?.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        return `${prefix}_${id}`;
    }

    function messageTypeForLegacy(data) {
        return TYPE_MAP[data?.type] || null;
    }

    window.IrsProtocol = Object.freeze({
        version: 1,
        randomId,
        messageTypeForLegacy,
        createEnvelope(data, sequence, targetClientId = null) {
            const type = messageTypeForLegacy(data);
            if (!type) throw new Error(`Unsupported IRS message type: ${data?.type || 'unknown'}`);
            const envelope = {
                v: 1,
                type,
                messageId: randomId('message'),
                sequence,
                sentAt: Date.now(),
                payload: { legacy: data }
            };
            if (targetClientId) envelope.targetClientId = targetClientId;
            return envelope;
        }
    });
})();
