import { CORNER_ASSIST, TILE } from '../constants.js';
import { HALF_HITBOX as HALF, laneOf, overlapsTile, span } from '../geometry.js';
import { getTile, tileCenter } from '../map.js';
import { effectiveSpeed } from '../stats.js';
import {
  Dir,
  PlayerStatus,
  isSolidTile,
  type GameState,
  type InputFrame,
  type Player,
  type PlayerId,
} from '../types.js';

/**
 * 플레이어 p 입장에서 (tx, ty)가 막혀 있는가.
 *
 * 물풍선은 "지금 그 타일에 겹쳐 있는 플레이어"에게만 뚫려 있다.
 * 이 규칙 하나로 봄버맨 표준 동작이 별도 상태 없이 그대로 성립한다:
 *   - 자기가 방금 놓은 물풍선 위에서 걸어 나올 수 있다 (겹쳐 있으므로 통과)
 *   - 완전히 벗어나면 다시 들어갈 수 없다 (더 이상 겹치지 않으므로 벽)
 *   - 설치 순간 같은 타일에 있던 다른 플레이어도 갇히지 않는다
 */
function isBlocked(state: GameState, p: Player, tx: number, ty: number): boolean {
  if (isSolidTile(getTile(state, tx, ty))) return true;

  for (const b of state.bubbles) {
    if (b.tx === tx && b.ty === ty) return !overlapsTile(p, tx, ty);
  }
  return false;
}

/** 진행 방향으로 다음에 들어갈 타일 줄 (행 또는 열) */
function aheadLine(moving: number, positive: boolean): number {
  return positive
    ? Math.floor((moving + HALF - 1) / TILE) + 1
    : Math.floor((moving - HALF) / TILE) - 1;
}

/** dir 방향으로 이동을 시도한다. 실제로 움직인 거리를 반환 */
function tryStep(state: GameState, p: Player, dir: Dir, speed: number): number {
  const horizontal = dir === Dir.Left || dir === Dir.Right;
  const positive = dir === Dir.Right || dir === Dir.Down;

  const moving = horizontal ? p.x : p.y;
  const fixed = horizontal ? p.y : p.x;
  const target = moving + (positive ? speed : -speed);

  // 진행 방향 앞쪽 모서리가 걸치는 타일 줄
  const leadLine = Math.floor((positive ? target + HALF - 1 : target - HALF) / TILE);
  const [crossLo, crossHi] = span(fixed);

  let blocked = false;
  for (let c = crossLo; c <= crossHi; c++) {
    if (isBlocked(state, p, horizontal ? leadLine : c, horizontal ? c : leadLine)) {
      blocked = true;
      break;
    }
  }

  if (!blocked) {
    if (horizontal) p.x = target;
    else p.y = target;
    return speed;
  }

  // 벽 바로 앞에 딱 붙인다
  const clamped = positive ? leadLine * TILE - HALF : (leadLine + 1) * TILE + HALF;
  const moved = Math.abs(clamped - moving);
  if (horizontal) p.x = clamped;
  else p.y = clamped;
  return moved;
}

/**
 * 수직축 정렬 — 이 게임 조작감의 핵심.
 *
 * 축 이동 중에는 수직 좌표를 "갈 수 있는 레인"의 중심으로 끌어당긴다.
 *   - 두 레인에 걸쳤고 진행 방향이 한쪽만 열려 있으면 → 그 레인으로 (코너 어시스트)
 *   - 그 외에는 → 가장 가까운 레인으로 (자동 정렬)
 *
 * 세로로 이동하면 히트박스가 두 행에 걸치게 되는데, 그 상태에서 가로를 누르면
 * 벽 모서리에 스쳐 막힌다. 격자 게임이 답답하게 느껴지는 원인이 대부분 이것이다.
 * 자동 정렬까지 같은 규칙으로 묶어야 코너를 돈 뒤 레인 중심에 정확히 안착한다.
 */
function alignPerpendicular(state: GameState, p: Player, dir: Dir, speed: number): void {
  const horizontal = dir === Dir.Left || dir === Dir.Right;
  const positive = dir === Dir.Right || dir === Dir.Down;

  const moving = horizontal ? p.x : p.y;
  const fixed = horizontal ? p.y : p.x;
  const [lo, hi] = span(fixed);

  let targetLane: number;
  let turningCorner = false;
  if (lo === hi) {
    targetLane = lo;
  } else {
    const ahead = aheadLine(moving, positive);
    const openLo = !isBlocked(state, p, horizontal ? ahead : lo, horizontal ? lo : ahead);
    const openHi = !isBlocked(state, p, horizontal ? ahead : hi, horizontal ? hi : ahead);
    // 한쪽만 열렸으면 그쪽으로 돌아 나간다. 둘 다 같으면 우회 정보가 없으므로 가까운 레인으로.
    turningCorner = openLo !== openHi;
    targetLane = turningCorner ? (openLo ? lo : hi) : laneOf(fixed);
  }

  const delta = tileCenter(targetLane) - fixed;
  if (delta === 0) return;

  // 코너를 돌 때만 걷는 속도보다 빠르게 보정한다.
  // 그냥 레인에 안착하는 경우까지 빠르게 하면 보정이 이동을 앞질러서,
  // 방향을 빠르게 번갈아 누르면 타일 중심에 못 박힌 채 못 움직이게 된다.
  const correction = turningCorner ? Math.max(speed, CORNER_ASSIST) : speed;
  const stepSize = Math.min(Math.abs(delta), correction);
  const shift = delta > 0 ? stepSize : -stepSize;

  if (horizontal) p.y += shift;
  else p.x += shift;
}

export function applyMovement(state: GameState, inputs: Map<PlayerId, InputFrame>): void {
  for (const p of state.players) {
    if (!p.alive) continue;

    // 물방울에 갇힌 동안은 움직일 수 없다. 탈출 게이지는 trap 시스템이 다룬다
    if (p.status === PlayerStatus.Trapped) continue;

    const dir = inputs.get(p.id)?.move ?? null;
    if (dir === null) continue;

    p.facing = dir;
    const speed = effectiveSpeed(p);

    tryStep(state, p, dir, speed);
    alignPerpendicular(state, p, dir, speed);
  }
}
