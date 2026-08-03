import { getTile } from '../map.js';
import { Dir, DIR_VECTORS, Tile, type GameState } from '../types.js';

export const UNREACHABLE = -1;

export interface Flood {
  /** 시작 타일에서의 거리 (타일 수). 못 가면 UNREACHABLE */
  dist: Int32Array;
  /** 최단 경로에서의 직전 타일 인덱스 */
  prev: Int32Array;
  start: number;
}

/**
 * 시간 인지 BFS.
 *
 * 격자 게임의 경로 탐색은 거리만으로는 부족하다. "거기 도착했을 때
 * 그 타일이 안전한가"를 같이 봐야 물줄기 속으로 걸어 들어가지 않는다.
 * canEnter가 도착 예정 틱(arrival)을 함께 받는 이유다.
 */
export function flood(
  state: GameState,
  startTx: number,
  startTy: number,
  ticksPerTile: number,
  canEnter: (tx: number, ty: number, index: number, arrival: number) => boolean,
): Flood {
  const size = state.width * state.height;
  const dist = new Int32Array(size).fill(UNREACHABLE);
  const prev = new Int32Array(size).fill(UNREACHABLE);
  const start = startTy * state.width + startTx;

  dist[start] = 0;
  const queue = [start];

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    const cx = current % state.width;
    const cy = (current - cx) / state.width;
    const nextDist = dist[current]! + 1;

    for (const [dx, dy] of DIR_VECTORS) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) continue;

      const index = ty * state.width + tx;
      if (dist[index] !== UNREACHABLE) continue;
      if (!canEnter(tx, ty, index, nextDist * ticksPerTile)) continue;

      dist[index] = nextDist;
      prev[index] = current;
      queue.push(index);
    }
  }

  return { dist, prev, start };
}

/** 목표까지의 경로에서 첫 한 걸음의 방향 */
export function firstStep(state: GameState, f: Flood, goal: number): Dir | null {
  if (goal === f.start || f.dist[goal] === UNREACHABLE) return null;

  let node = goal;
  while (f.prev[node] !== f.start) {
    const parent = f.prev[node];
    if (parent === undefined || parent === UNREACHABLE) return null;
    node = parent;
  }

  const sx = f.start % state.width;
  const sy = (f.start - sx) / state.width;
  const nx = node % state.width;
  const ny = (node - nx) / state.width;

  if (nx > sx) return Dir.Right;
  if (nx < sx) return Dir.Left;
  if (ny > sy) return Dir.Down;
  if (ny < sy) return Dir.Up;
  return null;
}

/** 지형만 보는 통행 가능 여부. 물풍선은 호출부가 따로 판단한다 */
export function isWalkableTile(state: GameState, tx: number, ty: number): boolean {
  const tile = getTile(state, tx, ty);
  return tile !== Tile.Hard && tile !== Tile.Soft;
}
