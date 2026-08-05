/**
 * core는 test/ 아래에 시험을 두지만 여기는 src/ 안이다.
 * 클라이언트 tsconfig가 rootDir을 src로 잡고 있어서, 형제 test/ 디렉터리를 넣으면
 * TS6059가 난다. rootDir을 올리면 dist-types 출력 위치가 통째로 바뀐다.
 */
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_COUNT,
  assignCharacters,
  characterOf,
  colorOf,
  speciesOf,
} from './characters.js';

const SEATS = 4;
const SOLO = [0, 1, 2, 3];
/** 대각선끼리 묶인다 — 0·3이 한 팀, 1·2가 한 팀 */
const DUO = [0, 1, 1, 0];

const local = (humans: number, picks: readonly number[]) =>
  assignCharacters({ seats: SEATS, humans, picks, bySeat: false, teams: SOLO, teamColors: false });

const duo = (humans: number, picks: readonly number[]) =>
  assignCharacters({ seats: SEATS, humans, picks, bySeat: false, teams: DUO, teamColors: true });

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

  /**
   * 고르는 쪽(main.ts)이 맞바꿔서 막지만, 그래도 같은 값이 들어오면 겹치지는 않아야 한다.
   * 밀려나는 것은 뒷사람이다.
   */
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
    const map = assignCharacters({
      seats: SEATS,
      humans: 2,
      picks: [3, 3],
      bySeat: true,
      teams: SOLO,
      teamColors: false,
    });
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
    const map = assignCharacters({
      seats: 6,
      humans: 1,
      picks: [0],
      bySeat: false,
      teams: [0, 1, 2, 3, 4, 5],
      teamColors: false,
    });
    expect(map.size).toBe(6);
    for (const c of map.values()) expect(c).toBeLessThan(CHARACTER_COUNT);
  });
});

describe('2v2 — 색이 곧 팀이다', () => {
  it('같은 팀은 같은 색, 다른 팀은 다른 색', () => {
    const map = duo(2, [0, 0]);
    const color = (seat: number) => colorOf(map.get(seat)!);
    // 0·3이 한 팀, 1·2가 한 팀
    expect(color(0)).toBe(color(3));
    expect(color(1)).toBe(color(2));
    expect(color(0)).not.toBe(color(1));
  });

  it('같은 팀끼리는 종족이 갈려 서로도 구분된다', () => {
    const map = duo(2, [0, 0]);
    expect(speciesOf(map.get(0)!)).not.toBe(speciesOf(map.get(3)!));
    expect(speciesOf(map.get(1)!)).not.toBe(speciesOf(map.get(2)!));
    // 넷이 전부 다른 캐릭터가 된다
    expect(new Set(map.values()).size).toBe(SEATS);
  });

  it('사람이 고른 것에서 종족만 살고 색은 팀이 덮어쓴다', () => {
    // 1P가 파랑디즈니(3)를 골라도 팀이 빨강이면 빨강디즈니(2)가 된다
    const map = duo(1, [3]);
    expect(speciesOf(map.get(0)!)).toBe(speciesOf(3));
    expect(colorOf(map.get(0)!)).toBe(DUO[0]! % 2);
  });

  it('두 사람이 같은 종족을 골라도 서로 다른 팀이라 색으로 갈린다', () => {
    const map = duo(2, [2, 2]);
    expect(speciesOf(map.get(0)!)).toBe(speciesOf(map.get(1)!));
    expect(colorOf(map.get(0)!)).not.toBe(colorOf(map.get(1)!));
    expect(map.get(0)).not.toBe(map.get(1));
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
