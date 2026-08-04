import {
  DEFAULT_PORT,
  SNAPSHOT_EVERY_TICKS,
  TICK_RATE,
  serializeState,
  type ClientMessage,
  type PlayerId,
  type ServerMessage,
} from '@crazy/core';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room } from './room.js';

const PORT = Number(process.env['PORT'] ?? DEFAULT_PORT);
const MS_PER_TICK = 1000 / TICK_RATE;
/** 서버가 멈췄다 깨어났을 때 몰아서 돌리는 한계 */
const MAX_CATCHUP_TICKS = 5;

const room = new Room();
const clients = new Map<WebSocket, PlayerId>();

const wss = new WebSocketServer({ port: PORT });

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

wss.on('connection', (ws) => {
  const playerId = room.join();
  if (playerId === null) {
    send(ws, { t: 'reject', reason: '자리가 꽉 찼습니다 (최대 4명)' });
    ws.close();
    return;
  }

  clients.set(ws, playerId);
  console.log(`[+] ${playerId + 1}P 접속 — 현재 ${room.humanCount}명`);

  send(ws, {
    t: 'welcome',
    playerId,
    snapshotIntervalMs: MS_PER_TICK * SNAPSHOT_EVERY_TICKS,
    state: serializeState(room.state),
  });

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return; // 깨진 패킷 하나로 서버가 죽으면 안 된다
    }
    if (msg.t === 'input') room.setInput(playerId, msg.move, msg.place);
  });

  const drop = (): void => {
    if (!clients.delete(ws)) return;
    room.leave(playerId);
    console.log(`[-] ${playerId + 1}P 퇴장 — 현재 ${room.humanCount}명`);
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
    room.tick();
    accumulator -= MS_PER_TICK;
    ticks++;

    if (++tickCounter >= SNAPSHOT_EVERY_TICKS) {
      tickCounter = 0;
      const snapshot = JSON.stringify({ t: 'snapshot', state: serializeState(room.state) });
      for (const ws of clients.keys()) {
        if (ws.readyState === ws.OPEN) ws.send(snapshot);
      }
    }
  }
  // 따라잡기를 포기한 만큼은 버린다 (누적되면 나선형으로 악화된다)
  if (ticks >= MAX_CATCHUP_TICKS) accumulator = 0;
}, 4);

console.log(`크레이지 아케이드 서버 — ws://0.0.0.0:${PORT} (${TICK_RATE}Hz, 스냅샷 ${TICK_RATE / SNAPSHOT_EVERY_TICKS}Hz)`);
