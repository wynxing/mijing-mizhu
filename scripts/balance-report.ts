import { runBalance, runBossDuel, type BalanceReport } from '../src/sim/balance';
import { CARDS } from '../src/rules/cards/content';

const SEEDS = 200;

function line(label: string, r: BalanceReport): string {
  return (
    `${label.padEnd(16)}` +
    `到出口 ${(r.reachedExitRate * 100).toFixed(0)}%`.padEnd(12) +
    `死亡 ${(r.deathRate * 100).toFixed(0)}%`.padEnd(10) +
    `超时 ${(r.timeoutRate * 100).toFixed(0)}%`.padEnd(10) +
    `回合 ${r.avgTurns.toFixed(1)}`.padEnd(11) +
    `追击 ${r.avgChaseTurns.toFixed(1)}`.padEnd(11) +
    `承伤 ${r.avgDamage.toFixed(1)}`.padEnd(12) +
    `交战 ${r.avgEngagements.toFixed(1)}`.padEnd(11) +
    `击杀 ${r.avgKills.toFixed(1)}`.padEnd(11) +
    `出牌 ${r.avgCardsPlayed.toFixed(1)}`.padEnd(11) +
    `甩开 ${(r.chaseEndRate * 100).toFixed(0)}%`
  );
}

function detail(r: BalanceReport): string {
  const byMonster = Object.entries(r.damageByMonster)
    .sort((a, b) => b[1] - a[1])
    .map(([name, total]) => `${name} ${(total / r.runs).toFixed(1)}`)
    .join(' / ');
  return (
    `  承伤拆分 怪物 ${r.avgMonsterDamage.toFixed(1)}（${byMonster}）` +
      ` / 陷阱 ${r.avgTrapDamage.toFixed(1)}（${r.avgTrapTriggers.toFixed(1)} 次）` +
      ` · 地图 填充 ${(r.avgFill * 100).toFixed(1)}%` +
      ` · 环 ${r.avgCycles.toFixed(0)}` +
      ` · 死路 ${r.avgDeadEnds.toFixed(1)}` +
      ` · 最短路 ${r.avgPathLength.toFixed(1)} 步`
  );
}

console.log(`=== 阶段 2 内容模拟（正式 reduceGame 驱动 · ${SEEDS} 局）===`);
console.log('  run / fight / escape 是全图视野的 oracle 下界；explore 只走迷雾里真能看到的格，局长与承伤验收看它。');
const reports = new Map<string, BalanceReport>();
for (const policy of ['run', 'fight', 'escape', 'explore'] as const) {
  const report = runBalance(policy, SEEDS);
  reports.set(policy, report);
  console.log(line(`策略 ${policy}`, report));
  console.log(detail(report));
}

console.log('\n=== 卡牌使用分布（策略 fight · 整批总次数）===');
const fight = reports.get('fight') as BalanceReport;
for (const card of CARDS) {
  const used = fight.cardUsage[card.id] ?? 0;
  console.log(
    `  ${card.name.padEnd(6)}${card.id.padEnd(12)}费用 ${card.cost}` +
      ` · 打出 ${String(used).padStart(5)} 次` +
      ` · 每局 ${(used / SEEDS).toFixed(2)}`,
  );
}

// 守卫单挑：只留守卫、玩家满血，用来单独校准 Boss 数值（§15 目标 30%–50%）。
// 这是「最佳情况」下界：真实一局到出口时血与手牌都有损耗，M6 人工通关是最终判据。
console.log('\n=== 守卫单挑（fight 策略 · 满血玩家 vs 守卫）===');
const duel = runBossDuel(SEEDS, 'fight');
console.log(
  `  失败 ${(duel.failureRate * 100).toFixed(0)}%`.padEnd(12) +
    ` · 回合 ${duel.avgTurns.toFixed(1)}`.padEnd(11) +
    ` · 承伤 ${duel.avgDamage.toFixed(1)}`,
);

// 预算低于 3 时守卫 + 战斗房嗅犬已经超额，generateValidLevel 必然失败。
console.log('\n=== 怪物预算扫描（策略 run · 走 monsterBudget，不截断布点）===');
for (const monsterBudget of [4, 6, 8, 10, 12, 14]) {
  console.log(line(`${monsterBudget} 只`, runBalance('run', SEEDS, { params: { monsterBudget } })));
}
