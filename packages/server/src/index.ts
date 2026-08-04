import {
  DEFAULT_PORT,
  SNAPSHOT_EVERY_TICKS,
  TICK_RATE,
  normalizeRoom,
  serializeState,
  type ClientMessage,
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

interface Client {
  room: string;
  /** null이면 관전자 */
  playerId: PlayerId | null;
}

const rooms = new Map<string, Room>();
const clients = new Map<WebSocket, Client>();

function roomFor(code: string): Room {
  let room = rooms.get(code);
  if (!room) {
    room = new Room();
    rooms.set(code, room);
    console.log(`[방] ${code} 생성 (현재 ${rooms.size}개)`);
  }
  return room;
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

const wss = new WebSocketServer({ server: http });

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const code = normalizeRoom(url.searchParams.get('room'));
  const room = roomFor(code);

  // 자리가 없으면 거절하지 않고 관전으로 받는다
  const playerId = room.join();
  clients.set(ws, { room: code, playerId });
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
    if (playerId === null) return; // 관전자는 입력을 보낼 수 없다
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return; // 깨진 패킷 하나로 서버가 죽으면 안 된다
    }
    if (msg.t === 'input') room.setInput(playerId, msg.seq, msg.move, msg.place);
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
      ws.send(`{"t":"snapshot","ack":${ack},"state":${stateJson}}`);
    }
  }
}

http.listen(PORT, () => {
  console.log(
    `크레이지 아케이드 서버 — 포트 ${PORT} (${TICK_RATE}Hz, 스냅샷 ${TICK_RATE / SNAPSHOT_EVERY_TICKS}Hz)`,
  );
  console.log(`헬스체크: http://localhost:${PORT}/health`);
});
