import { INVULN_DURATION, RESCUE_GRACE, TRAP_DURATION } from '../constants.js';
import { playerTile } from '../geometry.js';
import { PlayerStatus, type GameState, type Player } from '../types.js';

/**
 * 물방울 트랩 — 이 게임의 정체성.
 *
 * 물줄기에 맞아도 즉사가 아니라 물방울에 갇힌다. 거기서 갈리는 길:
 *   - 5초 경과            → 사망
 *   - 아군이 닿음         → 즉시 구출
 *   - 아군의 물줄기가 명중 → 즉시 구출
 *   - 바늘을 갖고 있었음   → 애초에 갇히지 않는다 (1개 소모)
 *   - 적팀이 밟음         → 즉시 사망
 *
 * **혼자 힘으로는 빠져나올 수 없다.** 연타로 탈출하게 두었더니
 * 아무도 죽지 않아서 물방울에 가두는 행위 자체가 무의미해졌다.
 * 갇히면 팀에 기대야 한다는 것이 이 게임을 팀 게임으로 만든다.
 */
export function applyTrap(state: GameState): void {
  for (const p of state.players) {
    if (!p.alive) continue;

    const [tx, ty] = playerTile(p);

    if (p.status === PlayerStatus.Invulnerable) {
      // 무적 중에는 피격도 밟기도 없다. 탈출 직후 남아 있는 물줄기에 다시 걸리지 않게 한다
      if (--p.statusTicks <= 0) {
        p.status = PlayerStatus.Normal;
        p.statusTicks = 0;
      }
      continue;
    }

    if (p.status === PlayerStatus.Trapped) {
      updateTrapped(state, p, tx, ty);
      continue;
    }

    if (hitByWater(state, p, tx, ty)) capture(p);
  }
}

/** 이 플레이어의 타일에 물줄기가 있는가 */
function hitByWater(state: GameState, p: Player, tx: number, ty: number): boolean {
  return state.waters.some((w) => w.tx === tx && w.ty === ty);
}

function updateTrapped(state: GameState, p: Player, tx: number, ty: number): void {
  const trappedFor = TRAP_DURATION - p.statusTicks;

  // 아군의 물줄기가 물방울을 때리면 풀려난다.
  // 유예를 두는 이유: 물줄기는 0.5초 남아 있으므로, 없으면 나를 가둔 바로 그 물줄기가
  // 다음 틱에 나를 곧바로 풀어준다
  if (trappedFor >= RESCUE_GRACE && friendlyWaterAt(state, p, tx, ty)) {
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

  if (--p.statusTicks <= 0) p.alive = false;
}

/** 같은 팀(자기 것 포함)이 놓은 물줄기만 구출한다 */
function friendlyWaterAt(state: GameState, victim: Player, tx: number, ty: number): boolean {
  return state.waters.some((w) => {
    if (w.tx !== tx || w.ty !== ty) return false;
    const owner = state.players.find((o) => o.id === w.ownerId);
    return owner !== undefined && owner.teamId === victim.teamId;
  });
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
  // 바늘이 있으면 갇히지 않고 1개를 소모한다.
  // 혼자 힘으로 빠져나올 유일한 수단이라 값이 높다
  if (p.needles > 0) {
    p.needles--;
    p.status = PlayerStatus.Invulnerable;
    p.statusTicks = INVULN_DURATION;
    return;
  }
  p.status = PlayerStatus.Trapped;
  p.statusTicks = TRAP_DURATION;
}

function release(p: Player): void {
  p.status = PlayerStatus.Invulnerable;
  p.statusTicks = INVULN_DURATION;
}
