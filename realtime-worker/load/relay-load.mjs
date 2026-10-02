import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const API_URL = String(process.env.CLASS_REALTIME_API_URL || 'http://localhost:8790').replace(/\/$/, '');
const ORIGIN = process.env.CLASS_REALTIME_ORIGIN || 'http://localhost:4177';
const STUDENT_COUNT = Math.max(1, Number.parseInt(process.env.STUDENTS || process.argv[2] || '60', 10));
const TIMEOUT_MS = 20_000;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function withTimeout(promise, label, timeoutMs = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs))
  ]);
}

function envelope(type, sequence, legacy, targetClientId = null) {
  const value = {
    v: 1,
    type,
    messageId: `load_${randomUUID()}`,
    sequence,
    sentAt: Date.now(),
    payload: { legacy }
  };
  if (targetClientId) value.targetClientId = targetClientId;
  return value;
}

function connect(url, protocols) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocols, { origin: ORIGIN });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `http_${response.status}`);
  return body;
}

async function main() {
  const startedAt = Date.now();
  const room = await jsonRequest('/api/rooms', { method: 'POST', body: '{}' });
  const teacherId = `teacher_load_${randomUUID()}`;
  const teacherUrl = new URL(room.websocketUrl);
  teacherUrl.searchParams.set('role', 'teacher');
  teacherUrl.searchParams.set('clientId', teacherId);
  const teacher = await connect(teacherUrl, ['classroom.v1', `owner.${room.ownerToken}`]);
  let teacherSequence = 0;
  const onlineIds = new Set();
  const answerIds = new Set();
  const allOnline = deferred();
  const allAnswers = deferred();

  teacher.on('message', raw => {
    const message = JSON.parse(String(raw));
    if (message.type === 'server.student-online') {
      onlineIds.add(message.payload.clientId);
      if (onlineIds.size === STUDENT_COUNT) allOnline.resolve();
      return;
    }
    if (message.type !== 'app.answer') return;
    answerIds.add(message.senderId);
    teacherSequence += 1;
    teacher.send(JSON.stringify(envelope('app.ack', teacherSequence, {
      type: 'ack',
      messageId: message.messageId,
      questionId: message.payload?.legacy?.questionId,
      accepted: true,
      persisted: true
    }, message.senderId)));
    if (answerIds.size === STUDENT_COUNT) allAnswers.resolve();
  });

  const latencies = [];
  const students = await Promise.all(Array.from({ length: STUDENT_COUNT }, async (_, index) => {
    const clientId = `student_load_${String(index + 1).padStart(3, '0')}_${randomUUID()}`;
    const ticket = await jsonRequest(`/api/rooms/${room.roomId}/ticket`, {
      method: 'POST',
      body: JSON.stringify({ clientId })
    });
    const url = new URL(room.websocketUrl);
    url.searchParams.set('role', 'student');
    url.searchParams.set('clientId', clientId);
    url.searchParams.set('mode', 'relay');
    url.searchParams.set('ticket', ticket.ticket);
    const socket = await connect(url, ['classroom.v1']);
    let sequence = 0;
    let answerMessageId = null;
    let answerSentAt = 0;
    const acknowledged = deferred();
    socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      const legacy = message.payload?.legacy;
      if (message.type === 'app.question') {
        sequence += 1;
        const answer = envelope('app.answer', sequence, {
          type: 'answer',
          val: ['A', 'B', 'C', 'D'][index % 4],
          questionId: legacy.questionId
        });
        answerMessageId = answer.messageId;
        answerSentAt = performance.now();
        socket.send(JSON.stringify(answer));
      } else if (message.type === 'app.ack' && legacy?.messageId === answerMessageId) {
        latencies.push(performance.now() - answerSentAt);
        acknowledged.resolve();
      }
    });
    sequence += 1;
    socket.send(JSON.stringify(envelope('app.join', sequence, {
      type: 'join',
      name: `load-${index + 1}`,
      gender: ''
    })));
    return { clientId, socket, acknowledged };
  }));

  await withTimeout(allOnline.promise, 'students_online');
  const joinedAt = Date.now();
  teacherSequence += 1;
  teacher.send(JSON.stringify(envelope('app.question', teacherSequence, {
    type: 'question',
    qType: 'ABCD',
    questionId: `question_${randomUUID()}`
  })));
  await withTimeout(Promise.all([
    allAnswers.promise,
    ...students.map(student => student.acknowledged.promise)
  ]), 'answers_acknowledged');
  const completedAt = Date.now();
  const roomStatus = await jsonRequest(`/api/rooms/${room.roomId}`);
  const sorted = [...latencies].sort((left, right) => left - right);
  const percentile = value => sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] || 0;

  students.forEach(student => student.socket.close(1000, 'load test complete'));
  teacher.close(1000, 'load test complete');

  console.log(JSON.stringify({
    test: 'relay-simultaneous-answer',
    apiUrl: API_URL,
    roomId: room.roomId,
    requestedStudents: STUDENT_COUNT,
    connectedStudents: roomStatus.connectedStudents,
    uniqueOnlineEvents: onlineIds.size,
    uniqueAnswers: answerIds.size,
    acknowledgements: latencies.length,
    joinDurationMs: joinedAt - startedAt,
    answerRoundTripMs: {
      min: Number((sorted[0] || 0).toFixed(2)),
      p50: Number(percentile(0.5).toFixed(2)),
      p95: Number(percentile(0.95).toFixed(2)),
      max: Number((sorted.at(-1) || 0).toFixed(2))
    },
    totalDurationMs: completedAt - startedAt,
    passed: onlineIds.size === STUDENT_COUNT &&
      answerIds.size === STUDENT_COUNT &&
      latencies.length === STUDENT_COUNT
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    test: 'relay-simultaneous-answer',
    requestedStudents: STUDENT_COUNT,
    passed: false,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
});
