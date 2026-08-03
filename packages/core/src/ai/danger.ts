import { getTile } from '../map.js';
import {
  DIR_VECTORS,
  Tile,
  type Bubble,
  type GameState,
} from '../types.js';

/** "물줄기가 올 예정이 없다"를 나타내는 값 */
export const SAFE = 0x7fffffff;

/**
 * 위험 맵 — 각 타일이 **몇 틱 뒤에** 물줄기에 덮이는가.
 *
 * 봇 품질의 대부분이 여기서 나온다. 단순히 "지금 물줄기가 있는가"가 아니라
 * "언제 위험해지는가"를 알아야 물풍선을 놓고 빠져나올 수 있는지 판단할 수 있다.
 * 연쇄 폭발까지 전개해야 한다 — 남의 물풍선이 내 물풍선을 앞당겨 터뜨린다.
 */
export function computeDanger(state: GameState, extra?: Bubble): Int32Array {
  const danger = new Int32Array(state.width * state.height).fill(SAFE);
  const bubbles = extra ? [...state.bubbles, extra] : state.bubbles;

  // 이미 깔린 물줄기는 지금 당장 위험하다
  for (const w of state.waters) {
    danger[w.ty * state.width + w.tx] = 0;
  }

  const times = detonationTimes(state, bubbles);
  for (const b of bubbles) {
    const t = times.get(b.id) ?? b.fuse;
    forEachBlastTile(state, bubbles, b, (tx, ty) => {
      const i = ty * state.width + tx;
      if ((danger[i] ?? SAFE) > t) danger[i] = t;
    });
  }
  return danger;
}

/**
 * 연쇄를 반영한 각 물풍선의 폭발 시각.
 * A의 물줄기가 B에 닿으면 B는 자기 신관과 A의 폭발 시각 중 빠른 쪽에 터진다.
 * 물풍선 수가 적으므로 고정점까지 단순 반복한다.
 */
function detonationTimes(state: GameState, bubbles: readonly Bubble[]): Map<number, number> {
  const times = new Map<number, number>();
  for (const b of bubbles) times.set(b.id, b.fuse);

  for (let guard = 0; guard < bubbles.length + 1; guard++) {
    let changed = false;
    for (const b of bubbles) {
      const t = times.get(b.id)!;
      forEachBlastTile(state, bubbles, b, (_tx, _ty, other) => {
        if (!other) return;
        if ((times.get(other.id) ?? Infinity) > t) {
          times.set(other.id, t);
          changed = true;
        }
      });
    }
    if (!changed) break;
  }
  return times;
}

/**
 * 물풍선 하나가 덮는 타일을 훑는다.
 * 정지 규칙은 explosion.ts와 같아야 한다 — 어긋나면 봇이 헛다리를 짚는다.
 */
function forEachBlastTile(
  state: GameState,
  bubbles: readonly Bubble[],
  bubble: Bubble,
  visit: (tx: number, ty: number, other?: Bubble) => void,
): void {
  visit(bubble.tx, bubble.ty);

  for (const [dx, dy] of DIR_VECTORS) {
    for (let dist = 1; dist <= bubble.power; dist++) {
      const tx = bubble.tx + dx * dist;
      const ty = bubble.ty + dy * dist;
      const tile = getTile(state, tx, ty);

      if (tile === Tile.Hard) break;
      if (tile === Tile.Soft) {
        visit(tx, ty);
        break;
      }

      const other = bubbles.find((o) => o.id !== bubble.id && o.tx === tx && o.ty === ty);
      visit(tx, ty, other);
      if (other) break;
    }
  }
}
