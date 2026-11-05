import { runBalance, type BalanceReport } from '../src/sim/balance';

const SEEDS = 200;

function line(label: string, r: BalanceReport): string {
  return (
    `${label.padEnd(20)}` +
    `到出口 ${(r.reachedExitRate * 100).toFixed(0)}%`.padEnd(13) +
    `回合 ${r.avgTurns.toFixed(1)}`.padEnd(10) +
    `追击 ${r.avgChaseTurns.toFixed(1)}`.padEnd(10) +
    `承伤 ${r.avgDamage.toFixed(1)}`.padEnd(10) +
    `交战 ${r.avgEngagements.toFixed(1)}`.padEnd(10) +
    `击杀 ${r.avgKills.toFixed(1)}`.padEnd(10) +
    `甩开 ${(r.chaseEndRate * 100).toFixed(0)}%`
  );
}

console.log('=== 阶段 1 机动性模拟（关卡自带布点 · 200 局）===');
for (const policy of ['run', 'fight', 'escape'] as const) {
  console.log(line(`策略 ${policy}`, runBalance(policy, SEEDS, 8)));
}

console.log('\n=== 怪物数量扫描（策略 run）===');
for (const count of [0, 2, 4, 6, 8, 10, 14]) {
  console.log(line(`${count} 只`, runBalance('run', SEEDS, count)));
}
