import { Rng32 } from '../core/rng';
import { axialKey, hexDistance, type Axial } from '../rules/grid/geometry';
import { findPath } from '../rules/grid/path';
import {
  DEFAULT_GEN_PARAMS,
  generateLevel,
  levelAsCellGrid,
  type Level,
} from '../rules/generation/generator';
import { addScent, createScent, decayScent, type ScentState } from '../rules/fog/scent';
import { monsterDef as monsterDefOf } from '../rules/monsters/content';
import {
  actMonster,
  createMonster,
  rollIntent,
  updatePerception,
  type Monster,
} from '../rules/monsters/brain';
import { rollDice, movementPoints } from '../rules/dice/dice';

export type Policy = 'run' | 'fight' | 'escape';

/** 玩家基础攻击力（设计文档 §6.5）。 */
export const PLAYER_BASE_ATTACK = 5;

export interface RunResult {
  seed: number;
  policy: Policy;
  reachedExit: boolean;
  turns: number;
  turnsInChase: number;
  damageTaken: number;
  chaseEndedByEscape: boolean;
  minDistance: number;
  avgDistance: number;
  /** 与怪物交战过的次数。 */
  engagements: number;
  /** 击杀的怪物数。 */
  kills: number;
}

export interface BalanceReport {
  policy: Policy;
  runs: number;
  reachedExitRate: number;
  avgTurns: number;
  avgDamage: number;
  avgChaseTurns: number;
  chaseEndRate: number;
  avgMinDistance: number;
  avgEngagements: number;
  avgKills: number;
}

/** 玩家的回合策略：跑、原地打、原地躲。 */
interface PolicyOptions {
  /** 遭遇战时站在原地花掉的移动点（模拟出一张卡的费用）。 */
  fightCost: number;
  /** 甩开追击时静止的回合数。 */
  hideTurns: number;
  /** 触发躲藏的怪物距离。 */
  hideDistance: number;
}

const POLICY_OPTIONS: Record<Policy, PolicyOptions> = {
  run: { fightCost: 0, hideTurns: 0, hideDistance: 0 },
  fight: { fightCost: 6, hideTurns: 0, hideDistance: 0 },
  escape: { fightCost: 0, hideTurns: 2, hideDistance: 3 },
};

/**
 * 单局模拟：玩家朝出口移动，怪物按三态规则循味追击。
 * 规则层与正式游戏共用同一套代码，所以这里的结论对游戏有效。
 */
export function simulateRun(
  seed: number,
  policy: Policy,
  maxTurns = 60,
  monsterCount = 8,
): RunResult {
  const rng = new Rng32(seed);
  const level: Level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed });
  const map = levelAsCellGrid(level);
  const options = POLICY_OPTIONS[policy];

  let pos = level.start;
  let hp = 100;
  let turn = 1;
  let scent: ScentState = createScent();
  let stationaryTurns = 0;
  let turnsInChase = 0;
  let damageTaken = 0;
  let chaseEndedByEscape = false;
  let minDistance = Infinity;
  let distanceSum = 0;
  let distanceSamples = 0;
  let engagements = 0;
  let kills = 0;

  // 用游戏自己的布点逻辑，模拟结果才对游戏有效
  let monsters: Monster[] = level.monsters
    .slice(0, monsterCount)
    .map((placement) => createMonster(monsterDefOf(placement.defId), placement.pos));
  monsters = monsters.map((m) => rollIntent(m, rng, pos));

  while (turn <= maxTurns) {
    const dice = rollDice(rng);
    const points = movementPoints(dice, 0);

    const nearest = Math.min(...monsters.map((m) => hexDistance(m.pos, pos)));
    const shouldHide =
      options.hideTurns > 0 && nearest <= options.hideDistance && stationaryTurns < options.hideTurns;
    const shouldFight = options.fightCost > 0 && nearest <= 2;

    let budget = points;
    if (shouldFight) budget -= options.fightCost;

    const traversed: Axial[] = [];
    if (budget > 0 && !shouldHide) {
      const path = findPath(map, pos, level.exit);
      if (path) {
        for (let i = 1; i < path.length && budget > 0; i++) {
          const next = path[i];
          const blocker = monsters.find((m) => axialKey(m.pos) === axialKey(next));
          if (blocker) {
            // 进入怪物所在格 = 近战攻击：消耗 1 移动点，造成基础攻击力伤害
            budget--;
            engagements++;
            monsters = monsters.map((m) =>
              m === blocker ? { ...m, hp: m.hp - PLAYER_BASE_ATTACK } : m,
            );
            if (blocker.hp - PLAYER_BASE_ATTACK <= 0) {
              kills++;
              monsters = monsters.filter((m) => m !== blocker);
              pos = next;
              traversed.push(next);
            }
            break;
          }
          pos = next;
          traversed.push(next);
          budget--;
        }
      }
    }

    if (traversed.length === 0) stationaryTurns++;
    else stationaryTurns = 0;

    scent = addScent(scent, traversed);

    // 怪物行动
    for (const m of monsters) {
      const action = actMonster(m, map, pos, rng);
      monsters = monsters.map((item) => (item === m ? action.monster : item));
      hp -= action.damage;
      damageTaken += action.damage;
    }

    // 感知更新 + 预掷下一回合意图
    monsters = monsters.map((m) => {
      const perceived = updatePerception(m, scent, pos, stationaryTurns);
      return rollIntent(perceived, rng, pos);
    });

    const chasing = monsters.some((m) => m.state === 'chase');
    if (chasing) turnsInChase++;
    else if (turnsInChase > 0 && !chasing) chaseEndedByEscape = true;

    const distance = Math.min(...monsters.map((m) => hexDistance(m.pos, pos)));
    minDistance = Math.min(minDistance, distance);
    distanceSum += distance;
    distanceSamples++;

    scent = decayScent(scent);

    if (axialKey(pos) === axialKey(level.exit)) {
      return {
        seed,
        policy,
        reachedExit: true,
        turns: turn,
        turnsInChase,
        damageTaken,
        chaseEndedByEscape,
        minDistance: minDistance === Infinity ? 0 : minDistance,
        avgDistance: distanceSum / distanceSamples,
        engagements,
        kills,
      };
    }

    if (hp <= 0) {
      return {
        seed,
        policy,
        reachedExit: false,
        turns: turn,
        turnsInChase,
        damageTaken,
        chaseEndedByEscape,
        minDistance,
        avgDistance: distanceSum / distanceSamples,
        engagements,
        kills,
      };
    }

    turn++;
  }

  return {
    seed,
    policy,
    reachedExit: false,
    turns: maxTurns,
    turnsInChase,
    damageTaken,
    chaseEndedByEscape,
    minDistance: minDistance === Infinity ? 0 : minDistance,
    avgDistance: distanceSum / distanceSamples,
    engagements,
    kills,
  };
}



export function runBalance(
  policy: Policy,
  seeds: number,
  monsterCount = 8,
): BalanceReport {
  const results: RunResult[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    results.push(simulateRun(seed, policy, 60, monsterCount));
  }
  const avg = (pick: (r: RunResult) => number) =>
    results.reduce((sum, r) => sum + pick(r), 0) / results.length;

  return {
    policy,
    runs: results.length,
    reachedExitRate: results.filter((r) => r.reachedExit).length / results.length,
    avgTurns: avg((r) => r.turns),
    avgDamage: avg((r) => r.damageTaken),
    avgChaseTurns: avg((r) => r.turnsInChase),
    chaseEndRate: results.filter((r) => r.chaseEndedByEscape).length / results.length,
    avgMinDistance: avg((r) => r.minDistance),
    avgEngagements: avg((r) => r.engagements),
    avgKills: avg((r) => r.kills),
  };
}
