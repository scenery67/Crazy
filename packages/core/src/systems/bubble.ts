import { BUBBLE_FUSE } from '../constants.js';
import { playerTile } from '../geometry.js';
import { getTile } from '../map.js';
import { effectiveCapacity, effectivePower, isForcedToPlace } from '../stats.js';
import {
  PlayerStatus,
  Tile,
  type GameState,
  type InputFrame,
  type PlayerId,
} from '../types.js';

/**
 * 물풍선 설치와 신관.
 *
 * 설치는 항상 "플레이어의 중심 타일"에 놓인다. 플레이어가 두 타일에 걸쳐 있어도
 * 물풍선은 격자에 정확히 정렬되어야 폭발 범위 계산이 단순해진다.
 */
export function applyBubbles(state: GameState, inputs: Map<PlayerId, InputFrame>): void {
  // 기존 물풍선의 신관을 먼저 줄인다. 이번 틱에 새로 놓인 것은 온전한 수명을 갖는다
  for (const b of state.bubbles) b.fuse--;

  for (const p of state.players) {
    if (!p.alive) continue;
    // 갇힌 동안은 설치할 수 없다
    if (p.status === PlayerStatus.Trapped) continue;
    const wants = inputs.get(p.id)?.placeBubble || isForcedToPlace(p, state.tick);
    if (!wants) continue;
    if (p.bubblesPlaced >= effectiveCapacity(p)) continue;

    const [tx, ty] = playerTile(p);
    if (getTile(state, tx, ty) !== Tile.Empty) continue;
    if (state.bubbles.some((b) => b.tx === tx && b.ty === ty)) continue;

    state.bubbles.push({
      id: state.nextBubbleId++,
      ownerId: p.id,
      tx,
      ty,
      fuse: BUBBLE_FUSE,
      // 위력은 설치 시점에 고정된다. 물약이 끊겨도 이미 놓은 물풍선은 그대로다
      power: effectivePower(p),
    });
    p.bubblesPlaced++;
  }
}
