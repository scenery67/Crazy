import {
  deserializeState,
  type Dir,
  type GameState,
  type PlayerId,
  type ServerMessage,
} from '@crazy/core';

export type Status = 'idle' | 'connecting' | 'connected' | 'error';

/**
 * 서버 권위 접속 (M8 1단계 — 예측 없음).
 *
 * 클라이언트는 시뮬레이션을 돌리지 않는다. 입력만 보내고 받은 스냅샷을 그린다.
 * 입력이 왕복 지연만큼 늦게 반영되지만, 규칙 동기화가 맞는지부터 확인하는 게
 * 먼저다. 예측·재조정은 2단계에서 붙인다.
 */
export class OnlineSession {
  playerId: PlayerId | null = null;
  status: Status = 'idle';
  message = '';

  private ws: WebSocket | null = null;
  private prev: GameState | null = null;
  private curr: GameState | null = null;
  private currAt = 0;
  private intervalMs = 50;
  private lastMove: Dir | null | undefined = undefined;

  constructor(private readonly onChange: () => void) {}

  connect(url: string): void {
    this.disconnect();
    this.status = 'connecting';
    this.message = '접속 중…';
    this.onChange();

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.fail('주소가 올바르지 않습니다');
      return;
    }
    this.ws = ws;

    ws.onmessage = (e) => this.receive(String(e.data));
    ws.onerror = () => this.fail('접속에 실패했습니다');
    ws.onclose = () => {
      if (this.status === 'connected') this.fail('서버와 연결이 끊어졌습니다');
      else if (this.status === 'connecting') this.fail('서버에 닿지 못했습니다');
    };
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = null;
    this.playerId = null;
    this.prev = null;
    this.curr = null;
    this.lastMove = undefined;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }
    this.status = 'idle';
    this.message = '';
  }

  get isLive(): boolean {
    return this.status === 'connected' && this.curr !== null;
  }

  /** 입력은 바뀔 때만 보낸다. WebSocket이 순서와 도착을 보장하므로 안전하다 */
  sendInput(move: Dir | null, place: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!place && move === this.lastMove) return;
    this.lastMove = move;
    this.ws.send(JSON.stringify({ t: 'input', move, place }));
  }

  /**
   * 화면에 그릴 상태. 스냅샷 하나만큼 뒤처져서 보간한다.
   * 20Hz 스냅샷을 그대로 그리면 뚝뚝 끊겨 보인다.
   */
  view(now: number): GameState | null {
    if (!this.curr) return null;
    if (!this.prev) return this.curr;

    const alpha = Math.min(1, Math.max(0, (now - this.currAt) / this.intervalMs));
    const out: GameState = {
      ...this.curr,
      players: this.curr.players.map((p) => ({ ...p })),
    };

    for (const p of out.players) {
      const before = this.prev.players.find((q) => q.id === p.id);
      if (!before) continue;
      p.x = Math.round(before.x + (p.x - before.x) * alpha);
      p.y = Math.round(before.y + (p.y - before.y) * alpha);
    }
    return out;
  }

  private receive(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    if (msg.t === 'reject') {
      this.fail(msg.reason);
      return;
    }

    if (msg.t === 'welcome') {
      this.playerId = msg.playerId;
      this.intervalMs = msg.snapshotIntervalMs;
      this.status = 'connected';
      this.message = `${msg.playerId + 1}P로 참가`;
      this.curr = deserializeState(msg.state);
      this.prev = null;
      this.currAt = performance.now();
      this.onChange();
      return;
    }

    const next = deserializeState(msg.state);
    // 새 판이 시작되면 좌표가 순간이동한다. 보간하면 맵을 가로질러 미끄러진다
    this.prev = this.curr && next.tick >= this.curr.tick ? this.curr : null;
    this.curr = next;
    this.currAt = performance.now();
  }

  private fail(message: string): void {
    this.ws = null;
    this.playerId = null;
    this.prev = null;
    this.curr = null;
    this.status = 'error';
    this.message = message;
    this.onChange();
  }
}
