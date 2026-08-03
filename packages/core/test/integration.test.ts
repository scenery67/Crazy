import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/constants.js';
import { playerTile } from '../src/geometry.js';
import { createInitialState, getTile, soloTeams } from '../src/map.js';
import { Rng } from '../src/rng.js';
import { step } from '../src/sim.js';
import { Dir, ItemKind, Tile, type GameState, type InputFrame } from '../src/types.js';

/**
 * 실제 생성 맵 위에서 전체 시스템을 오래 돌리는 스모크 테스트.
 *
 * 유닛 테스트는 규칙을 하나씩 검증하지만, 시스템이 서로를 밟는 문제
 * (물풍선 카운터 누수, 벽에 낀 플레이어, 엔티티 누적)는 잡지 못한다.
 * M6에서 봇 vs 봇 헤드리스 대전을 돌릴 때 쓸 검사도 여기서 만들어 둔다.
 */

const DIRS = [Dir.Up, Dir.Down, Dir.Left, Dir.Right] as const;

/**
 * 방향을 한동안 유지하다 바꾸는 입력기.
 *
 * 매 틱 방향을 바꾸는 입력을 쓰면 안 된다. 이 게임은 레인 고정이라
 * 수직 보정이 전진을 그대로 상쇄해서 플레이어가 타일 중심에 머문다.
 * 사람도 봇도 방향을 유지한 채 이동하므로, 그쪽을 흉내내야 의미 있는 부하가 된다.
 */
function patrol(rng: Rng, playerCount: number): (tick: number) => InputFrame[] {
  const held: Dir[] = Array.from({ length: playerCount }, () => Dir.Down);
  const until: number[] = Array.from({ length: playerCount }, () => 0);

  return (tick: number): InputFrame[] => {
    const frames: InputFrame[] = [];
    for (let id = 0; id < playerCount; id++) {
      if (tick >= until[id]!) {
        held[id] = DIRS[rng.int(DIRS.length)]!;
        until[id] = tick + 20 + rng.int(40);
      }
      frames.push({ playerId: id, move: held[id]!, placeBubble: rng.chance(3) });
    }
    return frames;
  };
}

function checkInvariants(state: GameState): void {
  for (const p of state.players) {
    if (p.alive) {
      // 파괴 불가 블록 안에 들어가면 안 된다
      const [tx, ty] = playerTile(p);
      expect(getTile(state, tx, ty)).not.toBe(Tile.Hard);
    }
    expect(p.statusTicks).toBeGreaterThanOrEqual(0);
    // 설치 카운터가 실제 물풍선 수와 어긋나면 안 된다 (누수되면 영영 못 놓는다)
    expect(p.bubblesPlaced).toBe(state.bubbles.filter((b) => b.ownerId === p.id).length);
    expect(p.bubblesPlaced).toBeLessThanOrEqual(p.bubbleCapacity);
  }

  // 한 타일에 물풍선이 겹치거나 물줄기가 중복되면 안 된다
  const bubbleTiles = state.bubbles.map((b) => `${b.tx},${b.ty}`);
  expect(new Set(bubbleTiles).size).toBe(bubbleTiles.length);
  const waterTiles = state.waters.map((w) => `${w.tx},${w.ty}`);
  expect(new Set(waterTiles).size).toBe(waterTiles.length);

  for (const w of state.waters) {
    expect(w.tx).toBeGreaterThanOrEqual(0);
    expect(w.ty).toBeGreaterThanOrEqual(0);
    expect(w.tx).toBeLessThan(state.width);
    expect(w.ty).toBeLessThan(state.height);
  }
}

function runMatch(seed: number, ticks: number): GameState {
  const state = createInitialState({ seed, teams: soloTeams(4) });
  const driver = patrol(new Rng(seed ^ 0x5f3759df), state.players.length);
  for (let i = 0; i < ticks; i++) step(state, driver(i));
  return state;
}

describe('통합 — 실제 맵에서 장시간 시뮬레이션', () => {
  it('여러 시드에서 불변식을 깨지 않는다', () => {
    for (const seed of [1, 7, 12345, 99991]) {
      const state = createInitialState({ seed, teams: soloTeams(4) });
      const driver = patrol(new Rng(seed ^ 0x5f3759df), state.players.length);

      for (let i = 0; i < TICK_RATE * 60; i++) {
        step(state, driver(i));
        if (i % 37 === 0) checkInvariants(state);
      }
      checkInvariants(state);
    }
  });

  it('플레이어가 스폰 구역을 벗어나 맵을 돌아다닌다', () => {
    const state = createInitialState({ seed: 2024, teams: soloTeams(4) });
    const driver = patrol(new Rng(4242), state.players.length);
    const visited = new Set<string>();

    for (let i = 0; i < TICK_RATE * 60; i++) {
      step(state, driver(i));
      for (const p of state.players) {
        if (p.alive) visited.add(playerTile(p).join(','));
      }
    }
    // 스폰 4칸에 갇혀 있으면 이동·보정 규칙이 서로를 상쇄하고 있다는 뜻이다
    expect(visited.size).toBeGreaterThan(12);
  });

  it('물풍선이 파괴 가능 블록을 실제로 없앤다', () => {
    const state = createInitialState({ seed: 2024, teams: soloTeams(4) });
    const before = state.map.filter((t) => t === Tile.Soft).length;
    expect(before).toBeGreaterThan(0);

    const driver = patrol(new Rng(4242), state.players.length);
    for (let i = 0; i < TICK_RATE * 60; i++) step(state, driver(i));

    expect(state.map.filter((t) => t === Tile.Soft).length).toBeLessThan(before);
  });

  /**
   * 순찰 입력 플레이어는 8초 안에 전원 자멸한다 — 자기 물풍선에 갇히고,
   * 탈출에 필요한 방향 전환 12회를 트랩 시간(5초) 안에 못 채우기 때문이다.
   * 그래서 아이템 검증은 창발적 플레이에 기대지 않고 직접 몰아서 한다.
   * (제대로 피해 다니는 주체는 M6 봇이 처음이다)
   */
  it('실제 맵의 블록을 모두 부수면 아이템이 나온다', () => {
    const state = createInitialState({ seed: 2024, teams: soloTeams(4) });
    const softStart = state.map.filter((t) => t === Tile.Soft).length;

    // 플레이어를 치워두고 맵 전체를 훑어 물풍선을 터뜨린다
    for (const p of state.players) p.alive = false;
    // 뒤따르는 폭발이 앞서 떨어진 아이템을 지우므로(의도된 규칙),
    // 최종 개수가 아니라 도중에 나왔는지를 본다
    let peakItems = 0;
    for (let ty = 1; ty < state.height - 1; ty++) {
      for (let tx = 1; tx < state.width - 1; tx++) {
        if (getTile(state, tx, ty) !== Tile.Empty) continue;
        state.bubbles.push({ id: state.nextBubbleId++, ownerId: 0, tx, ty, fuse: 1, power: 2 });
        step(state, []);
        peakItems = Math.max(peakItems, state.items.length);
      }
    }

    expect(state.map.filter((t) => t === Tile.Soft).length).toBe(0);
    expect(peakItems).toBeGreaterThan(0);
    expect(peakItems).toBeLessThanOrEqual(softStart);
  });

  it('떨어진 아이템을 밟으면 능력치가 오른다', () => {
    const state = createInitialState({ seed: 2024, teams: soloTeams(4) });
    const player = state.players[0]!;
    const [tx, ty] = playerTile(player);

    state.items.push({ tx, ty, kind: ItemKind.Power });
    const before = player.power;
    step(state, []);

    expect(player.power).toBe(before + 1);
    expect(state.items).toHaveLength(0);
  });

  it('장시간 돌려도 엔티티가 누적되지 않는다', () => {
    const state = runMatch(808, TICK_RATE * 120);
    // 물풍선은 인원수 × 보유 개수를 넘을 수 없고, 물줄기는 수명이 있으므로 유한하다
    expect(state.bubbles.length).toBeLessThanOrEqual(state.players.length);
    expect(state.waters.length).toBeLessThan(state.width * state.height);
  });

  it('같은 시드와 같은 입력열은 완전히 같은 결과를 낸다', () => {
    const a = runMatch(31337, TICK_RATE * 60);
    const b = runMatch(31337, TICK_RATE * 60);

    expect(b.players).toEqual(a.players);
    expect(Array.from(b.map)).toEqual(Array.from(a.map));
    expect(b.bubbles).toEqual(a.bubbles);
    expect(b.winnerTeamId).toBe(a.winnerTeamId);
  });
});
