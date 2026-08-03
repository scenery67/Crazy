import { Dir, type InputFrame, type PlayerId } from '@crazy/core';

interface Binding {
  playerId: PlayerId;
  dir?: Dir;
  place?: true;
}

/** e.code 기준이라 키보드 레이아웃(한/영, QWERTY 외)에 영향받지 않는다 */
const BINDINGS: Record<string, Binding> = {
  ArrowUp: { playerId: 0, dir: Dir.Up },
  ArrowDown: { playerId: 0, dir: Dir.Down },
  ArrowLeft: { playerId: 0, dir: Dir.Left },
  ArrowRight: { playerId: 0, dir: Dir.Right },
  Space: { playerId: 0, place: true },

  KeyW: { playerId: 1, dir: Dir.Up },
  KeyS: { playerId: 1, dir: Dir.Down },
  KeyA: { playerId: 1, dir: Dir.Left },
  KeyD: { playerId: 1, dir: Dir.Right },
  KeyF: { playerId: 1, place: true },
};

/**
 * 눌린 순서를 기억하는 방향 스택.
 *
 * 아래를 누른 채로 오른쪽을 추가로 누르면 오른쪽으로 꺾여야 한다.
 * 단순히 "눌린 키 집합"에서 고정 우선순위로 고르면 이게 안 되고,
 * 방향 전환이 한 박자 늦게 느껴진다.
 */
class DirectionStack {
  private held: Dir[] = [];

  press(dir: Dir): void {
    this.release(dir);
    this.held.push(dir);
  }

  release(dir: Dir): void {
    const i = this.held.indexOf(dir);
    if (i >= 0) this.held.splice(i, 1);
  }

  current(): Dir | null {
    return this.held.length > 0 ? this.held[this.held.length - 1]! : null;
  }

  clear(): void {
    this.held.length = 0;
  }
}

export class Keyboard {
  private dirs = new Map<PlayerId, DirectionStack>();
  /** 물풍선은 누른 순간 1틱만 true. 시뮬레이션이 엣지 판정을 따로 하지 않아도 되게 한다 */
  private pendingPlace = new Set<PlayerId>();

  constructor(private readonly playerCount: number) {
    for (let id = 0; id < playerCount; id++) this.dirs.set(id, new DirectionStack());

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    // 탭을 벗어나면 keyup을 놓쳐서 키가 눌린 채로 남는다
    window.addEventListener('blur', () => {
      for (const stack of this.dirs.values()) stack.clear();
      this.pendingPlace.clear();
    });
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const binding = BINDINGS[e.code];
    if (!binding || binding.playerId >= this.playerCount) return;
    e.preventDefault();

    if (binding.place) {
      if (down && !e.repeat) this.pendingPlace.add(binding.playerId);
      return;
    }
    if (binding.dir === undefined) return;

    const stack = this.dirs.get(binding.playerId);
    if (!stack) return;
    if (down) stack.press(binding.dir);
    else stack.release(binding.dir);
  }

  /** 이번 틱의 입력을 뽑는다. 호출할 때마다 물풍선 펄스는 소비된다 */
  poll(): InputFrame[] {
    const frames: InputFrame[] = [];
    for (let id = 0; id < this.playerCount; id++) {
      frames.push({
        playerId: id,
        move: this.dirs.get(id)?.current() ?? null,
        placeBubble: this.pendingPlace.delete(id),
      });
    }
    return frames;
  }
}
