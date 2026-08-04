import { ITEM_DROP_PERCENT, ITEM_WEIGHTS, WATER_DURATION } from '../constants.js';
import { getTile, setTile } from '../map.js';
import { Rng } from '../rng.js';
import {
  DIR_VECTORS,
  Tile,
  WaterKind,
  type Bubble,
  type Dir,
  type GameState,
  type ItemKind,
  type PlayerId,
} from '../types.js';

/**
 * 폭발과 물줄기.
 *
 * 순서가 중요하다: 기존 물줄기를 먼저 늙히고, 그다음 새 폭발을 처리한다.
 * 반대로 하면 이번 틱에 생긴 물줄기가 1틱 손해를 본다.
 */
export function applyExplosions(state: GameState): void {
  ageWaters(state);

  const pending = state.bubbles.filter((b) => b.fuse <= 0);
  if (pending.length > 0) detonate(state, pending);
}

function ageWaters(state: GameState): void {
  let keep = 0;
  for (const water of state.waters) {
    water.ticksLeft--;
    if (water.ticksLeft > 0) {
      state.waters[keep++] = water;
      continue;
    }
    // 물줄기가 걷히는 순간에야 부서진 블록 자리가 열린다.
    // 물줄기가 남아 있는 동안 열어주면 피할 수 없는 죽음이 생긴다
    if (getTile(state, water.tx, water.ty) === Tile.Breaking) {
      setTile(state, water.tx, water.ty, Tile.Empty);
    }
  }
  state.waters.length = keep;
}

/**
 * 십자 전파 + 연쇄 폭발.
 *
 * 연쇄는 같은 틱 안에서 전부 처리한다 (BFS). 틱을 나눠 처리하면
 * "연쇄 도중에 사이를 걸어 지나갈 수 있는" 이상한 상황이 생긴다.
 */
function detonate(state: GameState, initial: readonly Bubble[]): void {
  const queue: Bubble[] = [...initial];
  const exploded = new Set<number>();
  const rng = new Rng(state.rng);

  for (let head = 0; head < queue.length; head++) {
    const bubble = queue[head]!;
    if (exploded.has(bubble.id)) continue;
    exploded.add(bubble.id);

    emitWater(state, bubble.tx, bubble.ty, bubble.ownerId, WaterKind.Center, null);

    for (let dir = 0; dir < DIR_VECTORS.length; dir++) {
      const [dx, dy] = DIR_VECTORS[dir]!;

      for (let dist = 1; dist <= bubble.power; dist++) {
        const tx = bubble.tx + dx * dist;
        const ty = bubble.ty + dy * dist;
        const tile = getTile(state, tx, ty);

        // 파괴 불가 블록, 그리고 이미 부서지는 중인 블록 앞에서 멈춘다
        if (tile === Tile.Hard || tile === Tile.Breaking) break;

        // 파괴 가능 블록은 부수고 거기서 멈춘다 (뚫고 지나가지 않는다).
        // 다만 즉시 열리지는 않는다 — 물줄기가 걷힐 때까지 Breaking으로 막아둔다
        if (tile === Tile.Soft) {
          setTile(state, tx, ty, Tile.Breaking);
          // 아이템은 지금 굴려서 놓아둔다. 타일이 막혀 있는 동안에는 주울 수 없고,
          // 물줄기가 걷혀 열릴 때 비로소 드러난다
          maybeDropItem(state, rng, tx, ty);
          emitWater(state, tx, ty, bubble.ownerId, WaterKind.Tip, dir as Dir);
          break;
        }

        removeItemAt(state, tx, ty);

        const other = state.bubbles.find((b) => b.tx === tx && b.ty === ty);
        const kind = other || dist === bubble.power ? WaterKind.Tip : WaterKind.Arm;
        emitWater(state, tx, ty, bubble.ownerId, kind, dir as Dir);

        // 다른 물풍선을 만나면 연쇄시키고 거기서 멈춘다
        if (other) {
          if (!exploded.has(other.id)) {
            other.fuse = 0;
            queue.push(other);
          }
          break;
        }
      }
    }
  }

  state.bubbles = state.bubbles.filter((b) => {
    if (!exploded.has(b.id)) return true;
    const owner = state.players.find((p) => p.id === b.ownerId);
    if (owner) owner.bubblesPlaced = Math.max(0, owner.bubblesPlaced - 1);
    return false;
  });

  state.rng = rng.seed;
}

function maybeDropItem(state: GameState, rng: Rng, tx: number, ty: number): void {
  if (!rng.chance(ITEM_DROP_PERCENT)) return;
  state.items.push({ tx, ty, kind: rng.weighted(ITEM_WEIGHTS) as ItemKind });
}

/**
 * 같은 타일에 물줄기가 겹치면 새로 쌓지 않고 수명만 갱신한다.
 * 중복 엔티티는 렌더링 겹침과 판정 낭비만 만든다.
 */
function emitWater(
  state: GameState,
  tx: number,
  ty: number,
  ownerId: PlayerId,
  kind: WaterKind,
  dir: Dir | null,
): void {
  const existing = state.waters.find((w) => w.tx === tx && w.ty === ty);
  if (existing) {
    existing.ticksLeft = WATER_DURATION;
    // 중심은 다른 무엇보다 우선한다 (렌더링에서 가장 밝게 그린다)
    if (kind === WaterKind.Center) {
      existing.kind = kind;
      existing.dir = null;
      existing.ownerId = ownerId;
    }
    return;
  }
  state.waters.push({ tx, ty, ticksLeft: WATER_DURATION, ownerId, kind, dir });
}

/** 아이템은 물줄기에 닿으면 사라진다 */
function removeItemAt(state: GameState, tx: number, ty: number): void {
  const i = state.items.findIndex((it) => it.tx === tx && it.ty === ty);
  if (i >= 0) state.items.splice(i, 1);
}
