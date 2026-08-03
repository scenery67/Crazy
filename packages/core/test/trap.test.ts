import { describe, expect, it } from 'vitest';
import {
  ESCAPE_THRESHOLD,
  INVULN_DURATION,
  RESCUE_GRACE,
  TRAP_DURATION,
} from '../src/constants.js';
import { tileCenter } from '../src/map.js';
import { step, stepMany } from '../src/sim.js';
import { DRAW } from '../src/systems/victory.js';
import { Dir, Phase, PlayerStatus, type InputFrame } from '../src/types.js';
import { addWater, forceTrap, idle, makeState } from './helpers.js';

const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#######'];

/** 서로 다른 팀의 두 명 */
function duel() {
  return makeState(ROOM, [
    [1, 1],
    [5, 1],
  ]);
}

describe('피격과 트랩', () => {
  it('물줄기에 맞으면 즉사가 아니라 갇힌다', () => {
    const s = duel();
    addWater(s, 1, 1);
    step(s, idle);

    expect(s.players[0]!.alive).toBe(true);
    expect(s.players[0]!.status).toBe(PlayerStatus.Trapped);
    expect(s.players[0]!.statusTicks).toBe(TRAP_DURATION);
  });

  it('중심 타일이 아니면 맞지 않는다 (아슬아슬하게 피할 수 있다)', () => {
    const s = duel();
    addWater(s, 2, 1);
    step(s, idle);
    expect(s.players[0]!.status).toBe(PlayerStatus.Normal);
  });

  it('시간이 다하면 사망한다', () => {
    const s = duel();
    addWater(s, 1, 1);
    stepMany(s, TRAP_DURATION + 5, () => idle);
    expect(s.players[0]!.alive).toBe(false);
  });

  it('바늘이 있으면 갇히지 않고 1개를 소모한다', () => {
    const s = duel();
    s.players[0]!.needles = 2;
    addWater(s, 1, 1);
    step(s, idle);

    expect(s.players[0]!.status).toBe(PlayerStatus.Invulnerable);
    expect(s.players[0]!.needles).toBe(1);
  });
});

describe('구출', () => {
  it('나를 가둔 그 물줄기가 곧바로 나를 풀어주지 않는다', () => {
    const s = duel();
    addWater(s, 1, 1);
    step(s, idle); // 갇힘

    // 물줄기는 아직 남아 있다. 유예 시간 동안은 갇힌 상태를 유지해야 한다
    stepMany(s, RESCUE_GRACE - 2, () => idle);
    expect(s.players[0]!.status).toBe(PlayerStatus.Trapped);
  });

  it('유예 시간이 지난 뒤 새 물줄기가 닿으면 구출된다', () => {
    const s = duel();
    forceTrap(s.players[0]!);
    stepMany(s, RESCUE_GRACE + 1, () => idle);
    expect(s.players[0]!.status).toBe(PlayerStatus.Trapped);

    addWater(s, 1, 1);
    step(s, idle);
    expect(s.players[0]!.status).toBe(PlayerStatus.Invulnerable);
    expect(s.players[0]!.alive).toBe(true);
  });

  it('적의 물줄기여도 구출된다 (소유자 무관)', () => {
    const s = duel();
    forceTrap(s.players[0]!);
    stepMany(s, RESCUE_GRACE + 1, () => idle);

    addWater(s, 1, 1, 1); // 상대(1번)의 물줄기
    step(s, idle);
    expect(s.players[0]!.status).toBe(PlayerStatus.Invulnerable);
  });

  it('구출 직후에는 무적이라 남은 물줄기에 다시 걸리지 않는다', () => {
    const s = duel();
    forceTrap(s.players[0]!);
    stepMany(s, RESCUE_GRACE + 1, () => idle);
    addWater(s, 1, 1);

    stepMany(s, 20, () => idle);
    expect(s.players[0]!.status).toBe(PlayerStatus.Invulnerable);
    stepMany(s, INVULN_DURATION, () => idle);
    expect(s.players[0]!.status).toBe(PlayerStatus.Normal);
  });
});

describe('자력 탈출', () => {
  it('방향을 번갈아 누르면 게이지가 차서 탈출한다', () => {
    const s = duel();
    forceTrap(s.players[0]!);

    const alternate = (tick: number): InputFrame[] => [
      { playerId: 0, move: tick % 2 === 0 ? Dir.Left : Dir.Right, placeBubble: false },
    ];
    stepMany(s, ESCAPE_THRESHOLD + 2, alternate);

    expect(s.players[0]!.status).toBe(PlayerStatus.Invulnerable);
    expect(s.players[0]!.alive).toBe(true);
  });

  it('같은 방향만 누르고 있으면 게이지가 차지 않는다', () => {
    const s = duel();
    forceTrap(s.players[0]!);

    stepMany(s, 100, () => [{ playerId: 0, move: Dir.Left, placeBubble: false }]);
    expect(s.players[0]!.status).toBe(PlayerStatus.Trapped);
    expect(s.players[0]!.escapeGauge).toBe(1); // 최초 전환 1회뿐
  });

  it('갇힌 동안에는 움직일 수 없다', () => {
    const s = duel();
    forceTrap(s.players[0]!);
    const { x, y } = s.players[0]!;

    stepMany(s, 60, () => [{ playerId: 0, move: Dir.Right, placeBubble: false }]);
    expect(s.players[0]!).toMatchObject({ x, y });
  });

  it('갇힌 동안에는 물풍선을 놓을 수 없다', () => {
    const s = duel();
    forceTrap(s.players[0]!);
    stepMany(s, 10, () => [{ playerId: 0, move: null, placeBubble: true }]);
    expect(s.bubbles).toHaveLength(0);
  });
});

describe('밟기', () => {
  it('적팀이 같은 타일에 오면 즉시 사망한다', () => {
    const s = duel();
    forceTrap(s.players[0]!);
    s.players[1]!.x = tileCenter(1);
    s.players[1]!.y = tileCenter(1);

    step(s, idle);
    expect(s.players[0]!.alive).toBe(false);
  });

  it('아군이 닿으면 구출된다', () => {
    const s = duel();
    s.players[1]!.teamId = s.players[0]!.teamId; // 같은 팀으로
    forceTrap(s.players[0]!);
    s.players[1]!.x = tileCenter(1);
    s.players[1]!.y = tileCenter(1);

    step(s, idle);
    expect(s.players[0]!.alive).toBe(true);
    expect(s.players[0]!.status).toBe(PlayerStatus.Invulnerable);
  });

  it('아군이 도착하기 전에는 갇힌 채로 있는다', () => {
    const s = duel();
    s.players[1]!.teamId = s.players[0]!.teamId;
    forceTrap(s.players[0]!);
    // 상대는 멀리 있다
    stepMany(s, 60, () => idle);
    expect(s.players[0]!.status).toBe(PlayerStatus.Trapped);
  });

  it('적과 아군이 같은 타일에 있으면 적이 이긴다', () => {
    const s = makeState(ROOM, [
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    s.players[1]!.teamId = s.players[0]!.teamId; // 아군
    forceTrap(s.players[0]!);

    step(s, idle);
    expect(s.players[0]!.alive).toBe(false);
  });

  it('갇힌 아군은 남을 구하지 못한다', () => {
    const s = duel();
    s.players[1]!.teamId = s.players[0]!.teamId;
    forceTrap(s.players[0]!);
    forceTrap(s.players[1]!);
    s.players[1]!.x = tileCenter(1);
    s.players[1]!.y = tileCenter(1);

    stepMany(s, 30, () => idle);
    expect(s.players[0]!.status).toBe(PlayerStatus.Trapped);
  });

  it('갇힌 사람끼리는 서로 밟지 못한다', () => {
    const s = duel();
    forceTrap(s.players[0]!);
    forceTrap(s.players[1]!);
    s.players[1]!.x = tileCenter(1);
    s.players[1]!.y = tileCenter(1);

    stepMany(s, 30, () => idle);
    expect(s.players[0]!.alive).toBe(true);
    expect(s.players[1]!.alive).toBe(true);
  });
});

describe('승패', () => {
  it('마지막 팀만 남으면 그 팀이 이긴다', () => {
    const s = duel();
    addWater(s, 5, 1);
    stepMany(s, TRAP_DURATION + 5, () => idle);

    expect(s.players[1]!.alive).toBe(false);
    expect(s.phase).toBe(Phase.Over);
    expect(s.winnerTeamId).toBe(s.players[0]!.teamId);
  });

  it('2v2에서는 팀원이 살아 있으면 끝나지 않는다', () => {
    const s = makeState(ROOM, [
      [1, 1],
      [5, 1],
      [1, 3],
      [5, 3],
    ]);
    // 0,2번이 한 팀 / 1,3번이 한 팀
    s.players[2]!.teamId = s.players[0]!.teamId;
    s.players[3]!.teamId = s.players[1]!.teamId;

    addWater(s, 1, 1); // 0번만 제거
    stepMany(s, TRAP_DURATION + 5, () => idle);

    expect(s.players[0]!.alive).toBe(false);
    expect(s.phase).toBe(Phase.Playing);
  });

  it('동시에 전멸하면 무승부다', () => {
    const s = duel();
    addWater(s, 1, 1);
    addWater(s, 5, 1);
    stepMany(s, TRAP_DURATION + 5, () => idle);

    expect(s.phase).toBe(Phase.Over);
    expect(s.winnerTeamId).toBe(DRAW);
  });

  it('자기 물풍선에 자멸할 수 있다', () => {
    const s = duel();
    step(s, [{ playerId: 0, move: null, placeBubble: true }]);
    stepMany(s, 1000, () => idle);

    expect(s.players[0]!.alive).toBe(false);
    expect(s.winnerTeamId).toBe(s.players[1]!.teamId);
  });
});
