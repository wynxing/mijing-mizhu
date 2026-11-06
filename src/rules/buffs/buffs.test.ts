import { describe, expect, it } from 'vitest';
import { expireAtTurnEnd, tickBuffs, type Buff } from './buffs';

const immunity: Buff = { id: 'stance', kind: 'immunity', name: '铁壁姿态', turns: 2, amount: 1 };

describe('buff 生命周期', () => {
  it('免伤类在回合结束递减，第二次结束才移除', () => {
    const first = expireAtTurnEnd([immunity]);
    expect(first).toHaveLength(1);
    expect(first[0].turns).toBe(1);
    expect(expireAtTurnEnd(first)).toHaveLength(0);
  });

  it('回合开始的递减跳过免伤类', () => {
    expect(tickBuffs([immunity])).toEqual([immunity]);
  });

  it('其它 buff 在回合开始递减', () => {
    const buff: Buff = { id: 'battlecry', kind: 'damageBonus', name: '战意', turns: 3, amount: 2 };
    expect(tickBuffs([buff])[0].turns).toBe(2);
  });
});
