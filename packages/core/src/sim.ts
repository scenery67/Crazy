import { applyBubbles } from './systems/bubble.js';
import { applyExplosions } from './systems/explosion.js';
import { applyItems } from './systems/item.js';
import { applyMovement } from './systems/movement.js';
import { applySuddenDeath } from './systems/suddenDeath.js';
import { applyTrap } from './systems/trap.js';
import { applyVictory } from './systems/victory.js';
import type { GameState, InputFrame, PlayerId } from './types.js';

/**
 * 시뮬레이션 한 틱.
 *
 * 규칙:
 *  - 결정론적이어야 한다. Math.random(), Date.now(), DOM, I/O 금지.
 *    무작위성은 오직 state.rng에서만 나온다.
 *  - 부동소수점 좌표 금지. 모든 위치/속도는 정수 sub-unit.
 *
 * 성능을 위해 state를 제자리에서 변경한다(순수 함수가 아니다).
 * 롤백·리플레이에 필요한 스냅샷은 cloneState()로 명시적으로 뜬다.
 * 결정론만 지켜지면 넷코드에는 이쪽이 오히려 유리하다.
 *
 * 현재 구현 상태: M5 (이동 / 물풍선 / 폭발 / 트랩 / 아이템 / 승패).
 */
export function step(state: GameState, inputs: readonly InputFrame[]): GameState {
  const byPlayer = new Map<PlayerId, InputFrame>();
  for (const frame of inputs) byPlayer.set(frame.playerId, frame);

  // 시스템 실행 순서. 순서가 곧 규칙이므로 함부로 바꾸지 않는다.
  // 특히 explosion이 trap보다 먼저 와야, 이번 틱에 생긴 물줄기가
  // 같은 틱에 피격 판정을 받는다.
  applyMovement(state, byPlayer);
  applyBubbles(state, byPlayer);
  applyExplosions(state);
  // 아이템은 트랩보다 먼저다 — 방패를 밟은 그 틱에 곧바로 보호받아야 한다
  applyItems(state);
  applyTrap(state);
  applySuddenDeath(state);
  applyVictory(state);

  state.tick++;
  return state;
}

/** 롤백 넷코드·리플레이·봇 탐색용 스냅샷 */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    map: state.map.slice(),
    players: state.players.map((p) => ({ ...p })),
    bubbles: state.bubbles.map((b) => ({ ...b })),
    waters: state.waters.map((w) => ({ ...w })),
    items: state.items.map((i) => ({ ...i })),
  };
}

/** 편의 함수: 여러 틱을 한 번에 진행 (테스트/헤드리스 대전용) */
export function stepMany(
  state: GameState,
  ticks: number,
  inputsFor: (tick: number) => readonly InputFrame[],
): GameState {
  let s = state;
  for (let i = 0; i < ticks; i++) {
    s = step(s, inputsFor(s.tick));
  }
  return s;
}
