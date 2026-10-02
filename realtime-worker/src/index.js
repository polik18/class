import {
  normalizeRoomId,
  ownerTokenFromProtocols,
  serverMessage,
  validClientId,
  validateEnvelope
} from './protocol.js';
import {
  issueJoinTicket,
  verifyJoinTicket,
  verifyTurnstileToken
} from './security.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export default {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      console.error('class-realtime-api error', error);
      return jsonResponse({ error: 'internal_error' }, 500, request, env);
    }
  }
};

export class Classroom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/internal/create' && request.method === 'POST') {
      return this.createRoom(request);
    }
    if (url.pathname === '/internal/status' && request.method === 'GET') {
      return this.roomStatus();
    }
    if (url.pathname === '/internal/connect' && request.method === 'GET') {
      return this.connectWebSocket(request);
    }
    return new Response('Not found', { status: 404 });
  }

  async createRoom(request) {
    const existing = await this.ctx.storage.get('room');
    if (existing && existing.expiresAt > Date.now()) {
      return Response.json({ error: 'room_exists' }, { status: 409 });
    }

    const input = await safeJson(request);
    const roomId = normalizeRoomId(input?.roomId);
    const ownerToken = typeof input?.ownerToken === 'string' ? input.ownerToken : '';
    const expiresAt = Number(input?.expiresAt || 0);
    const maxStudents = clampInt(input?.maxStudents, 1, 100, 60);
    const directLimit = clampInt(input?.directLimit, 0, maxStudents, 30);
    if (!roomId || ownerToken.length < 32 || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return Response.json({ error: 'invalid_room_config' }, { status: 400 });
    }

    const room = {
      roomId,
      ownerTokenHash: await sha256(ownerToken),
      createdAt: Date.now(),
      expiresAt,
      maxStudents,
      directLimit
    };
    await this.ctx.storage.put('room', room);
    await this.ctx.storage.setAlarm(expiresAt);
    return Response.json({ roomId, expiresAt, maxStudents, directLimit }, { status: 201 });
  }

  async roomStatus() {
    const room = await this.ctx.storage.get('room');
    if (!room || room.expiresAt <= Date.now()) {
      return Response.json({ active: false }, { status: 404 });
    }
    const directClients = await this.directClients();
    const connectedIds = new Set(this.studentSockets().map(socket => socket.deserializeAttachment()?.clientId).filter(Boolean));
    directClients.forEach(id => connectedIds.add(id));
    return Response.json({
      active: true,
      roomId: room.roomId,
      expiresAt: room.expiresAt,
      maxStudents: room.maxStudents,
      directLimit: room.directLimit,
      connectedStudents: connectedIds.size,
      directStudents: directClients.length,
      teacherOnline: this.teacherSockets().length > 0
    });
  }

  async connectWebSocket(request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    const room = await this.ctx.storage.get('room');
    if (!room || room.expiresAt <= Date.now()) {
      return new Response('Room expired', { status: 404 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const clientId = url.searchParams.get('clientId');
    const requestedMode = url.searchParams.get('mode') === 'relay' ? 'relay' : 'negotiating';
    if (!['teacher', 'student'].includes(role) || !validClientId(clientId)) {
      return new Response('Invalid connection identity', { status: 400 });
    }

    if (role === 'teacher') {
      const ownerToken = ownerTokenFromProtocols(request.headers.get('sec-websocket-protocol'));
      if (!ownerToken || !constantTimeEqual(await sha256(ownerToken), room.ownerTokenHash)) {
        return new Response('Invalid owner token', { status: 403 });
      }
      this.teacherSockets().forEach(socket => safeClose(socket, 4001, 'Teacher reconnected'));
    } else {
      const duplicate = this.findStudent(clientId);
      const directClients = await this.directClients();
      const connectedIds = new Set(this.studentSockets().map(socket => socket.deserializeAttachment()?.clientId).filter(Boolean));
      directClients.forEach(id => connectedIds.add(id));
      if (!duplicate && !connectedIds.has(clientId) && connectedIds.size >= room.maxStudents) {
        return new Response('Room is full', { status: 409 });
      }
      if (duplicate) safeClose(duplicate, 4002, 'Student reconnected');
      if (directClients.includes(clientId)) await this.removeDirectClient(clientId);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment = {
      role,
      clientId,
      mode: role === 'student' ? requestedMode : 'control',
      connectedAt: Date.now(),
      rateWindowStartedAt: Date.now(),
      rateCount: 0
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`role:${role}`, `client:${clientId}`]);

    server.send(serverMessage('server.welcome', {
      roomId: room.roomId,
      role,
      clientId,
      expiresAt: room.expiresAt,
      maxStudents: room.maxStudents,
      directLimit: room.directLimit,
      connectedStudents: this.studentSockets().length
    }));

    if (role === 'teacher') {
      this.broadcastStudents(serverMessage('server.teacher-online'));
    } else {
      this.sendTeachers(serverMessage('server.student-online', { clientId, mode: requestedMode }));
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'sec-websocket-protocol': 'classroom.v1' }
    });
  }

  async webSocketMessage(socket, rawMessage) {
    const attachment = socket.deserializeAttachment();
    if (!attachment || !this.checkRateLimit(socket, attachment)) return;

    const parsed = validateEnvelope(rawMessage);
    if (!parsed.ok) {
      socket.send(serverMessage('server.error', { code: parsed.error }));
      if (parsed.error === 'message_too_large' || parsed.error === 'binary_not_supported') {
        safeClose(socket, 4009, parsed.error);
      }
      return;
    }

    const message = parsed.message;

    if (attachment.role === 'student' && message.type === 'control.direct-ready') {
      attachment.mode = 'direct';
      socket.serializeAttachment(attachment);
      await this.addDirectClient(attachment.clientId);
    }
    if (attachment.role === 'student' && message.type === 'control.direct-failed') {
      attachment.mode = 'relay';
      socket.serializeAttachment(attachment);
      await this.removeDirectClient(attachment.clientId);
      this.sendTeachers(serverMessage('server.student-online', { clientId: attachment.clientId, mode: 'relay' }));
      return;
    }
    if (attachment.role === 'teacher' && message.type === 'control.direct-left' && message.targetClientId) {
      await this.removeDirectClient(message.targetClientId);
      return;
    }
    const forwarded = JSON.stringify({
      ...message,
      senderId: attachment.clientId,
      sentAt: Number.isFinite(message.sentAt) ? message.sentAt : Date.now()
    });

    if (attachment.role === 'teacher') {
      if (message.targetClientId) {
        const target = this.findStudent(message.targetClientId);
        if (target) target.send(forwarded);
        else socket.send(serverMessage('server.error', { code: 'student_unavailable', clientId: message.targetClientId }));
      } else {
        this.broadcastStudents(forwarded, message.excludeClientId || null);
      }
      return;
    }

    const teachers = this.teacherSockets();
    if (!teachers.length) {
      socket.send(serverMessage('server.error', { code: 'teacher_unavailable' }));
      return;
    }
    teachers.forEach(teacher => teacher.send(forwarded));
  }

  async webSocketClose(socket) {
    const attachment = socket.deserializeAttachment();
    if (!attachment) return;
    if (attachment.role === 'teacher') {
      this.broadcastStudents(serverMessage('server.teacher-offline'));
    } else if (attachment.mode === 'direct') {
      this.sendTeachers(serverMessage('server.student-standby', { clientId: attachment.clientId, mode: 'direct' }));
    } else {
      this.sendTeachers(serverMessage('server.student-offline', { clientId: attachment.clientId }));
    }
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }

  async alarm() {
    this.ctx.getWebSockets().forEach(socket => safeClose(socket, 4000, 'Room expired'));
    await this.ctx.storage.deleteAll();
  }

  checkRateLimit(socket, attachment) {
    const now = Date.now();
    if (now - attachment.rateWindowStartedAt >= 10_000) {
      attachment.rateWindowStartedAt = now;
      attachment.rateCount = 0;
    }
    attachment.rateCount += 1;
    socket.serializeAttachment(attachment);
    const limit = attachment.role === 'teacher' ? 300 : 80;
    if (attachment.rateCount <= limit) return true;
    socket.send(serverMessage('server.error', { code: 'rate_limited' }));
    safeClose(socket, 4008, 'Rate limited');
    return false;
  }

  teacherSockets() {
    return this.ctx.getWebSockets('role:teacher');
  }

  studentSockets() {
    return this.ctx.getWebSockets('role:student');
  }

  findStudent(clientId) {
    return this.ctx.getWebSockets(`client:${clientId}`).find(socket => socket.deserializeAttachment()?.role === 'student') || null;
  }

  async directClients() {
    const clients = await this.ctx.storage.get('directClients');
    return Array.isArray(clients) ? clients.filter(validClientId) : [];
  }

  async addDirectClient(clientId) {
    const clients = new Set(await this.directClients());
    clients.add(clientId);
    await this.ctx.storage.put('directClients', [...clients]);
  }

  async removeDirectClient(clientId) {
    const clients = new Set(await this.directClients());
    if (!clients.delete(clientId)) return;
    await this.ctx.storage.put('directClients', [...clients]);
  }

  sendTeachers(message) {
    this.teacherSockets().forEach(socket => socket.send(message));
  }

  broadcastStudents(message, excludeClientId = null) {
    this.studentSockets().forEach(socket => {
      const attachment = socket.deserializeAttachment();
      if (attachment?.mode !== 'direct' && attachment?.clientId !== excludeClientId) socket.send(message);
    });
  }
}

async function routeRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return corsPreflight(request, env);

  if (url.pathname === '/health' && request.method === 'GET') {
    return jsonResponse({ ok: true, service: 'class-realtime-api', protocolVersion: 1 }, 200, request, env);
  }

  if (url.pathname === '/api/config' && request.method === 'GET') {
    if (!isAllowedOrigin(request, env)) return jsonResponse({ error: 'origin_not_allowed' }, 403, request, env);
    const local = isLocalDevelopmentRequest(request);
    const turnstileRequired = !local && env.REQUIRE_TURNSTILE === 'true';
    return jsonResponse({
      turnstileRequired,
      turnstileSiteKey: turnstileRequired ? String(env.TURNSTILE_SITE_KEY || '') : null,
      joinTicketRequired: true
    }, 200, request, env);
  }

  if (url.pathname === '/api/rooms' && request.method === 'POST') {
    if (!isAllowedOrigin(request, env)) return jsonResponse({ error: 'origin_not_allowed' }, 403, request, env);
    if (env.ALLOW_NEW_ROOMS !== 'true') return jsonResponse({ error: 'new_rooms_paused' }, 503, request, env);
    const authorized = await authorizeRoomCreation(request, env);
    if (!authorized.ok) return jsonResponse({ error: authorized.error }, authorized.status, request, env);
    return createRoom(request, env);
  }

  const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9-]+)(?:\/(connect|ticket))?$/);
  if (match) {
    const roomId = normalizeRoomId(match[1]);
    if (!roomId) return jsonResponse({ error: 'invalid_room_id' }, 400, request, env);
    const stub = env.CLASSROOMS.getByName(roomId);
    if (match[2] === 'connect' && request.method === 'GET') {
      if (!isAllowedOrigin(request, env)) return new Response('Origin not allowed', { status: 403 });
      const role = url.searchParams.get('role');
      const clientId = url.searchParams.get('clientId');
      if (role === 'student') {
        const secret = joinTicketSecret(request, env);
        if (!secret) return new Response('Join ticket service unavailable', { status: 503 });
        const validTicket = validClientId(clientId) && await verifyJoinTicket(
          secret,
          url.searchParams.get('ticket'),
          roomId,
          clientId
        );
        if (!validTicket) return new Response('Invalid or expired join ticket', { status: 403 });
      }
      return stub.fetch(rewriteInternalUrl(request, '/internal/connect'));
    }
    if (match[2] === 'ticket' && request.method === 'POST') {
      if (!isAllowedOrigin(request, env)) return jsonResponse({ error: 'origin_not_allowed' }, 403, request, env);
      return createJoinTicket(request, env, stub, roomId);
    }
    if (!match[2] && request.method === 'GET') {
      const response = await stub.fetch(rewriteInternalUrl(request, '/internal/status'));
      return withCors(response, request, env);
    }
  }

  return jsonResponse({ error: 'not_found' }, 404, request, env);
}

async function authorizeRoomCreation(request, env) {
  if (isLocalDevelopmentRequest(request)) return { ok: true };
  if (env.REQUIRE_TURNSTILE !== 'true') return { ok: true };
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) {
    return { ok: false, error: 'turnstile_not_configured', status: 503 };
  }
  const input = await safeJson(request);
  const result = await verifyTurnstileToken({
    token: input?.turnstileToken,
    secret: env.TURNSTILE_SECRET_KEY,
    remoteIp: request.headers.get('cf-connecting-ip'),
    expectedAction: 'create-room'
  });
  return result.ok
    ? { ok: true }
    : { ok: false, error: result.error, status: result.error === 'turnstile_unavailable' ? 503 : 403 };
}

async function createJoinTicket(request, env, stub, roomId) {
  const secret = joinTicketSecret(request, env);
  if (!secret) return jsonResponse({ error: 'join_ticket_not_configured' }, 503, request, env);
  const input = await safeJson(request);
  if (!validClientId(input?.clientId)) return jsonResponse({ error: 'invalid_client_id' }, 400, request, env);
  const roomResponse = await stub.fetch(new Request(new URL('/internal/status', request.url)));
  if (!roomResponse.ok) return jsonResponse({ error: 'room_not_found' }, 404, request, env);
  const ttlSeconds = clampInt(env.JOIN_TICKET_TTL_SECONDS, 30, 300, 90);
  const ticket = await issueJoinTicket(secret, roomId, input.clientId, Date.now(), ttlSeconds * 1000);
  return jsonResponse(ticket, 201, request, env);
}

function joinTicketSecret(request, env) {
  const configured = String(env.JOIN_TOKEN_SECRET || '');
  if (configured.length >= 32) return configured;
  if (isLocalDevelopmentRequest(request)) return 'class-local-development-ticket-secret';
  return null;
}

function isLocalDevelopmentRequest(request) {
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) return false;
  const origin = request.headers.get('origin');
  return origin === 'http://localhost:4177' || origin === 'http://127.0.0.1:4177';
}

async function createRoom(request, env) {
  const now = Date.now();
  const ttlSeconds = clampInt(env.ROOM_TTL_SECONDS, 300, 14_400, 14_400);
  const maxStudents = clampInt(env.MAX_STUDENTS_PER_ROOM, 1, 100, 60);
  const directLimit = clampInt(env.DIRECT_LIMIT_PER_ROOM, 0, maxStudents, 30);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomId = generateRoomId();
    const ownerToken = randomToken();
    const stub = env.CLASSROOMS.getByName(roomId);
    const internalRequest = new Request(new URL('/internal/create', request.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        roomId,
        ownerToken,
        expiresAt: now + ttlSeconds * 1000,
        maxStudents,
        directLimit
      })
    });
    const created = await stub.fetch(internalRequest);
    if (created.status === 409) continue;
    if (!created.ok) return jsonResponse({ error: 'room_create_failed' }, 502, request, env);
    const room = await created.json();
    const websocketBase = new URL(request.url);
    websocketBase.protocol = websocketBase.protocol === 'https:' ? 'wss:' : 'ws:';
    websocketBase.pathname = `/api/rooms/${roomId}/connect`;
    websocketBase.search = '';
    return jsonResponse({ ...room, ownerToken, websocketUrl: websocketBase.toString() }, 201, request, env);
  }
  return jsonResponse({ error: 'room_id_exhausted' }, 503, request, env);
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  return Boolean(origin && allowedOrigins(env).includes(origin));
}

function corsHeaders(request, env) {
  const headers = {
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
  const origin = request.headers.get('origin');
  if (origin && allowedOrigins(env).includes(origin)) headers['access-control-allow-origin'] = origin;
  return headers;
}

function corsPreflight(request, env) {
  if (!isAllowedOrigin(request, env)) return new Response(null, { status: 403, headers: { vary: 'Origin' } });
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function jsonResponse(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env) }
  });
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request, env)).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function rewriteInternalUrl(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

function generateRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map(byte => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

function base64Url(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function clampInt(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function safeClose(socket, code, reason) {
  try {
    socket.close(code, reason);
  } catch {
    // Socket may already be closed.
  }
}
