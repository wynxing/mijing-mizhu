import { describe, expect, it } from 'vitest';
import { runBalance, simulateRun } from './balance';

describe('平衡模拟', () => {
  it('同种子同策略两次运行完全一致', () => {
    expect(simulateRun(7, 'explore')).toEqual(simulateRun(7, 'explore'));
  });

  it('承伤等于怪物伤害加陷阱伤害，怪物拆分也加得回去', () => {
    const report = runBalance('fight', 6);
    expect(report.avgDamage).toBeCloseTo(report.avgMonsterDamage + report.avgTrapDamage, 6);
    const total = Object.values(report.damageByMonster).reduce((sum, n) => sum + n, 0);
    expect(total / report.runs).toBeCloseTo(report.avgMonsterDamage, 6);
  });

  it('怪物预算扫描真的改变布点数量', () => {
    const few = runBalance('run', 3, { params: { monsterBudget: 4 } });
    const many = runBalance('run', 3, { params: { monsterBudget: 12 } });
    expect(few.avgEngagements + few.avgDamage).not.toBe(many.avgEngagements + many.avgDamage);
  });
});