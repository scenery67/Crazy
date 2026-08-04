import {
  BUBBLE_FUSE,
  DIR_VECTORS,
  DRAW,
  ItemKind,
  PLAYER_HITBOX,
  Phase,
  PlayerStatus,
  TILE,
  TRAP_DURATION,
  Tile,
  WATER_DURATION,
  WaterKind,
  type Dir,
  type GameState,
  type Player,
} from '@crazy/core';
import { CHAR_ROW, CHAR_SCALE, drawFrame, type Sheet, type SpriteSet } from './sprites.js';

/** 원본 스프라이트가 52px 타일 기준이라 1:1로 맞춘다 */
export const TILE_PX = 52;

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

const PLAYER_COLORS = ['#ef5b5b', '#4fa3f7', '#5bd08a', '#f2c14e'] as const;
const TEAM_COLORS = ['#ff8a8a', '#8ac4ff', '#8ae8b4', '#ffdf8a'] as const;
const TEAM_LABELS = ['A', 'B', 'C', 'D'] as const;

const ITEM_COLORS: Record<number, string> = {
  [ItemKind.Bubble]: '#2f7fb8',
  [ItemKind.Power]: '#c9552f',
  [ItemKind.Roller]: '#2f9e63',
  [ItemKind.Needle]: '#6b7280',
  [ItemKind.Potion]: '#7c4dbd',
  [ItemKind.Skull]: '#4a4a55',
  [ItemKind.Shield]: '#2f8fa8',
};

/** sub-unit 좌표 → 캔버스 픽셀 */
function px(coord: number): number {
  return (coord / TILE) * TILE_PX;
}

export interface Viewport {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** null이면 도형 모드로 그린다 */
  sprites: SpriteSet | null;
}

export function createViewport(
  canvas: HTMLCanvasElement,
  state: GameState,
  sprites: SpriteSet | null,
): Viewport {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D 컨텍스트를 만들 수 없다');

  const w = state.width * TILE_PX;
  const h = state.height * TILE_PX;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  // 표시 크기는 CSS가 정한다. 여기서 px로 박으면 인라인 스타일이 이겨서
  // 좁은 화면에서 폭만 줄고 높이는 그대로 남아 비율이 깨진다
  canvas.style.setProperty('--gw', String(w));
  canvas.style.setProperty('--gh', String(h));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  // 새 판에서는 이전 판의 위치 기억이 남아 있으면 안 된다
  walkMemory.clear();

  return { canvas, ctx, sprites };
}

/**
 * 걷기 애니메이션을 위한 렌더러 전용 기억.
 * 시뮬레이션에 "움직이는 중"이라는 상태가 없어서 위치 변화로 판단한다.
 * 여기 있는 값은 게임 규칙에 전혀 영향을 주지 않는다.
 */
const walkMemory = new Map<number, { x: number; y: number; anim: number; tick: number; still: number }>();

/**
 * 좌표가 한 틱 안 변했다고 바로 멈춤으로 보면 안 된다.
 * 벽에 붙어 있으면 전진은 막히고 레인 정렬만 미세하게 좌표를 흔들어서,
 * 걷기와 서기가 매 틱 뒤집히며 캐릭터가 떨린다.
 */
const STILL_GRACE = 8;
/** 이만큼 가만히 있으면 그제야 대기 동작으로 넘어간다 */
const IDLE_POSE_AFTER = 90;

interface WalkPose {
  frame: number;
  moving: boolean;
  idle: boolean;
}

function walkPose(p: Player, tick: number): WalkPose {
  let prev = walkMemory.get(p.id);
  if (!prev) {
    prev = { x: p.x, y: p.y, anim: 0, tick, still: 0 };
    walkMemory.set(p.id, prev);
  }

  // 렌더는 화면 주사율대로 도니, 시뮬레이션이 진행된 틱에만 프레임을 넘긴다
  if (tick !== prev.tick) {
    if (prev.x !== p.x || prev.y !== p.y) {
      prev.anim++;
      prev.still = 0;
    } else {
      prev.still++;
    }
    prev.x = p.x;
    prev.y = p.y;
    prev.tick = tick;
  }

  return {
    frame: Math.floor(prev.anim / 4),
    moving: prev.still < STILL_GRACE,
    idle: prev.still >= IDLE_POSE_AFTER,
  };
}

/**
 * @param localIds 사람이 잡고 있는 자리. 이쪽만 사용자 캐릭터로 그린다
 */
export function render(vp: Viewport, state: GameState, localIds: ReadonlySet<number>): void {
  const { ctx, sprites } = vp;
  ctx.clearRect(0, 0, state.width * TILE_PX, state.height * TILE_PX);

  if (sprites) renderSprites(ctx, state, sprites, localIds);
  else renderShapes(ctx, state);

  if (state.phase === Phase.Over) drawResult(ctx, state);
}

// ─────────────────────────── 스프라이트 모드 ───────────────────────────

interface Drawable {
  /** 발밑 y. 이 값으로 정렬해야 앞뒤 가림이 맞는다 */
  footY: number;
  paint: () => void;
}

function renderSprites(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  sp: SpriteSet,
  localIds: ReadonlySet<number>,
): void {
  // 1. 바닥은 전부 깔고 시작한다
  for (let ty = 0; ty < state.height; ty++) {
    for (let tx = 0; tx < state.width; tx++) {
      ctx.drawImage(sp.floor.img, tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX);
    }
  }

  // 2. 물줄기는 바닥에 깔린다
  for (const w of state.waters) {
    const sheet = w.kind === WaterKind.Center ? sp.burst : pickWave(sp, w.kind, w.dir);
    const progress = 1 - w.ticksLeft / WATER_DURATION;
    drawFrame(
      ctx,
      sheet,
      Math.floor(progress * sheet.frames),
      (w.tx + 0.5) * TILE_PX,
      (w.ty + 1) * TILE_PX,
    );
  }

  // 3. 키 큰 것들은 발밑 순으로 정렬해서 그린다
  const tall: Drawable[] = [];

  for (let ty = 0; ty < state.height; ty++) {
    for (let tx = 0; tx < state.width; tx++) {
      const tile = state.map[ty * state.width + tx];
      if (tile !== Tile.Hard && tile !== Tile.Soft && tile !== Tile.Breaking) continue;

      const footY = (ty + 1) * TILE_PX;
      if (tile === Tile.Breaking) {
        // 남은 물줄기 수명이 곧 부서지는 진행도다
        const water = state.waters.find((w) => w.tx === tx && w.ty === ty);
        const progress = water ? 1 - water.ticksLeft / WATER_DURATION : 1;
        const frame = Math.floor(progress * sp.softPop.frames);
        tall.push({
          footY,
          paint: () => drawFrame(ctx, sp.softPop, frame, (tx + 0.5) * TILE_PX, footY + 6),
        });
        continue;
      }

      const sheet = tile === Tile.Hard ? sp.hardBlock : sp.softBlock;
      tall.push({
        footY,
        paint: () => drawFrame(ctx, sheet, 0, (tx + 0.5) * TILE_PX, footY + 6),
      });
    }
  }

  for (const b of state.bubbles) {
    const footY = (b.ty + 1) * TILE_PX;
    // 터질 때가 가까울수록 빠르게 두근거린다.
    // 가장 빠를 때가 원작 모작의 프레임 간격(0.2초 = 12틱)이고, 시작은 그보다 느리다
    const urgency = 1 - Math.min(b.fuse, BUBBLE_FUSE) / BUBBLE_FUSE;
    const speed = 22 - urgency * 10;
    tall.push({
      footY,
      paint: () =>
        drawFrame(ctx, sp.bomb, Math.floor(state.tick / speed), (b.tx + 0.5) * TILE_PX, footY + 4),
    });
  }

  for (const p of state.players) {
    if (!p.alive) continue;
    const cx = px(p.x);
    const footY = px(p.y) + TILE_PX * 0.42;
    tall.push({ footY, paint: () => paintPlayer(ctx, state, sp, p, cx, footY, localIds.has(p.id)) });
  }

  tall.sort((a, b) => a.footY - b.footY);
  for (const d of tall) d.paint();

  // 4. 아이템은 블록보다 위에 그린다.
  //    블록이 타일보다 크게 위로 넘치는 탓에, 순서대로 그리면 한 칸 위 아이템을 덮는다.
  //    아이템은 보이지 않으면 존재 자체를 모르므로 가려지는 쪽이 훨씬 나쁘다
  for (const item of state.items) {
    const sheet = sp.items[item.kind];
    const cx = (item.tx + 0.5) * TILE_PX;
    const bob = Math.sin((state.tick + item.tx * 7 + item.ty * 13) / 18) * 2;
    if (sheet) {
      drawFrame(ctx, sheet, Math.floor(state.tick / 15), cx, (item.ty + 1) * TILE_PX + bob);
    } else {
      // 대응 그림이 없는 아이템(바늘·해골·방패)은 도형으로 그린다
      drawItemGlyphTile(ctx, item.kind, cx, (item.ty + 0.5) * TILE_PX + bob);
    }
  }
}

function pickWave(sp: SpriteSet, kind: WaterKind, dir: Dir | null): Sheet {
  const d = (dir ?? 1) as Dir;
  return kind === WaterKind.Tip ? sp.waveTip[d] : sp.waveArm[d];
}

function paintPlayer(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  sp: SpriteSet,
  p: Player,
  cx: number,
  footY: number,
  isLocal: boolean,
): void {
  const trapped = p.status === PlayerStatus.Trapped;
  const blinking =
    p.status === PlayerStatus.Invulnerable && Math.floor(state.tick / 4) % 2 === 0;

  ctx.save();
  if (blinking) ctx.globalAlpha = 0.45;

  drawFrame(ctx, sp.shadow, 0, cx, footY + 6);

  // 팀 표식 — 스프라이트가 전원 같은 캐릭터라 이게 없으면 아군을 구분할 수 없다
  ctx.strokeStyle = TEAM_COLORS[p.teamId % TEAM_COLORS.length] ?? '#fff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(cx, footY + 2, TILE_PX * 0.3, TILE_PX * 0.13, 0, 0, Math.PI * 2);
  ctx.stroke();

  if (trapped) {
    // 남은 시간에 애니메이션을 맞춘다. 틱으로 돌리면 13프레임 시퀀스가 2.6초마다
    // 처음으로 되감겨서, 갇혀 있는 동안 물방울이 터졌다 되돌아가기를 반복한다.
    // 이렇게 하면 마지막 프레임(터짐)이 죽는 순간에 정확히 한 번 나온다
    const progress = 1 - p.statusTicks / TRAP_DURATION;
    const frame = Math.min(sp.trap.frames - 1, Math.floor(progress * sp.trap.frames));
    drawFrame(ctx, sp.trap, frame, cx, footY + 10);
  } else {
    const pose = walkPose(p, state.tick);
    // 멈춰도 바라보던 방향을 유지한다. 정면으로 되돌리면 방향이 튕겨 보인다
    const frame = pose.moving ? pose.frame : 0;
    if (isLocal) {
      drawFrame(ctx, sp.hero[p.facing], frame, cx, footY);
    } else {
      const sheet = sp.chars[p.id % sp.chars.length] ?? sp.chars[0]!;
      drawFrame(ctx, sheet, frame, cx, footY, CHAR_ROW[p.facing], CHAR_SCALE);
    }
  }

  ctx.restore();

  if (trapped) drawTrapGauges(ctx, p, cx, footY - TILE_PX * 0.55, TILE_PX * 0.5);
  else drawEffects(ctx, state, p, cx, footY - TILE_PX * 0.5, TILE_PX * 0.42);
}

// ─────────────────────────── 도형 모드 (폴백) ───────────────────────────

function renderShapes(ctx: CanvasRenderingContext2D, state: GameState): void {
  drawTiles(ctx, state);
  drawItemsAsShapes(ctx, state);
  drawBubblesAsShapes(ctx, state);
  drawWatersAsShapes(ctx, state);
  drawPlayersAsShapes(ctx, state);
}

function drawTiles(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (let ty = 0; ty < state.height; ty++) {
    for (let tx = 0; tx < state.width; tx++) {
      const x = tx * TILE_PX;
      const y = ty * TILE_PX;
      const tile = state.map[ty * state.width + tx];

      ctx.fillStyle = (tx + ty) % 2 === 0 ? PALETTE.floorA : PALETTE.floorB;
      ctx.fillRect(x, y, TILE_PX, TILE_PX);

      if (tile === Tile.Hard) {
        drawBlock(ctx, x, y, PALETTE.hardTop, PALETTE.hardBody, PALETTE.hardEdge);
      } else if (tile === Tile.Soft) {
        drawBlock(ctx, x, y, PALETTE.softTop, PALETTE.softBody, PALETTE.softEdge);
      } else if (tile === Tile.Breaking) {
        // 아직 막혀 있다는 걸 보여줘야 한다. 흐리게 그려 부서지는 중임을 알린다
        ctx.save();
        ctx.globalAlpha = 0.45;
        drawBlock(ctx, x, y, PALETTE.softTop, PALETTE.softBody, PALETTE.softEdge);
        ctx.restore();
      } else {
        ctx.strokeStyle = PALETTE.gridLine;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE_PX - 1, TILE_PX - 1);
      }
    }
  }
}

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

function drawItemsAsShapes(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const item of state.items) {
    const bob = Math.sin((state.tick + item.tx * 7 + item.ty * 13) / 18) * 2;
    drawItemGlyphTile(ctx, item.kind, (item.tx + 0.5) * TILE_PX, (item.ty + 0.5) * TILE_PX + bob);
  }
}

/** 색 배경 + 도형 하나로 아이템을 그린다 */
function drawItemGlyphTile(
  ctx: CanvasRenderingContext2D,
  kind: number,
  cx: number,
  cy: number,
): void {
  const half = TILE_PX * 0.3;

  ctx.fillStyle = 'rgb(0 0 0 / 0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + half + 4, half * 0.8, half * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = ITEM_COLORS[kind] ?? '#888';
  roundRect(ctx, cx - half, cy - half, half * 2, half * 2, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgb(255 255 255 / 0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  drawItemGlyph(ctx, kind, cx, cy, half);
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
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.62, cy);
      ctx.lineTo(cx + r * 0.62, cy);
      ctx.moveTo(cx, cy - r * 0.62);
      ctx.lineTo(cx, cy + r * 0.62);
      ctx.stroke();
      break;
    case ItemKind.Roller:
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

function drawBubblesAsShapes(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const b of state.bubbles) {
    const cx = (b.tx + 0.5) * TILE_PX;
    const cy = (b.ty + 0.5) * TILE_PX;

    const urgency = 1 - Math.min(b.fuse, BUBBLE_FUSE) / BUBBLE_FUSE;
    const period = 45 - urgency * 27;
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

    ctx.fillStyle = 'rgb(255 255 255 / 0.55)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.32, cy - r * 0.34, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWatersAsShapes(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const w of state.waters) {
    const x = w.tx * TILE_PX;
    const y = w.ty * TILE_PX;
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

function drawPlayersAsShapes(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const p of state.players) {
    if (!p.alive) continue;

    const cx = px(p.x);
    const cy = px(p.y);
    const r = px(PLAYER_HITBOX) / 2;

    const blinking =
      p.status === PlayerStatus.Invulnerable && Math.floor(state.tick / 4) % 2 === 0;
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

  drawTrapGauges(ctx, p, cx, cy, outer);
}

// ─────────────────────────── 공통 오버레이 ───────────────────────────

/**
 * 죽기까지 남은 시간(줄어드는 호).
 * 혼자서는 나올 수 없으므로, 이 호는 아군에게 "얼마나 급한가"를 알리는 신호다.
 */
function drawTrapGauges(
  ctx: CanvasRenderingContext2D,
  p: Player,
  cx: number,
  cy: number,
  radius: number,
): void {
  const remain = p.statusTicks / TRAP_DURATION;
  ctx.strokeStyle = remain < 0.3 ? '#ff6b6b' : '#ffd166';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remain);
  ctx.stroke();
}

/** 물약·해골은 능력치를 크게 바꾸는데, 표시가 없으면 원인을 알 수 없다 */
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

function drawResult(ctx: CanvasRenderingContext2D, state: GameState): void {
  const w = state.width * TILE_PX;
  const h = state.height * TILE_PX;

  ctx.fillStyle = 'rgb(6 10 18 / 0.72)';
  ctx.fillRect(0, 0, w, h);

  const draw = state.winnerTeamId === DRAW || state.winnerTeamId === null;
  // 개인전은 teamId가 곧 플레이어라 "3팀 승리"라고 하면 어색하다.
  // 팀 인원수로 두 경우를 구분한다 — 렌더러가 모드를 알 필요가 없다
  const winners = state.players.filter((p) => p.teamId === state.winnerTeamId);
  const label = draw
    ? '무승부'
    : winners.length === 1
      ? `${(winners[0]?.id ?? 0) + 1}P 승리`
      : `${TEAM_LABELS[state.winnerTeamId! % TEAM_LABELS.length]}팀 승리`;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = draw
    ? '#cbd5e1'
    : (TEAM_COLORS[state.winnerTeamId! % TEAM_COLORS.length] ?? '#fff');
  ctx.font = '600 34px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(label, w / 2, h / 2 - 12);

  ctx.fillStyle = 'rgb(203 213 225 / 0.75)';
  ctx.font = '15px ui-monospace, monospace';
  ctx.fillText('R — 새 판', w / 2, h / 2 + 24);
}
