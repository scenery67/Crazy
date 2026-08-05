import { describe, expect, it } from 'vitest';
import { Dir } from '../src/types.js';
import {
  MAX_MESSAGE_BYTES,
  deserializeState,
  normalizeRoom,
  parseClientMessage,
  serializeState,
} from '../src/net.js';
import { createInitialState, soloTeams } from '../src/map.js';

const input = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ t: 'input', seq: 1, move: Dir.Up, place: false, ...over });

describe('parseClientMessage — 서버가 네트워크에서 받는 유일한 입구', () => {
  it('규약에 맞는 입력을 통과시킨다', () => {
    expect(parseClientMessage(input())).toEqual({
      t: 'input',
      seq: 1,
      move: Dir.Up,
      place: false,
    });
  });

  it('move는 null이어도 된다 (아무 키도 안 누른 틱)', () => {
    expect(parseClientMessage(input({ move: null }))?.move).toBeNull();
  });

  it('네 방향만 받는다', () => {
    for (const dir of Object.values(Dir)) {
      expect(parseClientMessage(input({ move: dir }))?.move).toBe(dir);
    }
    for (const bad of [4, -1, 1.5, '0', {}, []]) {
      expect(parseClientMessage(input({ move: bad }))).toBeNull();
    }
  });

  /**
   * seq는 스냅샷의 ack로 되돌아 나가고, 그 문자열은 손으로 조립된다.
   * 숫자가 아닌 것이 통과하면 그 클라이언트의 스냅샷이 깨진 JSON이 된다.
   */
  it('seq는 안전한 정수만 받는다', () => {
    for (const bad of [
      Number.NaN,
      Infinity,
      -1,
      1.5,
      '1',
      Number.MAX_SAFE_INTEGER + 1,
      null,
      {},
      '1,"x":2',
    ]) {
      expect(parseClientMessage(input({ seq: bad }))).toBeNull();
    }
    expect(parseClientMessage(input({ seq: 0 }))?.seq).toBe(0);
    expect(parseClientMessage(input({ seq: Number.MAX_SAFE_INTEGER }))).not.toBeNull();
  });

  it('place는 boolean이어야 한다 — 참 같은 값도 거절한다', () => {
    for (const bad of [1, 'true', {}, null]) {
      expect(parseClientMessage(input({ place: bad }))).toBeNull();
    }
  });

  it('모르는 종류와 깨진 JSON은 버린다', () => {
    for (const bad of ['', '{', 'null', '[]', '"input"', '{"t":"snapshot"}', '{"t":42}']) {
      expect(parseClientMessage(bad)).toBeNull();
    }
  });

  it('너무 긴 메시지는 뜯어보지도 않는다', () => {
    const huge = JSON.stringify({ t: 'input', seq: 1, move: 0, place: false, pad: 'x'.repeat(500) });
    expect(huge.length).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(huge)).toBeNull();
  });
});

describe('normalizeRoom', () => {
  it('대문자·숫자만 남기고 8자로 자른다', () => {
    expect(normalizeRoom('ab-cd')).toBe('ABCD');
    expect(normalizeRoom('여기다123456789')).toBe('12345678');
  });

  it('비어 있으면 기본 방으로 보낸다', () => {
    for (const empty of [null, undefined, '', '!!!']) expect(normalizeRoom(empty)).toBe('MAIN');
  });
});

describe('상태 직렬화', () => {
  it('JSON을 왕복해도 같은 상태다', () => {
    const state = createInitialState({ seed: 12345, teams: soloTeams(4) });
    const back = deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
    expect(back.map).toEqual(state.map);
    expect(back.map).toBeInstanceOf(Uint8Array);
    expect(back.players).toEqual(state.players);
    expect(back.tick).toBe(state.tick);
  });
});
