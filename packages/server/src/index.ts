import {
  DEFAULT_PORT,
  MAX_MESSAGE_BYTES,
  SNAPSHOT_EVERY_TICKS,
  TICK_RATE,
  normalizeRoom,
  parseClientMessage,
  serializeState,
  type PlayerId,
  type ServerMessage,
} from '@crazy/core';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room } from './room.js';

const PORT = Number(process.env['PORT'] ?? DEFAULT_PORT);
const MS_PER_TICK = 1000 / TICK_RATE;
/** 서버가 멈췄다 깨어났을 때 몰아서 돌리는 한계 */
const MAX_CATCHUP_TICKS = 5;

/**
 * 상한들.
 *
 * 방은 접속만 하면 생기고 **각각 60Hz로 step()을 돈다.** 상한이 없으면 접속마다
 * 다른 방 코드를 대는 것만으로 CPU를 바닥낼 수 있다 — shared-cpu-1x / 256MB에서는
 * 금방이다. 방 수와 접속 수를 모두 막아야 하는 이유가 이것이다.
 *
 * 값은 지금 규모(친구들끼리)에 맞춘 것이고, 실제로 부딪히면 올리면 된다.
 */
const num = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

const MAX_ROOMS = num('MAX_ROOMS', 50);
const MAX_CLIENTS = num('MAX_CLIENTS', 200);
/**
 * 같은 주소에서 여는 탭 수. README가 "탭 두 개로 같은 판"을 권하므로 넉넉해야 한다.
 *
 * **프록시 뒤에서 `fly-client-ip`가 없으면 전원이 한 주소로 보인다.** 그런 환경에
 * 올릴 때는 이 값을 올리거나 꺼야 한다 — 안 그러면 서버 전체가 이 숫자에 갇힌다.
 */
const MAX_CLIENTS_PER_IP = num('MAX_CLIENTS_PER_IP', 8);
/** 정상 클라이언트는 틱마다 하나(초당 60개)를 보낸다. 두 배까지는 봐준다 */
const MAX_MESSAGES_PER_SEC = num('MAX_MESSAGES_PER_SEC', 120);

interface Client {
  room: string;
  /** null이면 관전자 */
  playerId: PlayerId | null;
  ip: string;
  /** 최근 1초 동안 받은 메시지 수 */
  messages: number;
  windowStart: number;
}

const rooms = new Map<string, Room>();
const clients = new Map<WebSocket, Client>();

/** 이미 있는 방에만 붙여준다. 새로 만드는 것은 상한에 걸릴 수 있다 */
function roomFor(code: string): Room | null {
  const existing = rooms.get(code);
  if (existing) return existing;
  if (rooms.size >= MAX_ROOMS) return null;

  const room = new Room();
  rooms.set(code, room);
  console.log(`[방] ${code} 생성 (현재 ${rooms.size}개)`);
  return room;
}

/**
 * 접속자 IP. Fly 프록시 뒤에 있으므로 소켓 주소는 전부 프록시 것이 된다.
 *
 * `fly-client-ip`는 프록시가 붙여주므로 그 환경에서는 클라이언트가 위조할 수 없다.
 * **직접 노출된 서버라면 이 헤더를 믿으면 안 된다** — 그때는 소켓 주소만 남는다.
 */
function clientIp(headers: Record<string, string | string[] | undefined>, socket: string): string {
  const flyIp = headers['fly-client-ip'];
  if (typeof flyIp === 'string' && flyIp) return flyIp;
  return socket;
}

function countForIp(ip: string): number {
  let n = 0;
  for (const client of clients.values()) if (client.ip === ip) n++;
  return n;
}

function membersOf(code: string): WebSocket[] {
  const list: WebSocket[] = [];
  for (const [ws, client] of clients) {
    if (client.room === code) list.push(ws);
  }
  return list;
}

// Fly의 헬스체크와 배포 확인용. WebSocket은 이 서버에 업그레이드로 붙는다
const http = createServer((req, res) => {
  if (req.url === '/health') {
    const summary = [...rooms.entries()].map(([code, room]) => ({
      room: code,
      players: room.humanCount,
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: summary }));
    return;
  }
  res.writeHead(404).end();
});

// ws의 기본 상한은 100MB다. 우리 메시지는 40바이트 남짓이라 훨씬 일찍 끊어도 된다
const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES });

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

/** 거절은 이유를 알려주고 끊는다. 조용히 끊으면 클라이언트가 재접속을 반복한다 */
function reject(ws: WebSocket, reason: string): void {
  send(ws, { t: 'reject', reason });
  ws.close();
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req.headers, req.socket.remoteAddress ?? '?');

  if (clients.size >= MAX_CLIENTS) return reject(ws, '서버가 가득 찼습니다');
  if (countForIp(ip) >= MAX_CLIENTS_PER_IP) return reject(ws, '같은 주소에서 너무 많이 접속했습니다');

  const url = new URL(req.url ?? '/', 'http://localhost');
  const code = normalizeRoom(url.searchParams.get('room'));
  const room = roomFor(code);
  if (!room) return reject(ws, '방이 너무 많습니다. 잠시 후 다시 시도해 주세요');

  // 자리가 없으면 거절하지 않고 관전으로 받는다
  const playerId = room.join();
  clients.set(ws, { room: code, playerId, ip, messages: 0, windowStart: Date.now() });
  console.log(
    `[+] ${code} — ${playerId === null ? '관전자' : `${playerId + 1}P`} 접속 (플레이어 ${room.humanCount}명)`,
  );

  send(ws, {
    t: 'welcome',
    playerId,
    room: code,
    snapshotIntervalMs: MS_PER_TICK * SNAPSHOT_EVERY_TICKS,
    state: serializeState(room.state),
  });

  ws.on('message', (raw) => {
    const client = clients.get(ws);
    if (!client) return;

    // 1초 창을 넘겨 쏟아내면 끊는다. 정상 클라이언트는 여기 닿지 않는다
    const now = Date.now();
    if (now - client.windowStart >= 1000) {
      client.windowStart = now;
      client.messages = 0;
    }
    if (++client.messages > MAX_MESSAGES_PER_SEC) {
      reject(ws, '입력을 너무 빨리 보냅니다');
      return;
    }

    if (playerId === null) return; // 관전자는 입력을 보낼 수 없다

    // 깨졌거나 규약에 맞지 않는 것은 조용히 버린다. 패킷 하나로 서버가 흔들리면 안 된다
    const msg = parseClientMessage(String(raw));
    if (!msg) return;
    room.setInput(playerId, msg.seq, msg.move, msg.place);
  });

  const drop = (): void => {
    if (!clients.delete(ws)) return;
    if (playerId !== null) room.leave(playerId);
    console.log(`[-] ${code} — 퇴장 (플레이어 ${room.humanCount}명)`);

    // 아무도 없는 방은 계속 돌릴 이유가 없다
    if (membersOf(code).length === 0) {
      rooms.delete(code);
      console.log(`[방] ${code} 정리 (현재 ${rooms.size}개)`);
    }
  };
  ws.on('close', drop);
  ws.on('error', drop);
});

/**
 * 서버 권위 루프. 시뮬레이션은 정확히 60Hz로 돌고 스냅샷은 20Hz로 나간다.
 * setInterval은 정확하지 않으므로 실제 경과 시간을 누적해서 보정한다.
 */
let last = performance.now();
let accumulator = 0;
let tickCounter = 0;

setInterval(() => {
  const now = performance.now();
  accumulator += now - last;
  last = now;

  let ticks = 0;
  while (accumulator >= MS_PER_TICK && ticks < MAX_CATCHUP_TICKS) {
    for (const room of rooms.values()) room.tick();
    accumulator -= MS_PER_TICK;
    ticks++;

    if (++tickCounter >= SNAPSHOT_EVERY_TICKS) {
      tickCounter = 0;
      broadcast();
    }
  }
  // 따라잡기를 포기한 만큼은 버린다 (누적되면 나선형으로 악화된다)
  if (ticks >= MAX_CATCHUP_TICKS) accumulator = 0;
}, 4);

function broadcast(): void {
  for (const [code, room] of rooms) {
    // ack는 클라이언트마다 다르지만 state는 같다. 무거운 쪽을 방마다 한 번만 직렬화한다
    const stateJson = JSON.stringify(serializeState(room.state));
    for (const ws of membersOf(code)) {
      if (ws.readyState !== ws.OPEN) continue;
      const client = clients.get(ws)!;
      const ack = client.playerId === null ? 0 : room.ackFor(client.playerId);
      // ack는 원래 클라이언트가 보낸 seq다. 손으로 만드는 JSON에 그대로 끼워 넣으므로
      // 숫자가 아닌 것이 새어 들어오면 이 줄이 통째로 깨진다. 입구에서 이미 걸렀지만,
      // 문자열을 조립하는 쪽에서도 한 번 더 못을 박는다
      const safeAck = Number.isSafeInteger(ack) ? ack : 0;
      ws.send(`{"t":"snapshot","ack":${safeAck},"state":${stateJson}}`);
    }
  }
}

http.listen(PORT, () => {
  console.log(
    `크레이지 아케이드 서버 — 포트 ${PORT} (${TICK_RATE}Hz, 스냅샷 ${TICK_RATE / SNAPSHOT_EVERY_TICKS}Hz)`,
  );
  console.log(`헬스체크: http://localhost:${PORT}/health`);
});
