import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MESSAGE_BYTES,
  normalizeRoomId,
  ownerTokenFromProtocols,
  validateEnvelope
} from '../src/protocol.js';

function envelope(overrides = {}) {
  return JSON.stringify({
    v: 1,
    type: 'app.answer',
    messageId: 'message_12345678',
    sequence: 1,
    payload: { value: 'A' },
    ...overrides
  });
}

test('normalizes human-friendly room IDs', () => {
  assert.equal(normalizeRoomId('abcd-2345'), 'ABCD-2345');
  assert.equal(normalizeRoomId('ABCI-2345'), null);
  assert.equal(normalizeRoomId('bad-room'), null);
});

test('extracts owner token from websocket subprotocols', () => {
  assert.equal(ownerTokenFromProtocols('classroom.v1, owner.secret_123'), 'secret_123');
  assert.equal(ownerTokenFromProtocols('classroom.v1'), null);
});

test('accepts valid protocol envelopes', () => {
  const result = validateEnvelope(envelope());
  assert.equal(result.ok, true);
  assert.equal(result.message.type, 'app.answer');
});

test('accepts delivery acknowledgements', () => {
  const result = validateEnvelope(envelope({ type: 'app.ack' }));
  assert.equal(result.ok, true);
});

test('rejects unsupported message types and invalid sequence numbers', () => {
  assert.deepEqual(validateEnvelope(envelope({ type: 'admin.delete' })), { ok: false, error: 'unsupported_type' });
  assert.deepEqual(validateEnvelope(envelope({ sequence: -1 })), { ok: false, error: 'invalid_sequence' });
});

test('validates optional broadcast exclusions', () => {
  assert.equal(validateEnvelope(envelope({ excludeClientId: 'student_1234' })).ok, true);
  assert.deepEqual(validateEnvelope(envelope({ excludeClientId: 'bad id' })), { ok: false, error: 'invalid_exclusion' });
});

test('rejects oversized and binary messages', () => {
  assert.deepEqual(validateEnvelope('x'.repeat(MAX_MESSAGE_BYTES + 1)), { ok: false, error: 'message_too_large' });
  assert.deepEqual(validateEnvelope(new Uint8Array([1, 2, 3])), { ok: false, error: 'binary_not_supported' });
});
