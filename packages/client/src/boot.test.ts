/**
 * main.ts가 모듈 평가 중에 죽지 않는지만 본다.
 *
 * 한 번 크게 데였다. 최상위 코드가 아직 만들어지지 않은 const를 건드려
 * `ReferenceError: Cannot access 'online' before initialization`이 나면서
 * 스크립트가 통째로 멈췄고, 화면에는 아무것도 나오지 않았다.
 * 타입 검사도 빌드도 이걸 잡지 못한다 — 선언 순서는 실행해봐야 안다.
 *
 * 그물은 이것 하나만 잡는다. 렌더도 규칙도 보지 않는다.
 *
 * "X is not defined"로 실패하면 최상위 코드가 새 브라우저 API를 쓰기 시작했다는 뜻이다.
 * 아래에 흉내만 하나 더 얹으면 된다.
 */
import { beforeAll, expect, it, vi } from 'vitest';

function stubDom(): void {
  const listeners = () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() });

  // 무엇을 부르든 받아주는 2D 컨텍스트
  const ctx2d = new Proxy(
    { canvas: { width: 0, height: 0 } } as Record<string, unknown>,
    { get: (t, k: string) => (k in t ? t[k] : vi.fn()) },
  );

  const makeEl = (tag: string): Record<string, unknown> => ({
    tagName: tag.toUpperCase(),
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
    dataset: {},
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn(), contains: () => false },
    hidden: false,
    value: '',
    textContent: '',
    disabled: false,
    getContext: () => ctx2d,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    setAttribute: vi.fn(),
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    click: vi.fn(),
    focus: vi.fn(),
    blur: vi.fn(),
    appendChild: vi.fn(),
    ...listeners(),
  });

  const canvas = makeEl('canvas');
  const g = globalThis as Record<string, unknown>;

  g['document'] = {
    ...listeners(),
    body: makeEl('body'),
    documentElement: makeEl('html'),
    createElement: (t: string) => makeEl(t),
    querySelector: (sel: string) => (sel.includes('canvas') ? canvas : makeEl('div')),
    querySelectorAll: () => [],
  };
  g['window'] = {
    ...listeners(),
    devicePixelRatio: 1,
    location: { protocol: 'http:', hostname: 'localhost', search: '' },
    matchMedia: () => ({ matches: false, ...listeners() }),
  };
  g['navigator'] = { maxTouchPoints: 0 };
  g['location'] = (g['window'] as Record<string, unknown>)['location'];
  g['matchMedia'] = (g['window'] as Record<string, unknown>)['matchMedia'];
  g['requestAnimationFrame'] = () => 0;
  g['cancelAnimationFrame'] = vi.fn();
  // 로드는 영원히 끝나지 않는다. 부팅만 보면 되므로 그래도 상관없다
  g['Image'] = class {
    naturalWidth = 64;
    naturalHeight = 64;
    set src(_v: string) {}
  };
  g['AudioContext'] = class {
    state = 'suspended';
    destination = {};
    createGain = () => ({ connect: vi.fn(), gain: { value: 1, setValueAtTime: vi.fn() } });
    createOscillator = () => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: {} });
    resume = vi.fn();
  };
  g['WebSocket'] = class {
    close = vi.fn();
    send = vi.fn();
  };
}

beforeAll(stubDom);

it('main.ts가 모듈 평가 중에 죽지 않는다', async () => {
  await expect(import('./main.js')).resolves.toBeTruthy();
});
