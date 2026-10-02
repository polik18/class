import test from 'node:test';
import assert from 'node:assert/strict';
import {
  issueJoinTicket,
  verifyJoinTicket,
  verifyTurnstileToken
} from '../src/security.js';

const SECRET = 'test-secret-that-is-at-least-thirty-two-characters';

test('issues room and client-bound join tickets', async () => {
  const now = 1_800_000_000_000;
  const { ticket } = await issueJoinTicket(SECRET, 'ABCD-2345', 'student_1234', now);
  assert.equal(await verifyJoinTicket(SECRET, ticket, 'ABCD-2345', 'student_1234', now + 1_000), true);
  assert.equal(await verifyJoinTicket(SECRET, ticket, 'WXYZ-6789', 'student_1234', now + 1_000), false);
  assert.equal(await verifyJoinTicket(SECRET, ticket, 'ABCD-2345', 'student_9999', now + 1_000), false);
  assert.equal(await verifyJoinTicket(SECRET, ticket, 'ABCD-2345', 'student_1234', now + 91_000), false);
});

test('rejects tampered join tickets', async () => {
  const { ticket } = await issueJoinTicket(SECRET, 'ABCD-2345', 'student_1234');
  assert.equal(await verifyJoinTicket(SECRET, `${ticket}x`, 'ABCD-2345', 'student_1234'), false);
  assert.equal(await verifyJoinTicket(SECRET, 'not-a-ticket', 'ABCD-2345', 'student_1234'), false);
});

test('validates Turnstile success and action', async () => {
  const fetchImpl = async () => Response.json({ success: true, action: 'create-room', hostname: 'polik18.github.io' });
  const result = await verifyTurnstileToken({ token: 'valid-test-token', secret: 'test-secret', fetchImpl });
  assert.equal(result.ok, true);

  const wrongAction = await verifyTurnstileToken({
    token: 'valid-test-token',
    secret: 'test-secret',
    expectedAction: 'different-action',
    fetchImpl
  });
  assert.deepEqual(wrongAction, { ok: false, error: 'turnstile_action_mismatch' });
});

test('fails closed when Turnstile is absent or unavailable', async () => {
  assert.deepEqual(
    await verifyTurnstileToken({ token: '', secret: 'test-secret' }),
    { ok: false, error: 'turnstile_token_missing' }
  );
  assert.deepEqual(
    await verifyTurnstileToken({ token: 'valid-test-token', secret: 'test-secret', fetchImpl: async () => { throw new Error('offline'); } }),
    { ok: false, error: 'turnstile_unavailable' }
  );
});
