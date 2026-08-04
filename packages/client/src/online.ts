import {
  cloneState,
  deserializeState,
  step,
  type Dir,
  type GameState,
  type InputFrame,
  type PlayerId,
  type Player,
  type ServerMessage,
} from '@crazy/core';

export type Status = 'idle' | 'connecting' | 'connected' | 'error';

interface PendingInput {
  seq: number;
  move: Dir | null;
  place: boolean;
}

/**
 * 서버 권위 접속 + 내 캐릭터 예측 (M8 2단계).
 *
 * 서버가 진실이지만, 내 입력까지 왕복을 기다리면 조작이 늦게 느껴진다.
 * 그래서 내 입력은 즉시 로컬에 반영하고, 스냅샷이 올 때마다
 * **그 시점으로 되감아 아직 반영되지 않은 입력만 다시 재생**한다.
 *
 * 원격 플레이어는 예측하지 않는다. 그들의 입력을 알 수 없어서 추측이 빗나가면
 * 더 어색해지고, 스냅샷 보간만으로도 충분히 부드럽다.
 * 결정론적 step()과 cloneState()가 없으면 이 재조정은 성립하지 않는다.
 */
export class OnlineSession {
  playerId: PlayerId | null = null;
  room = '';
  status: Status = 'idle';
  message = '';
  /** 재조정 시 서버 위치와 예측 위치가 얼마나 벌어졌는지 (디버깅용) */
  lastCorrection = 0;

  /** 자리가 없어 관전만 하는 상태 */
  get isSpectator(): boolean {
    return this.status === 'connected' && this.playerId === null;
  }

  private url = '';
  private retries = 0;
  private retryTimer: number | null = null;
  private ws: WebSocket | null = null;
  private prev: GameState | null = null;
  private curr: GameState | null = null;
  private currAt = 0;
  private intervalMs = 50;

  private seq = 0;
  private pending: PendingInput[] = [];
  /** 아직 서버가 모르는 내 입력까지 반영한 상태 */
  private predicted: GameState | null = null;

  constructor(private readonly onChange: () => void) {}

  connect(url: string, room: string): void {
    this.stop();
    this.url = `${url}${url.includes('?') ? '&' : '?'}room=${encodeURIComponent(room)}`;
    this.retries = 0;
    this.open();
  }

  private open(): void {
    this.status = 'connecting';
    this.message = this.retries > 0 ? `재접속 시도 ${this.retries}…` : '접속 중…';
    this.onChange();

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.fail('주소가 올바르지 않습니다');
      return;
    }
    this.ws = ws;

    ws.onmessage = (e) => this.receive(String(e.data));
    ws.onerror = () => {
      /* onclose가 뒤따르므로 여기서는 처리하지 않는다 */
    };
    ws.onclose = () => {
      this.ws = null;
      this.retry();
    };
  }

  /**
   * 끊기면 다시 붙는다. 같은 자리로 돌아간다는 보장은 없다 —
   * 서버가 빈 자리를 순서대로 주므로 다른 번호를 받을 수 있다.
   */
  private retry(): void {
    if (this.retries >= 5) {
      this.fail('서버에 닿지 못했습니다');
      return;
    }
    this.reset();
    this.retries++;
    const delay = Math.min(8000, 1000 * 2 ** (this.retries - 1));
    this.status = 'connecting';
    this.message = `연결 끊김 — ${delay / 1000}초 후 재시도`;
    this.onChange();
    this.retryTimer = window.setTimeout(() => this.open(), delay);
  }

  disconnect(): void {
    this.stop();
    this.status = 'idle';
    this.message = '';
  }

  private stop(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    this.reset();
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }
  }

  get isLive(): boolean {
    return this.status === 'connected' && this.curr !== null;
  }

  /**
   * 한 틱 분의 입력. 서버로 보내고 동시에 로컬에도 즉시 반영한다.
   * 매 틱 보내는 이유는 재조정이 "번호로 어디까지 반영됐는지"에 기대기 때문이다.
   */
  tick(move: Dir | null, place: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.playerId === null || !this.predicted) return;

    const seq = ++this.seq;
    this.ws.send(JSON.stringify({ t: 'input', seq, move, place }));
    this.pending.push({ seq, move, place });
    // 서버가 오래 응답하지 않아도 버퍼가 무한히 자라지 않게 한다
    if (this.pending.length > 240) this.pending.shift();

    step(this.predicted, [this.frame(move, place)]);
  }

  /**
   * 화면에 그릴 상태.
   * 전체는 스냅샷 보간으로 그리고, **내 캐릭터만 예측 결과로 덮어쓴다.**
   */
  view(now: number): GameState | null {
    if (!this.curr) return null;

    const out: GameState = {
      ...this.curr,
      players: this.curr.players.map((p) => ({ ...p })),
    };

    if (this.prev) {
      const alpha = Math.min(1, Math.max(0, (now - this.currAt) / this.intervalMs));
      for (const p of out.players) {
        const before = this.prev.players.find((q) => q.id === p.id);
        if (!before) continue;
        p.x = Math.round(before.x + (p.x - before.x) * alpha);
        p.y = Math.round(before.y + (p.y - before.y) * alpha);
      }
    }

    const me = this.predicted?.players.find((p) => p.id === this.playerId);
    const slot = out.players.find((p) => p.id === this.playerId);
    if (me && slot) {
      slot.x = me.x;
      slot.y = me.y;
      slot.facing = me.facing;
    }
    return out;
  }

  private frame(move: Dir | null, place: boolean): InputFrame {
    return { playerId: this.playerId!, move, placeBubble: place };
  }

  /** 서버 상태로 되감고, 아직 반영되지 않은 내 입력만 다시 재생한다 */
  private reconcile(server: GameState, ack: number): void {
    const before = this.predictedSelf();

    this.pending = this.pending.filter((p) => p.seq > ack);
    const replayed = cloneState(server);
    for (const input of this.pending) {
      step(replayed, [this.frame(input.move, input.place)]);
    }
    this.predicted = replayed;

    const after = this.predictedSelf();
    if (before && after) {
      this.lastCorrection = Math.abs(before.x - after.x) + Math.abs(before.y - after.y);
    }
  }

  private predictedSelf(): Player | undefined {
    return this.predicted?.players.find((p) => p.id === this.playerId);
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
      this.room = msg.room;
      this.intervalMs = msg.snapshotIntervalMs;
      this.status = 'connected';
      this.retries = 0;
      this.message =
        msg.playerId === null
          ? `${msg.room} 관전 중 (자리 없음)`
          : `${msg.room} · ${msg.playerId + 1}P`;
      this.curr = deserializeState(msg.state);
      this.prev = null;
      this.predicted = cloneState(this.curr);
      this.currAt = performance.now();
      this.onChange();
      return;
    }

    const next = deserializeState(msg.state);
    // 새 판이 시작되면 좌표가 순간이동한다. 보간하면 맵을 가로질러 미끄러진다
    const continuous = this.curr !== null && next.tick >= this.curr.tick;
    this.prev = continuous ? this.curr : null;
    this.curr = next;
    this.currAt = performance.now();

    if (!continuous) this.pending.length = 0;
    this.reconcile(next, msg.ack);
  }

  private reset(): void {
    this.playerId = null;
    this.prev = null;
    this.curr = null;
    this.predicted = null;
    this.pending.length = 0;
    this.seq = 0;
    this.lastCorrection = 0;
  }

  private fail(message: string): void {
    this.stop();
    this.status = 'error';
    this.message = message;
    this.onChange();
  }
}
