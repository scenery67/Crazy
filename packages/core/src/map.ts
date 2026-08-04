import {
  MAP_HEIGHT,
  MAP_WIDTH,
  SOFT_BLOCK_PERCENT,
  SPAWN_SAFE_RADIUS,
  TILE,
} from './constants.js';
import { Rng } from './rng.js';
import {
  Dir,
  Phase,
  PlayerStatus,
  SkullKind,
  Tile,
  type GameState,
  type Player,
  type TeamId,
} from './types.js';

/** 스폰은 항상 홀수/홀수 좌표라 Hard 격자와 겹치지 않는다 */
export const SPAWN_TILES: readonly (readonly [number, number])[] = [
  [1, 1],
  [MAP_WIDTH - 2, 1],
  [1, MAP_HEIGHT - 2],
  [MAP_WIDTH - 2, MAP_HEIGHT - 2],
];

export function tileIndex(width: number, tx: number, ty: number): number {
  return ty * width + tx;
}

export function getTile(state: GameState, tx: number, ty: number): Tile {
  if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) return Tile.Hard;
  return (state.map[tileIndex(state.width, tx, ty)] ?? Tile.Hard) as Tile;
}

export function setTile(state: GameState, tx: number, ty: number, tile: Tile): void {
  if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) return;
  state.map[tileIndex(state.width, tx, ty)] = tile;
}

/** 타일 중심의 sub-unit 좌표 */
export function tileCenter(t: number): number {
  return t * TILE + TILE / 2;
}

/** sub-unit 좌표가 속한 타일 */
export function toTile(coord: number): number {
  return Math.floor(coord / TILE);
}

/**
 * 테두리 전체 + 내부의 짝수/짝수 좌표가 Hard.
 * 테두리를 포함해서 세기 때문에 홀수가 아니라 짝수다.
 */
function isHardAt(tx: number, ty: number, width: number, height: number): boolean {
  if (tx === 0 || ty === 0 || tx === width - 1 || ty === height - 1) return true;
  return tx % 2 === 0 && ty % 2 === 0;
}

/** 스폰 지점에서 맨해튼 거리 SPAWN_SAFE_RADIUS 이내면 Soft 블록을 놓지 않는다 */
function isSpawnSafe(tx: number, ty: number): boolean {
  for (const [sx, sy] of SPAWN_TILES) {
    if (Math.abs(tx - sx) + Math.abs(ty - sy) <= SPAWN_SAFE_RADIUS) return true;
  }
  return false;
}

export function generateMap(rng: Rng, width: number, height: number): Uint8Array {
  const map = new Uint8Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tileIndex(width, tx, ty);
      if (isHardAt(tx, ty, width, height)) {
        map[i] = Tile.Hard;
      } else if (isSpawnSafe(tx, ty)) {
        map[i] = Tile.Empty;
      } else {
        map[i] = rng.chance(SOFT_BLOCK_PERCENT) ? Tile.Soft : Tile.Empty;
      }
    }
  }
  return map;
}

export interface MatchConfig {
  seed: number;
  /**
   * 인덱스 = 플레이어 id, 값 = 소속 팀.
   * 개인전은 [0,1,2,3], 2v2는 [0,1,0,1].
   */
  teams: readonly TeamId[];
}

/** 개인전: 전원이 서로 다른 팀 */
export function soloTeams(playerCount: number): TeamId[] {
  return Array.from({ length: playerCount }, (_, i) => i);
}

/** 2v2: 대각선끼리 한 팀이 되도록 배치 */
export function duoTeams(): TeamId[] {
  return [0, 1, 1, 0];
}

function createPlayer(id: number, teamId: TeamId): Player {
  const spawn = SPAWN_TILES[id];
  if (!spawn) throw new Error(`스폰 지점이 없는 플레이어 id: ${id}`);
  const [tx, ty] = spawn;
  return {
    id,
    teamId,
    alive: true,
    x: tileCenter(tx),
    y: tileCenter(ty),
    facing: ty === 1 ? Dir.Down : Dir.Up,
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

export function createInitialState(config: MatchConfig): GameState {
  if (config.teams.length < 2 || config.teams.length > SPAWN_TILES.length) {
    throw new Error(`플레이어 수는 2~${SPAWN_TILES.length}명이어야 한다`);
  }
  const rng = new Rng(config.seed);
  const map = generateMap(rng, MAP_WIDTH, MAP_HEIGHT);
  return {
    tick: 0,
    rng: rng.seed,
    phase: Phase.Playing,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    map,
    players: config.teams.map((teamId, id) => createPlayer(id, teamId)),
    bubbles: [],
    waters: [],
    items: [],
    nextBubbleId: 1,
    suddenDeathIndex: 0,
    winnerTeamId: null,
  };
}
