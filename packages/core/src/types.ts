/**
 * 시뮬레이션 상태 모델.
 *
 * 이 파일은 DOM/브라우저 API를 절대 참조하지 않는다.
 * 여기의 모든 좌표는 sub-unit 정수다 (constants.TILE = 1 타일).
 */

export type PlayerId = number;
export type TeamId = number;

export const Dir = {
  Up: 0,
  Down: 1,
  Left: 2,
  Right: 3,
} as const;
export type Dir = (typeof Dir)[keyof typeof Dir];

/** [dx, dy] — Dir 값을 인덱스로 사용 */
export const DIR_VECTORS: readonly (readonly [number, number])[] = [
  [0, -1], // Up
  [0, 1], // Down
  [-1, 0], // Left
  [1, 0], // Right
];

export const Tile = {
  Empty: 0,
  /** 파괴 불가 */
  Hard: 1,
  /** 물줄기로 파괴 가능. 아이템 드랍 */
  Soft: 2,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export const PlayerStatus = {
  Normal: 0,
  /** 물방울에 갇힘 */
  Trapped: 1,
  /** 탈출/구출 직후 */
  Invulnerable: 2,
} as const;
export type PlayerStatus = (typeof PlayerStatus)[keyof typeof PlayerStatus];

export const ItemKind = {
  Bubble: 0,
  Power: 1,
  Roller: 2,
  Needle: 3,
  Potion: 4,
  Skull: 5,
  Shield: 6,
} as const;
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];

/** 해골이 걸어주는 디버프. None은 "걸린 게 없음" */
export const SkullKind = {
  None: 0,
  /** 발이 느려진다 */
  SlowFeet: 1,
  /** 물풍선을 1개밖에 못 놓는다 */
  TinyBubble: 2,
  /** 원하지 않아도 계속 물풍선을 흘린다 */
  ForcedPlace: 3,
} as const;
export type SkullKind = (typeof SkullKind)[keyof typeof SkullKind];

export const Phase = {
  Playing: 0,
  SuddenDeath: 1,
  Over: 2,
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export interface Player {
  id: PlayerId;
  /** 개인전은 "전원이 서로 다른 teamId"인 특수 케이스로 표현한다 */
  teamId: TeamId;
  alive: boolean;

  /** sub-unit 좌표. 플레이어의 중심점 */
  x: number;
  y: number;
  facing: Dir;

  status: PlayerStatus;
  /** 현재 status의 남은 틱 수. Normal일 때는 0 */
  statusTicks: number;
  /** 트랩 중 방향키 연타로 쌓는 탈출 게이지 */
  escapeGauge: number;

  bubbleCapacity: number;
  bubblesPlaced: number;
  power: number;
  speedLevel: number;
  needles: number;

  /**
   * 일시 효과는 원래 능력치를 건드리지 않는다. 남은 틱만 들고 있다가
   * 계산 시점에 stats.ts가 덮어쓴다 — 효과가 끝날 때 되돌릴 필요가 없다.
   */
  potionTicks: number;
  skullTicks: number;
  skullKind: SkullKind;
}

export interface Bubble {
  id: number;
  ownerId: PlayerId;
  /** 타일 좌표 */
  tx: number;
  ty: number;
  /** 남은 신관 틱. 0이 되면 폭발 */
  fuse: number;
  power: number;
}

export const WaterKind = {
  Center: 0,
  Arm: 1,
  Tip: 2,
} as const;
export type WaterKind = (typeof WaterKind)[keyof typeof WaterKind];

export interface Water {
  tx: number;
  ty: number;
  ticksLeft: number;
  ownerId: PlayerId;
  kind: WaterKind;
  /** 렌더링용 — 물줄기가 뻗어나간 방향. Center는 null */
  dir: Dir | null;
}

export interface Item {
  tx: number;
  ty: number;
  kind: ItemKind;
}

export interface GameState {
  tick: number;
  /** xorshift32 시드. 모든 무작위성은 여기서만 나온다 */
  rng: number;
  phase: Phase;

  width: number;
  height: number;
  /** width * height 크기. 값은 Tile */
  map: Uint8Array;

  players: Player[];
  bubbles: Bubble[];
  waters: Water[];
  items: Item[];

  /** Bubble id 발급용 카운터 */
  nextBubbleId: number;
  /** 서든데스에서 다음에 블록이 떨어질 나선 순서상의 위치 */
  suddenDeathIndex: number;
  /** 승리한 팀. 아직 진행 중이면 null, 무승부면 -1 */
  winnerTeamId: TeamId | null;
}

/**
 * 한 틱 동안의 플레이어 입력.
 * 사람/AI 봇/네트워크 원격 플레이어가 모두 이 타입을 생산한다.
 * 봇에게 렌더 정보나 특권을 주지 않기 위한 유일한 통로.
 */
export interface InputFrame {
  playerId: PlayerId;
  move: Dir | null;
  placeBubble: boolean;
}
