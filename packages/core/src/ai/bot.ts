import { BUBBLE_FUSE, TILE } from '../constants.js';
import { playerTile } from '../geometry.js';
import { getTile } from '../map.js';
import { Rng } from '../rng.js';
import { effectiveCapacity, effectivePower, effectiveSpeed } from '../stats.js';
import {
  Dir,
  DIR_VECTORS,
  PlayerStatus,
  Tile,
  type Bubble,
  type GameState,
  type InputFrame,
  type Player,
  type PlayerId,
} from '../types.js';
import { SAFE, computeDanger } from './danger.js';
import { UNREACHABLE, firstStep, flood, isWalkableTile } from './pathfind.js';

/** 도착 시각과 폭발 시각 사이에 두는 여유 틱 */
const SAFETY_MARGIN = 10;
/** 제자리에서 이만큼 못 움직이면 계획을 다시 세운다 */
const STUCK_LIMIT = 12;

export interface BotConfig {
  /** 기회가 왔을 때 실제로 물풍선을 놓을 확률 (%) */
  aggression: number;
  /** 탈출 경로 확인을 건너뛸 확률 (%). 난이도를 낮추는 유일한 손잡이 */
  recklessness: number;
  /** 갇혔을 때 방향을 바꾸는 간격(틱). 1이면 최대 속도로 연타 */
  mashInterval: number;
}

export const BOT_PRESETS = {
  easy: { aggression: 35, recklessness: 25, mashInterval: 4 },
  normal: { aggression: 60, recklessness: 6, mashInterval: 2 },
  hard: { aggression: 85, recklessness: 0, mashInterval: 1 },
} as const satisfies Record<string, BotConfig>;

export interface Bot {
  playerId: PlayerId;
  config: BotConfig;
  rng: Rng;
  /** 유지 중인 이동 방향. 매 틱 새로 정하면 레인 정렬에 상쇄되어 제자리에서 굳는다 */
  dir: Dir | null;
  placeNext: boolean;
  lastTile: number;
  lastInDanger: boolean;
  lastX: number;
  lastY: number;
  stuckTicks: number;
}

export function createBot(
  playerId: PlayerId,
  seed: number,
  config: BotConfig = BOT_PRESETS.normal,
): Bot {
  return {
    playerId,
    config,
    rng: new Rng(seed || 1),
    dir: null,
    placeNext: false,
    lastTile: -1,
    lastInDanger: false,
    lastX: -1,
    lastY: -1,
    stuckTicks: 0,
  };
}

/**
 * 봇의 한 틱. 사람과 똑같은 InputFrame만 내놓는다.
 *
 * 봇에게 렌더 정보나 특권을 주지 않는 것이 규칙이다. 그래야 나중에
 * 이 함수를 서버에 그대로 올릴 수 있고, 봇이 부당하게 세지지 않는다.
 */
export function botInput(state: GameState, bot: Bot): InputFrame {
  const idle: InputFrame = { playerId: bot.playerId, move: null, placeBubble: false };
  const p = state.players.find((pl) => pl.id === bot.playerId);
  if (!p || !p.alive) return idle;

  // 갇혔으면 탈출 연타가 최우선이다.
  // 게이지는 방향을 '바꿀 때'만 오르므로 같은 방향을 계속 눌러선 안 된다
  if (p.status === PlayerStatus.Trapped) {
    const phase = Math.floor(state.tick / Math.max(1, bot.config.mashInterval)) % 2;
    return { playerId: bot.playerId, move: phase === 0 ? Dir.Left : Dir.Right, placeBubble: false };
  }

  const [tx, ty] = playerTile(p);
  const here = ty * state.width + tx;
  const danger = computeDanger(state);
  const inDanger = (danger[here] ?? SAFE) < SAFE;
  const ticksPerTile = Math.max(1, Math.ceil(TILE / effectiveSpeed(p)));

  bot.stuckTicks = p.x === bot.lastX && p.y === bot.lastY ? bot.stuckTicks + 1 : 0;
  bot.lastX = p.x;
  bot.lastY = p.y;

  const needsPlan =
    bot.dir === null ||
    here !== bot.lastTile ||
    inDanger !== bot.lastInDanger ||
    bot.stuckTicks >= STUCK_LIMIT;

  if (needsPlan) {
    bot.lastTile = here;
    bot.lastInDanger = inDanger;
    bot.stuckTicks = 0;
    replan(state, p, bot, danger, tx, ty, ticksPerTile, inDanger);
  }

  const placeBubble = bot.placeNext;
  bot.placeNext = false;
  return { playerId: bot.playerId, move: bot.dir, placeBubble };
}

function replan(
  state: GameState,
  p: Player,
  bot: Bot,
  danger: Int32Array,
  tx: number,
  ty: number,
  ticksPerTile: number,
  inDanger: boolean,
): void {
  bot.placeNext = false;

  // 위험할 때는 다른 걸 생각하지 않는다
  if (inDanger) {
    bot.dir = flee(state, p, danger, tx, ty, ticksPerTile);
    return;
  }

  if (canPlaceHere(state, p, tx, ty) && isWorthBombing(state, p, tx, ty)) {
    if (bot.rng.chance(bot.config.aggression)) {
      // 이 검사 하나가 봇 품질의 대부분을 결정한다.
      // 빼먹으면 봇은 자기 물풍선에 갇혀 끝없이 자멸한다
      const reckless = bot.rng.chance(bot.config.recklessness);
      if (reckless || hasEscapeRoute(state, p, tx, ty, ticksPerTile)) {
        bot.placeNext = true;
        bot.dir = null;
        return;
      }
    }
  }

  bot.dir = seek(state, p, bot, danger, tx, ty, ticksPerTile);
}

/** 안전한 타일로 가는 첫 걸음. 없으면 가장 오래 버틸 수 있는 쪽으로 */
function flee(
  state: GameState,
  p: Player,
  danger: Int32Array,
  tx: number,
  ty: number,
  ticksPerTile: number,
): Dir | null {
  const f = flood(state, tx, ty, ticksPerTile, (ntx, nty, index, arrival) => {
    if (!isPassable(state, p, ntx, nty)) return false;
    return (danger[index] ?? SAFE) > arrival + SAFETY_MARGIN;
  });

  let best = -1;
  let bestDist = Infinity;
  let fallback = -1;
  let fallbackTime = -1;

  for (let i = 0; i < f.dist.length; i++) {
    const d = f.dist[i]!;
    if (d === UNREACHABLE || d === 0) continue;
    const risk = danger[i] ?? SAFE;
    if (risk === SAFE) {
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    } else if (risk > fallbackTime) {
      fallbackTime = risk;
      fallback = i;
    }
  }

  const goal = best >= 0 ? best : fallback;
  return goal >= 0 ? firstStep(state, f, goal) : null;
}

/**
 * 목표 우선순위: 아이템 → 부술 블록 옆 → 적 쪽.
 * 안전한 타일만 밟는다.
 */
function seek(
  state: GameState,
  p: Player,
  bot: Bot,
  danger: Int32Array,
  tx: number,
  ty: number,
  ticksPerTile: number,
): Dir | null {
  const f = flood(state, tx, ty, ticksPerTile, (ntx, nty, index) => {
    if (!isPassable(state, p, ntx, nty)) return false;
    return (danger[index] ?? SAFE) === SAFE;
  });

  // 갇힌 아군 구조가 최우선이다. 아군은 5초 안에 죽는데 아이템은 도망가지 않는다
  const rescue = nearest(state, f, (i) => hasTrappedAlly(state, p, i));
  if (rescue >= 0) return firstStep(state, f, rescue);

  const item = nearest(state, f, (i) => state.items.some((it) => it.ty * state.width + it.tx === i));
  if (item >= 0) return firstStep(state, f, item);

  const farm = nearest(state, f, (_, ntx, nty) => touchesSoftBlock(state, ntx, nty));
  if (farm >= 0) return firstStep(state, f, farm);

  const enemy = nearestToEnemy(state, p, f);
  if (enemy >= 0) return firstStep(state, f, enemy);

  // 갈 곳이 없으면 아무 방향이나 잡고 유지한다 (매 틱 다시 뽑으면 굳는다)
  return ALL_DIRS[bot.rng.int(ALL_DIRS.length)] ?? null;
}

const ALL_DIRS: readonly Dir[] = [Dir.Up, Dir.Down, Dir.Left, Dir.Right];

function nearest(
  state: GameState,
  f: ReturnType<typeof flood>,
  match: (index: number, tx: number, ty: number) => boolean,
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < f.dist.length; i++) {
    const d = f.dist[i]!;
    if (d === UNREACHABLE || d === 0 || d >= bestDist) continue;
    const ntx = i % state.width;
    const nty = (i - ntx) / state.width;
    if (!match(i, ntx, nty)) continue;
    bestDist = d;
    best = i;
  }
  return best;
}

/** 적에게 맨해튼 거리로 가장 가까운, 도달 가능한 타일 */
function nearestToEnemy(state: GameState, p: Player, f: ReturnType<typeof flood>): number {
  const enemies = state.players.filter((o) => o.alive && o.teamId !== p.teamId);
  if (enemies.length === 0) return -1;

  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < f.dist.length; i++) {
    const d = f.dist[i]!;
    if (d === UNREACHABLE || d === 0) continue;
    const ntx = i % state.width;
    const nty = (i - ntx) / state.width;

    let closest = Infinity;
    for (const e of enemies) {
      const [ex, ey] = playerTile(e);
      closest = Math.min(closest, Math.abs(ex - ntx) + Math.abs(ey - nty));
    }
    // 거리가 같으면 가까운 경로를 고른다
    const score = closest * 100 + d;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function canPlaceHere(state: GameState, p: Player, tx: number, ty: number): boolean {
  if (p.bubblesPlaced >= effectiveCapacity(p)) return false;
  if (getTile(state, tx, ty) !== Tile.Empty) return false;
  return !state.bubbles.some((b) => b.tx === tx && b.ty === ty);
}

/** 여기서 터뜨리면 블록이 부서지거나 적이 사정권에 드는가 */
function isWorthBombing(state: GameState, p: Player, tx: number, ty: number): boolean {
  const power = effectivePower(p);

  for (const [dx, dy] of DIR_VECTORS) {
    for (let dist = 1; dist <= power; dist++) {
      const ntx = tx + dx * dist;
      const nty = ty + dy * dist;
      const tile = getTile(state, ntx, nty);
      if (tile === Tile.Hard) break;
      if (tile === Tile.Soft) return true;

      const hitsEnemy = state.players.some((o) => {
        if (!o.alive || o.teamId === p.teamId) return false;
        const [ox, oy] = playerTile(o);
        return ox === ntx && oy === nty;
      });
      if (hitsEnemy) return true;

      if (state.bubbles.some((b) => b.tx === ntx && b.ty === nty)) break;
    }
  }
  return false;
}

/**
 * 여기에 놓고 나서 살아나갈 길이 있는가.
 *
 * 이 검사가 봇의 자멸을 막는 전부다. 가상의 물풍선을 포함한 위험 맵을 만들고,
 * 폭발 전에 도달할 수 있는 "폭발 예정이 전혀 없는" 타일이 하나라도 있는지 본다.
 */
function hasEscapeRoute(
  state: GameState,
  p: Player,
  tx: number,
  ty: number,
  ticksPerTile: number,
): boolean {
  const hypothetical: Bubble = {
    id: -1,
    ownerId: p.id,
    tx,
    ty,
    fuse: BUBBLE_FUSE,
    power: effectivePower(p),
  };
  const danger = computeDanger(state, hypothetical);

  const f = flood(state, tx, ty, ticksPerTile, (ntx, nty, index, arrival) => {
    if (!isPassable(state, p, ntx, nty)) return false;
    return (danger[index] ?? SAFE) > arrival + SAFETY_MARGIN;
  });

  for (let i = 0; i < f.dist.length; i++) {
    if (f.dist[i] === UNREACHABLE || f.dist[i] === 0) continue;
    if ((danger[i] ?? SAFE) === SAFE) return true;
  }
  return false;
}

/** 지형이 뚫려 있고 물풍선도 없는가 (자기가 서 있는 타일의 물풍선은 논외) */
function isPassable(state: GameState, p: Player, tx: number, ty: number): boolean {
  if (!isWalkableTile(state, tx, ty)) return false;
  const [px, py] = playerTile(p);
  if (tx === px && ty === py) return true;
  return !state.bubbles.some((b) => b.tx === tx && b.ty === ty);
}

/** 그 타일에 물방울로 갇힌 아군이 있는가 (닿으면 구출된다) */
function hasTrappedAlly(state: GameState, p: Player, index: number): boolean {
  return state.players.some((o) => {
    if (o.id === p.id || !o.alive || o.teamId !== p.teamId) return false;
    if (o.status !== PlayerStatus.Trapped) return false;
    const [ox, oy] = playerTile(o);
    return oy * state.width + ox === index;
  });
}

function touchesSoftBlock(state: GameState, tx: number, ty: number): boolean {
  return DIR_VECTORS.some(([dx, dy]) => getTile(state, tx + dx, ty + dy) === Tile.Soft);
}
