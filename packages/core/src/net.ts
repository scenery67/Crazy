import type { Dir, GameState, PlayerId } from './types.js';

/**
 * 직렬화와 통신 규약.
 *
 * core에 두는 이유: 클라이언트와 서버가 **같은 정의**를 봐야 하고,
 * core는 DOM에도 Node에도 의존하지 않으므로 양쪽에서 그대로 import된다.
 *
 * 압축은 하지 않는다. 스냅샷이 통째로 500바이트 정도라 20Hz로 보내도
 * 10KB/s밖에 안 된다. 처음부터 델타나 비트패킹을 넣으면
 * "규칙이 틀린 것"과 "직렬화가 틀린 것"을 구분할 수 없게 된다.
 */

/** Uint8Array는 JSON으로 왕복하지 못하므로 map만 배열로 바꾼다 */
export type SerializedState = Omit<GameState, 'map'> & { map: number[] };

export function serializeState(state: GameState): SerializedState {
  return { ...state, map: Array.from(state.map) };
}

export function deserializeState(data: SerializedState): GameState {
  return { ...data, map: Uint8Array.from(data.map) };
}

/**
 * 클라 → 서버. 매 틱 보낸다.
 *
 * 예측·재조정을 하려면 "서버가 내 입력을 어디까지 반영했는가"를 알아야 하고,
 * 그러려면 입력마다 번호가 붙어야 한다. 매 틱 40바이트 남짓이라
 * 초당 2.4KB 정도이고, 이 정도면 아껴서 얻는 것보다 잃는 게 크다.
 */
export interface InputMessage {
  t: 'input';
  /** 클라이언트가 매기는 단조 증가 번호 */
  seq: number;
  move: Dir | null;
  place: boolean;
}

export type ClientMessage = InputMessage;

export interface WelcomeMessage {
  t: 'welcome';
  /** 이 접속이 조종할 자리. 방이 꽉 찼으면 null이고 관전만 한다 */
  playerId: PlayerId | null;
  /** 실제로 들어간 방 코드 */
  room: string;
  /** 서버가 스냅샷을 보내는 주기(ms). 클라 보간에 쓴다 */
  snapshotIntervalMs: number;
  state: SerializedState;
}

export interface SnapshotMessage {
  t: 'snapshot';
  state: SerializedState;
  /**
   * 이 스냅샷에 반영된 마지막 입력 번호 (받는 클라이언트 기준).
   * 클라이언트는 이 번호 이하의 입력을 버리고 나머지만 다시 재생한다.
   */
  ack: number;
}

export interface RejectMessage {
  t: 'reject';
  reason: string;
}

export type ServerMessage = WelcomeMessage | SnapshotMessage | RejectMessage;

export const DEFAULT_PORT = 8080;
export const DEFAULT_ROOM = 'MAIN';

/** 방 코드는 대소문자를 가리지 않고, 주소에 넣기 안전한 문자만 남긴다 */
export function normalizeRoom(code: string | null | undefined): string {
  const cleaned = (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return cleaned || DEFAULT_ROOM;
}
/** 스냅샷 주기: 60Hz 시뮬레이션의 3틱마다 = 20Hz */
export const SNAPSHOT_EVERY_TICKS = 3;
