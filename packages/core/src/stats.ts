import {
  FORCED_PLACE_INTERVAL,
  MAX_POWER,
  SKULL_SLOW_SPEED,
  SPEED_TABLE,
} from './constants.js';
import { SkullKind, type Player } from './types.js';

/**
 * 일시 효과가 반영된 실제 능력치.
 *
 * 물약·해골은 원래 값을 덮어쓰지 않고 여기서만 계산한다.
 * 효과가 끝날 때 "원래 값으로 되돌리는" 코드가 없으므로,
 * 효과가 겹치거나 중간에 아이템을 더 먹어도 어긋나지 않는다.
 */

function hasSkull(p: Player, kind: SkullKind): boolean {
  return p.skullTicks > 0 && p.skullKind === kind;
}

/** 물약을 마신 동안에는 물줄기가 최대로 뻗는다 */
export function effectivePower(p: Player): number {
  return p.potionTicks > 0 ? MAX_POWER : p.power;
}

export function effectiveCapacity(p: Player): number {
  return hasSkull(p, SkullKind.TinyBubble) ? 1 : p.bubbleCapacity;
}

export function effectiveSpeed(p: Player): number {
  if (hasSkull(p, SkullKind.SlowFeet)) return SKULL_SLOW_SPEED;
  return SPEED_TABLE[Math.min(p.speedLevel, SPEED_TABLE.length - 1)] ?? SPEED_TABLE[0]!;
}

/** 해골에 걸리면 원하지 않아도 주기적으로 물풍선을 흘린다 */
export function isForcedToPlace(p: Player, tick: number): boolean {
  return hasSkull(p, SkullKind.ForcedPlace) && tick % FORCED_PLACE_INTERVAL === 0;
}
