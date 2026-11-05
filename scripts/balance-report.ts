import { runBalance, type BalanceReport } from '../src/sim/balance';
import { SNIFFER, STONEWARDEN, WRAITH, type MonsterDef } from '../src/rules/monsters/content';

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

function sweep(title: string, def: MonsterDef, count: number): void {
  console.log(`\n=== ${title} ===`);
  for (const policy of ['run', 'fight', 'escape'] as const) {
    console.log(line(`策略 ${policy}`, runBalance(policy, SEEDS, def, count)));
  }
}

sweep('嗅犬 · 1 只', SNIFFER, 1);
sweep('嗅犬 · 14 只（文档怪物预算）', SNIFFER, 14);

console.log('\n=== 14 只 · 不同怪物（策略 run）===');
for (const def of [SNIFFER, STONEWARDEN, WRAITH]) {
  console.log(line(def.name, runBalance('run', SEEDS, def, 14)));
}
