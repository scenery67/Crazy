import { describe, expect, it } from 'vitest';
import { MAP_HEIGHT, MAP_WIDTH } from '../src/constants.js';
import {
  SPAWN_TILES,
  createInitialState,
  duoTeams,
  getTile,
  soloTeams,
  toTile,
} from '../src/map.js';
import { Tile } from '../src/types.js';

const config = { seed: 12345, teams: soloTeams(4) };

describe('맵 생성', () => {
  it('같은 시드는 같은 맵을 만든다', () => {
    const a = createInitialState(config);
    const b = createInitialState(config);
    expect(Array.from(a.map)).toEqual(Array.from(b.map));
  });

  it('다른 시드는 다른 맵을 만든다', () => {
    const a = createInitialState(config);
    const b = createInitialState({ ...config, seed: 999 });
    expect(Array.from(a.map)).not.toEqual(Array.from(b.map));
  });

  it('테두리는 전부 Hard다', () => {
    const s = createInitialState(config);
    for (let tx = 0; tx < MAP_WIDTH; tx++) {
      expect(getTile(s, tx, 0)).toBe(Tile.Hard);
      expect(getTile(s, tx, MAP_HEIGHT - 1)).toBe(Tile.Hard);
    }
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
      expect(getTile(s, 0, ty)).toBe(Tile.Hard);
      expect(getTile(s, MAP_WIDTH - 1, ty)).toBe(Tile.Hard);
    }
  });

  it('홀수/홀수 좌표에는 Hard 블록이 없다', () => {
    const s = createInitialState(config);
    for (let ty = 1; ty < MAP_HEIGHT - 1; ty += 2) {
      for (let tx = 1; tx < MAP_WIDTH - 1; tx += 2) {
        expect(getTile(s, tx, ty)).not.toBe(Tile.Hard);
      }
    }
  });

  it('스폰 주변은 비어 있어 시작하자마자 갇히지 않는다', () => {
    const s = createInitialState(config);
    for (const [sx, sy] of SPAWN_TILES) {
      expect(getTile(s, sx, sy)).toBe(Tile.Empty);
      // 각 스폰에서 최소 2방향으로 나갈 길이 있어야 한다
      const open = [
        getTile(s, sx + 1, sy),
        getTile(s, sx - 1, sy),
        getTile(s, sx, sy + 1),
        getTile(s, sx, sy - 1),
      ].filter((t) => t === Tile.Empty).length;
      expect(open).toBeGreaterThanOrEqual(2);
    }
  });

  it('맵 바깥 조회는 Hard로 취급한다', () => {
    const s = createInitialState(config);
    expect(getTile(s, -1, 5)).toBe(Tile.Hard);
    expect(getTile(s, 5, MAP_HEIGHT + 10)).toBe(Tile.Hard);
  });
});

describe('플레이어 초기화', () => {
  it('각 플레이어는 자기 스폰 타일 중심에 선다', () => {
    const s = createInitialState(config);
    expect(s.players).toHaveLength(4);
    s.players.forEach((p, i) => {
      const spawn = SPAWN_TILES[i]!;
      expect(toTile(p.x)).toBe(spawn[0]);
      expect(toTile(p.y)).toBe(spawn[1]);
      expect(p.alive).toBe(true);
    });
  });

  it('개인전은 전원이 서로 다른 팀이다', () => {
    const s = createInitialState(config);
    expect(new Set(s.players.map((p) => p.teamId)).size).toBe(4);
  });

  it('2v2는 대각선끼리 한 팀이다', () => {
    const s = createInitialState({ seed: 1, teams: duoTeams() });
    expect(s.players[0]!.teamId).toBe(s.players[3]!.teamId);
    expect(s.players[1]!.teamId).toBe(s.players[2]!.teamId);
    expect(s.players[0]!.teamId).not.toBe(s.players[1]!.teamId);
  });

  it('플레이어가 2명 미만이거나 스폰보다 많으면 거부한다', () => {
    expect(() => createInitialState({ seed: 1, teams: [0] })).toThrow();
    expect(() => createInitialState({ seed: 1, teams: soloTeams(5) })).toThrow();
  });
});
