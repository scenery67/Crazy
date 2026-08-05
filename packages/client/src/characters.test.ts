/**
 * core는 test/ 아래에 시험을 두지만 여기는 src/ 안이다.
 * 클라이언트 tsconfig가 rootDir을 src로 잡고 있어서, 형제 test/ 디렉터리를 넣으면
 * TS6059가 난다. rootDir을 올리면 dist-types 출력 위치가 통째로 바뀐다.
 */
import { describe, expect, it } from 'vitest';
import { CHARACTER_COUNT, assignCharacters, characterOf } from './characters.js';

const SEATS = 4;
const local = (humans: number, picks: readonly number[]) =>
  assignCharacters({ seats: SEATS, humans, picks, bySeat: false });

describe('assignCharacters', () => {
  it('사람이 고른 것을 그대로 주고, 남은 것을 봇이 나눠 갖는다', () => {
    const map = local(1, [2]);
    expect(map.get(0)).toBe(2);
    expect([...map.values()].sort()).toEqual([0, 1, 2, 3]);
  });

  it('어느 것을 골라도 네 자리가 서로 다르다', () => {
    for (let pick = 0; pick < CHARACTER_COUNT; pick++) {
      const map = local(1, [pick]);
      expect(map.get(0)).toBe(pick);
      expect(new Set(map.values()).size).toBe(SEATS);
    }
  });

  /** 2P 선택기는 1P와 같은 값을 고를 수 있다. 화면에서 겹치면 안 된다 */
  it('둘이 같은 캐릭터를 골라도 겹치지 않는다', () => {
    const map = local(2, [1, 1]);
    expect(map.get(0)).toBe(1);
    expect(map.get(1)).not.toBe(1);
    expect(new Set(map.values()).size).toBe(SEATS);
  });

  it('둘이 다른 캐릭터를 고르면 그대로 배정된다', () => {
    const map = local(2, [2, 1]);
    expect(map.get(0)).toBe(2);
    expect(map.get(1)).toBe(1);
  });

  it('온라인·재생에서는 자리 번호가 곧 캐릭터다', () => {
    const map = assignCharacters({ seats: SEATS, humans: 2, picks: [3, 3], bySeat: true });
    expect([...map]).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('화면에서 엉뚱한 값이 와도 시트 범위를 벗어나지 않는다', () => {
    for (const bad of [Number.NaN, -1, 99, 1.5]) {
      const map = local(1, [bad]);
      expect(map.size).toBe(SEATS);
      for (const c of map.values()) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(CHARACTER_COUNT);
      }
    }
  });

  it('자리가 캐릭터보다 많으면 겹치더라도 전원에게 배정한다', () => {
    const map = assignCharacters({ seats: 6, humans: 1, picks: [0], bySeat: false });
    expect(map.size).toBe(6);
    for (const c of map.values()) expect(c).toBeLessThan(CHARACTER_COUNT);
  });
});

describe('characterOf', () => {
  it('배정에 없는 자리는 자리 번호로 되돌린다', () => {
    expect(characterOf(new Map(), 5)).toBe(5 % CHARACTER_COUNT);
  });

  it('배정이 있으면 그것을 쓴다', () => {
    expect(characterOf(new Map([[1, 3]]), 1)).toBe(3);
  });
});
