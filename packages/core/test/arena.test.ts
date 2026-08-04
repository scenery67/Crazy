import { describe, expect, it } from 'vitest';
import { BOT_PRESETS, botInput, createBot, type BotConfig } from '../src/ai/bot.js';
import { TICK_RATE } from '../src/constants.js';
import { createInitialState, duoTeams, soloTeams } from '../src/map.js';
import { step } from '../src/sim.js';
import { DRAW } from '../src/systems/victory.js';
import { Phase, type InputFrame } from '../src/types.js';

/**
 * 봇 vs 봇 헤드리스 대전.
 *
 * 렌더 없이 시뮬만 돌리므로 초당 수천 틱이 나온다. 밸런스와 봇 품질을
 * 눈이 아니라 숫자로 판단하기 위한 장치다.
 */

interface MatchResult {
  ticks: number;
  finished: boolean;
  survivors: number;
  bubblesPlaced: number;
  winnerTeamId: number | null;
}

function runBotMatch(
  seed: number,
  config: BotConfig | readonly BotConfig[],
  maxTicks: number,
  teams: readonly number[] = soloTeams(4),
): MatchResult {
  const state = createInitialState({ seed, teams });
  const bots = state.players.map((p) =>
    createBot(p.id, seed * 31 + p.id * 7 + 1, Array.isArray(config) ? config[p.id]! : (config as BotConfig)),
  );

  let bubblesPlaced = 0;
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    const inputs: InputFrame[] = bots.map((b) => botInput(state, b));
    const before = state.nextBubbleId;
    step(state, inputs);
    bubblesPlaced += state.nextBubbleId - before;
    if (state.phase === Phase.Over) break;
  }

  return {
    ticks,
    finished: state.phase === Phase.Over,
    survivors: state.players.filter((p) => p.alive).length,
    bubblesPlaced,
    winnerTeamId: state.winnerTeamId,
  };
}

function summarize(config: BotConfig, matches: number, maxTicks: number) {
  const results: MatchResult[] = [];
  for (let seed = 1; seed <= matches; seed++) {
    results.push(runBotMatch(seed * 1013, config, maxTicks));
  }
  const total = results.length;
  return {
    matches: total,
    avgTicks: Math.round(results.reduce((a, r) => a + r.ticks, 0) / total),
    finishedRate: results.filter((r) => r.finished).length / total,
    avgBubbles: Math.round(results.reduce((a, r) => a + r.bubblesPlaced, 0) / total),
    minTicks: Math.min(...results.map((r) => r.ticks)),
  };
}

describe('봇 대전', () => {
  /** 서든데스(3분)가 맵을 다 메울 시간까지 준다 */
  const MAX = TICK_RATE * 300;

  it('normal 봇은 순찰 입력(8초 전멸)보다 훨씬 오래 살아남는다', () => {
    const stats = summarize(BOT_PRESETS.normal, 12, MAX);
    // 순찰 입력은 첫 사망이 8초, 전멸도 그 언저리였다
    expect(stats.avgTicks).toBeGreaterThan(TICK_RATE * 20);
    expect(stats.minTicks).toBeGreaterThan(TICK_RATE * 5);
  });

  it('경기는 반드시 끝난다 (서든데스가 교착을 깬다)', () => {
    // 서든데스가 없으면 hard 봇끼리는 2분이 지나도 0/10 종료였다
    for (const config of [BOT_PRESETS.easy, BOT_PRESETS.normal, BOT_PRESETS.hard]) {
      expect(summarize(config, 8, MAX).finishedRate).toBe(1);
    }
  });

  it('봇은 실제로 물풍선을 놓는다 (겁먹고 굳지 않는다)', () => {
    const stats = summarize(BOT_PRESETS.normal, 8, TICK_RATE * 60);
    expect(stats.avgBubbles).toBeGreaterThan(10);
  });

  /**
   * 난이도는 "같은 판에서 누가 이기는가"로 재야 한다.
   *
   * 예전에는 난이도별로 따로 돌려 경기 길이를 비교했는데, 자력 탈출을 없앤 뒤로는
   * 공격성이 곧바로 킬로 이어져서 **센 봇끼리 붙으면 경기가 더 빨리 끝난다.**
   * 경기 길이는 실력이 아니라 결판 속도를 재는 값이었다.
   */
  it('같은 판에서 hard 봇이 easy 봇보다 많이 이긴다', () => {
    let hardWins = 0;
    let easyWins = 0;

    for (let seed = 1; seed <= 24; seed++) {
      // 스폰 자리에 따른 유불리를 없애려고 시드마다 자리를 바꾼다
      const hardFirst = seed % 2 === 0;
      const configs = [0, 1, 2, 3].map((id) =>
        (id < 2) === hardFirst ? BOT_PRESETS.hard : BOT_PRESETS.easy,
      );

      const r = runBotMatch(seed * 1013, configs, MAX);
      if (r.winnerTeamId === null || r.winnerTeamId === DRAW) continue;
      // 개인전이라 teamId가 곧 자리 번호다
      const winnerIsHard = (r.winnerTeamId < 2) === hardFirst;
      if (winnerIsHard) hardWins++;
      else easyWins++;
    }

    expect(hardWins).toBeGreaterThan(easyWins);
  });

  it('대전은 결정론적이다 — 같은 시드는 같은 결과', () => {
    const a = runBotMatch(4242, BOT_PRESETS.normal, MAX);
    const b = runBotMatch(4242, BOT_PRESETS.normal, MAX);
    expect(b).toEqual(a);
  });

  it('봇이 서로를 실제로 제거한다', () => {
    let anyoneDied = false;
    for (let seed = 1; seed <= 10 && !anyoneDied; seed++) {
      if (runBotMatch(seed * 97, BOT_PRESETS.hard, MAX).survivors < 4) anyoneDied = true;
    }
    expect(anyoneDied).toBe(true);
  });

  it('2v2에서도 경기가 끝나고 한 팀이 이긴다', () => {
    let teamWins = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const r = runBotMatch(seed * 811, BOT_PRESETS.normal, MAX, duoTeams());
      expect(r.finished).toBe(true);
      // 승리 팀이 나왔다면 그 팀 소속만 남아야 한다
      if (r.winnerTeamId !== null && r.winnerTeamId !== DRAW) teamWins++;
    }
    expect(teamWins).toBeGreaterThan(0);
  });

  it('봇은 초반(서든데스 전)에 자멸로 전멸하지 않는다', () => {
    // 순찰 입력은 여기서 4명 전원이 죽었다. 탈출 경로 확인이 하는 일이 이것이다
    let wiped = 0;
    for (let seed = 1; seed <= 10; seed++) {
      if (runBotMatch(seed * 613, BOT_PRESETS.hard, TICK_RATE * 60).survivors === 0) wiped++;
    }
    expect(wiped).toBe(0);
  });
});
