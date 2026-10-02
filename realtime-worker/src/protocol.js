export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 8 * 1024;

const ROOM_ID_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const ALLOWED_MESSAGE_TYPES = new Set([
  'signal.offer',
  'signal.answer',
  'signal.ice',
  'control.direct-ready',
  'control.direct-failed',
  'control.direct-left',
  'control.ping',
  'control.pong',
  'app.join',
  'app.sync-mode',
  'app.sync-board',
  'app.sync-score',
  'app.chat-toggle',
  'app.chat-message',
  'app.question',
  'app.answer',
  'app.stop',
  'app.draw-path',
  'app.undo-path',
  'app.clear-board',
  'app.board-pan',
  'app.request-screen-share',
  'app.stop-screen-share',
  'app.teacher-request-screen',
  'app.approve-screen-share',
  'app.deny-screen-share'
]);

export function normalizeRoomId(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return ROOM_ID_PATTERN.test(normalized) ? normalized : null;
}

export function validClientId(value) {
  return typeof value === 'string' && CLIENT_ID_PATTERN.test(value);
}

export function validMessageId(value) {
  return typeof value === 'string' && MESSAGE_ID_PATTERN.test(value);
}

export function utf8Size(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function parseProtocols(headerValue) {
  return String(headerValue || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

export function ownerTokenFromProtocols(headerValue) {
  const ownerProtocol = parseProtocols(headerValue).find(value => value.startsWith('owner.'));
  return ownerProtocol ? ownerProtocol.slice('owner.'.length) : null;
}

export function validateEnvelope(rawMessage) {
  if (typeof rawMessage !== 'string') {
    return { ok: false, error: 'binary_not_supported' };
  }
  if (utf8Size(rawMessage) > MAX_MESSAGE_BYTES) {
    return { ok: false, error: 'message_too_large' };
  }

  let message;
  try {
    message = JSON.parse(rawMessage);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { ok: false, error: 'invalid_message' };
  }
  if (message.v !== PROTOCOL_VERSION) {
    return { ok: false, error: 'unsupported_version' };
  }
  if (!ALLOWED_MESSAGE_TYPES.has(message.type)) {
    return { ok: false, error: 'unsupported_type' };
  }
  if (!validMessageId(message.messageId)) {
    return { ok: false, error: 'invalid_message_id' };
  }
  if (!Number.isSafeInteger(message.sequence) || message.sequence < 0) {
    return { ok: false, error: 'invalid_sequence' };
  }
  if (message.targetClientId !== undefined && !validClientId(message.targetClientId)) {
    return { ok: false, error: 'invalid_target' };
  }
  if (message.excludeClientId !== undefined && !validClientId(message.excludeClientId)) {
    return { ok: false, error: 'invalid_exclusion' };
  }
  if (message.payload !== undefined && (message.payload === null || typeof message.payload !== 'object' || Array.isArray(message.payload))) {
    return { ok: false, error: 'invalid_payload' };
  }

  return { ok: true, message };
}

export function serverMessage(type, payload = {}) {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    type,
    sentAt: Date.now(),
    payload
  });
}
