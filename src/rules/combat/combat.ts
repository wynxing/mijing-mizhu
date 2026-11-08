import { hasBuff, sumBuff, type Buff } from '../buffs/buffs';

/** 玩家基础攻击力（设计文档 §6.5）：卡牌打空时仍可徒手攻击。 */
export const PLAYER_BASE_ATTACK = 8;

export interface PlayerHit {
  /** 实际扣血。 */
  damage: number;
  /** 被闪避，完全免伤。 */
  dodged: boolean;
  /** 被免疫，完全免伤。 */
  immune: boolean;
}

/**
 * 玩家承受伤害：闪避（一次性免伤）→ 铁壁姿态（免疫）→ 铁壁（减伤）。
 * 防御卡可以把伤害降到 0，所以这里不设最低值。
 */
export function hitPlayer(amount: number, buffs: readonly Buff[]): PlayerHit {
  if (hasBuff(buffs, 'evadeOnce')) return { damage: 0, dodged: true, immune: false };
  if (hasBuff(buffs, 'immunity')) return { damage: 0, dodged: false, immune: true };
  const reduction = sumBuff(buffs, 'damageReduction');
  return { damage: Math.max(0, amount - reduction), dodged: false, immune: false };
}

/** 玩家造成的伤害：最终伤害 = max(1, 卡伤害 - 防御 - 减伤)。 */
export function damageDealt(amount: number, defense = 0, reduction = 0): number {
  return Math.max(1, amount - defense - reduction);
}

/** 玩家当前的攻击力（含战意等增伤）。 */
export function playerAttack(buffs: readonly Buff[]): number {
  return PLAYER_BASE_ATTACK + sumBuff(buffs, 'damageBonus');
}
