import { TILE } from '@crazy/core';
import { drawFrame, type SpriteSet } from './sprites.js';

/**
 * 사망 연출.
 *
 * 시뮬레이션에서 죽은 플레이어는 그 즉시 `alive: false`가 되어 사라진다.
 * 규칙상으로는 맞지만, 그냥 없어지면 무슨 일이 일어났는지 보이지 않는다.
 * 쓰러지는 동작을 보여주고, 점멸시킨 뒤 사라지게 한다.
 *
 * 전적으로 표현이라 시뮬레이션과 분리되어 있고, 온라인에서도 스냅샷 차이만으로 동작한다.
 */

/** 프레임 하나가 유지되는 틱. 원작 모작의 _DIE_COOLTIME(0.2초)보다 조금 빠르다 */
const FRAME_TICKS = 9;
/** chars/Die.png의 가로 프레임 수 */
const FRAMES = 8;
const FALL_TICKS = FRAME_TICKS * FRAMES;
/** 다 쓰러진 뒤 점멸하며 사라지는 시간 */
const BLINK_TICKS = 42;

interface Corpse {
  /** 캔버스 픽셀 기준 발밑 위치 */
  footX: number;
  footY: number;
  /** 사망 시트에서 쓸 줄 (캐릭터별로 다르다) */
  row: number;
  age: number;
}

export class Corpses {
  private items: Corpse[] = [];

  clear(): void {
    this.items.length = 0;
  }

  spawn(x: number, y: number, tilePx: number, row: number): void {
    this.items.push({
      footX: (x / TILE) * tilePx,
      footY: (y / TILE) * tilePx + tilePx * 0.42,
      row,
      age: 0,
    });
  }

  /** 시뮬레이션이 진행된 틱에만 부른다 */
  update(): void {
    let keep = 0;
    for (const c of this.items) {
      if (++c.age < FALL_TICKS + BLINK_TICKS) this.items[keep++] = c;
    }
    this.items.length = keep;
  }

  draw(ctx: CanvasRenderingContext2D, sprites: SpriteSet | null): void {
    if (this.items.length === 0) return;

    ctx.save();
    for (const c of this.items) {
      // 쓰러지는 동안은 그대로, 다 쓰러진 뒤에는 점멸하며 옅어진다
      if (c.age >= FALL_TICKS) {
        const left = 1 - (c.age - FALL_TICKS) / BLINK_TICKS;
        if (Math.floor(c.age / 4) % 2 === 0) continue;
        ctx.globalAlpha = left;
      } else {
        ctx.globalAlpha = 1;
      }

      if (sprites) {
        const last = Math.min(FRAMES, sprites.die.frames) - 1;
        const frame = Math.min(last, Math.floor(c.age / FRAME_TICKS));
        drawFrame(ctx, sprites.die, frame, c.footX, c.footY, c.row);
      } else {
        // 도형 모드 폴백
        ctx.fillStyle = '#ff9a9a';
        ctx.beginPath();
        ctx.ellipse(c.footX, c.footY - 8, 16, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
