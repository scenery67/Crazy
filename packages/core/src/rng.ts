/**
 * 결정론적 난수. xorshift32.
 *
 * Math.random()은 시뮬레이션 어디에서도 쓰지 않는다.
 * 시드가 GameState에 들어 있어야 리플레이와 넷코드가 성립한다.
 */

/** 시드를 한 단계 전진시킨다. 0이 들어오면 고정점에 빠지므로 보정한다 */
export function nextSeed(seed: number): number {
  let x = seed | 0;
  if (x === 0) x = 0x9e3779b9 | 0;
  x ^= x << 13;
  x |= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x |= 0;
  return x | 0;
}

/**
 * 시드를 들고 다니는 커서.
 * 순수 함수 스타일의 시드 스레딩은 코드를 읽기 어렵게 만들어서,
 * 지역적으로만 쓰는 얇은 래퍼를 둔다. 상태는 여전히 정수 하나뿐이다.
 */
export class Rng {
  constructor(public seed: number) {}

  /** [0, 2^32) 범위의 부호 없는 정수 */
  nextUint(): number {
    this.seed = nextSeed(this.seed);
    return this.seed >>> 0;
  }

  /** [0, maxExclusive) 범위의 정수 */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return this.nextUint() % maxExclusive;
  }

  /** percent 확률(0~100)로 true */
  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  /** 가중치 배열에서 인덱스 하나를 뽑는다 */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return 0;
    let roll = this.int(total);
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i] ?? 0;
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }
}
