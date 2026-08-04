import {
  BOT_PRESETS,
  DEFAULT_PORT,
  DEFAULT_ROOM,
  ReplayReader,
  ReplayRecorder,
  SUDDEN_DEATH_AT,
  createReplayState,
  isReplay,
  normalizeRoom,
  TICK_RATE,
  botInput,
  createBot,
  createInitialState,
  duoTeams,
  soloTeams,
  step,
  type Bot,
  type GameState,
  type InputFrame,
  type TeamId,
} from '@crazy/core';
import { GameAudio } from './audio.js';
import { Corpses } from './corpses.js';
import { EventDetector } from './events.js';
import { Keyboard, TouchPad } from './input.js';
import { OnlineSession } from './online.js';
import { Particles } from './particles.js';
import { TILE_PX, createViewport, render, type Viewport } from './render.js';
import { loadSprites, type SpriteSet } from './sprites.js';

/** 키보드에 묶인 최대 인원. 0번=방향키, 1번=WASD */
const MAX_LOCAL = 2;
const TOTAL_PLAYERS = 4;

type Mode = 'solo' | 'duo';
type Difficulty = keyof typeof BOT_PRESETS;

/** 사람이 잡는 인원. 나머지는 봇이 채운다 */
let localCount = 1;
let mode: Mode = 'solo';
let difficulty: Difficulty = 'normal';

/**
 * 개인전은 "전원이 서로 다른 팀"인 특수 케이스다.
 * 2v2는 대각선끼리 묶여서 시작부터 붙어 있지 않다.
 */
function teamsForMode(): TeamId[] {
  return mode === 'duo' ? duoTeams() : soloTeams(TOTAL_PLAYERS);
}

const TEAM_LABELS = ['A', 'B', 'C', 'D'];

/** 소리·파티클은 시뮬레이션을 건드리지 않는다. 상태 차이에서 읽어낼 뿐이다 */
const events = new EventDetector();
const audio = new GameAudio();
const particles = new Particles();
const corpses = new Corpses();

/**
 * 리플레이는 시드와 입력 로그만 저장한다 — 결정론이라 상태는 필요 없다.
 * 온라인에서는 녹화하지 않는다. 클라이언트가 아는 것은 자기 입력뿐이라
 * 남의 입력을 담을 수 없기 때문이다.
 */
let recorder: ReplayRecorder | null = null;
let playback: { reader: ReplayReader; ticks: number } | null = null;

/**
 * 사람이 잡고 있는 자리. 렌더러가 사용자 캐릭터와 봇 캐릭터를 갈라 그리는 데 쓴다.
 * 온라인에서는 내 자리 하나뿐이고, 관전 중이면 비어 있다.
 */
function localPlayerIds(): ReadonlySet<number> {
  // 재생 중에는 내가 조종하는 자리가 없다
  if (playback) return new Set();
  if (online.isLive) {
    return online.playerId === null ? new Set() : new Set([online.playerId]);
  }
  return new Set(Array.from({ length: localCount }, (_, i) => i));
}

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
const corrEl = document.querySelector<HTMLElement>('#corr');
const corrBoxEl = document.querySelector<HTMLElement>('#corrbox');
const muteEl = document.querySelector<HTMLElement>('#mute');

const PLAYER_COLORS = ['#ef5b5b', '#4fa3f7', '#5bd08a', '#f2c14e'];
const SKULL_LABELS = ['', '느림', '풍선↓', '강제설치'];

/** 능력치가 안 보이면 아이템을 먹었는지조차 알 수 없다 */
function renderStats(shown: GameState): void {
  if (!statsEl) return;
  statsEl.innerHTML = shown.players
    .map((p, i) => {
      const fx: string[] = [];
      if (p.potionTicks > 0) fx.push('물약');
      if (p.skullTicks > 0) fx.push(SKULL_LABELS[p.skullKind] ?? '해골');
      if (p.needles > 0) fx.push(`바늘×${p.needles}`);
      // 온라인에서는 내 자리만 표시하면 된다 — 나머지는 사람인지 봇인지 알 수 없다
      const label = online.isLive
        ? p.id === online.playerId
          ? '나'
          : `${p.id + 1}P`
        : i < localCount
          ? `${i + 1}P`
          : 'BOT';
      // 2v2에서는 누가 아군인지 한눈에 보여야 구출 플레이가 성립한다
      const team = mode === 'duo' ? `<span class="team">${TEAM_LABELS[p.teamId]}</span>` : '';
      return `<span class="p${p.alive ? '' : ' dead'}">
        ${team}
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
const initialTeams = soloTeams(TOTAL_PLAYERS);
let state: GameState = createInitialState({ seed, teams: initialTeams });
/**
 * 스프라이트는 저장소에 없다(개인 사용 전용). 없으면 null이 되고
 * 렌더러가 도형 모드로 그린다 — 공개 배포본이 이 경로를 탄다.
 */
let sprites: SpriteSet | null = null;
let viewport: Viewport = createViewport(canvas, state, sprites);
let bots: Bot[] = [];

// 첫 판도 녹화 대상이다
recorder = new ReplayRecorder(seed, initialTeams);

void loadSprites().then((loaded) => {
  sprites = loaded;
  viewport = createViewport(canvas, state, sprites);
});

function spawnBots(): void {
  bots = [];
  for (let id = localCount; id < TOTAL_PLAYERS; id++) {
    bots.push(createBot(id, seed * 31 + id * 7 + 1, BOT_PRESETS[difficulty]));
  }
}

function newMatch(): void {
  seed = Math.floor(Math.random() * 0x7fffffff) || 1;
  const teams = teamsForMode();
  state = createInitialState({ seed, teams });
  viewport = createViewport(canvas!, state, sprites);
  spawnBots();
  playback = null;
  recorder = new ReplayRecorder(seed, teams);
  if (replayStatusEl) replayStatusEl.textContent = '';
  // 새 판의 상태 차이를 이벤트로 읽으면 소리와 파티클이 한꺼번에 터진다
  events.reset();
  particles.clear();
  corpses.clear();
  if (seedEl) seedEl.textContent = String(seed);
  syncSetup();
}
if (seedEl) seedEl.textContent = String(seed);
spawnBots();

const keyboard = new Keyboard(MAX_LOCAL);

/** 터치 기기에서만 조작판을 띄운다. 데스크톱에서는 화면만 가린다 */
const touchEl = document.querySelector<HTMLElement>('#touch');
const stickEl = document.querySelector<HTMLElement>('#stick');
const knobEl = document.querySelector<HTMLElement>('#knob');
const bombEl = document.querySelector<HTMLElement>('#bombbtn');

let touchPad: TouchPad | null = null;
if (TouchPad.supported && touchEl && stickEl && knobEl && bombEl) {
  touchEl.hidden = false;
  document.body.classList.add('has-touch');
  touchPad = new TouchPad(stickEl, knobEl, bombEl);
}

/** 키보드와 터치를 합친다. 어느 쪽으로 조작해도 1P가 움직인다 */
function localInputs(): InputFrame[] {
  const frames = keyboard.poll().slice(0, localCount);
  const touch = touchPad?.poll();
  const first = frames[0];
  if (touch && first) {
    if (touch.move !== null) first.move = touch.move;
    if (touch.place) first.placeBubble = true;
  }
  return frames;
}

const setupEl = document.querySelector<HTMLElement>('#setup');

/** 현재 설정에 맞춰 버튼 눌림 상태를 표시한다 */
function syncSetup(): void {
  const current: Record<string, string> = {
    mode,
    local: String(localCount),
    difficulty,
  };
  setupEl?.querySelectorAll<HTMLButtonElement>('button[data-value]').forEach((btn) => {
    const key = btn.closest<HTMLElement>('.group')?.dataset['key'];
    if (!key) return;
    btn.setAttribute('aria-pressed', String(current[key] === btn.dataset['value']));
  });
}

setupEl?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-value]');
  const key = btn?.closest<HTMLElement>('.group')?.dataset['key'];
  const value = btn?.dataset['value'];
  if (!btn || !key || !value) return;

  if (key === 'mode') mode = value as Mode;
  if (key === 'local') localCount = Number(value);
  if (key === 'difficulty') difficulty = value as Difficulty;

  // 포커스가 남아 있으면 Space(물풍선)가 이 버튼을 다시 누른다
  btn.blur();
  newMatch();
});
syncSetup();

// 브라우저는 사용자가 화면을 건드리기 전에는 소리를 못 내게 한다
for (const evt of ['keydown', 'pointerdown'] as const) {
  window.addEventListener(evt, () => audio.unlock(), { once: false });
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    audio.muted = !audio.muted;
    if (muteEl) muteEl.textContent = audio.muted ? '음소거' : '켜짐';
  }
  if (online.isLive || online.status === 'connecting') return; // 온라인에서는 서버가 판을 정한다
  if (e.code === 'KeyR') newMatch();
  if (e.code === 'Digit1' || e.code === 'Digit2') {
    localCount = e.code === 'Digit1' ? 1 : 2;
    newMatch();
  }
});

// ─────────────────────────── 온라인 ───────────────────────────

const serverEl = document.querySelector<HTMLInputElement>('#server');
const roomEl = document.querySelector<HTMLInputElement>('#room');
const connectEl = document.querySelector<HTMLButtonElement>('#connect');
const netStatusEl = document.querySelector<HTMLElement>('#netstatus');

const online = new OnlineSession(() => syncNet());

/**
 * 배포 빌드에는 서버 주소를 주입하고, 없으면 같은 PC에서 띄운 서버를 가리킨다.
 * https 페이지에서는 ws://가 차단되므로 배포 주소는 반드시 wss:// 여야 한다.
 */
if (serverEl) {
  const injected = import.meta.env.VITE_SERVER_URL;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.hostname || 'localhost';
  serverEl.value = injected || `${scheme}://${host}:${DEFAULT_PORT}`;
}
// 주소에 ?room=ABCD 가 붙어 있으면 그 방으로 — 링크만 보내면 같이 들어올 수 있다
if (roomEl) {
  roomEl.value = normalizeRoom(new URLSearchParams(location.search).get('room')) || DEFAULT_ROOM;
}

function syncNet(): void {
  const busy = online.status === 'connected' || online.status === 'connecting';
  if (connectEl) connectEl.textContent = busy ? '연결 끊기' : '접속';
  if (serverEl) serverEl.disabled = busy;
  if (roomEl) roomEl.disabled = busy;
  if (netStatusEl) {
    netStatusEl.textContent = online.message;
    netStatusEl.className =
      online.status === 'error' ? 'bad' : online.status === 'connected' ? 'ok' : '';
  }
  // 온라인 중에는 로컬 설정이 의미가 없다
  setupEl?.classList.toggle('locked', busy);
}

connectEl?.addEventListener('click', () => {
  connectEl.blur();
  if (online.status === 'connected' || online.status === 'connecting') {
    online.disconnect();
    syncNet();
    newMatch();
    return;
  }
  online.connect(
    serverEl?.value.trim() || `ws://localhost:${DEFAULT_PORT}`,
    normalizeRoom(roomEl?.value),
  );
});
syncNet();

// ─────────────────────────── 리플레이 ───────────────────────────

const saveReplayEl = document.querySelector<HTMLButtonElement>('#savereplay');
const loadReplayEl = document.querySelector<HTMLButtonElement>('#loadreplay');
const replayFileEl = document.querySelector<HTMLInputElement>('#replayfile');
const replayStatusEl = document.querySelector<HTMLElement>('#replaystatus');

saveReplayEl?.addEventListener('click', () => {
  saveReplayEl.blur();
  if (!recorder) {
    if (replayStatusEl) replayStatusEl.textContent = '온라인·재생 중에는 저장할 수 없습니다';
    return;
  }
  const replay = recorder.finish();
  const blob = new Blob([JSON.stringify(replay)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `crazy-${replay.seed}.json`;
  link.click();
  URL.revokeObjectURL(url);
  if (replayStatusEl) {
    replayStatusEl.textContent = `저장 ${Math.floor(replay.ticks / TICK_RATE)}s · ${Math.round(blob.size / 1024)}KB`;
  }
});

loadReplayEl?.addEventListener('click', () => {
  loadReplayEl.blur();
  replayFileEl?.click();
});

replayFileEl?.addEventListener('change', () => {
  const file = replayFileEl.files?.[0];
  replayFileEl.value = ''; // 같은 파일을 다시 열 수 있게 한다
  if (!file) return;

  void file.text().then((text) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      if (replayStatusEl) replayStatusEl.textContent = '읽을 수 없는 파일입니다';
      return;
    }
    if (!isReplay(parsed)) {
      if (replayStatusEl) replayStatusEl.textContent = '리플레이 파일이 아닙니다';
      return;
    }

    online.disconnect();
    syncNet();
    state = createReplayState(parsed);
    viewport = createViewport(canvas, state, sprites);
    playback = { reader: new ReplayReader(parsed), ticks: parsed.ticks };
    recorder = null;
    bots = [];
    events.reset();
    particles.clear();
    corpses.clear();
    seed = parsed.seed;
    if (seedEl) seedEl.textContent = String(seed);
  });
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
    if (online.status === 'connected') {
      // 서버가 진실이지만 내 입력은 즉시 반영한다. 스냅샷이 올 때마다 되감아 재조정된다
      const local = localInputs()[0];
      if (local) online.tick(local.move, local.placeBubble);
    } else if (playback) {
      if (state.tick < playback.ticks) {
        state = step(state, playback.reader.inputsFor(state.tick));
        if (replayStatusEl) {
          replayStatusEl.textContent = `재생 ${Math.floor(state.tick / TICK_RATE)}s / ${Math.floor(playback.ticks / TICK_RATE)}s`;
        }
      } else if (replayStatusEl) {
        replayStatusEl.textContent = '재생 끝 (R로 새 판)';
      }
    } else {
      // 사람과 봇이 같은 InputFrame을 내놓는다. 시뮬레이션은 둘을 구분하지 않는다
      const inputs = localInputs();
      for (const bot of bots) inputs.push(botInput(state, bot));
      // step이 tick을 올리므로 반드시 그 전에 기록해야 한다
      recorder?.record(state.tick, inputs);
      state = step(state, inputs);
    }
    accumulator -= MS_PER_TICK;
    ticksThisFrame++;
  }
  // 따라잡기를 포기한 만큼은 버린다 (누적되면 나선형으로 악화된다)
  if (ticksThisFrame >= MAX_CATCHUP_TICKS) accumulator = 0;

  const shown = online.isLive ? (online.view(now) ?? state) : state;

  // 시뮬레이션이 진행된 프레임에만 이벤트를 읽고 파티클을 흘린다.
  // 렌더 주사율에 묶이면 화면이 빠른 기기에서 파티클이 더 빨리 사라진다
  if (ticksThisFrame > 0) {
    const locals = localPlayerIds();
    const fired = events.detect(shown, locals);
    if (fired.length > 0) {
      audio.play(fired);
      particles.spawn(fired, TILE_PX);
      for (const e of fired) {
        if (e.t === 'death') corpses.spawn(e.x, e.y, TILE_PX);
      }
    }
    for (let i = 0; i < ticksThisFrame; i++) {
      particles.update();
      corpses.update();
    }
  }

  render(viewport, shown, localPlayerIds());
  corpses.draw(viewport.ctx, viewport.sprites);
  particles.draw(viewport.ctx);

  fpsCounter++;
  fpsTimer += delta;
  if (fpsTimer >= 500) {
    if (fpsEl) fpsEl.textContent = String(Math.round((fpsCounter * 1000) / fpsTimer));
    fpsCounter = 0;
    fpsTimer = 0;
  }
  if (tickEl) tickEl.textContent = String(shown.tick);
  if (aliveEl) aliveEl.textContent = String(shown.players.filter((p) => p.alive).length);
  if (phaseEl) {
    const left = SUDDEN_DEATH_AT - shown.tick;
    phaseEl.textContent = left > 0 ? `${Math.ceil(left / TICK_RATE)}s` : '서든데스';
    phaseEl.style.color = left > 0 ? '' : '#ff6b6b';
  }
  // 예측이 서버와 얼마나 어긋났는지. 계속 크면 예측이 깨졌다는 뜻이다
  if (corrBoxEl) corrBoxEl.hidden = !online.isLive;
  if (corrEl && online.isLive) corrEl.textContent = String(online.lastCorrection);

  // 매 프레임 DOM을 새로 쓸 이유가 없다. 시뮬레이션이 진행된 프레임에만 갱신한다
  if (ticksThisFrame > 0) renderStats(shown);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
