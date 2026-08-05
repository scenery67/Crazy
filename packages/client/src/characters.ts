/**
 * 자리 번호 → 캐릭터 번호 배정.
 *
 * 렌더링과 떼어내 순수 함수로 둔 이유가 둘 있다.
 * 하나는 시험할 수 있게 하려는 것이고, 다른 하나는 배정이 접속 상태를 직접 읽지 않게
 * 하려는 것이다. 예전에는 이 계산이 online 세션을 들여다봐서, 모듈이 다 만들어지기 전에
 * 부르면 그대로 죽었다.
 */

/** 고를 수 있는 캐릭터 수. chars/Die.png의 줄 수와 같아야 한다 */
export const CHARACTER_COUNT = 4;

export interface CharacterSetup {
  /** 판에 앉는 자리 수 */
  seats: number;
  /** 사람이 쥔 자리 수. 나머지는 봇이 채운다 */
  humans: number;
  /** 사람들이 고른 캐릭터. 자리 순서대로 */
  picks: readonly number[];
  /** 자리 번호를 그대로 캐릭터로 쓴다 (온라인·재생) */
  bySeat: boolean;
}

/** 화면 설정에서 온 값이라 그대로 믿지 않는다. 엉뚱한 값은 0번으로 떨어뜨린다 */
function sane(want: number | undefined): number {
  if (want === undefined || !Number.isInteger(want)) return 0;
  if (want < 0 || want >= CHARACTER_COUNT) return 0;
  return want;
}

export function assignCharacters(setup: CharacterSetup): Map<number, number> {
  const map = new Map<number, number>();

  // 서버가 자리를 나눠주므로 자연히 겹치지 않고, 남의 선택을 알 방법도 없다
  if (setup.bySeat) {
    for (let id = 0; id < setup.seats; id++) map.set(id, id % CHARACTER_COUNT);
    return map;
  }

  const used = new Set<number>();
  /** 원하는 번호부터 위로 훑어 아직 안 쓴 것을 집는다 */
  const take = (want: number): number => {
    // 자리가 캐릭터보다 많으면 어쩔 수 없이 겹친다. 다시 처음부터 나눠 쓴다
    if (used.size >= CHARACTER_COUNT) used.clear();
    let pick = sane(want);
    while (used.has(pick)) pick = (pick + 1) % CHARACTER_COUNT;
    used.add(pick);
    return pick;
  };

  // 사람이 고른 것을 먼저 배정하고, 남은 것을 봇에게 준다.
  // 둘이 같은 캐릭터를 골라도 뒷사람이 다음 번호로 밀린다
  const humans = Math.min(setup.humans, setup.seats);
  for (let id = 0; id < humans; id++) map.set(id, take(sane(setup.picks[id])));
  for (let id = humans; id < setup.seats; id++) map.set(id, take(0));

  return map;
}

/** 배정에 없는 자리는 자리 번호로 되돌린다. 되돌리는 규칙을 한 군데로 모은다 */
export function characterOf(map: ReadonlyMap<number, number>, id: number): number {
  return map.get(id) ?? id % CHARACTER_COUNT;
}
