import type { GameEvent } from './events.js';

/**
 * 파티클. 순수 표현이라 시뮬레이션과 완전히 분리되어 있고,
 * 게임 규칙에 영향을 주지 않는다. 여기서는 Math.random()을 써도 된다.
 */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  /** 중력을 받는가. 물방울은 튀어오르고 반짝임은 떠오른다 */
  gravity: number;
}

const MAX_PARTICLES = 400;

export class Particles {
  private items: Particle[] = [];

  clear(): void {
    this.items.length = 0;
  }

  spawn(events: readonly GameEvent[], tilePx: number): void {
    for (const e of events) {
      const cx = (e.tx + 0.5) * tilePx;
      const cy = (e.ty + 0.5) * tilePx;

      switch (e.t) {
        case 'explode':
          this.burst(cx, cy, 14, { color: '#bdefff', speed: 3.4, size: 3.5, gravity: 0.06 });
          this.burst(cx, cy, 6, { color: '#ffffff', speed: 1.8, size: 2.5, gravity: 0.02 });
          break;
        case 'break':
          this.burst(cx, cy, 10, { color: '#c99a5b', speed: 2.2, size: 3, gravity: 0.14 });
          break;
        case 'pickup':
          this.burst(cx, cy, 9, { color: '#ffe08a', speed: 1.5, size: 2.5, gravity: -0.05 });
          break;
        case 'trap':
          this.burst(cx, cy, 10, { color: '#7fe3ff', speed: 1.6, size: 3, gravity: -0.03 });
          break;
        case 'rescue':
          this.burst(cx, cy, 12, { color: '#8ae8b4', speed: 2.2, size: 3, gravity: -0.06 });
          break;
        case 'death':
          this.burst(cx, cy, 16, { color: '#ff9a9a', speed: 2.6, size: 3.5, gravity: 0.05 });
          break;
        case 'bubble':
          break; // 설치는 소리로 충분하다. 파티클까지 붙이면 화면이 시끄럽다
      }
    }
  }

  private burst(
    cx: number,
    cy: number,
    count: number,
    o: { color: string; speed: number; size: number; gravity: number },
  ): void {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= MAX_PARTICLES) return;
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = o.speed * (0.5 + Math.random() * 0.7);
      const life = 18 + Math.floor(Math.random() * 16);
      this.items.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: o.size * (0.6 + Math.random() * 0.7),
        color: o.color,
        gravity: o.gravity,
      });
    }
  }

  /** 시뮬레이션이 진행된 틱에만 부른다. 렌더 주사율과 무관하게 같은 속도로 흐른다 */
  update(): void {
    let keep = 0;
    for (const p of this.items) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.94;
      p.vy *= 0.94;
      if (--p.life > 0) this.items[keep++] = p;
    }
    this.items.length = keep;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.items.length === 0) return;
    ctx.save();
    for (const p of this.items) {
      ctx.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.6));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
