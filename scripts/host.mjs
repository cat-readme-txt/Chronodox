import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.env.PORT || 4173);
const DIST_DIR = join(process.cwd(), 'dist');
const ROOM_COUNTDOWN_MS = 3000;
const DEFAULT_AI_DIFFICULTY = 'normal';
const DEFAULT_TURN_TIMER_SECONDS = 60;
const MIN_TURN_TIMER_SECONDS = 15;
const MAX_TURN_TIMER_SECONDS = 600;

if (!existsSync(DIST_DIR)) {
  console.error('dist/ not found. Run `npm run build` before starting the LAN host.');
  process.exit(1);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
};

const rooms = new Map();
const queueTickets = new Map();
const waitingQueue = [];

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  while (code.length < 6) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? makeRoomCode() : code;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 10_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

function createMember(playerId, clientId) {
  return {
    playerId,
    clientId,
    connected: Boolean(clientId),
    ready: false,
    joinedAt: clientId ? Date.now() : null,
    selectedAgentId: null,
    selectedPeriod: null,
  };
}

function normalizeSettings(settings = {}) {
  const rawSeconds = settings.turnTimerSeconds;
  const turnTimerSeconds = Number.isFinite(rawSeconds)
    ? Math.min(MAX_TURN_TIMER_SECONDS, Math.max(MIN_TURN_TIMER_SECONDS, Math.round(rawSeconds)))
    : DEFAULT_TURN_TIMER_SECONDS;
  const aiDifficulty = ['easy', 'normal', 'hard'].includes(String(settings.aiDifficulty).toLowerCase())
    ? String(settings.aiDifficulty).toLowerCase()
    : DEFAULT_AI_DIFFICULTY;
  return {
    turnTimerEnabled: Boolean(settings.turnTimerEnabled),
    turnTimerSeconds,
    aiDifficulty,
  };
}

function applyCountdownDeadline(room) {
  room.state = {
    ...room.state,
    matchConfig: { ...room.settings },
    turnDeadlineAt: room.settings.turnTimerEnabled && typeof room.countdownStartAt === 'number'
      ? room.countdownStartAt + ROOM_COUNTDOWN_MS + (room.settings.turnTimerSeconds * 1000)
      : null,
  };
}

function createRoom({ roomCode, transport, state, settings, p1ClientId, p2ClientId = null }) {
  const normalizedSettings = normalizeSettings(settings);
  return {
    roomCode,
    transport,
    status: 'waiting',
    revision: 0,
    state: {
      ...state,
      matchConfig: { ...normalizedSettings },
      turnDeadlineAt: null,
    },
    settings: normalizedSettings,
    createdAt: Date.now(),
    countdownStartAt: null,
    members: {
      P1: createMember('P1', p1ClientId),
      P2: createMember('P2', p2ClientId),
    },
  };
}

function removeWaitingTicket(ticketId) {
  const index = waitingQueue.findIndex(entry => entry.ticketId === ticketId);
  if (index >= 0) waitingQueue.splice(index, 1);
}

function findMemberByClientId(room, clientId) {
  if (room.members.P1.clientId === clientId) return room.members.P1;
  if (room.members.P2.clientId === clientId) return room.members.P2;
  return null;
}

function advanceRoomStatus(room) {
  if (
    room.status === 'countdown'
    && typeof room.countdownStartAt === 'number'
    && Date.now() >= room.countdownStartAt + ROOM_COUNTDOWN_MS
  ) {
    room.status = 'active';
  }
  return room;
}

function evaluateRoomReadiness(room) {
  advanceRoomStatus(room);
  const everyoneConnected = room.members.P1.connected && room.members.P2.connected;
  const everyoneReady = room.members.P1.ready && room.members.P2.ready;

  if (room.status === 'active') return;

  if (everyoneConnected && everyoneReady) {
    if (room.status !== 'countdown') {
      room.status = 'countdown';
      room.countdownStartAt = Date.now();
      applyCountdownDeadline(room);
    }
    return;
  }

  room.status = 'waiting';
  room.countdownStartAt = null;
  room.state = {
    ...room.state,
    turnDeadlineAt: null,
  };
}

function getPresencePayload() {
  const onlineClients = new Set();
  for (const ticket of waitingQueue) {
    onlineClients.add(ticket.clientId);
  }
  for (const room of rooms.values()) {
    for (const member of Object.values(room.members)) {
      if (member.connected && member.clientId) onlineClients.add(member.clientId);
    }
  }
  return {
    queueSeekers: waitingQueue.length,
    waitingRooms: [...rooms.values()].filter(room => room.status === 'waiting').length,
    onlineNow: onlineClients.size,
  };
}

function roomSnapshot(room) {
  advanceRoomStatus(room);
  return {
    roomCode: room.roomCode,
    transport: room.transport,
    revision: room.revision,
    state: room.state,
    status: room.status,
    countdownStartAt: room.countdownStartAt,
    createdAt: room.createdAt,
    readyPlayers: Object.values(room.members)
      .filter(member => member.ready)
      .map(member => member.playerId),
    connectedPlayers: Object.values(room.members)
      .filter(member => member.connected)
      .map(member => member.playerId),
    selections: {
      P1: {
        selectedAgentId: room.members.P1.selectedAgentId,
        selectedPeriod: room.members.P1.selectedPeriod,
      },
      P2: {
        selectedAgentId: room.members.P2.selectedAgentId,
        selectedPeriod: room.members.P2.selectedPeriod,
      },
    },
    hostConnected: room.members.P1.connected,
    guestConnected: room.members.P2.connected,
    settings: room.settings,
  };
}

function ensureRoom(code, res) {
  const room = rooms.get(code);
  if (!room) {
    sendJson(res, 404, { error: `Room ${code} was not found.` });
    return null;
  }
  return room;
}

async function serveStatic(req, res, pathname) {
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const isRootRequest = safePath === '/';
  const requestPath = isRootRequest ? 'index.html' : safePath.slice(1);
  let filePath = join(DIST_DIR, requestPath);
  const hasFileExtension = extname(requestPath).length > 0;

  if (!existsSync(filePath)) {
    if (!hasFileExtension) {
      filePath = join(DIST_DIR, 'index.html');
    } else {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(`Asset not found: ${pathname}`);
      return;
    }
  }

  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && pathname === '/api/presence') {
      sendJson(res, 200, getPresencePayload());
      return;
    }

    if (req.method === 'POST' && pathname === '/api/queue') {
      const body = await readJson(req);
      if (!body.clientId || !body.state) {
        sendJson(res, 400, { error: 'clientId and state are required.' });
        return;
      }
      const requestedSettings = normalizeSettings(body.settings);

      const existingTicket = waitingQueue.find(entry => entry.clientId === body.clientId);
      if (existingTicket) {
        sendJson(res, 200, {
          matched: false,
          ticketId: existingTicket.ticketId,
          searchingCount: waitingQueue.length,
        });
        return;
      }

      const opponentTicket = waitingQueue.find(entry =>
        entry.clientId !== body.clientId
        && Boolean(entry.settings?.turnTimerEnabled) === requestedSettings.turnTimerEnabled
        && Number(entry.settings?.turnTimerSeconds) === requestedSettings.turnTimerSeconds
      );
      if (opponentTicket) {
        removeWaitingTicket(opponentTicket.ticketId);
        const roomCode = makeRoomCode();
        const room = createRoom({
          roomCode,
          transport: 'queue',
          state: opponentTicket.state,
          settings: requestedSettings,
          p1ClientId: opponentTicket.clientId,
          p2ClientId: body.clientId,
        });
        rooms.set(roomCode, room);
        queueTickets.set(opponentTicket.ticketId, {
          ...opponentTicket,
          matched: true,
          roomCode,
          playerId: 'P1',
        });
        sendJson(res, 200, {
          matched: true,
          roomCode,
          playerId: 'P2',
          searchingCount: waitingQueue.length,
        });
        return;
      }

      const ticketId = makeId('queue');
      const ticket = {
        ticketId,
        clientId: body.clientId,
        state: body.state,
        settings: requestedSettings,
        createdAt: Date.now(),
        matched: false,
        roomCode: null,
        playerId: null,
      };
      queueTickets.set(ticketId, ticket);
      waitingQueue.push(ticket);
      sendJson(res, 200, {
        matched: false,
        ticketId,
        searchingCount: waitingQueue.length,
      });
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/api/queue/')) {
      const ticketId = pathname.split('/').pop();
      const ticket = ticketId ? queueTickets.get(ticketId) : null;
      if (!ticket) {
        sendJson(res, 404, { error: 'Queue ticket not found.' });
        return;
      }
      sendJson(res, 200, {
        matched: ticket.matched,
        roomCode: ticket.roomCode ?? undefined,
        playerId: ticket.playerId ?? undefined,
        ticketId,
        searchingCount: waitingQueue.length,
      });
      return;
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/queue/')) {
      const ticketId = pathname.split('/').pop();
      if (ticketId) {
        removeWaitingTicket(ticketId);
        queueTickets.delete(ticketId);
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/rooms') {
      const body = await readJson(req);
      if (!body.clientId || !body.state) {
        sendJson(res, 400, { error: 'clientId and state are required.' });
        return;
      }
      const requestedSettings = normalizeSettings(body.settings);
      const roomCode = makeRoomCode();
      rooms.set(roomCode, createRoom({
        roomCode,
        transport: 'room',
        state: body.state,
        settings: requestedSettings,
        p1ClientId: body.clientId,
      }));
      sendJson(res, 200, { roomCode, playerId: 'P1', revision: 0 });
      return;
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/rooms\/[A-Z0-9]+\/join$/)) {
      const [, , , rawCode] = pathname.split('/');
      const roomCode = rawCode.toUpperCase();
      const room = ensureRoom(roomCode, res);
      if (!room) return;
      const body = await readJson(req);
      if (!body.clientId) {
        sendJson(res, 400, { error: 'clientId is required.' });
        return;
      }
      if (room.members.P1.clientId === body.clientId) {
        room.members.P1.connected = true;
        room.members.P1.joinedAt ??= Date.now();
        evaluateRoomReadiness(room);
        sendJson(res, 200, { roomCode, playerId: 'P1', revision: room.revision });
        return;
      }
      if (room.members.P2.clientId === body.clientId) {
        room.members.P2.connected = true;
        room.members.P2.joinedAt ??= Date.now();
        evaluateRoomReadiness(room);
        sendJson(res, 200, { roomCode, playerId: 'P2', revision: room.revision });
        return;
      }
      if (room.members.P2.connected && room.members.P2.clientId !== body.clientId) {
        sendJson(res, 409, { error: `Room ${roomCode} is already full.` });
        return;
      }
      room.members.P2.clientId = body.clientId;
      room.members.P2.connected = true;
      room.members.P2.joinedAt = Date.now();
      room.members.P2.ready = false;
      evaluateRoomReadiness(room);
      sendJson(res, 200, { roomCode, playerId: 'P2', revision: room.revision });
      return;
    }

    if (req.method === 'GET' && pathname.match(/^\/api\/rooms\/[A-Z0-9]+\/state$/)) {
      const [, , , rawCode] = pathname.split('/');
      const room = ensureRoom(rawCode.toUpperCase(), res);
      if (!room) return;
      sendJson(res, 200, roomSnapshot(room));
      return;
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/rooms\/[A-Z0-9]+\/ready$/)) {
      const [, , , rawCode] = pathname.split('/');
      const room = ensureRoom(rawCode.toUpperCase(), res);
      if (!room) return;
      const body = await readJson(req);
      if (!body.clientId || typeof body.ready !== 'boolean') {
        sendJson(res, 400, { error: 'clientId and ready are required.' });
        return;
      }
      const member = findMemberByClientId(room, body.clientId);
      if (!member) {
        sendJson(res, 403, { error: 'Client is not part of this room.' });
        return;
      }
      member.connected = true;
      member.ready = body.ready;
      evaluateRoomReadiness(room);
      sendJson(res, 200, roomSnapshot(room));
      return;
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/rooms\/[A-Z0-9]+\/settings$/)) {
      const [, , , rawCode] = pathname.split('/');
      const room = ensureRoom(rawCode.toUpperCase(), res);
      if (!room) return;
      const body = await readJson(req);
      if (!body.clientId || !body.settings) {
        sendJson(res, 400, { error: 'clientId and settings are required.' });
        return;
      }
      if (room.transport !== 'room') {
        sendJson(res, 409, { error: 'Queue rooms do not allow manual settings changes.' });
        return;
      }
      if (room.status === 'active') {
        sendJson(res, 409, { error: 'Room settings are locked after the mission begins.' });
        return;
      }
      const member = findMemberByClientId(room, body.clientId);
      if (!member) {
        sendJson(res, 403, { error: 'Client is not part of this room.' });
        return;
      }
      if (member.playerId !== 'P1') {
        sendJson(res, 403, { error: 'Only the host may change room settings.' });
        return;
      }

      room.settings = normalizeSettings(body.settings);
      room.members.P1.ready = false;
      room.members.P2.ready = false;
      room.status = 'waiting';
      room.countdownStartAt = null;
      room.state = {
        ...room.state,
        matchConfig: { ...room.settings },
        turnDeadlineAt: null,
      };

      sendJson(res, 200, roomSnapshot(room));
      return;
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/rooms\/[A-Z0-9]+\/presence$/)) {
      const [, , , rawCode] = pathname.split('/');
      const room = ensureRoom(rawCode.toUpperCase(), res);
      if (!room) return;
      const body = await readJson(req);
      if (!body.clientId) {
        sendJson(res, 400, { error: 'clientId is required.' });
        return;
      }
      const member = findMemberByClientId(room, body.clientId);
      if (!member) {
        sendJson(res, 403, { error: 'Client is not part of this room.' });
        return;
      }
      member.connected = true;
      member.selectedAgentId = typeof body.selectedAgentId === 'string' ? body.selectedAgentId : null;
      member.selectedPeriod = typeof body.selectedPeriod === 'string' ? body.selectedPeriod : null;
      sendJson(res, 200, roomSnapshot(room));
      return;
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/rooms\/[A-Z0-9]+\/state$/)) {
      const [, , , rawCode] = pathname.split('/');
      const room = ensureRoom(rawCode.toUpperCase(), res);
      if (!room) return;
      const body = await readJson(req);
      if (!body.clientId || body.state == null || typeof body.revisionBase !== 'number') {
        sendJson(res, 400, { error: 'clientId, state, and revisionBase are required.' });
        return;
      }
      if (room.status !== 'active') {
        sendJson(res, 409, { error: 'Room is not active yet.', ...roomSnapshot(room) });
        return;
      }
      const member = findMemberByClientId(room, body.clientId);
      if (!member) {
        sendJson(res, 403, { error: 'Client is not part of this room.' });
        return;
      }
      if (body.revisionBase !== room.revision) {
        sendJson(res, 409, {
          error: 'Room state moved. Pull the newest timeline and retry.',
          revision: room.revision,
          state: room.state,
        });
        return;
      }
      room.state = body.state;
      room.revision += 1;
      sendJson(res, 200, { revision: room.revision });
      return;
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/rooms\/[A-Z0-9]+\/leave$/)) {
      const [, , , rawCode] = pathname.split('/');
      const room = ensureRoom(rawCode.toUpperCase(), res);
      if (!room) return;
      const body = await readJson(req);
      const member = body.clientId ? findMemberByClientId(room, body.clientId) : null;
      if (!member) {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (room.transport === 'room' && member.playerId === 'P2') {
        room.members.P2 = createMember('P2', null);
        room.members.P1.ready = false;
        room.members.P1.selectedAgentId = null;
        room.members.P1.selectedPeriod = null;
        evaluateRoomReadiness(room);
        sendJson(res, 200, { ok: true });
        return;
      }

      member.connected = false;
      member.ready = false;
      rooms.delete(room.roomCode);
      sendJson(res, 200, { ok: true });
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Host server error' });
  }
});

server.listen(PORT, '0.0.0.0', async () => {
  const interfaces = networkInterfaces();
  const lanAddresses = Object.values(interfaces)
    .flat()
    .filter(details => details && details.family === 'IPv4' && !details.internal)
    .map(details => details.address);

  await readFile(join(DIST_DIR, 'index.html'), 'utf8').catch(() => null);
  console.log(`Chronodox host live on http://localhost:${PORT}`);
  for (const address of lanAddresses) {
    console.log(`LAN access for everyone on the same network: http://${address}:${PORT}`);
  }
});
