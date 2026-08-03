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

  // 물방울은 닿으면 터진다. 누가 터뜨렸는지가 결과를 가른다
  const contact = contactOnTile(state, p, tx, ty);
  if (contact === 'enemy') {
    p.alive = false;
    return;
  }
  if (contact === 'ally') {
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

  if (--p.statusTicks <= 0) p.alive = false;
}

/**
 * 같은 타일에 있는 멀쩡한 플레이어가 누구인가.
 *
 * 아군에게도 구조 수단을 준다. 물줄기로만 구출할 수 있게 하면
 * 창이 트랩 지속(5초) − 신관(3초) = 2초뿐이고 물풍선을 바로 옆에 놓아야 해서,
 * 실제 플레이에서는 구출이 사실상 불가능하다.
 * 달려가서 닿는 것이 가장 직관적인 구조 동작이기도 하다.
 *
 * 둘 다 있으면 적이 이긴다 — 아군이 먼저 닿았다면 이미 풀려났을 것이기 때문이다.
 */
function contactOnTile(
  state: GameState,
  victim: Player,
  tx: number,
  ty: number,
): 'enemy' | 'ally' | null {
  let ally = false;
  for (const o of state.players) {
    if (o.id === victim.id || !o.alive) continue;
    // 갇힌 사람은 남을 구할 수도, 밟을 수도 없다
    if (o.status === PlayerStatus.Trapped) continue;
    const [ox, oy] = playerTile(o);
    if (ox !== tx || oy !== ty) continue;
    if (o.teamId !== victim.teamId) return 'enemy';
    ally = true;
  }
  return ally ? 'ally' : null;
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
