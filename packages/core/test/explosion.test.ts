import { describe, expect, it } from 'vitest';
import { BUBBLE_FUSE, WATER_DURATION } from '../src/constants.js';
import { getTile, setTile, toTile } from '../src/map.js';
import { step, stepMany } from '../src/sim.js';
import { Dir, PlayerStatus, Tile, WaterKind } from '../src/types.js';
import { addBubble, hold, idle, place, makeState, waterAt } from './helpers.js';

/** 7x7 빈 방. 가운데는 (3,3) */
const ROOM = [
  '#######',
  '#.....#',
  '#.....#',
  '#.....#',
  '#.....#',
  '#.....#',
  '#######',
];

describe('물풍선 설치', () => {
  it('플레이어의 중심 타일에 놓인다', () => {
    const s = makeState(ROOM, [[3, 3]]);
    step(s, place());
    expect(s.bubbles).toHaveLength(1);
    expect(s.bubbles[0]).toMatchObject({ tx: 3, ty: 3, ownerId: 0, fuse: BUBBLE_FUSE });
  });

  it('보유 개수를 넘겨 설치할 수 없다', () => {
    const s = makeState(ROOM, [[3, 3]]);
    step(s, place());
    s.players[0]!.x += 1000; // 옆 타일로 이동
    step(s, place());
    expect(s.bubbles).toHaveLength(1);
  });

  it('개수를 늘리면 그만큼 설치할 수 있다', () => {
    const s = makeState(ROOM, [[3, 3]]);
    s.players[0]!.bubbleCapacity = 2;
    step(s, place());
    s.players[0]!.x += 1000;
    step(s, place());
    expect(s.bubbles).toHaveLength(2);
  });

  it('같은 타일에 겹쳐 놓을 수 없다', () => {
    const s = makeState(ROOM, [[3, 3]]);
    s.players[0]!.bubbleCapacity = 3;
    step(s, place());
    step(s, place());
    expect(s.bubbles).toHaveLength(1);
  });
});

describe('폭발과 물줄기', () => {
  it('신관이 다하면 터진다', () => {
    const s = makeState(ROOM, [[3, 3]]);
    step(s, place());
    stepMany(s, BUBBLE_FUSE - 1, () => idle);
    expect(s.bubbles).toHaveLength(1);
    expect(s.waters).toHaveLength(0);

    step(s, idle);
    expect(s.bubbles).toHaveLength(0);
    expect(s.waters.length).toBeGreaterThan(0);
  });

  it('십자 4방향으로 power만큼 뻗는다', () => {
    const s = makeState(ROOM, [[3, 3]]);
    addBubble(s, 3, 3, { fuse: 1, power: 2 });
    step(s, idle);

    // 중심 + 4방향 × 2칸 = 9칸
    expect(s.waters).toHaveLength(9);
    for (const [tx, ty] of [
      [3, 3],
      [3, 1],
      [3, 2],
      [3, 4],
      [3, 5],
      [1, 3],
      [2, 3],
      [4, 3],
      [5, 3],
    ]) {
      expect(waterAt(s, tx!, ty!)).toBe(true);
    }
    // 대각선에는 생기지 않는다
    expect(waterAt(s, 2, 2)).toBe(false);
  });

  it('중심 타일은 Center로 표시된다', () => {
    const s = makeState(ROOM, [[3, 3]]);
    addBubble(s, 3, 3, { fuse: 1, power: 2 });
    step(s, idle);
    expect(s.waters.find((w) => w.tx === 3 && w.ty === 3)?.kind).toBe(WaterKind.Center);
  });

  it('파괴 불가 블록 앞에서 멈추고 그 자리에는 물줄기가 없다', () => {
    const s = makeState(ROOM, [[1, 1]]);
    addBubble(s, 1, 1, { fuse: 1, power: 3 });
    step(s, idle);
    expect(waterAt(s, 0, 1)).toBe(false);
    expect(waterAt(s, 1, 0)).toBe(false);
    expect(waterAt(s, 2, 1)).toBe(true);
  });

  it('파괴 가능 블록을 부수고 거기서 멈춘다', () => {
    const s = makeState(['#####', '#.x.#', '#####'], [[1, 1]]);
    addBubble(s, 1, 1, { fuse: 1, power: 3 });
    step(s, idle);

    // 즉시 열리지 않는다. 물줄기가 걷힐 때까지 막혀 있다
    expect(getTile(s, 2, 1)).toBe(Tile.Breaking);
    expect(waterAt(s, 2, 1)).toBe(true);
    // 부순 블록 너머로는 뚫고 가지 않는다
    expect(waterAt(s, 3, 1)).toBe(false);

    stepMany(s, WATER_DURATION, () => idle);
    expect(getTile(s, 2, 1)).toBe(Tile.Empty);
    expect(waterAt(s, 2, 1)).toBe(false);
  });

  it('부서지는 블록은 다음 폭발도 막는다', () => {
    // 물줄기를 직접 깔면 어느 폭발의 것인지 헷갈리므로 타일만 만들어 둔다
    const s = makeState(['#######', '#.x...#', '#######'], [[1, 1]]);
    setTile(s, 2, 1, Tile.Breaking);

    addBubble(s, 5, 1, { fuse: 1, power: 5 });
    step(s, idle);

    expect(waterAt(s, 3, 1)).toBe(true);
    // 부서지는 중인 블록을 뚫고 나가지 않는다
    expect(waterAt(s, 2, 1)).toBe(false);
    expect(waterAt(s, 1, 1)).toBe(false);
  });

  it('물줄기는 WATER_DURATION 뒤에 사라진다', () => {
    const s = makeState(ROOM, [[3, 3]]);
    addBubble(s, 3, 3, { fuse: 1, power: 1 });
    step(s, idle);

    stepMany(s, WATER_DURATION - 1, () => idle);
    expect(s.waters.length).toBeGreaterThan(0);
    step(s, idle);
    expect(s.waters).toHaveLength(0);
  });

  it('터진 만큼 설치 가능 개수가 돌아온다', () => {
    const s = makeState(ROOM, [[3, 3]]);
    step(s, place());
    expect(s.players[0]!.bubblesPlaced).toBe(1);

    stepMany(s, BUBBLE_FUSE, () => idle);
    expect(s.players[0]!.bubblesPlaced).toBe(0);
  });
});

describe('부서진 블록 자리로 빨려 들어가 죽지 않는다', () => {
  /**
   *   # # # # #
   *   # o x P #    o=물풍선  x=파괴 가능 블록  P=플레이어
   *   # # # # #
   *
   * 벽 반대편의 플레이어는 물줄기 사거리 밖이라 안전하다.
   * 블록이 즉시 사라지면 벽을 밀고 있던 플레이어가 빨려 들어가
   * 남아 있는 물줄기에 갇힌다 — 예고도 반응 시간도 없는 죽음이다.
   */
  const WALL = ['#####', '#.x.#', '#####'];

  it('물줄기가 걷힐 때까지는 들어갈 수 없다', () => {
    const s = makeState(WALL, [[3, 1]]);
    addBubble(s, 1, 1, { fuse: 1, power: 1 });

    // 블록을 향해 계속 밀면서 폭발을 맞는다
    stepMany(s, WATER_DURATION - 2, () => hold(Dir.Left));

    expect(s.players[0]!.alive).toBe(true);
    expect(s.players[0]!.status).toBe(PlayerStatus.Normal);
    // 아직 부서지는 중이라 원래 블록 자리를 넘어가지 못한다
    expect(toTile(s.players[0]!.x)).toBe(3);
  });

  it('물줄기가 걷힌 뒤에는 안전하게 지나간다', () => {
    const s = makeState(WALL, [[3, 1]]);
    addBubble(s, 1, 1, { fuse: 1, power: 1 });

    stepMany(s, WATER_DURATION + 120, () => hold(Dir.Left));

    expect(s.players[0]!.alive).toBe(true);
    expect(s.players[0]!.status).toBe(PlayerStatus.Normal);
    // 이제 열렸으므로 통과했어야 한다
    expect(toTile(s.players[0]!.x)).toBeLessThan(3);
  });
});

describe('연쇄 폭발', () => {
  it('물줄기가 닿은 물풍선은 같은 틱에 함께 터진다', () => {
    const s = makeState(ROOM, [[1, 1]]);
    addBubble(s, 1, 3, { fuse: 1, power: 2 });
    addBubble(s, 3, 3, { fuse: BUBBLE_FUSE, power: 2 });

    step(s, idle);

    expect(s.bubbles).toHaveLength(0);
    // 두 번째 물풍선이 자기 위치에서 다시 뻗어나가야 한다
    expect(waterAt(s, 5, 3)).toBe(true);
  });

  it('연쇄는 물풍선에서 멈춘다 (뚫고 지나가지 않는다)', () => {
    const s = makeState(ROOM, [[1, 1]]);
    addBubble(s, 1, 3, { fuse: 1, power: 4 });
    addBubble(s, 2, 3, { fuse: BUBBLE_FUSE, power: 1 });

    step(s, idle);
    // 첫 물풍선의 물줄기는 (2,3)에서 멈추고,
    // 그 너머 (3,3)은 두 번째 물풍선(power 1)이 만든 것이다
    expect(waterAt(s, 3, 3)).toBe(true);
    expect(waterAt(s, 4, 3)).toBe(false);
  });

  it('여러 단계로 이어져도 무한 루프에 빠지지 않는다', () => {
    const s = makeState(ROOM, [[1, 1]]);
    addBubble(s, 1, 3, { fuse: 1, power: 1 });
    addBubble(s, 2, 3, { fuse: BUBBLE_FUSE, power: 1 });
    addBubble(s, 3, 3, { fuse: BUBBLE_FUSE, power: 1 });
    addBubble(s, 4, 3, { fuse: BUBBLE_FUSE, power: 1 });

    step(s, idle);
    expect(s.bubbles).toHaveLength(0);
    expect(waterAt(s, 5, 3)).toBe(true);
  });

  it('서로를 가리키는 물풍선도 한 번씩만 터진다', () => {
    const s = makeState(ROOM, [[1, 1]]);
    addBubble(s, 2, 3, { fuse: 1, power: 1 });
    addBubble(s, 3, 3, { fuse: 1, power: 1 });

    step(s, idle);
    expect(s.bubbles).toHaveLength(0);
    // 같은 타일에 물줄기가 중복으로 쌓이지 않는다
    const tiles = s.waters.map((w) => `${w.tx},${w.ty}`);
    expect(new Set(tiles).size).toBe(tiles.length);
  });
});
