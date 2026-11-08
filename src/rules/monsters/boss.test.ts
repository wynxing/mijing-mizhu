import { describe, expect, it } from 'vitest';
import { Rng32 } from '../../core/rng';
import { axialKey, neighbor } from '../grid/geometry';
import { createGame } from '../game/createGame';
import {
  BOSS_AOE_DAMAGE,
  BOSS_AOE_RADIUS,
  BOSS_PHASE_HEAL,
  advanceBossPhase,
  createMonster,
  rollIntent,
  updatePerception,
} from './brain';
import { monsterDef } from './content';
import { reduceGame } from '../turn/reducer';
import type { GameState } from '../turn/types';

function guardianAt(state: GameState) {
  const index = state.monsters.findIndex((monster) => monster.def.id === 'guardian');
  return { index, monster: state.monsters[index] };
}

/** 把守卫改成指定阶段与血量，其余状态不动。 */
function setBoss(state: GameState, phase: 0 | 1 | 2 | 3, hp: number): GameState {
  const { index } = guardianAt(state);
  return {
    ...state,
    monsters: state.monsters.map((monster, i) =>
      i === index ? { ...monster, bossPhase: phase, hp, state: 'chase' } : monster,
    ),
  };
}

describe('守卫三阶段', () => {
  it('未激活时只守原位，进入出口房才觉醒', () => {
    const dormant = createMonster(monsterDef('guardian'), { q: 0, r: 0 }, 'g');
    const scent = { cells: new Map([[axialKey({ q: 1, r: 0 }), 5]]) };

    const asleep = updatePerception(dormant, scent, { q: 1, r: 0 }, 0, false);
    expect(asleep.bossPhase).toBe(0);
    expect(asleep.state).toBe('wander');
    expect(rollIntent(asleep, new Rng32(1), { q: 1, r: 0 }).intent.kind).toBe('search');

    const awake = updatePerception(dormant, scent, { q: 1, r: 0 }, 0, true);
    expect(awake.bossPhase).toBe(1);
    expect(awake.state).toBe('chase');
  });

  it('阶段阈值 2/3、1/3，只进不退', () => {
    const base = createMonster(monsterDef('guardian'), { q: 0, r: 0 }, 'g');
    const awake = { ...base, bossPhase: 1 as const, state: 'chase' as const };

    const maxHp = base.maxHp;
    const phase2 = advanceBossPhase({ ...awake, hp: Math.floor(maxHp * 0.6) });
    expect(phase2.bossPhase).toBe(2);
    expect(phase2.hp).toBe(Math.min(maxHp, Math.floor(maxHp * 0.6) + BOSS_PHASE_HEAL));

    const phase3 = advanceBossPhase({ ...awake, hp: Math.floor(maxHp * 0.3) });
    expect(phase3.bossPhase).toBe(3);

    // 回血后仍停在阶段 2，不降级
    const stays = advanceBossPhase({ ...awake, bossPhase: 2 as const, hp: Math.floor(maxHp * 0.9) });
    expect(stays.bossPhase).toBe(2);

    // 未激活的守卫不因扣血自动跳阶段（由被攻击唤醒为阶段 1）
    const dormant = advanceBossPhase({ ...base, hp: 10 });
    expect(dormant.bossPhase).toBe(0);
  });

  it('阶段 3 的意图是固定半径与伤害的 AOE', () => {
    const base = createMonster(monsterDef('guardian'), { q: 0, r: 0 }, 'g');
    const phase3 = { ...base, bossPhase: 3 as const, state: 'chase' as const };
    const rolled = rollIntent(phase3, new Rng32(1), { q: 2, r: 0 });
    expect(rolled.intent).toEqual({
      kind: 'aoe',
      radius: BOSS_AOE_RADIUS,
      damage: BOSS_AOE_DAMAGE,
    });
  });

  it('进入阶段 2 的回合一次性召唤 2 只嗅犬并回血，之后不再召唤', () => {
    const base = createGame(3);
    const lowHp = Math.floor(guardianAt(base).monster.maxHp * 0.6);
    const state = setBoss(base, 1, lowHp);
    const before = guardianAt(state).monster;
    const after = reduceGame(state, { type: 'endTurn' });
    const { monster: boss } = guardianAt(after);

    expect(boss.bossPhase).toBe(2);
    expect(boss.hp).toBe(Math.min(boss.maxHp, lowHp + BOSS_PHASE_HEAL));
    expect(boss.summoned).toBe(true);
    expect(after.monsters.length).toBe(state.monsters.length + 2);
    expect(after.monsters.filter((m) => m.uid.includes('-summon-'))).toHaveLength(2);
    expect(after.events.some((event) => event.type === 'bossPhase')).toBe(true);
    expect(after.events.filter((event) => event.type === 'monsterSummoned')).toHaveLength(2);
    expect(before.summoned).toBe(false);

    const next = reduceGame(after, { type: 'endTurn' });
    expect(next.monsters.filter((m) => m.uid.includes('-summon-'))).toHaveLength(2);
  });

  it('守卫未死时踏出口不判胜，击杀后才赢', () => {
    const base = createGame(3);
    const exit = base.level.exit;
    const { monster } = guardianAt(base);
    // 主路径的倒数第二格必然与出口相邻且是地面
    const from = base.level.mainPath[base.level.mainPath.length - 2];
    expect(from).toBeDefined();
    if (axialKey(from) === axialKey(monster.pos)) return;

    const blocked: GameState = {
      ...base,
      player: { ...base.player, pos: from! },
      monsters: [monster],
    };
    const stepped = reduceGame(blocked, { type: 'move', target: exit });
    expect(stepped.player.pos).toEqual(exit);
    expect(stepped.status).toBe('playing');
    expect(stepped.log.some((entry) => entry.text === '守卫还挡在出口前')).toBe(true);

    const cleared: GameState = { ...blocked, monsters: [] };
    expect(reduceGame(cleared, { type: 'move', target: exit }).status).toBe('won');
  });

  it('站在出口上击杀守卫立即判胜', () => {
    const base = createGame(3);
    const onExit: GameState = {
      ...base,
      player: { ...base.player, pos: base.level.exit },
      monsters: [],
    };
    expect(reduceGame(onExit, { type: 'listen' }).status).toBe('won');
  });

  it('被近战攻击会唤醒守卫', () => {
    const base = createGame(3);
    const { monster } = guardianAt(base);
    const prepared: GameState = {
      ...base,
      player: { ...base.player, pos: neighbor(monster.pos, 0) },
      monsters: [monster],
    };
    const after = reduceGame(prepared, { type: 'move', target: monster.pos });
    const struck = after.monsters.find((m) => m.def.id === 'guardian');
    expect(struck).toBeDefined();
    expect(struck!.bossPhase).toBe(1);
    expect(struck!.hp).toBeLessThan(monster.hp);
  });

  it('AOE 走伤害管线：闪避可以把 18 点完全免掉', () => {
    const state = setBoss(createGame(3), 3, 60);
    const { monster } = guardianAt(state);
    const first = reduceGame(
      { ...state, player: { ...state.player, pos: neighbor(monster.pos, 0) } },
      { type: 'endTurn' },
    );
    // 上一步已经预掷出 AOE 意图；这一步带着闪避挨打
    const dodged = reduceGame(
      {
        ...first,
        buffs: [{ id: 'dodge', kind: 'evadeOnce', name: '闪避', turns: 1, amount: 1 }],
      },
      { type: 'endTurn' },
    );
    const aoe = dodged.events.filter((event) => event.type === 'bossAoE');
    expect(aoe.length).toBeGreaterThan(0);
    for (const event of aoe) {
      if (event.type === 'bossAoE') expect(event.damage).toBe(0);
    }
  });
});
