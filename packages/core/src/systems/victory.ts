import { Phase, type GameState } from '../types.js';

/** 무승부를 나타내는 winnerTeamId */
export const DRAW = -1;

/**
 * 승패 판정.
 *
 * 살아 있는 팀이 1개 이하로 줄면 끝난다. 개인전은 "전원이 서로 다른 팀"이므로
 * 별도 분기 없이 그대로 마지막 1인 판정이 된다.
 */
export function applyVictory(state: GameState): void {
  if (state.phase === Phase.Over) return;

  const aliveTeams = new Set<number>();
  for (const p of state.players) {
    if (p.alive) aliveTeams.add(p.teamId);
  }
  if (aliveTeams.size > 1) return;

  state.phase = Phase.Over;
  // 동시에 전멸하면 무승부
  state.winnerTeamId = aliveTeams.size === 1 ? [...aliveTeams][0]! : DRAW;
}
