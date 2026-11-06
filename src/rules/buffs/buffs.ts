/** Buff 与负面状态的统一生命周期。 */
export type BuffKind =
  | 'damageBonus'
  | 'damageReduction'
  | 'immunity'
  | 'evadeOnce'
  | 'extraMove'
  | 'bleed'
  | 'poison';

export interface Buff {
  id: string;
  kind: BuffKind;
  name: string;
  /** 剩余回合数。 */
  turns: number;
  amount: number;
}

/** 免伤类：按设计文档 §3.1，在本回合结束时才失效，保证覆盖完整回合。 */
const TURN_END_KINDS: readonly BuffKind[] = ['immunity', 'evadeOnce'];

export function addBuff(buffs: readonly Buff[], buff: Buff): Buff[] {
  return [...buffs, buff];
}

/** 回合开始：时长递减，归零移除。 */
export function tickBuffs(buffs: readonly Buff[]): Buff[] {
  const out: Buff[] = [];
  for (const buff of buffs) {
    if (TURN_END_KINDS.includes(buff.kind)) {
      out.push(buff);
      continue;
    }
    if (buff.turns - 1 > 0) out.push({ ...buff, turns: buff.turns - 1 });
  }
  return out;
}

/** 回合结束：免伤类递减，归零才失效。 */
export function expireAtTurnEnd(buffs: readonly Buff[]): Buff[] {
  const out: Buff[] = [];
  for (const buff of buffs) {
    if (!TURN_END_KINDS.includes(buff.kind)) {
      out.push(buff);
      continue;
    }
    if (buff.turns - 1 > 0) out.push({ ...buff, turns: buff.turns - 1 });
  }
  return out;
}

export function sumBuff(buffs: readonly Buff[], kind: BuffKind): number {
  return buffs
    .filter((buff) => buff.kind === kind)
    .reduce((sum, buff) => sum + buff.amount, 0);
}

export function hasBuff(buffs: readonly Buff[], kind: BuffKind): boolean {
  return buffs.some((buff) => buff.kind === kind);
}

/** 同类 buff 不叠加，取剩余回合最多的那个。 */
export function mergeBuff(buffs: readonly Buff[], buff: Buff): Buff[] {
  const same = buffs.filter((item) => item.kind === buff.kind);
  const best = same.reduce<Buff | null>(
    (acc, item) => (acc === null || item.turns > acc.turns ? item : acc),
    null,
  );
  const rest = buffs.filter((item) => item.kind !== buff.kind);
  if (best && best.turns >= buff.turns) return rest;
  return [...rest, { ...buff, amount: buff.amount + (best?.amount ?? 0) }];
}
