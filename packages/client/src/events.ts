import { PlayerStatus, Tile, WaterKind, type GameState, type PlayerId } from '@crazy/core';

/**
 * 상태를 두 시점 비교해서 "무슨 일이 일어났는지" 뽑아낸다.
 *
 * 시뮬레이션은 이벤트를 남기지 않는다 — 남기면 결정론과 스냅샷이 복잡해지고,
 * 서버도 쓸 일 없는 데이터를 나르게 된다. 소리와 파티클은 순전히 표현이므로
 * 클라이언트가 상태 차이에서 직접 읽어내는 편이 깔끔하다.
 *
 * 온라인에서도 그대로 동작한다. 스냅샷도 결국 같은 GameState이기 때문이다.
 */
export type GameEvent =
  | { t: 'bubble'; tx: number; ty: number }
  | { t: 'explode'; tx: number; ty: number }
  | { t: 'break'; tx: number; ty: number }
  | { t: 'pickup'; tx: number; ty: number; mine: boolean }
  | { t: 'trap'; tx: number; ty: number; mine: boolean }
  | { t: 'rescue'; tx: number; ty: number; mine: boolean }
  /** 쓰러지는 자리와 캐릭터를 알아야 하므로 좌표와 자리 번호를 함께 넘긴다 */
  | { t: 'death'; tx: number; ty: number; mine: boolean; x: number; y: number; id: PlayerId };

interface PlayerMark {
  alive: boolean;
  status: PlayerStatus;
  /** 능력치 총합. 늘어나면 아이템을 먹은 것이다 */
  gear: number;
}

function gearOf(p: GameState['players'][number]): number {
  return p.power + p.bubbleCapacity + p.speedLevel + p.needles + (p.potionTicks > 0 ? 1 : 0);
}

export class EventDetector {
  private tick = -1;
  private bubbles = new Set<number>();
  private centers = new Set<number>();
  private tiles: Uint8Array | null = null;
  private players = new Map<PlayerId, PlayerMark>();

  /** 판이 바뀌면 차이를 이벤트로 읽으면 안 된다. 조용히 기준만 다시 잡는다 */
  reset(): void {
    this.tick = -1;
    this.bubbles.clear();
    this.centers.clear();
    this.tiles = null;
    this.players.clear();
  }

  detect(state: GameState, localIds: ReadonlySet<number>): GameEvent[] {
    const events: GameEvent[] = [];

    // 새 판이거나 크게 건너뛴 경우(온라인 재접속 등)는 기준만 갱신한다
    const continuous = this.tick >= 0 && state.tick >= this.tick && state.tick - this.tick < 30;
    if (!continuous) {
      this.snapshot(state);
      return events;
    }

    for (const b of state.bubbles) {
      if (!this.bubbles.has(b.id)) events.push({ t: 'bubble', tx: b.tx, ty: b.ty });
    }

    for (const w of state.waters) {
      if (w.kind !== WaterKind.Center) continue;
      const key = w.ty * state.width + w.tx;
      if (!this.centers.has(key)) events.push({ t: 'explode', tx: w.tx, ty: w.ty });
    }

    if (this.tiles) {
      for (let i = 0; i < state.map.length; i++) {
        if (this.tiles[i] === Tile.Soft && state.map[i] === Tile.Breaking) {
          events.push({ t: 'break', tx: i % state.width, ty: Math.floor(i / state.width) });
        }
      }
    }

    for (const p of state.players) {
      const was = this.players.get(p.id);
      if (!was) continue;
      const mine = localIds.has(p.id);
      const tx = Math.floor(p.x / 1000);
      const ty = Math.floor(p.y / 1000);

      if (was.alive && !p.alive) {
        events.push({ t: 'death', tx, ty, mine, x: p.x, y: p.y, id: p.id });
      }
      if (p.alive && gearOf(p) > was.gear) events.push({ t: 'pickup', tx, ty, mine });
      if (was.status !== PlayerStatus.Trapped && p.status === PlayerStatus.Trapped) {
        events.push({ t: 'trap', tx, ty, mine });
      }
      if (was.status === PlayerStatus.Trapped && p.status === PlayerStatus.Invulnerable) {
        events.push({ t: 'rescue', tx, ty, mine });
      }
    }

    this.snapshot(state);
    return events;
  }

  private snapshot(state: GameState): void {
    this.tick = state.tick;

    this.bubbles.clear();
    for (const b of state.bubbles) this.bubbles.add(b.id);

    this.centers.clear();
    for (const w of state.waters) {
      if (w.kind === WaterKind.Center) this.centers.add(w.ty * state.width + w.tx);
    }

    if (!this.tiles || this.tiles.length !== state.map.length) {
      this.tiles = new Uint8Array(state.map.length);
    }
    this.tiles.set(state.map);

    this.players.clear();
    for (const p of state.players) {
      this.players.set(p.id, { alive: p.alive, status: p.status, gear: gearOf(p) });
    }
  }
}
