import { describe, expect, it } from 'vitest';
import { BOT_PRESETS, botInput, createBot } from '../src/ai/bot.js';
import { TICK_RATE } from '../src/constants.js';
import { createInitialState, soloTeams } from '../src/map.js';
import { ReplayRecorder, isReplay, playReplay } from '../src/replay.js';
import { step } from '../src/sim.js';
import { Dir, Phase, type GameState, type InputFrame } from '../src/types.js';

/** 봇 대전을 녹화하면서 진행한다 */
function recordBotMatch(seed: number, ticks: number) {
  const teams = soloTeams(4);
  const state = createInitialState({ seed, teams });
  const bots = state.players.map((p) => createBot(p.id, seed * 31 + p.id * 7 + 1, BOT_PRESETS.normal));
  const recorder = new ReplayRecorder(seed, teams);

  for (let tick = 0; tick < ticks; tick++) {
    const inputs: InputFrame[] = bots.map((b) => botInput(state, b));
    recorder.record(tick, inputs);
    step(state, inputs);
    if (state.phase === Phase.Over) break;
  }
  return { state, replay: recorder.finish() };
}

/** 상태 비교는 깊게 해야 의미가 있다 */
function summarize(s: GameState) {
  return {
    tick: s.tick,
    rng: s.rng,
    phase: s.phase,
    winnerTeamId: s.winnerTeamId,
    map: Array.from(s.map),
    players: s.players,
    bubbles: s.bubbles,
    waters: s.waters,
    items: s.items,
  };
}

describe('리플레이', () => {
  it('녹화한 대전을 그대로 재현한다', () => {
    const { state, replay } = recordBotMatch(2024, TICK_RATE * 60);
    expect(summarize(playReplay(replay))).toEqual(summarize(state));
  });

  it('여러 시드에서도 똑같이 재현된다', () => {
    for (const seed of [7, 1013, 31337]) {
      const { state, replay } = recordBotMatch(seed, TICK_RATE * 30);
      expect(summarize(playReplay(replay))).toEqual(summarize(state));
    }
  });

  it('물풍선 설치가 1틱 신호로 정확히 재현된다', () => {
    const teams = soloTeams(4);
    const state = createInitialState({ seed: 99, teams });
    const recorder = new ReplayRecorder(99, teams);

    // 같은 방향을 유지하면서 특정 틱에만 설치한다.
    // 설치를 "변경분"으로만 기록하면 이 신호가 사라진다
    for (let tick = 0; tick < 400; tick++) {
      const inputs: InputFrame[] = [
        { playerId: 0, move: Dir.Right, placeBubble: tick === 5 || tick === 200 },
      ];
      recorder.record(tick, inputs);
      step(state, inputs);
    }

    const replay = recorder.finish();
    expect(summarize(playReplay(replay))).toEqual(summarize(state));
  });

  it('입력이 바뀔 때만 기록해서 크기가 작다', () => {
    const { replay } = recordBotMatch(555, TICK_RATE * 60);
    const bytes = JSON.stringify(replay).length;
    // 매 틱 4명을 다 담으면 3600 x 4 = 14,400줄이 된다
    expect(replay.changes.length).toBeLessThan(3000);
    expect(bytes).toBeLessThan(120_000);
  });

  it('형식 검사가 엉뚱한 파일을 걸러낸다', () => {
    const { replay } = recordBotMatch(1, 60);
    expect(isReplay(replay)).toBe(true);
    expect(isReplay(null)).toBe(false);
    expect(isReplay({ v: 999, seed: 1, teams: [], changes: [], ticks: 0 })).toBe(false);
    expect(isReplay({ hello: 'world' })).toBe(false);
  });
});
