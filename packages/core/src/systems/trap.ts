import {
  ESCAPE_THRESHOLD,
  INVULN_DURATION,
  RESCUE_GRACE,
  TRAP_DURATION,
} from '../constants.js';
import { playerTile } from '../geometry.js';
import {
  PlayerStatus,
  type GameState,
  type InputFrame,
  type Player,
  type PlayerId,
} from '../types.js';

/**
 * 물방울 트랩 — 이 게임의 정체성.
 *
 * 물줄기에 맞아도 즉사가 아니라 물방울에 갇힌다. 거기서 네 갈래로 갈린다:
 *   - 5초 경과            → 사망
 *   - 방향키 연타         → 자력 탈출
 *   - 물줄기가 물방울 명중 → 즉시 구출 (소유자 무관, 원작 룰)
 *   - 적팀이 밟음         → 즉시 사망
 *
 * 구출이 소유자 무관이라, 갇힌 상대를 제거하는 유일한 수단은 밟기다.
 * "적을 가둔 뒤 그 근처에서 물풍선을 함부로 못 터뜨린다"는 긴장감이 여기서 나온다.
 */
export function applyTrap(state: GameState, inputs: Map<PlayerId, InputFrame>): void {
  for (const p of state.players) {
    if (!p.alive) continue;

    const [tx, ty] = playerTile(p);
    const inWater = state.waters.some((w) => w.tx === tx && w.ty === ty);

    if (p.status === PlayerStatus.Invulnerable) {
      // 무적 중에는 피격도 밟기도 없다. 탈출 직후 남아 있는 물줄기에 다시 걸리지 않게 한다
      if (--p.statusTicks <= 0) {
        p.status = PlayerStatus.Normal;
        p.statusTicks = 0;
      }
      continue;
    }

    if (p.status === PlayerStatus.Trapped) {
      updateTrapped(state, p, inputs.get(p.id), inWater, tx, ty);
      continue;
    }

    if (inWater) capture(p);
  }
}

function updateTrapped(
  state: GameState,
  p: Player,
  input: InputFrame | undefined,
  inWater: boolean,
  tx: number,
  ty: number,
): void {
  const trappedFor = TRAP_DURATION - p.statusTicks;

  if (inWater && trappedFor >= RESCUE_GRACE) {
    release(p);
    return;
  }

  // 자력 탈출: 방향을 바꿀 때마다 게이지가 오른다.
  // facing을 그대로 재사용한다 — 갇힌 동안에는 이동 시스템이 건드리지 않는다
  const move = input?.move ?? null;
  if (move !== null && move !== p.facing) {
    p.facing = move;
    p.escapeGauge++;
  }
  if (p.escapeGauge >= ESCAPE_THRESHOLD) {
    release(p);
    return;
  }

  if (isStompedByEnemy(state, p, tx, ty)) {
    p.alive = false;
    return;
  }

  if (--p.statusTicks <= 0) p.alive = false;
}

/** 적팀의 멀쩡한 플레이어가 같은 타일에 있으면 밟힌 것이다. 아군은 그냥 통과한다 */
function isStompedByEnemy(state: GameState, victim: Player, tx: number, ty: number): boolean {
  return state.players.some((o) => {
    if (o.id === victim.id || !o.alive) return false;
    if (o.teamId === victim.teamId) return false;
    if (o.status === PlayerStatus.Trapped) return false;
    const [ox, oy] = playerTile(o);
    return ox === tx && oy === ty;
  });
}

function capture(p: Player): void {
  // 바늘이 있으면 갇히지 않고 1개를 소모한다
  if (p.needles > 0) {
    p.needles--;
    p.status = PlayerStatus.Invulnerable;
    p.statusTicks = INVULN_DURATION;
    return;
  }
  p.status = PlayerStatus.Trapped;
  p.statusTicks = TRAP_DURATION;
  p.escapeGauge = 0;
}

function release(p: Player): void {
  p.status = PlayerStatus.Invulnerable;
  p.statusTicks = INVULN_DURATION;
  p.escapeGauge = 0;
}
