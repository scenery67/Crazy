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

/** 스틱 중심에서 이만큼 밀어야 방향으로 친다. 손가락은 정확하지 않다 */
const STICK_DEADZONE = 22;
const STICK_RANGE = 46;

/**
 * 터치 조작.
 *
 * 격자 4방향 이동이라 아날로그 값이 쓸모없다. 밀어낸 방향을 **가장 큰 축 하나로
 * 스냅해서** 키보드와 똑같은 입력을 만든다. 대각선을 허용하면 레인 정렬과
 * 싸우게 되어 오히려 조작이 나빠진다.
 */
export class TouchPad {
  private move: Dir | null = null;
  private pendingPlace = false;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;

  /**
   * 주 입력장치가 손가락인가.
   *
   * `maxTouchPoints > 0`으로 판정하면 안 된다. 그건 "터치가 되는가"이고,
   * 터치스크린 달린 PC도 참이라 마우스로 쓰는데 조작판이 뜬다.
   * `pointer: coarse`는 **주** 포인터가 굵은지를 묻기 때문에,
   * 터치 노트북에 마우스가 붙어 있으면 거짓이 된다.
   */
  static get preferred(): boolean {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  }

  constructor(
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
    bomb: HTMLElement,
  ) {
    stick.addEventListener('pointerdown', (e) => this.grab(e));
    stick.addEventListener('pointermove', (e) => this.drag(e));
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      stick.addEventListener(type, (e) => this.release(e));
    }

    bomb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.pendingPlace = true;
    });
    // 버튼이 눌린 채 남으면 다음 탭이 안 먹는다
    bomb.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private grab(e: PointerEvent): void {
    e.preventDefault();
    this.pointerId = e.pointerId;
    const box = this.stick.getBoundingClientRect();
    // 처음 짚은 곳을 중심으로 삼는다. 스틱 정중앙을 짚기는 어렵다
    this.originX = box.left + box.width / 2;
    this.originY = box.top + box.height / 2;
    this.stick.setPointerCapture(e.pointerId);
    this.drag(e);
  }

  private drag(e: PointerEvent): void {
    if (this.pointerId !== e.pointerId) return;
    e.preventDefault();

    const dx = e.clientX - this.originX;
    const dy = e.clientY - this.originY;

    if (Math.hypot(dx, dy) < STICK_DEADZONE) {
      this.move = null;
    } else if (Math.abs(dx) > Math.abs(dy)) {
      this.move = dx > 0 ? Dir.Right : Dir.Left;
    } else {
      this.move = dy > 0 ? Dir.Down : Dir.Up;
    }

    const scale = Math.min(1, Math.hypot(dx, dy) / STICK_RANGE);
    const angle = Math.atan2(dy, dx);
    this.knob.style.transform = `translate(${Math.cos(angle) * STICK_RANGE * scale}px, ${Math.sin(angle) * STICK_RANGE * scale}px)`;
  }

  private release(e: PointerEvent): void {
    if (this.pointerId !== e.pointerId) return;
    this.pointerId = null;
    this.move = null;
    this.knob.style.transform = '';
  }

  /** 호출할 때마다 물풍선 신호는 소비된다 */
  poll(): { move: Dir | null; place: boolean } {
    const place = this.pendingPlace;
    this.pendingPlace = false;
    return { move: this.move, place };
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
