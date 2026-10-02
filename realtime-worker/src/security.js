const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function issueJoinTicket(secret, roomId, clientId, now = Date.now(), ttlMs = 90_000) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('join_ticket_secret_invalid');
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    roomId,
    clientId,
    issuedAt: now,
    expiresAt: now + ttlMs
  })));
  const signature = bytesToBase64Url(await hmac(secret, payload));
  return { ticket: `${payload}.${signature}`, expiresAt: now + ttlMs };
}

export async function verifyJoinTicket(secret, ticket, roomId, clientId, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof ticket !== 'string' || ticket.length > 1024) return false;
  const [payload, signature, extra] = ticket.split('.');
  if (!payload || !signature || extra !== undefined) return false;
  let providedSignature;
  let parsed;
  try {
    providedSignature = base64UrlToBytes(signature);
    parsed = JSON.parse(decoder.decode(base64UrlToBytes(payload)));
  } catch {
    return false;
  }
  const expectedSignature = await hmac(secret, payload);
  if (providedSignature.length !== expectedSignature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expectedSignature.length; index += 1) {
    mismatch |= providedSignature[index] ^ expectedSignature[index];
  }
  if (mismatch !== 0) return false;
  return parsed?.roomId === roomId &&
    parsed?.clientId === clientId &&
    Number.isFinite(parsed?.issuedAt) &&
    Number.isFinite(parsed?.expiresAt) &&
    parsed.issuedAt <= now + 30_000 &&
    parsed.expiresAt > now;
}

export async function verifyTurnstileToken({ token, secret, remoteIp, expectedAction = 'create-room', fetchImpl = fetch }) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048) {
    return { ok: false, error: 'turnstile_token_missing' };
  }
  if (typeof secret !== 'string' || secret.length < 10) {
    return { ok: false, error: 'turnstile_not_configured' };
  }

  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token);
  if (remoteIp) form.set('remoteip', remoteIp);
  let response;
  try {
    response = await fetchImpl(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
  } catch {
    return { ok: false, error: 'turnstile_unavailable' };
  }
  if (!response.ok) return { ok: false, error: 'turnstile_unavailable' };
  const result = await response.json().catch(() => null);
  if (!result?.success) return { ok: false, error: 'turnstile_rejected' };
  if (expectedAction && result.action !== expectedAction) return { ok: false, error: 'turnstile_action_mismatch' };
  return { ok: true, result };
}
