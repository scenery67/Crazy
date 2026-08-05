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
/** 색 두 가지 — 0=빨강 1=파랑 */
export const COLOR_COUNT = 2;
/** 종족 두 가지 — 0=배찌 1=디즈니 */
export const SPECIES_COUNT = CHARACTER_COUNT / COLOR_COUNT;

/**
 * 캐릭터 번호는 종족과 색을 한 숫자에 담은 것이다.
 * 0=빨강배찌 1=파랑배찌 2=빨강디즈니 3=파랑디즈니 — chars/Die.png의 줄 순서와 같다.
 */
export const speciesOf = (character: number): number => Math.floor(character / COLOR_COUNT);
export const colorOf = (character: number): number => character % COLOR_COUNT;
export const characterFrom = (species: number, color: number): number =>
  species * COLOR_COUNT + color;

export interface CharacterSetup {
  /** 판에 앉는 자리 수 */
  seats: number;
  /** 사람이 쥔 자리 수. 나머지는 봇이 채운다 */
  humans: number;
  /** 사람들이 고른 캐릭터. 자리 순서대로 */
  picks: readonly number[];
  /** 자리 번호를 그대로 캐릭터로 쓴다 (온라인·재생) */
  bySeat: boolean;
  /** 자리별 팀. teamColors가 아니면 보지 않는다 */
  teams: readonly number[];
  /**
   * 2v2 — **색이 곧 팀이다.** 같은 팀은 같은 색을 쓰고 고를 수 있는 것은 종족뿐이다.
   * 같은 팀끼리는 종족을 갈라 줘야 서로도 구분된다.
   */
  teamColors: boolean;
}

/** 화면 설정에서 온 값이라 그대로 믿지 않는다. 엉뚱한 값은 0번으로 떨어뜨린다 */
function sane(want: number | undefined): number {
  if (want === undefined || !Number.isInteger(want)) return 0;
  if (want < 0 || want >= CHARACTER_COUNT) return 0;
  return want;
}

/**
 * 2v2 — 색은 팀이 정하고, 사람은 종족만 고른다.
 * 같은 팀끼리 종족까지 같으면 아군끼리 구분이 안 되므로 팀 안에서 갈라 준다.
 */
function assignByTeam(setup: CharacterSetup): Map<number, number> {
  const map = new Map<number, number>();
  const takenPerTeam = new Map<number, Set<number>>();

  for (let id = 0; id < setup.seats; id++) {
    const team = setup.teams[id] ?? id;
    let taken = takenPerTeam.get(team);
    if (!taken) {
      taken = new Set<number>();
      takenPerTeam.set(team, taken);
    }
    // 한 팀이 종족 수보다 많으면 어쩔 수 없이 겹친다
    if (taken.size >= SPECIES_COUNT) taken.clear();

    // 봇은 남은 종족을 가져간다. 사람이 고른 것에서 색은 버리고 종족만 쓴다
    let species = id < setup.humans ? speciesOf(sane(setup.picks[id])) : 0;
    while (taken.has(species)) species = (species + 1) % SPECIES_COUNT;
    taken.add(species);

    map.set(id, characterFrom(species, team % COLOR_COUNT));
  }
  return map;
}

export function assignCharacters(setup: CharacterSetup): Map<number, number> {
  const map = new Map<number, number>();

  // 서버가 자리를 나눠주므로 자연히 겹치지 않고, 남의 선택을 알 방법도 없다
  if (setup.bySeat) {
    for (let id = 0; id < setup.seats; id++) map.set(id, id % CHARACTER_COUNT);
    return map;
  }

  if (setup.teamColors) return assignByTeam(setup);

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
  // 사람끼리 겹치는 일은 고르는 쪽에서 맞바꿔 막는다 (main.ts). 여기 도달하면 봇만 밀린다
  const humans = Math.min(setup.humans, setup.seats);
  for (let id = 0; id < humans; id++) map.set(id, take(sane(setup.picks[id])));
  for (let id = humans; id < setup.seats; id++) map.set(id, take(0));

  return map;
}

/** 배정에 없는 자리는 자리 번호로 되돌린다. 되돌리는 규칙을 한 군데로 모은다 */
export function characterOf(map: ReadonlyMap<number, number>, id: number): number {
  return map.get(id) ?? id % CHARACTER_COUNT;
}
