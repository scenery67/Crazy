import { describe, expect, it } from 'vitest';
import { PLAYER_HITBOX, SPEED_TABLE, TILE } from '../src/constants.js';
import { tileCenter } from '../src/map.js';
import { cloneState, step, stepMany } from '../src/sim.js';
import { Dir, PlayerStatus } from '../src/types.js';
import { addBubble, hold, makeState } from './helpers.js';

const SPEED = SPEED_TABLE[0]!;
const HALF = PLAYER_HITBOX / 2;

/** 3x3 통로가 뚫린 방 */
const OPEN_ROOM = [
  '#####',
  '#...#',
  '#...#',
  '#...#',
  '#####',
];

describe('기본 이동', () => {
  it('빈 공간에서는 속도만큼 이동한다', () => {
    const s = makeState(OPEN_ROOM, [[2, 2]]);
    const startX = s.players[0]!.x;
    step(s, hold(Dir.Right));
    expect(s.players[0]!.x).toBe(startX + SPEED);
  });

  it('이동 방향이 facing에 반영된다', () => {
    const s = makeState(OPEN_ROOM, [[2, 2]]);
    step(s, hold(Dir.Up));
    expect(s.players[0]!.facing).toBe(Dir.Up);
  });

  it('축 이동 중에는 수직 좌표가 흔들리지 않는다', () => {
    const s = makeState(OPEN_ROOM, [[2, 2]]);
    const startY = s.players[0]!.y;
    stepMany(s, 10, () => hold(Dir.Right));
    expect(s.players[0]!.y).toBe(startY);
  });

  it('입력이 없으면 움직이지 않는다', () => {
    const s = makeState(OPEN_ROOM, [[2, 2]]);
    const { x, y } = s.players[0]!;
    stepMany(s, 30, () => hold(null));
    expect(s.players[0]!).toMatchObject({ x, y });
  });

  it('물방울에 갇힌 동안은 움직일 수 없다', () => {
    const s = makeState(OPEN_ROOM, [[2, 2]]);
    s.players[0]!.status = PlayerStatus.Trapped;
    const { x, y } = s.players[0]!;
    stepMany(s, 60, () => hold(Dir.Right));
    expect(s.players[0]!).toMatchObject({ x, y });
  });
});

describe('벽 충돌', () => {
  it('벽 바로 앞에 정확히 정렬되어 멈춘다', () => {
    const s = makeState(OPEN_ROOM, [[1, 1]]);
    stepMany(s, 200, () => hold(Dir.Right));
    // 벽은 x=4 열. 오른쪽 모서리가 4*TILE에 딱 붙어야 한다
    expect(s.players[0]!.x).toBe(4 * TILE - HALF);
  });

  it('벽에 붙은 뒤로는 더 이상 밀리지 않는다', () => {
    const s = makeState(OPEN_ROOM, [[1, 1]]);
    stepMany(s, 200, () => hold(Dir.Left));
    const settled = s.players[0]!.x;
    stepMany(s, 60, () => hold(Dir.Left));
    expect(s.players[0]!.x).toBe(settled);
    expect(settled).toBe(1 * TILE + HALF);
  });

  it('파괴 가능 블록도 이동을 막는다', () => {
    const s = makeState(['#####', '#.x.#', '#####'], [[1, 1]]);
    stepMany(s, 200, () => hold(Dir.Right));
    expect(s.players[0]!.x).toBe(2 * TILE - HALF);
  });
});

describe('코너 어시스트 / 레인 정렬', () => {
  /**
   *   # # # #
   *   # . # #      (1,1)에서 아래로 이동하다 두 행에 걸친 상태에서
   *   # . . #      오른쪽을 누르는 상황. (2,1)은 벽, (2,2)는 열려 있다.
   *   # # # #      보정이 없으면 여기서 영원히 막힌다.
   */
  const CORNER = ['####', '#.##', '#..#', '####'];

  it('두 레인에 걸친 채 진행하면 열린 레인 쪽으로 미끄러진다', () => {
    const s = makeState(CORNER, [[1, 1]]);
    // 아래로 조금 내려와 행 1과 2에 걸치게 만든다
    s.players[0]!.y = tileCenter(1) + 400;

    const before = s.players[0]!.y;
    step(s, hold(Dir.Right));
    expect(s.players[0]!.y).toBeGreaterThan(before);
  });

  it('보정이 끝나면 코너를 돌아 끝까지 진행한다', () => {
    const s = makeState(CORNER, [[1, 1]]);
    s.players[0]!.y = tileCenter(1) + 400;

    stepMany(s, 60, () => hold(Dir.Right));
    // 열린 행 중심에 정확히 안착하고, 오른쪽 벽 앞까지 나아가야 한다
    expect(s.players[0]!.y).toBe(tileCenter(2));
    expect(s.players[0]!.x).toBe(3 * TILE - HALF);
  });

  it('보정은 레인 중심을 넘어가지 않는다', () => {
    const s = makeState(CORNER, [[1, 1]]);
    s.players[0]!.y = tileCenter(2) - 5; // 중심 바로 앞
    step(s, hold(Dir.Right));
    expect(s.players[0]!.y).toBe(tileCenter(2));
  });

  it('이미 레인 중심이면 수직 좌표를 건드리지 않는다', () => {
    const s = makeState(['####', '#.##', '####'], [[1, 1]]);
    stepMany(s, 30, () => hold(Dir.Right));
    expect(s.players[0]!.y).toBe(tileCenter(1));
    // 히트박스가 타일보다 작으므로 벽에 닿을 때까지는 붙는다
    expect(s.players[0]!.x).toBe(2 * TILE - HALF);
  });

  it('우회로가 없으면 가장 가까운 레인으로 정렬만 한다', () => {
    const s = makeState(['####', '#.##', '#.##', '####'], [[1, 1]]);
    s.players[0]!.y = tileCenter(1) + 400; // 행 1에 더 가깝다

    stepMany(s, 60, () => hold(Dir.Right));
    expect(s.players[0]!.y).toBe(tileCenter(1));
    expect(s.players[0]!.x).toBe(2 * TILE - HALF);
  });

  /**
   *   # # # # #
   *   # . x . #     위아래에 블록이 있고, 오른쪽은 벽으로 막힌 자리.
   *   # . P # #     이때 옆 행으로 끌려가면 안 된다 — 그 행은 내 열에서 막혀 있다.
   *   # . x . #
   *   # # # # #
   */
  it('막혀 있어도 갈 수 없는 옆 행으로 끌려가지 않는다', () => {
    // 오른쪽은 벽, 위아래는 블록. 옆 행(1, 3)은 내 열에서 막혀 있으므로
    // 그쪽으로 끌려가면 안 된다
    const rows = ['#####', '#.x.#', '#..##', '#.x.#', '#####'];

    for (const nudge of [-200, -120, 0, 120, 200]) {
      const s = makeState(rows, [[2, 2]]);
      s.players[0]!.y = tileCenter(2) + nudge;

      stepMany(s, 60, () => hold(Dir.Right));
      expect(s.players[0]!.y).toBe(tileCenter(2));
    }
  });

  it('세로 이동에도 같은 규칙이 대칭으로 적용된다', () => {
    //   # # # #
    //   # . . #    (1,1)에서 오른쪽으로 가다 두 열에 걸친 채
    //   # # . #    아래를 누르면 열린 열(2)로 미끄러져야 한다
    //   # # . #
    //   # # # #
    const s = makeState(['####', '#..#', '##.#', '##.#', '####'], [[1, 1]]);
    s.players[0]!.x = tileCenter(1) + 400;

    // 코너를 도는 데 몇 틱 쓰므로 벽까지 가려면 넉넉히 준다
    stepMany(s, 90, () => hold(Dir.Down));
    expect(s.players[0]!.x).toBe(tileCenter(2));
    expect(s.players[0]!.y).toBe(4 * TILE - HALF);
  });
});

describe('물풍선 통과 규칙', () => {
  const ROOM = ['#####', '#...#', '#####'];
  /** 이동 규칙만 보기 위해 폭발하지 않는 물풍선을 쓴다 */
  const INERT = { fuse: 1_000_000 };

  it('자기가 서 있는 물풍선에서는 걸어 나올 수 있다', () => {
    const s = makeState(ROOM, [[1, 1]]);
    addBubble(s, 1, 1, INERT);
    stepMany(s, 200, () => hold(Dir.Right));
    expect(s.players[0]!.x).toBe(4 * TILE - HALF);
  });

  it('한 번 벗어난 물풍선에는 다시 들어갈 수 없다', () => {
    const s = makeState(ROOM, [[1, 1]]);
    addBubble(s, 1, 1, INERT);
    stepMany(s, 200, () => hold(Dir.Right));
    stepMany(s, 200, () => hold(Dir.Left));
    // 물풍선 타일(1)의 오른쪽 경계 앞에 막혀야 한다
    expect(s.players[0]!.x).toBe(2 * TILE + HALF);
  });

  it('다른 플레이어의 물풍선도 겹쳐 있는 동안은 통과한다', () => {
    const s = makeState(ROOM, [
      [1, 1],
      [1, 1],
    ]);
    addBubble(s, 1, 1, INERT);
    stepMany(s, 200, () => [{ playerId: 1, move: Dir.Right, placeBubble: false }]);
    expect(s.players[1]!.x).toBe(4 * TILE - HALF);
  });
});

describe('결정론', () => {
  it('같은 시작 상태와 같은 입력은 같은 결과를 낸다', () => {
    const inputs = (tick: number) => hold(tick % 40 < 20 ? Dir.Right : Dir.Down);
    const a = makeState(OPEN_ROOM, [[1, 1]]);
    const b = cloneState(a);

    stepMany(a, 300, inputs);
    stepMany(b, 300, inputs);

    expect(b.players[0]!).toEqual(a.players[0]!);
    expect(b.tick).toBe(a.tick);
  });

  it('cloneState는 원본과 분리된다', () => {
    const a = makeState(OPEN_ROOM, [[1, 1]]);
    const snapshot = cloneState(a);
    stepMany(a, 100, () => hold(Dir.Right));
    expect(snapshot.players[0]!.x).toBe(tileCenter(1));
    expect(snapshot.tick).toBe(0);
  });
});
