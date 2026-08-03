import { SUDDEN_DEATH_AT, SUDDEN_DEATH_INTERVAL } from '../constants.js';
import { playerTile } from '../geometry.js';
import { Phase, PlayerStatus, Tile, type GameState } from '../types.js';

/**
 * 서든데스 — 바깥부터 나선형으로 블록이 떨어져 맵을 좁힌다.
 *
 * 이게 없으면 경기가 끝나지 않는다. 헤드리스 봇 대전에서 확인된 사실이다:
 * 실력이 비슷한 넷이 붙으면 블록을 다 부순 뒤 서로 잘 피해다녀서
 * 2분이 지나도 승부가 나지 않았다(hard 봇 0/10 종료).
 */
export function applySuddenDeath(state: GameState): void {
  if (state.phase === Phase.Over) return;
  if (state.tick < SUDDEN_DEATH_AT) return;

  if (state.phase === Phase.Playing) state.phase = Phase.SuddenDeath;
  if ((state.tick - SUDDEN_DEATH_AT) % SUDDEN_DEATH_INTERVAL !== 0) return;

  const order = spiralOrder(state.width, state.height);
  if (state.suddenDeathIndex >= order.length) return;

  dropBlock(state, order[state.suddenDeathIndex++]!);
}

function dropBlock(state: GameState, index: number): void {
  const tx = index % state.width;
  const ty = (index - tx) / state.width;

  state.map[index] = Tile.Hard;
  state.items = state.items.filter((it) => it.tx !== tx || it.ty !== ty);
  state.waters = state.waters.filter((w) => w.tx !== tx || w.ty !== ty);
  state.bubbles = state.bubbles.filter((b) => {
    if (b.tx !== tx || b.ty !== ty) return true;
    const owner = state.players.find((p) => p.id === b.ownerId);
    if (owner) owner.bubblesPlaced = Math.max(0, owner.bubblesPlaced - 1);
    return false;
  });

  // 깔리면 즉사한다. 물방울에 갇혀 있어도, 무적이어도 예외가 없다
  for (const p of state.players) {
    if (!p.alive) continue;
    const [px, py] = playerTile(p);
    if (px === tx && py === ty) {
      p.alive = false;
      p.status = PlayerStatus.Normal;
      p.statusTicks = 0;
    }
  }
}

/**
 * 테두리 안쪽을 시계 방향 나선으로 훑는 순서.
 * 계산이 가벼워서 캐시하지 않는다 (간격마다 한 번만 호출된다).
 */
function spiralOrder(width: number, height: number): number[] {
  const order: number[] = [];
  let top = 1;
  let bottom = height - 2;
  let left = 1;
  let right = width - 2;

  while (top <= bottom && left <= right) {
    for (let x = left; x <= right; x++) order.push(top * width + x);
    top++;
    for (let y = top; y <= bottom; y++) order.push(y * width + right);
    right--;
    if (top <= bottom) {
      for (let x = right; x >= left; x--) order.push(bottom * width + x);
      bottom--;
    }
    if (left <= right) {
      for (let y = bottom; y >= top; y--) order.push(y * width + left);
      left++;
    }
  }
  return order;
}
