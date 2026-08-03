import {
  MAX_BUBBLE_CAPACITY,
  MAX_POWER,
  MAX_SPEED_LEVEL,
  POTION_DURATION,
  SHIELD_DURATION,
  SKULL_DURATION,
} from '../constants.js';
import { playerTile } from '../geometry.js';
import { Rng } from '../rng.js';
import {
  ItemKind,
  PlayerStatus,
  SkullKind,
  type GameState,
  type Player,
} from '../types.js';

const SKULL_KINDS: readonly SkullKind[] = [
  SkullKind.SlowFeet,
  SkullKind.TinyBubble,
  SkullKind.ForcedPlace,
];

/** 아이템 획득과 일시 효과 타이머 */
export function applyItems(state: GameState): void {
  const rng = new Rng(state.rng);

  for (const p of state.players) {
    if (p.potionTicks > 0) p.potionTicks--;
    if (p.skullTicks > 0 && --p.skullTicks === 0) p.skullKind = SkullKind.None;

    if (!p.alive || p.status === PlayerStatus.Trapped) continue;

    const [tx, ty] = playerTile(p);
    const index = state.items.findIndex((it) => it.tx === tx && it.ty === ty);
    if (index < 0) continue;

    const [item] = state.items.splice(index, 1);
    if (item) collect(p, item.kind, rng);
  }

  state.rng = rng.seed;
}

function collect(p: Player, kind: ItemKind, rng: Rng): void {
  switch (kind) {
    case ItemKind.Bubble:
      p.bubbleCapacity = Math.min(MAX_BUBBLE_CAPACITY, p.bubbleCapacity + 1);
      return;
    case ItemKind.Power:
      p.power = Math.min(MAX_POWER, p.power + 1);
      return;
    case ItemKind.Roller:
      p.speedLevel = Math.min(MAX_SPEED_LEVEL, p.speedLevel + 1);
      return;
    case ItemKind.Needle:
      p.needles++;
      return;
    case ItemKind.Potion:
      p.potionTicks = POTION_DURATION;
      return;
    case ItemKind.Skull:
      p.skullTicks = SKULL_DURATION;
      p.skullKind = SKULL_KINDS[rng.int(SKULL_KINDS.length)] ?? SkullKind.SlowFeet;
      return;
    case ItemKind.Shield:
      // 이미 무적이면 더 긴 쪽을 남긴다
      p.status = PlayerStatus.Invulnerable;
      p.statusTicks = Math.max(p.statusTicks, SHIELD_DURATION);
      return;
  }
}
