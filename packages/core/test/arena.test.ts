import { describe, expect, it } from 'vitest';
import { BOT_PRESETS, botInput, createBot, type BotConfig } from '../src/ai/bot.js';
import { TICK_RATE } from '../src/constants.js';
import { createInitialState, soloTeams } from '../src/map.js';
import { step } from '../src/sim.js';
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
}

function runBotMatch(seed: number, config: BotConfig, maxTicks: number): MatchResult {
  const state = createInitialState({ seed, teams: soloTeams(4) });
  const bots = state.players.map((p) => createBot(p.id, seed * 31 + p.id * 7 + 1, config));

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

  it('hard 봇이 easy 봇보다 오래 산다', () => {
    const easy = summarize(BOT_PRESETS.easy, 12, MAX);
    const hard = summarize(BOT_PRESETS.hard, 12, MAX);
    expect(hard.avgTicks).toBeGreaterThan(easy.avgTicks);
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

  it('봇은 초반(서든데스 전)에 자멸로 전멸하지 않는다', () => {
    // 순찰 입력은 여기서 4명 전원이 죽었다. 탈출 경로 확인이 하는 일이 이것이다
    let wiped = 0;
    for (let seed = 1; seed <= 10; seed++) {
      if (runBotMatch(seed * 613, BOT_PRESETS.hard, TICK_RATE * 60).survivors === 0) wiped++;
    }
    expect(wiped).toBe(0);
  });
});
