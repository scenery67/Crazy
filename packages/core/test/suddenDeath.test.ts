import { describe, expect, it } from 'vitest';
import { SUDDEN_DEATH_AT, SUDDEN_DEATH_INTERVAL } from '../src/constants.js';
import { getTile } from '../src/map.js';
import { step, stepMany } from '../src/sim.js';
import { applySuddenDeath } from '../src/systems/suddenDeath.js';
import { ItemKind, Phase, Tile } from '../src/types.js';
import { addBubble, idle, makeState } from './helpers.js';

/** 7x5 — 안쪽은 5x3 = 15칸 */
const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#######'];
const INTERIOR = 15;

/**
 * 서든데스가 첫 틱에 발동하도록 시간을 맞춘다.
 *
 * 플레이어는 반드시 둘 이상(서로 다른 팀)이어야 한다. 하나뿐이면
 * applyVictory가 곧바로 "마지막 팀 생존"으로 판정해 경기가 끝나고,
 * 서든데스는 시작조차 하지 않는다.
 */
function armed(spawns: readonly (readonly [number, number])[] = [[3, 2], [4, 2]]) {
  const s = makeState(ROOM, spawns);
  s.tick = SUDDEN_DEATH_AT;
  return s;
}

describe('서든데스', () => {
  it('시간이 되기 전에는 아무 일도 없다', () => {
    const s = makeState(ROOM, [[3, 2], [4, 2]]);
    stepMany(s, 120, () => idle);
    expect(s.phase).toBe(Phase.Playing);
    expect(s.suddenDeathIndex).toBe(0);
  });

  it('시간이 되면 국면이 바뀌고 첫 블록이 떨어진다', () => {
    const s = armed();
    step(s, idle);
    expect(s.phase).toBe(Phase.SuddenDeath);
    expect(s.suddenDeathIndex).toBe(1);
    expect(getTile(s, 1, 1)).toBe(Tile.Hard);
  });

  it('바깥 모서리부터 시계 방향으로 채운다', () => {
    const s = armed();
    stepMany(s, SUDDEN_DEATH_INTERVAL + 1, () => idle);
    expect(getTile(s, 1, 1)).toBe(Tile.Hard);
    expect(getTile(s, 2, 1)).toBe(Tile.Hard);
    expect(getTile(s, 3, 1)).toBe(Tile.Empty);
  });

  it('정해진 간격으로만 떨어진다', () => {
    const s = armed();
    step(s, idle);
    expect(s.suddenDeathIndex).toBe(1);

    stepMany(s, SUDDEN_DEATH_INTERVAL - 1, () => idle);
    expect(s.suddenDeathIndex).toBe(1);

    step(s, idle);
    expect(s.suddenDeathIndex).toBe(2);
  });

  it('깔린 플레이어는 즉사한다', () => {
    const s = armed([[1, 1], [4, 2]]);
    step(s, idle);
    expect(s.players[0]!.alive).toBe(false);
    expect(s.players[1]!.alive).toBe(true);
  });

  it('블록 아래의 물풍선과 아이템은 정리된다', () => {
    const s = armed();
    addBubble(s, 1, 1, { fuse: 999 });
    s.items.push({ tx: 1, ty: 1, kind: ItemKind.Power });

    step(s, idle);
    expect(s.bubbles).toHaveLength(0);
    expect(s.items).toHaveLength(0);
    // 설치 개수도 돌려받아야 한다
    expect(s.players[0]!.bubblesPlaced).toBe(0);
  });

  it('나선이 안쪽을 빠짐없이 덮고 다 채우면 멈춘다', () => {
    // 경기 종료가 끼어들지 않도록 시스템만 직접 돌린다
    const s = armed();
    for (let i = 0; i < SUDDEN_DEATH_INTERVAL * (INTERIOR + 2); i++) {
      applySuddenDeath(s);
      s.tick++;
    }

    expect(s.suddenDeathIndex).toBe(INTERIOR);
    for (let ty = 1; ty < s.height - 1; ty++) {
      for (let tx = 1; tx < s.width - 1; tx++) {
        expect(getTile(s, tx, ty)).toBe(Tile.Hard);
      }
    }
  });

  it('가만히 서 있으면 결국 깔려서 승부가 난다', () => {
    const s = armed([[1, 1], [4, 2]]);
    stepMany(s, SUDDEN_DEATH_INTERVAL * (INTERIOR + 2), () => idle);
    expect(s.phase).toBe(Phase.Over);
  });
});
