import { Rng32 } from '../../core/rng';
import { axialKey, type Axial } from '../grid/geometry';
import { mergeBuff, type Buff } from '../buffs/buffs';
import type { GameEvent } from '../turn/events';
import type { GameState } from '../turn/types';

/** 踩中陷阱的固定伤害（设计文档 §4.2）。 */
export const TRAP_DAMAGE = 5;

export type TrapDebuff = 'bleed' | 'poison';

const DEBUFFS: Record<TrapDebuff, Omit<Buff, 'kind'>> = {
  bleed: { id: 'bleed', name: '流血', turns: 3, amount: 3 },
  poison: { id: 'poison', name: '中毒', turns: 3, amount: 2 },
};

export interface TrapResolution {
  state: GameState;
  debuff: TrapDebuff | null;
  events: GameEvent[];
}

/** 陷阱的负面状态：流血与中毒对半分。 */
export function rollTrapDebuff(rngState: number): { debuff: TrapDebuff; rngState: number } {
  const rng = new Rng32(rngState);
  const debuff: TrapDebuff = rng.next() < 0.5 ? 'bleed' : 'poison';
  return { debuff, rngState: rng.state };
}

/**
 * 踩中陷阱：扣血、随机施加流血或中毒，并消耗该陷阱。
 * 纯函数：随机流只从 state.rngState 取一次。
 */
export function resolveTrap(state: GameState, cell: Axial): TrapResolution {
  const key = axialKey(cell);
  if (!state.level.traps.has(key)) {
    return { state, debuff: null, events: [] };
  }

  const rolled = rollTrapDebuff(state.rngState);
  const { debuff } = rolled;
  const traps = new Set(state.level.traps);
  traps.delete(key);

  const hp = Math.max(0, state.player.hp - TRAP_DAMAGE);
  const buff: Buff = { ...DEBUFFS[debuff], kind: debuff };

  return {
    state: {
      ...state,
      player: { ...state.player, hp },
      level: { ...state.level, traps },
      buffs: mergeBuff(state.buffs, buff),
      rngState: rolled.rngState,
    },
    debuff,
    events: [{ type: 'playerTrapped', at: cell, damage: TRAP_DAMAGE, debuff }],
  };
}

/** 陷阱负面状态每回合的伤害。 */
export function trapDebuffDamage(debuff: TrapDebuff): number {
  return DEBUFFS[debuff].amount;
}

/** 回合结束时的流血/中毒总伤害。 */
export function debuffDamage(buffs: readonly Buff[]): number {
  let damage = 0;
  for (const buff of buffs) {
    if (buff.kind === 'bleed' || buff.kind === 'poison') damage += buff.amount;
  }
  return damage;
}
