import {
  BOT_PRESETS,
  Phase,
  TICK_RATE,
  botInput,
  createBot,
  createInitialState,
  soloTeams,
  step,
  type Bot,
  type Dir,
  type GameState,
  type InputFrame,
  type PlayerId,
} from '@crazy/core';

const MAX_PLAYERS = 4;
/** 경기가 끝나고 다음 판이 시작되기까지 */
const RESTART_DELAY_TICKS = TICK_RATE * 5;

interface HumanSeat {
  move: Dir | null;
  /** 물풍선은 누른 순간의 1회성 신호다. 한 틱만 적용하고 지운다 */
  pendingPlace: boolean;
  /** 마지막으로 받은 입력 번호. 스냅샷에 실어 보내 클라이언트가 재조정에 쓴다 */
  lastSeq: number;
  /** 이번 틱에 실제로 반영된 번호 (받은 것과 적용한 것을 구분해야 한다) */
  appliedSeq: number;
}

/**
 * 방 하나 = 게임 하나.
 *
 * 사람이 들어오면 그 자리의 봇을 치우고, 나가면 봇이 다시 앉는다.
 * `botInput()`이 `GameState -> InputFrame` 순수 함수라서 가능한 구조이고,
 * 덕분에 시뮬레이션은 사람과 봇을 구분하지 않는다.
 */
export class Room {
  state!: GameState;
  private bots = new Map<PlayerId, Bot>();
  private humans = new Map<PlayerId, HumanSeat>();
  private overTicks = 0;

  constructor() {
    this.startMatch();
  }

  get humanCount(): number {
    return this.humans.size;
  }

  /** 빈 자리를 하나 준다. 꽉 찼으면 null */
  join(): PlayerId | null {
    for (let id = 0; id < MAX_PLAYERS; id++) {
      if (this.humans.has(id)) continue;
      this.humans.set(id, { move: null, pendingPlace: false, lastSeq: 0, appliedSeq: 0 });
      this.bots.delete(id);
      return id;
    }
    return null;
  }

  leave(playerId: PlayerId): void {
    if (!this.humans.delete(playerId)) return;
    // 나간 자리는 봇이 이어받는다. 빈 채로 두면 서 있는 표적이 된다
    this.bots.set(playerId, this.makeBot(playerId));
  }

  setInput(playerId: PlayerId, seq: number, move: Dir | null, place: boolean): void {
    const seat = this.humans.get(playerId);
    if (!seat) return;
    // 순서가 뒤집힌 패킷은 무시한다 (WebSocket에서는 드물지만 재접속 직후 섞일 수 있다)
    if (seq <= seat.lastSeq) return;
    seat.lastSeq = seq;
    seat.move = move;
    if (place) seat.pendingPlace = true;
  }

  /** 스냅샷에 실을, 이 자리에 반영된 마지막 입력 번호 */
  ackFor(playerId: PlayerId): number {
    return this.humans.get(playerId)?.appliedSeq ?? 0;
  }

  tick(): void {
    const inputs: InputFrame[] = [];

    for (const [playerId, seat] of this.humans) {
      inputs.push({ playerId, move: seat.move, placeBubble: seat.pendingPlace });
      seat.pendingPlace = false;
      seat.appliedSeq = seat.lastSeq;
    }
    for (const bot of this.bots.values()) {
      inputs.push(botInput(this.state, bot));
    }

    step(this.state, inputs);

    if (this.state.phase === Phase.Over && ++this.overTicks >= RESTART_DELAY_TICKS) {
      this.startMatch();
    }
  }

  private startMatch(): void {
    const seed = Math.floor(Math.random() * 0x7fffffff) || 1;
    this.state = createInitialState({ seed, teams: soloTeams(MAX_PLAYERS) });
    this.overTicks = 0;

    // 사람이 앉아 있지 않은 자리만 봇으로 채운다
    this.bots.clear();
    for (let id = 0; id < MAX_PLAYERS; id++) {
      if (!this.humans.has(id)) this.bots.set(id, this.makeBot(id));
    }
    // move는 지우지 않는다. 클라이언트는 입력이 바뀔 때만 보내므로,
    // 여기서 지우면 키를 계속 누르고 있어도 새 판에서 움직이지 않는다.
    // 실제로 키를 쥐고 있는 상태이니 방향을 유지하는 것이 맞기도 하다
    for (const seat of this.humans.values()) seat.pendingPlace = false;
  }

  private makeBot(playerId: PlayerId): Bot {
    const seed = (this.state?.rng ?? 1) * 31 + playerId * 7 + 1;
    return createBot(playerId, seed || 1, BOT_PRESETS.normal);
  }
}
