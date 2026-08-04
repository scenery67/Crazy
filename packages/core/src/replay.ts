import { createInitialState } from './map.js';
import { step } from './sim.js';
import type { Dir, GameState, InputFrame, PlayerId, TeamId } from './types.js';

/**
 * 리플레이 — 시드와 입력 로그만 저장한다.
 *
 * 시뮬레이션이 결정론적이라 상태를 저장할 필요가 없다.
 * 같은 시드로 시작해 같은 입력을 같은 순서로 먹이면 반드시 같은 결과가 나온다.
 * 3분짜리 경기가 수십 KB로 들어가는 이유다.
 *
 * 부작용으로 **결정론 회귀 테스트**가 공짜로 생긴다.
 * 녹화한 뒤 재생해서 최종 상태가 다르면 어딘가에서 결정론이 깨진 것이다.
 */

export const REPLAY_VERSION = 1;

/** [틱, 플레이어, 이동(-1은 없음), 설치(0|1)] */
export type ReplayChange = [number, number, number, number];

export interface Replay {
  v: number;
  seed: number;
  teams: TeamId[];
  ticks: number;
  /** 입력이 바뀐 순간만 담는다. 매 틱을 담으면 크기가 수십 배가 된다 */
  changes: ReplayChange[];
}

export class ReplayRecorder {
  private readonly changes: ReplayChange[] = [];
  private readonly lastMove = new Map<PlayerId, number>();
  private ticks = 0;

  constructor(
    private readonly seed: number,
    private readonly teams: readonly TeamId[],
  ) {}

  /** 매 틱, step에 넘긴 입력 그대로 부른다 */
  record(tick: number, inputs: readonly InputFrame[]): void {
    this.ticks = tick + 1;
    for (const f of inputs) {
      const move = f.move ?? -1;
      const changed = this.lastMove.get(f.playerId) !== move;
      // 설치는 1틱짜리 신호라 바뀐 것이 없어도 반드시 남겨야 한다
      if (!changed && !f.placeBubble) continue;
      this.lastMove.set(f.playerId, move);
      this.changes.push([tick, f.playerId, move, f.placeBubble ? 1 : 0]);
    }
  }

  finish(): Replay {
    return {
      v: REPLAY_VERSION,
      seed: this.seed,
      teams: [...this.teams],
      ticks: this.ticks,
      changes: this.changes,
    };
  }
}

/**
 * 녹화된 입력을 틱 순서대로 되돌려준다.
 *
 * 이동은 다음 변경까지 유지되고, 설치는 기록된 그 틱에만 켜진다.
 * 이 비대칭이 녹화 크기를 크게 줄인다.
 */
export class ReplayReader {
  private cursor = 0;
  private readonly move = new Map<PlayerId, Dir | null>();

  constructor(private readonly replay: Replay) {}

  get ticks(): number {
    return this.replay.ticks;
  }

  get done(): boolean {
    return this.cursor >= this.replay.changes.length;
  }

  inputsFor(tick: number): InputFrame[] {
    const placing = new Set<PlayerId>();

    while (this.cursor < this.replay.changes.length) {
      const change = this.replay.changes[this.cursor]!;
      if (change[0] > tick) break;
      this.cursor++;
      const [, playerId, move, place] = change;
      this.move.set(playerId, move < 0 ? null : (move as Dir));
      if (place === 1 && change[0] === tick) placing.add(playerId);
    }

    const frames: InputFrame[] = [];
    for (const [playerId, move] of this.move) {
      frames.push({ playerId, move, placeBubble: placing.has(playerId) });
    }
    return frames;
  }
}

export function createReplayState(replay: Replay): GameState {
  return createInitialState({ seed: replay.seed, teams: replay.teams });
}

/** 끝까지 돌린 결과. 결정론 검증에 쓴다 */
export function playReplay(replay: Replay): GameState {
  const state = createReplayState(replay);
  const reader = new ReplayReader(replay);
  for (let tick = 0; tick < replay.ticks; tick++) {
    step(state, reader.inputsFor(tick));
  }
  return state;
}

export function isReplay(value: unknown): value is Replay {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<Replay>;
  return (
    r.v === REPLAY_VERSION &&
    typeof r.seed === 'number' &&
    Array.isArray(r.teams) &&
    Array.isArray(r.changes) &&
    typeof r.ticks === 'number'
  );
}
