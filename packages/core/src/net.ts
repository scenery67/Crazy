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

/** 클라 → 서버. 입력이 바뀔 때만 보낸다 (WebSocket은 순서와 도착을 보장한다) */
export interface InputMessage {
  t: 'input';
  move: Dir | null;
  place: boolean;
}

export type ClientMessage = InputMessage;

export interface WelcomeMessage {
  t: 'welcome';
  /** 이 접속이 조종할 자리 */
  playerId: PlayerId;
  /** 서버가 스냅샷을 보내는 주기(ms). 클라 보간에 쓴다 */
  snapshotIntervalMs: number;
  state: SerializedState;
}

export interface SnapshotMessage {
  t: 'snapshot';
  state: SerializedState;
}

/** 자리가 꽉 찼을 때 */
export interface RejectMessage {
  t: 'reject';
  reason: string;
}

export type ServerMessage = WelcomeMessage | SnapshotMessage | RejectMessage;

export const DEFAULT_PORT = 8080;
/** 스냅샷 주기: 60Hz 시뮬레이션의 3틱마다 = 20Hz */
export const SNAPSHOT_EVERY_TICKS = 3;
