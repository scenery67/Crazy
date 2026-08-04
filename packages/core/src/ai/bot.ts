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
/** 배회할 때 한 방향을 유지하는 틱 수 (사람도 방향을 잡으면 한동안 유지한다) */
const WANDER_HOLD_MIN = 25;
const WANDER_HOLD_RANGE = 35;

export interface BotConfig {
  /** 기회가 왔을 때 실제로 물풍선을 놓을 확률 (%) */
  aggression: number;
  /** 탈출 경로 확인을 건너뛸 확률 (%) */
  recklessness: number;
  /**
   * 위험을 알아차리기까지 걸리는 틱. 난이도의 핵심 손잡이다.
   *
   * 자력 탈출을 없앤 뒤로 갇히면 곧 죽음이라, "얼마나 늦게 도망치는가"가
   * 곧 생존율이 된다. 설치 적극성만으로는 난이도 차이가 나지 않았다.
   */
  reactionTicks: number;
}

export const BOT_PRESETS = {
  easy: { aggression: 35, recklessness: 25, reactionTicks: 20 },
  normal: { aggression: 60, recklessness: 6, reactionTicks: 8 },
  hard: { aggression: 85, recklessness: 0, reactionTicks: 0 },
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
  /**
   * 이 틱 수가 지나기 전에는 타일이 바뀌어도 계획을 다시 세우지 않는다.
   * 갈 곳이 없어 배회할 때 매 타일마다 방향을 새로 뽑으면 제자리에서 떨린다.
   */
  holdTicks: number;
  /** 위험을 알아차리기까지 남은 틱 */
  dangerDelay: number;
}

/** 정반대 방향. 되꺾기를 막는 데 쓴다 */
const REVERSE: Record<Dir, Dir> = {
  [Dir.Up]: Dir.Down,
  [Dir.Down]: Dir.Up,
  [Dir.Left]: Dir.Right,
  [Dir.Right]: Dir.Left,
};

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
    holdTicks: 0,
    dangerDelay: config.reactionTicks,
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

  // 갇히면 혼자 힘으로는 나올 수 없다. 아군이 오기를 기다릴 뿐이다
  if (p.status === PlayerStatus.Trapped) return idle;

  const [tx, ty] = playerTile(p);
  const here = ty * state.width + tx;
  const danger = computeDanger(state);
  const inDanger = (danger[here] ?? SAFE) < SAFE;
  const ticksPerTile = Math.max(1, Math.ceil(TILE / effectiveSpeed(p)));

  bot.stuckTicks = p.x === bot.lastX && p.y === bot.lastY ? bot.stuckTicks + 1 : 0;
  bot.lastX = p.x;
  bot.lastY = p.y;

  if (bot.holdTicks > 0) bot.holdTicks--;
  const stuck = bot.stuckTicks >= STUCK_LIMIT;

  // 위험을 곧바로 알아차리지 못한다. 이 지연이 난이도를 만든다
  if (!inDanger) bot.dangerDelay = bot.config.reactionTicks;
  else if (bot.dangerDelay > 0) bot.dangerDelay--;
  const alarmed = inDanger && bot.dangerDelay === 0;

  const needsPlan =
    bot.dir === null ||
    alarmed !== bot.lastInDanger ||
    stuck ||
    (here !== bot.lastTile && bot.holdTicks === 0);

  if (needsPlan) {
    bot.lastTile = here;
    bot.lastInDanger = alarmed;
    bot.stuckTicks = 0;
    replan(state, p, bot, danger, tx, ty, ticksPerTile, alarmed, stuck);
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
  stuck: boolean,
): void {
  bot.placeNext = false;

  // 위험할 때는 다른 걸 생각하지 않는다. 되꺾기 제한도 걸지 않는다
  if (inDanger) {
    bot.holdTicks = 0;
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

  const next = seek(state, p, bot, danger, tx, ty, ticksPerTile);

  // 정반대로 꺾는 것이 제자리 떨림의 주범이다. 타일을 넘을 때마다 목표를
  // 다시 고르다 보면 왔던 길로 되돌아가기를 반복한다.
  // 막혀 있는 게 아니라면 가던 방향을 유지한다.
  if (!stuck && next !== null && bot.dir !== null && next === REVERSE[bot.dir]) return;

  bot.dir = next;
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

  // 갈 곳이 없으면 배회한다. 이때가 떨림이 제일 심하므로 두 가지를 지킨다:
  // 실제로 열린 방향만 고르고, 한동안 그 방향을 유지한다
  const open = ALL_DIRS.filter(([, dx, dy]) => isPassable(state, p, tx + dx, ty + dy));
  const picked = (open.length > 0 ? open : ALL_DIRS)[bot.rng.int(open.length || ALL_DIRS.length)];
  bot.holdTicks = WANDER_HOLD_MIN + bot.rng.int(WANDER_HOLD_RANGE);
  return picked ? picked[0] : null;
}

/** [방향, dx, dy] */
const ALL_DIRS: readonly (readonly [Dir, number, number])[] = [
  [Dir.Up, 0, -1],
  [Dir.Down, 0, 1],
  [Dir.Left, -1, 0],
  [Dir.Right, 1, 0],
];

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
