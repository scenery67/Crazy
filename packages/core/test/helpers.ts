import { Dir, Phase, PlayerStatus, SkullKind, Tile, WaterKind } from '../src/types.js';
import type { Bubble, GameState, InputFrame, Player, PlayerId } from '../src/types.js';
import { BUBBLE_FUSE, TRAP_DURATION, WATER_DURATION } from '../src/constants.js';
import { tileCenter } from '../src/map.js';

/**
 * ASCII로 맵을 그려서 상태를 만든다. 시뮬레이션 테스트의 기본 도구.
 *
 *   '#' Hard   'x' Soft   '.' Empty
 *
 * 무작위 맵으로는 폭발·충돌 같은 규칙을 정밀하게 검증할 수 없다.
 */
export function makeState(rows: readonly string[], spawns: readonly (readonly [number, number])[] = [[1, 1]]): GameState {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  if (rows.some((r) => r.length !== width)) throw new Error('모든 행의 길이가 같아야 한다');

  const map = new Uint8Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const ch = rows[ty]![tx];
      map[ty * width + tx] = ch === '#' ? Tile.Hard : ch === 'x' ? Tile.Soft : Tile.Empty;
    }
  }

  return {
    tick: 0,
    rng: 1,
    phase: Phase.Playing,
    width,
    height,
    map,
    players: spawns.map(([tx, ty], id) => makePlayer(id, tx, ty)),
    bubbles: [],
    waters: [],
    items: [],
    nextBubbleId: 1,
    suddenDeathIndex: 0,
    winnerTeamId: null,
  };
}

function makePlayer(id: PlayerId, tx: number, ty: number): Player {
  return {
    id,
    teamId: id,
    alive: true,
    x: tileCenter(tx),
    y: tileCenter(ty),
    facing: Dir.Down,
    status: PlayerStatus.Normal,
    statusTicks: 0,
    bubbleCapacity: 1,
    bubblesPlaced: 0,
    power: 1,
    speedLevel: 0,
    needles: 0,
    potionTicks: 0,
    skullTicks: 0,
    skullKind: SkullKind.None,
  };
}

/** 한 플레이어가 같은 방향을 계속 누르고 있는 입력 */
export function hold(dir: Dir | null, playerId: PlayerId = 0): InputFrame[] {
  return [{ playerId, move: dir, placeBubble: false }];
}

/** 물풍선 설치 입력 (1틱 펄스) */
export function place(playerId: PlayerId = 0): InputFrame[] {
  return [{ playerId, move: null, placeBubble: true }];
}

/** 입력 없음 */
export const idle: readonly InputFrame[] = [];

export function addBubble(
  state: GameState,
  tx: number,
  ty: number,
  opts: { ownerId?: PlayerId; fuse?: number; power?: number } = {},
): Bubble {
  const bubble: Bubble = {
    id: state.nextBubbleId++,
    ownerId: opts.ownerId ?? 0,
    tx,
    ty,
    fuse: opts.fuse ?? BUBBLE_FUSE,
    power: opts.power ?? 1,
  };
  state.bubbles.push(bubble);
  const owner = state.players.find((p) => p.id === bubble.ownerId);
  if (owner) owner.bubblesPlaced++;
  return bubble;
}

/** 물줄기를 직접 깐다 — 폭발을 기다리지 않고 트랩 규칙만 검증할 때 쓴다 */
export function addWater(state: GameState, tx: number, ty: number, ownerId: PlayerId = 0): void {
  state.waters.push({
    tx,
    ty,
    ticksLeft: WATER_DURATION,
    ownerId,
    kind: WaterKind.Center,
    dir: null,
  });
}

/** 물줄기를 거치지 않고 곧바로 갇힌 상태로 만든다 */
export function forceTrap(p: Player): void {
  p.status = PlayerStatus.Trapped;
  p.statusTicks = TRAP_DURATION;
}

export function waterAt(state: GameState, tx: number, ty: number): boolean {
  return state.waters.some((w) => w.tx === tx && w.ty === ty);
}
