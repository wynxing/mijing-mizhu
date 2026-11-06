import { describe, expect, it } from 'vitest';
import { axialKey, neighbors } from '../grid/geometry';
import { isWalkableAtLevel } from '../generation/generator';
import { BROOD } from '../monsters/content';
import { createMonster } from '../monsters/brain';
import { createGame } from '../game/createGame';
import { reduceGame } from '../turn/reducer';
import type { GameState } from '../turn/types';
import { resolveTrap, TRAP_DAMAGE } from './trap';

function freeNeighbor(state: GameState) {
  const cell = neighbors(state.player.pos).find((candidate) => {
    if (!isWalkableAtLevel(state.level, candidate)) return false;
    return !state.monsters.some((monster) => axialKey(monster.pos) === axialKey(candidate));
  });
  if (!cell) throw new Error('起点没有可走的相邻格');
  return cell;
}

function withTrap(state: GameState, cell: { q: number; r: number }): GameState {
  return {
    ...state,
    level: { ...state.level, traps: new Set([axialKey(cell)]) },
  };
}

function cardByName(state: GameState, name: string) {
  const held = state.hand.find((item) => item.def.name === name);
  if (!held) throw new Error(`手牌里没有 ${name}`);
  return held;
}

describe('陷阱', () => {
  it('踩中扣血、施加负面状态并消耗陷阱', () => {
    const base = createGame(2);
    const target = freeNeighbor(base);
    const state = withTrap(base, target);

    const next = reduceGame(state, { type: 'move', target });

    expect(next.player.hp).toBe(base.player.hp - TRAP_DAMAGE);
    expect(next.level.traps.has(axialKey(target))).toBe(false);
    const debuff = next.buffs.find((buff) => buff.kind === 'bleed' || buff.kind === 'poison');
    expect(debuff).toBeDefined();
    expect(debuff!.turns).toBe(3);
    expect(next.events.some((event) => event.type === 'playerTrapped')).toBe(true);
    expect(next.rngState).not.toBe(state.rngState);
  });

  it('同一随机状态产生同一种负面状态', () => {
    const base = createGame(3);
    const target = freeNeighbor(base);
    const state = withTrap(base, target);

    const a = resolveTrap(state, target);
    const b = resolveTrap(state, target);
    expect(a.debuff).toBe(b.debuff);
    expect(a.state.rngState).toBe(b.state.rngState);
  });

  it('没有陷阱的格子不产生结算', () => {
    const base = createGame(4);
    const target = freeNeighbor(base);
    const result = resolveTrap(base, target);
    expect(result.events).toEqual([]);
    expect(result.state).toBe(base);
  });

  it('回合结束时流血按层数扣血并递减', () => {
    const base = createGame(5);
    const state: GameState = {
      ...base,
      monsters: [],
      buffs: [{ id: 'bleed', kind: 'bleed', name: '流血', turns: 3, amount: 3 }],
    };

    const next = reduceGame(state, { type: 'endTurn' });

    expect(next.player.hp).toBe(base.player.hp - 3);
    expect(next.buffs.find((buff) => buff.kind === 'bleed')!.turns).toBe(2);
  });

  it('中毒时治疗减半', () => {
    const base = createGame(6);
    const potion = cardByName(base, '药剂');
    const state: GameState = {
      ...base,
      player: { ...base.player, hp: 50 },
      buffs: [{ id: 'poison', kind: 'poison', name: '中毒', turns: 3, amount: 2 }],
      dice: base.dice.map((die) => ({ ...die, value: 6 })),
    };

    const next = reduceGame(state, {
      type: 'playCard',
      cardUid: potion.uid,
      dieId: state.dice[0].id,
    });

    expect(next.player.hp).toBe(60);
  });

  it('止血清除流血与中毒', () => {
    const base = createGame(7);
    const bandage = cardByName(base, '止血');
    const state: GameState = {
      ...base,
      buffs: [
        { id: 'bleed', kind: 'bleed', name: '流血', turns: 3, amount: 3 },
        { id: 'poison', kind: 'poison', name: '中毒', turns: 3, amount: 2 },
      ],
      dice: base.dice.map((die) => ({ ...die, value: 6 })),
    };

    const next = reduceGame(state, {
      type: 'playCard',
      cardUid: bandage.uid,
      dieId: state.dice[0].id,
    });

    expect(next.buffs.some((buff) => buff.kind === 'bleed')).toBe(false);
    expect(next.buffs.some((buff) => buff.kind === 'poison')).toBe(false);
    expect(next.player.hp).toBe(base.player.hp);
  });

  it('蛛巢每回合最多新增 2 个陷阱，且不放在玩家脚下', () => {
    const base = createGame(8);
    const broodPos = freeNeighbor(base);
    const state: GameState = {
      ...base,
      monsters: [createMonster(BROOD, broodPos, 'brood-1')],
    };

    const next = reduceGame(state, { type: 'endTurn' });
    const added = [...next.level.traps].filter((key) => !state.level.traps.has(key));

    expect(added.length).toBeGreaterThan(0);
    expect(added.length).toBeLessThanOrEqual(2);
    expect(next.level.traps.has(axialKey(next.player.pos))).toBe(false);
    expect(next.level.traps.has(axialKey(next.level.start))).toBe(false);
    expect(next.level.traps.has(axialKey(next.level.exit))).toBe(false);
  });
});
