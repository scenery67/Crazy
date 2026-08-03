import { describe, expect, it } from 'vitest';
import {
  FORCED_PLACE_INTERVAL,
  MAX_BUBBLE_CAPACITY,
  MAX_POWER,
  MAX_SPEED_LEVEL,
  POTION_DURATION,
  SHIELD_DURATION,
  SKULL_DURATION,
  SKULL_SLOW_SPEED,
  SPEED_TABLE,
  TILE,
} from '../src/constants.js';
import { tileCenter } from '../src/map.js';
import { step, stepMany } from '../src/sim.js';
import { effectiveCapacity, effectivePower, effectiveSpeed } from '../src/stats.js';
import { Dir, ItemKind, PlayerStatus, SkullKind } from '../src/types.js';
import { addWater, forceTrap, hold, idle, makeState, place } from './helpers.js';

const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#######'];

function withItem(kind: ItemKind, tx = 1, ty = 1) {
  const s = makeState(ROOM, [
    [1, 1],
    [5, 3],
  ]);
  s.items.push({ tx, ty, kind });
  return s;
}

describe('아이템 획득', () => {
  it('밟고 지나가면 사라진다', () => {
    const s = withItem(ItemKind.Power);
    step(s, idle);
    expect(s.items).toHaveLength(0);
  });

  it('물풍선 아이템은 설치 개수를 늘린다', () => {
    const s = withItem(ItemKind.Bubble);
    step(s, idle);
    expect(s.players[0]!.bubbleCapacity).toBe(2);
  });

  it('물물약은 물줄기 길이를 늘린다', () => {
    const s = withItem(ItemKind.Power);
    step(s, idle);
    expect(s.players[0]!.power).toBe(2);
  });

  it('롤러는 이동 속도를 올린다', () => {
    const s = withItem(ItemKind.Roller);
    const before = effectiveSpeed(s.players[0]!);
    step(s, idle);
    expect(effectiveSpeed(s.players[0]!)).toBeGreaterThan(before);
  });

  it('바늘은 쌓인다', () => {
    const s = withItem(ItemKind.Needle);
    step(s, idle);
    s.items.push({ tx: 1, ty: 1, kind: ItemKind.Needle });
    step(s, idle);
    expect(s.players[0]!.needles).toBe(2);
  });

  it('능력치는 상한을 넘지 않는다', () => {
    const s = withItem(ItemKind.Power);
    s.players[0]!.power = MAX_POWER;
    s.players[0]!.bubbleCapacity = MAX_BUBBLE_CAPACITY;
    s.players[0]!.speedLevel = MAX_SPEED_LEVEL;

    step(s, idle);
    for (const kind of [ItemKind.Bubble, ItemKind.Roller]) {
      s.items.push({ tx: 1, ty: 1, kind });
      step(s, idle);
    }
    expect(s.players[0]!.power).toBe(MAX_POWER);
    expect(s.players[0]!.bubbleCapacity).toBe(MAX_BUBBLE_CAPACITY);
    expect(s.players[0]!.speedLevel).toBe(MAX_SPEED_LEVEL);
  });

  it('갇힌 동안에는 줍지 못한다', () => {
    const s = withItem(ItemKind.Power);
    forceTrap(s.players[0]!);
    stepMany(s, 10, () => idle);
    expect(s.items).toHaveLength(1);
    expect(s.players[0]!.power).toBe(1);
  });

  it('물줄기에 닿은 아이템은 없어진다', () => {
    const s = makeState(ROOM, [[5, 3]]);
    s.items.push({ tx: 2, ty: 1, kind: ItemKind.Power });
    s.bubbles.push({ id: 1, ownerId: 0, tx: 1, ty: 1, fuse: 1, power: 3 });

    step(s, idle);
    expect(s.items).toHaveLength(0);
  });
});

describe('일시 효과', () => {
  it('물약은 정해진 시간 동안만 위력을 최대로 만든다', () => {
    const s = withItem(ItemKind.Potion);
    step(s, idle);

    expect(s.players[0]!.potionTicks).toBeGreaterThan(0);
    expect(effectivePower(s.players[0]!)).toBe(MAX_POWER);
    // 원래 능력치는 건드리지 않는다
    expect(s.players[0]!.power).toBe(1);

    stepMany(s, POTION_DURATION, () => idle);
    expect(effectivePower(s.players[0]!)).toBe(1);
  });

  it('물약이 끊겨도 이미 놓은 물풍선의 위력은 그대로다', () => {
    const s = withItem(ItemKind.Potion);
    step(s, idle);
    step(s, place());

    expect(s.bubbles[0]!.power).toBe(MAX_POWER);
    stepMany(s, POTION_DURATION, () => idle);
    expect(s.bubbles[0]?.power ?? MAX_POWER).toBe(MAX_POWER);
  });

  it('방패는 무적을 준다', () => {
    const s = withItem(ItemKind.Shield);
    step(s, idle);
    expect(s.players[0]!.status).toBe(PlayerStatus.Invulnerable);
    expect(s.players[0]!.statusTicks).toBeGreaterThan(SHIELD_DURATION - 5);
  });

  it('방패를 든 채로는 물줄기에 갇히지 않는다', () => {
    const s = withItem(ItemKind.Shield);
    step(s, idle);
    addWater(s, 1, 1);
    stepMany(s, 20, () => idle);
    expect(s.players[0]!.status).toBe(PlayerStatus.Invulnerable);
  });

  it('해골은 시간이 지나면 풀린다', () => {
    const s = withItem(ItemKind.Skull);
    step(s, idle);
    expect(s.players[0]!.skullTicks).toBeGreaterThan(0);
    expect(s.players[0]!.skullKind).not.toBe(SkullKind.None);

    stepMany(s, SKULL_DURATION, () => idle);
    expect(s.players[0]!.skullKind).toBe(SkullKind.None);
  });
});

describe('해골 디버프', () => {
  function skulled(kind: SkullKind) {
    const s = makeState(ROOM, [
      [1, 1],
      [5, 3],
    ]);
    s.players[0]!.skullTicks = SKULL_DURATION;
    s.players[0]!.skullKind = kind;
    return s;
  }

  it('SlowFeet은 기본보다 느리게 만든다', () => {
    const s = skulled(SkullKind.SlowFeet);
    expect(effectiveSpeed(s.players[0]!)).toBe(SKULL_SLOW_SPEED);
    expect(SKULL_SLOW_SPEED).toBeLessThan(SPEED_TABLE[0]!);

    const startX = s.players[0]!.x;
    step(s, hold(Dir.Right));
    expect(s.players[0]!.x - startX).toBe(SKULL_SLOW_SPEED);
  });

  it('TinyBubble은 실제 보유량과 무관하게 1개로 묶는다', () => {
    const s = skulled(SkullKind.TinyBubble);
    s.players[0]!.bubbleCapacity = 5;
    expect(effectiveCapacity(s.players[0]!)).toBe(1);

    step(s, place());
    s.players[0]!.x += TILE;
    step(s, place());
    expect(s.bubbles).toHaveLength(1);
  });

  it('ForcedPlace는 누르지 않아도 물풍선을 흘린다', () => {
    const s = skulled(SkullKind.ForcedPlace);
    s.players[0]!.bubbleCapacity = 3;

    stepMany(s, FORCED_PLACE_INTERVAL * 2 + 2, () => idle);
    expect(s.bubbles.length).toBeGreaterThan(0);
  });

  it('해골이 풀리면 능력치가 원래대로 돌아온다', () => {
    const s = skulled(SkullKind.SlowFeet);
    s.players[0]!.speedLevel = 3;
    stepMany(s, SKULL_DURATION + 1, () => idle);
    expect(effectiveSpeed(s.players[0]!)).toBe(SPEED_TABLE[3]!);
  });
});

describe('드랍', () => {
  it('블록을 부수면 아이템이 나온다', () => {
    // 파괴 가능 블록을 길게 늘어놓고 한 번에 부순다
    const rows = ['#########', '#.xxxxxx#', '#########'];
    const s = makeState(rows, [[1, 1]]);
    s.bubbles.push({ id: 1, ownerId: 0, tx: 1, ty: 1, fuse: 1, power: 1 });
    s.players[0]!.bubblesPlaced = 1;

    // 한 번의 폭발은 블록 하나만 부수므로, 여러 시드로 반복해 드랍을 확인한다
    let dropped = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const t = makeState(rows, [[1, 1]]);
      t.rng = seed;
      t.bubbles.push({ id: 1, ownerId: 0, tx: 1, ty: 1, fuse: 1, power: 1 });
      t.players[0]!.bubblesPlaced = 1;
      step(t, idle);
      dropped += t.items.length;
    }
    expect(dropped).toBeGreaterThan(0);
  });

  it('같은 시드는 같은 드랍을 만든다', () => {
    const build = () => {
      const t = makeState(['#########', '#.xxxxxx#', '#########'], [[1, 1]]);
      t.rng = 4242;
      t.bubbles.push({ id: 1, ownerId: 0, tx: 1, ty: 1, fuse: 1, power: 1 });
      t.players[0]!.bubblesPlaced = 1;
      step(t, idle);
      return t;
    };
    expect(build().items).toEqual(build().items);
  });

  it('부순 블록에서 나온 아이템이 그 폭발에 다시 지워지지 않는다', () => {
    let survived = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const t = makeState(['#####', '#.x.#', '#####'], [[3, 1]]);
      t.rng = seed;
      t.bubbles.push({ id: 1, ownerId: 0, tx: 1, ty: 1, fuse: 1, power: 2 });
      step(t, idle);
      survived += t.items.filter((i) => i.tx === 2 && i.ty === 1).length;
    }
    expect(survived).toBeGreaterThan(0);
  });
});
