import { describe, expect, it } from 'vitest';
import { createGame } from '../game/createGame';
import { isWalkableAtLevel } from '../generation/generator';
import { neighbors, type Axial } from '../grid/geometry';
import { createMonster, type Monster } from '../monsters/brain';
import { SNIFFER } from '../monsters/content';
import type { GameState } from './types';
import { reduceGame } from './reducer';
import type { GameEvent } from './events';

function walkableNeighbor(state: GameState): Axial {
  return neighbors(state.player.pos).find((cell) => isWalkableAtLevel(state.level, cell))!;
}

function monsterAt(uid: string, pos: Axial, hp: number, intent: Monster['intent']): Monster {
  return { ...createMonster(SNIFFER, pos, uid), hp, maxHp: SNIFFER.hp, intent, state: 'chase' };
}

describe('事件流', () => {
  it('走一格产出 playerMoved，起点与终点都在事件里', () => {
    const state = createGame(12);
    const target = walkableNeighbor(state);
    const next = reduceGame(state, { type: 'move', target });

    const moved = next.events.filter((event) => event.type === 'playerMoved');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ from: state.player.pos, to: target });
  });

  it('近身攻击产出 playerAttacked，怪没死就不算移动', () => {
    const state = createGame(12);
    const target = walkableNeighbor(state);
    const withMonster: GameState = {
      ...state,
      monsters: [monsterAt('m1', target, 20, { kind: 'search' })],
    };

    const next = reduceGame(withMonster, { type: 'move', target });
    const attack = next.events.find((event) => event.type === 'playerAttacked') as GameEvent;
    expect(attack).toBeDefined();
    expect(attack).toMatchObject({ monsterUid: 'm1', damage: 5, killed: false });
    expect(next.events.some((event) => event.type === 'playerMoved')).toBe(false);
  });

  it('打死怪会额外产出 monsterDied，随后玩家踏进它的格子', () => {
    const state = createGame(12);
    const target = walkableNeighbor(state);
    const withMonster: GameState = {
      ...state,
      monsters: [monsterAt('m1', target, 3, { kind: 'search' })],
    };

    const next = reduceGame(withMonster, { type: 'move', target });
    expect(next.events.map((event) => event.type)).toEqual([
      'playerAttacked',
      'monsterDied',
      'playerMoved',
    ]);
    expect(next.player.pos).toEqual(target);
  });

  it('出牌打伤怪产出 playerAttacked', () => {
    const state = createGame(12);
    const target = walkableNeighbor(state);
    const withMonster: GameState = {
      ...state,
      monsters: [monsterAt('m1', target, 20, { kind: 'search' })],
    };

    const next = reduceGame(withMonster, {
      type: 'playCard',
      cardUid: 'strike-0',
      dieId: 0,
    });
    const attack = next.events.find((event) => event.type === 'playerAttacked');
    expect(attack).toMatchObject({ monsterUid: 'm1', damage: 6, killed: false });
  });

  it('回合结算里怪物打中玩家产出 monsterAttacked，伤害是减免后的值', () => {
    const state = createGame(12);
    const target = walkableNeighbor(state);
    const withMonster: GameState = {
      ...state,
      monsters: [monsterAt('m1', target, 20, { kind: 'attack', damage: SNIFFER.damage })],
    };

    const next = reduceGame(withMonster, { type: 'endTurn' });
    const attack = next.events.find((event) => event.type === 'monsterAttacked');
    expect(attack).toMatchObject({ monsterUid: 'm1', damage: SNIFFER.damage, avoided: false });
    expect(next.player.hp).toBe(100 - SNIFFER.damage);
  });

  it('被拒绝的行动不会产生新事件', () => {
    const state = createGame(12);
    const rejected = reduceGame(state, { type: 'move', target: { q: 12, r: 9 } });
    expect(rejected.events).toBe(state.events);
  });
});
