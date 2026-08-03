import {
  BUBBLE_FUSE,
  DIR_VECTORS,
  DRAW,
  ESCAPE_THRESHOLD,
  ItemKind,
  PLAYER_HITBOX,
  Phase,
  PlayerStatus,
  TILE,
  TRAP_DURATION,
  Tile,
  WATER_DURATION,
  WaterKind,
  type GameState,
  type Player,
} from '@crazy/core';

/** 타일 하나를 그릴 픽셀 크기 */
export const TILE_PX = 44;

const PALETTE = {
  floorA: '#1b2a3a',
  floorB: '#1f3145',
  hardTop: '#5c7590',
  hardBody: '#3d5266',
  hardEdge: '#2a3947',
  softTop: '#8a6a44',
  softBody: '#6b5133',
  softEdge: '#4a3722',
  gridLine: 'rgb(255 255 255 / 0.03)',
  bubbleBody: '#4bb3e8',
  bubbleRim: '#a8e4ff',
  water: '#7fe3ff',
  waterCore: '#ffffff',
} as const;

/** 플레이어 id별 고유색 */
const PLAYER_COLORS = ['#ef5b5b', '#4fa3f7', '#5bd08a', '#f2c14e'] as const;
/** 팀 색 — 개인전에서는 플레이어 색과 사실상 같아 보인다 */
const TEAM_COLORS = ['#ff8a8a', '#8ac4ff', '#8ae8b4', '#ffdf8a'] as const;

/** sub-unit 좌표 → 캔버스 픽셀 */
function px(coord: number): number {
  return (coord / TILE) * TILE_PX;
}

export interface Viewport {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export function createViewport(canvas: HTMLCanvasElement, state: GameState): Viewport {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D 컨텍스트를 만들 수 없다');

  const w = state.width * TILE_PX;
  const h = state.height * TILE_PX;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return { canvas, ctx };
}

/**
 * 상태를 읽기만 해서 그린다. 렌더러는 시뮬레이션을 절대 변경하지 않는다.
 * 보간(interpolation)은 나중에 이 레이어에서만 처리한다.
 */
export function render(vp: Viewport, state: GameState): void {
  const { ctx } = vp;
  ctx.clearRect(0, 0, state.width * TILE_PX, state.height * TILE_PX);

  drawTiles(ctx, state);
  drawItems(ctx, state);
  drawBubbles(ctx, state);
  drawWaters(ctx, state);
  drawPlayers(ctx, state);
  if (state.phase === Phase.Over) drawResult(ctx, state);
}

function drawTiles(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (let ty = 0; ty < state.height; ty++) {
    for (let tx = 0; tx < state.width; tx++) {
      const x = tx * TILE_PX;
      const y = ty * TILE_PX;
      const tile = state.map[ty * state.width + tx];

      // 바닥은 항상 먼저 깐다 — 블록이 파괴되면 그대로 드러난다
      ctx.fillStyle = (tx + ty) % 2 === 0 ? PALETTE.floorA : PALETTE.floorB;
      ctx.fillRect(x, y, TILE_PX, TILE_PX);

      if (tile === Tile.Hard) {
        drawBlock(ctx, x, y, PALETTE.hardTop, PALETTE.hardBody, PALETTE.hardEdge);
      } else if (tile === Tile.Soft) {
        drawBlock(ctx, x, y, PALETTE.softTop, PALETTE.softBody, PALETTE.softEdge);
      } else {
        ctx.strokeStyle = PALETTE.gridLine;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE_PX - 1, TILE_PX - 1);
      }
    }
  }
}

/** 윗면 하이라이트 + 몸통 + 외곽선으로 살짝 입체감을 준다 */
function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  top: string,
  body: string,
  edge: string,
): void {
  const inset = 2;
  const w = TILE_PX - inset * 2;
  const h = TILE_PX - inset * 2;
  const lip = Math.round(h * 0.22);

  ctx.fillStyle = body;
  ctx.fillRect(x + inset, y + inset, w, h);
  ctx.fillStyle = top;
  ctx.fillRect(x + inset, y + inset, w, lip);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + inset + 1, y + inset + 1, w - 2, h - 2);
}

/** 아이템 종류별 배경색. 종류를 색으로 먼저 구분하고, 도형으로 확인시킨다 */
const ITEM_COLORS: Record<number, string> = {
  [ItemKind.Bubble]: '#2f7fb8',
  [ItemKind.Power]: '#c9552f',
  [ItemKind.Roller]: '#2f9e63',
  [ItemKind.Needle]: '#6b7280',
  [ItemKind.Potion]: '#7c4dbd',
  [ItemKind.Skull]: '#4a4a55',
  [ItemKind.Shield]: '#2f8fa8',
};

function drawItems(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const item of state.items) {
    // 살짝 위아래로 떠서 바닥 무늬와 구분된다
    const bob = Math.sin((state.tick + item.tx * 7 + item.ty * 13) / 18) * 2;
    const cx = (item.tx + 0.5) * TILE_PX;
    const cy = (item.ty + 0.5) * TILE_PX + bob;
    const half = TILE_PX * 0.3;

    ctx.fillStyle = 'rgb(0 0 0 / 0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, (item.ty + 0.5) * TILE_PX + half + 4, half * 0.8, half * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = ITEM_COLORS[item.kind] ?? '#888';
    roundRect(ctx, cx - half, cy - half, half * 2, half * 2, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgb(255 255 255 / 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    drawItemGlyph(ctx, item.kind, cx, cy, half);
  }
}

function drawItemGlyph(
  ctx: CanvasRenderingContext2D,
  kind: number,
  cx: number,
  cy: number,
  r: number,
): void {
  switch (kind) {
    case ItemKind.Bubble:
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case ItemKind.Power:
      // 바깥으로 뻗는 십자 — 물줄기가 길어진다는 뜻
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.62, cy);
      ctx.lineTo(cx + r * 0.62, cy);
      ctx.moveTo(cx, cy - r * 0.62);
      ctx.lineTo(cx, cy + r * 0.62);
      ctx.stroke();
      break;
    case ItemKind.Roller:
      // 진행 방향 갈매기 두 개
      for (const dx of [-r * 0.34, r * 0.14]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx, cy - r * 0.42);
        ctx.lineTo(cx + dx + r * 0.34, cy);
        ctx.lineTo(cx + dx, cy + r * 0.42);
        ctx.stroke();
      }
      break;
    case ItemKind.Needle:
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.4, cy + r * 0.5);
      ctx.lineTo(cx + r * 0.42, cy - r * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + r * 0.42, cy - r * 0.5, r * 0.16, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case ItemKind.Potion:
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.2, cy - r * 0.55);
      ctx.lineTo(cx - r * 0.2, cy - r * 0.15);
      ctx.lineTo(cx - r * 0.5, cy + r * 0.5);
      ctx.lineTo(cx + r * 0.5, cy + r * 0.5);
      ctx.lineTo(cx + r * 0.2, cy - r * 0.15);
      ctx.lineTo(cx + r * 0.2, cy - r * 0.55);
      ctx.closePath();
      ctx.fill();
      break;
    case ItemKind.Skull:
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.1, r * 0.45, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(cx - r * 0.45, cy - r * 0.1, r * 0.9, r * 0.4);
      ctx.fillStyle = '#2b2b33';
      ctx.beginPath();
      ctx.arc(cx - r * 0.2, cy - r * 0.16, r * 0.13, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.2, cy - r * 0.16, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    case ItemKind.Shield:
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.55);
      ctx.lineTo(cx + r * 0.48, cy - r * 0.28);
      ctx.lineTo(cx + r * 0.48, cy + r * 0.18);
      ctx.lineTo(cx, cy + r * 0.58);
      ctx.lineTo(cx - r * 0.48, cy + r * 0.18);
      ctx.lineTo(cx - r * 0.48, cy - r * 0.28);
      ctx.closePath();
      ctx.stroke();
      break;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBubbles(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const b of state.bubbles) {
    const cx = (b.tx + 0.5) * TILE_PX;
    const cy = (b.ty + 0.5) * TILE_PX;

    // 터질 때가 가까울수록 빠르게 두근거린다 — 남은 시간을 소리 없이 알려준다
    const urgency = 1 - Math.min(b.fuse, BUBBLE_FUSE) / BUBBLE_FUSE;
    const period = 26 - urgency * 18;
    const pulse = Math.sin((state.tick / period) * Math.PI * 2) * (0.05 + urgency * 0.09);
    const r = TILE_PX * (0.36 + pulse);

    ctx.fillStyle = 'rgb(0 0 0 / 0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.7, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = PALETTE.bubbleBody;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = PALETTE.bubbleRim;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 하이라이트
    ctx.fillStyle = 'rgb(255 255 255 / 0.55)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.32, cy - r * 0.34, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWaters(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const w of state.waters) {
    const x = w.tx * TILE_PX;
    const y = w.ty * TILE_PX;
    // 끝날 때 서서히 옅어진다
    const life = w.ticksLeft / WATER_DURATION;
    const alpha = Math.min(1, life * 1.8);

    ctx.save();
    ctx.globalAlpha = alpha;

    const horizontal = w.kind === WaterKind.Center || isHorizontal(w.dir);
    const vertical = w.kind === WaterKind.Center || !isHorizontal(w.dir);
    const thick = TILE_PX * 0.72;
    const core = TILE_PX * 0.34;
    const pad = (TILE_PX - thick) / 2;
    const corePad = (TILE_PX - core) / 2;

    ctx.fillStyle = PALETTE.water;
    if (horizontal) ctx.fillRect(x, y + pad, TILE_PX, thick);
    if (vertical) ctx.fillRect(x + pad, y, thick, TILE_PX);

    ctx.fillStyle = PALETTE.waterCore;
    ctx.globalAlpha = alpha * 0.75;
    if (horizontal) ctx.fillRect(x, y + corePad, TILE_PX, core);
    if (vertical) ctx.fillRect(x + corePad, y, core, TILE_PX);

    ctx.restore();
  }
}

function isHorizontal(dir: number | null): boolean {
  if (dir === null) return true;
  const [dx] = DIR_VECTORS[dir] ?? [0, 0];
  return dx !== 0;
}

function drawPlayers(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const p of state.players) {
    if (!p.alive) continue;

    const cx = px(p.x);
    const cy = px(p.y);
    const r = px(PLAYER_HITBOX) / 2;

    // 무적 중에는 깜빡인다
    const blinking = p.status === PlayerStatus.Invulnerable && Math.floor(state.tick / 4) % 2 === 0;
    ctx.save();
    if (blinking) ctx.globalAlpha = 0.4;

    ctx.fillStyle = 'rgb(0 0 0 / 0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.75, r * 0.85, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const trapped = p.status === PlayerStatus.Trapped;
    const bodyR = trapped ? r * 0.6 : r;

    ctx.fillStyle = PLAYER_COLORS[p.id % PLAYER_COLORS.length] ?? '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, bodyR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = TEAM_COLORS[p.teamId % TEAM_COLORS.length] ?? '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, bodyR + 2, 0, Math.PI * 2);
    ctx.stroke();

    if (!trapped) {
      const [dx, dy] = DIR_VECTORS[p.facing] ?? [0, 1];
      ctx.fillStyle = 'rgb(255 255 255 / 0.9)';
      ctx.beginPath();
      ctx.arc(cx + dx * r * 0.45, cy + dy * r * 0.45, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    if (trapped) drawTrapBubble(ctx, p, cx, cy, r);
    else drawEffects(ctx, state, p, cx, cy, r);
  }
}

/**
 * 일시 효과 표시.
 * 물약과 해골은 능력치를 크게 바꾸는데, 표시가 없으면
 * 플레이어는 자기 물줄기가 왜 짧아졌는지 알 방법이 없다.
 */
function drawEffects(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  p: Player,
  cx: number,
  cy: number,
  r: number,
): void {
  if (p.potionTicks > 0) {
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6 + Math.sin(state.tick / 6) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (p.skullTicks > 0) {
    ctx.strokeStyle = '#b07de0';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, state.tick / 14, state.tick / 14 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/**
 * 갇힌 상태 표시.
 * 남은 시간(줄어드는 호)과 탈출 게이지(차오르는 호)를 함께 보여준다.
 * 이 둘이 안 보이면 플레이어는 언제 죽는지, 연타가 먹히는지 알 수 없다.
 */
function drawTrapBubble(
  ctx: CanvasRenderingContext2D,
  p: Player,
  cx: number,
  cy: number,
  r: number,
): void {
  const outer = r * 1.15;

  ctx.fillStyle = 'rgb(127 227 255 / 0.22)';
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgb(168 228 255 / 0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = 'rgb(255 255 255 / 0.6)';
  ctx.beginPath();
  ctx.arc(cx - outer * 0.35, cy - outer * 0.38, outer * 0.16, 0, Math.PI * 2);
  ctx.fill();

  // 남은 시간 — 시계 방향으로 줄어든다
  const remain = p.statusTicks / TRAP_DURATION;
  ctx.strokeStyle = remain < 0.3 ? '#ff6b6b' : '#ffd166';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, outer + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remain);
  ctx.stroke();

  // 탈출 게이지 — 연타할수록 차오른다
  if (p.escapeGauge > 0) {
    ctx.strokeStyle = '#8ae8b4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      outer + 7,
      Math.PI / 2,
      Math.PI / 2 + Math.PI * 2 * Math.min(1, p.escapeGauge / ESCAPE_THRESHOLD),
    );
    ctx.stroke();
  }
}

function drawResult(ctx: CanvasRenderingContext2D, state: GameState): void {
  const w = state.width * TILE_PX;
  const h = state.height * TILE_PX;

  ctx.fillStyle = 'rgb(6 10 18 / 0.72)';
  ctx.fillRect(0, 0, w, h);

  const draw = state.winnerTeamId === DRAW || state.winnerTeamId === null;
  const label = draw ? '무승부' : `${state.winnerTeamId! + 1}팀 승리`;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = draw ? '#cbd5e1' : (TEAM_COLORS[state.winnerTeamId! % TEAM_COLORS.length] ?? '#fff');
  ctx.font = '600 34px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(label, w / 2, h / 2 - 12);

  ctx.fillStyle = 'rgb(203 213 225 / 0.75)';
  ctx.font = '15px ui-monospace, monospace';
  ctx.fillText('R — 새 판', w / 2, h / 2 + 24);
}
