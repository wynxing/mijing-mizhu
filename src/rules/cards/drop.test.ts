import { describe, expect, it } from 'vitest';
import { createGame } from '../game/createGame';
import { isWalkableAtLevel } from '../generation/generator';
import { neighbors, type AxialKey } from '../grid/geometry';
import type { Die } from '../dice/dice';
import { reduceGame } from '../turn/reducer';
import { DROP_POOL, HAND_LIMIT, drawCard } from './drop';
import { STARTING_HAND, cardDef } from './content';

function diceWith(values: number[]): Die[] {
  return values.map((value, id) => ({ id, value, reserved: false }));
}

function adjacentFloor(seed: number) {
  const state = createGame(seed);
  return { state, target: neighbors(state.player.pos).find((cell) => isWalkableAtLevel(state.level, cell))! };
}

describe('战斗掉落', () => {
  it('掉落池是初始牌组之外的 9 张', () => {
    expect(DROP_POOL).toHaveLength(9);
    for (const card of DROP_POOL) expect(STARTING_HAND).not.toContain(card.id);
  });

  it('同一随机状态抽出同一张卡', () => {
    const first = drawCard([], 12345, 1);
    const second = drawCard([], 12345, 1);
    expect(first?.card.def.id).toBe(second?.card.def.id);
    expect(first?.rngState).toBe(second?.rngState);
    expect(first?.card.uid).toBe(second?.card.uid);
  });

  it('抽卡会推进随机状态', () => {
    const drop = drawCard([], 1, 1);
    expect(drop?.rngState).not.toBe(1);
  });

  it('手牌满时不再掉落，也不消耗随机数', () => {
    const ids = [...STARTING_HAND, ...DROP_POOL.slice(0, 5).map((card) => card.id)];
    const hand = ids.map((id, index) => ({ uid: `${id}-${index}`, def: cardDef(id) }));
    expect(hand).toHaveLength(HAND_LIMIT);
    expect(drawCard(hand, 777, 1)).toBeNull();
  });

  it('近战击杀后手牌 +1', () => {
    const { state, target } = adjacentFloor(9);
    const monster = state.monsters[0];
    const prepared = {
      ...state,
      level: { ...state.level, traps: new Set<AxialKey>() },
      monsters: [{ ...monster, pos: target, hp: 1 }],
      dice: diceWith([6, 6, 6]),
    };
    const next = reduceGame(prepared, { type: 'move', target });
    expect(next.monsters).toHaveLength(0);
    expect(next.hand).toHaveLength(state.hand.length + 1);
    expect(DROP_POOL.map((card) => card.id)).toContain(next.hand.at(-1)!.def.id);
    expect(next.rngState).not.toBe(state.rngState);
  });

  it('卡牌击杀后手牌 +1', () => {
    const { state, target } = adjacentFloor(9);
    const monster = state.monsters[0];
    const prepared = {
      ...state,
      level: { ...state.level, traps: new Set<AxialKey>() },
      hand: [{ uid: 'strike-0', def: cardDef('strike') }],
      monsters: [{ ...monster, pos: target, hp: 1 }],
      dice: diceWith([6, 6, 6]),
    };
    const next = reduceGame(prepared, { type: 'playCard', cardUid: 'strike-0', dieId: 0 });
    expect(next.monsters).toHaveLength(0);
    expect(next.hand).toHaveLength(1);
    expect(DROP_POOL.map((card) => card.id)).toContain(next.hand[0].def.id);
  });
});
