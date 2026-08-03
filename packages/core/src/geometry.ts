import { PLAYER_HITBOX, TILE } from './constants.js';
import type { Player } from './types.js';

export const HALF_HITBOX = PLAYER_HITBOX / 2;

/** 좌표가 속한 타일 줄 (행 또는 열) */
export function laneOf(coord: number): number {
  return Math.floor(coord / TILE);
}

/** 히트박스가 걸쳐 있는 타일 범위 [lo, hi]. 경계에 정확히 닿는 것은 겹침으로 치지 않는다 */
export function span(coord: number): [number, number] {
  return [
    Math.floor((coord - HALF_HITBOX) / TILE),
    Math.floor((coord + HALF_HITBOX - 1) / TILE),
  ];
}

/**
 * 플레이어의 중심이 속한 타일.
 *
 * 물풍선 설치·피격·밟기 판정은 전부 이 "중심 타일" 기준이다.
 * 히트박스 겹침으로 판정하면 타일에 20%만 걸쳐도 물줄기에 맞아서,
 * 아슬아슬하게 피하는 플레이가 성립하지 않는다.
 */
export function playerTile(p: Player): [number, number] {
  return [laneOf(p.x), laneOf(p.y)];
}

/** 히트박스가 (tx, ty) 타일과 겹치는가 — 이동 충돌 전용 */
export function overlapsTile(p: Player, tx: number, ty: number): boolean {
  const [x0, x1] = span(p.x);
  const [y0, y1] = span(p.y);
  return tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1;
}
