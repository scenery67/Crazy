import { describe, expect, it } from 'vitest';
import { BUBBLE_FUSE, WATER_DURATION } from '../src/constants.js';
import { getTile } from '../src/map.js';
import { step, stepMany } from '../src/sim.js';
import { Tile, WaterKind } from '../src/types.js';
import { addBubble, idle, place, makeState, waterAt } from './helpers.js';

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

    expect(getTile(s, 2, 1)).toBe(Tile.Empty);
    expect(waterAt(s, 2, 1)).toBe(true);
    // 부순 블록 너머로는 뚫고 가지 않는다
    expect(waterAt(s, 3, 1)).toBe(false);
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
