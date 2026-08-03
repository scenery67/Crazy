import {
  BOT_PRESETS,
  SUDDEN_DEATH_AT,
  TICK_RATE,
  botInput,
  createBot,
  createInitialState,
  soloTeams,
  step,
  type Bot,
  type GameState,
} from '@crazy/core';
import { Keyboard } from './input.js';
import { createViewport, render, type Viewport } from './render.js';

/** 키보드에 묶인 최대 인원. 0번=방향키, 1번=WASD */
const MAX_LOCAL = 2;
const TOTAL_PLAYERS = 4;

/** 사람이 잡는 인원. 나머지는 봇이 채운다 */
let localCount = 1;

const MS_PER_TICK = 1000 / TICK_RATE;
/** 탭 전환 등으로 크게 밀렸을 때 따라잡기를 포기하는 한계 */
const MAX_CATCHUP_TICKS = 5;

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('#game 캔버스를 찾을 수 없다');

const tickEl = document.querySelector<HTMLElement>('#tick');
const fpsEl = document.querySelector<HTMLElement>('#fps');
const seedEl = document.querySelector<HTMLElement>('#seed');
const aliveEl = document.querySelector<HTMLElement>('#alive');
const statsEl = document.querySelector<HTMLElement>('#stats');
const phaseEl = document.querySelector<HTMLElement>('#phase');

const PLAYER_COLORS = ['#ef5b5b', '#4fa3f7', '#5bd08a', '#f2c14e'];
const SKULL_LABELS = ['', '느림', '풍선↓', '강제설치'];

/** 능력치가 안 보이면 아이템을 먹었는지조차 알 수 없다 */
function renderStats(): void {
  if (!statsEl) return;
  statsEl.innerHTML = state.players
    .map((p, i) => {
      const fx: string[] = [];
      if (p.potionTicks > 0) fx.push('물약');
      if (p.skullTicks > 0) fx.push(SKULL_LABELS[p.skullKind] ?? '해골');
      if (p.needles > 0) fx.push(`바늘×${p.needles}`);
      const label = i < localCount ? `${i + 1}P` : 'BOT';
      return `<span class="p${p.alive ? '' : ' dead'}">
        <span class="name" style="color:${PLAYER_COLORS[i]}">${label}</span>
        <span>풍선 ${p.bubbleCapacity}</span>
        <span>파워 ${p.power}</span>
        <span>속도 ${p.speedLevel + 1}</span>
        ${fx.length ? `<span class="fx">${fx.join(' ')}</span>` : ''}
      </span>`;
    })
    .join('');
}

let seed = Math.floor(Math.random() * 0x7fffffff) || 1;
let state: GameState = createInitialState({ seed, teams: soloTeams(TOTAL_PLAYERS) });
let viewport: Viewport = createViewport(canvas, state);
let bots: Bot[] = [];

function spawnBots(): void {
  bots = [];
  for (let id = localCount; id < TOTAL_PLAYERS; id++) {
    bots.push(createBot(id, seed * 31 + id * 7 + 1, BOT_PRESETS.normal));
  }
}

function newMatch(): void {
  seed = Math.floor(Math.random() * 0x7fffffff) || 1;
  state = createInitialState({ seed, teams: soloTeams(TOTAL_PLAYERS) });
  viewport = createViewport(canvas!, state);
  spawnBots();
  if (seedEl) seedEl.textContent = String(seed);
}
if (seedEl) seedEl.textContent = String(seed);
spawnBots();

const keyboard = new Keyboard(MAX_LOCAL);

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') newMatch();
  if (e.code === 'Digit1' || e.code === 'Digit2') {
    localCount = e.code === 'Digit1' ? 1 : 2;
    newMatch();
  }
});

/**
 * 고정 타임스텝 루프.
 * 시뮬레이션은 정확히 60Hz로 돌고, 렌더는 화면 주사율대로 돈다.
 * 이 분리가 결정론의 전제조건이다.
 */
let accumulator = 0;
let lastTime = performance.now();
let fpsCounter = 0;
let fpsTimer = 0;

function frame(now: number): void {
  const delta = Math.min(now - lastTime, 250);
  lastTime = now;
  accumulator += delta;

  let ticksThisFrame = 0;
  while (accumulator >= MS_PER_TICK && ticksThisFrame < MAX_CATCHUP_TICKS) {
    // 사람과 봇이 같은 InputFrame을 내놓는다. 시뮬레이션은 둘을 구분하지 않는다
    const inputs = keyboard.poll().slice(0, localCount);
    for (const bot of bots) inputs.push(botInput(state, bot));
    state = step(state, inputs);
    accumulator -= MS_PER_TICK;
    ticksThisFrame++;
  }
  // 따라잡기를 포기한 만큼은 버린다 (누적되면 나선형으로 악화된다)
  if (ticksThisFrame >= MAX_CATCHUP_TICKS) accumulator = 0;

  render(viewport, state);

  fpsCounter++;
  fpsTimer += delta;
  if (fpsTimer >= 500) {
    if (fpsEl) fpsEl.textContent = String(Math.round((fpsCounter * 1000) / fpsTimer));
    fpsCounter = 0;
    fpsTimer = 0;
  }
  if (tickEl) tickEl.textContent = String(state.tick);
  if (aliveEl) aliveEl.textContent = String(state.players.filter((p) => p.alive).length);
  if (phaseEl) {
    const left = SUDDEN_DEATH_AT - state.tick;
    phaseEl.textContent = left > 0 ? `${Math.ceil(left / TICK_RATE)}s` : '서든데스';
    phaseEl.style.color = left > 0 ? '' : '#ff6b6b';
  }
  // 매 프레임 DOM을 새로 쓸 이유가 없다. 시뮬레이션이 진행된 프레임에만 갱신한다
  if (ticksThisFrame > 0) renderStats();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
