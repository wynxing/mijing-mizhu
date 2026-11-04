import { describe, expect, it } from 'vitest';
import { createGame } from '../game/createGame';
import { levelAsCellGrid } from '../generation/generator';
import { findPath } from '../grid/path';
import { areAdjacent, neighbors, offsetToAxial } from '../grid/geometry';
import { movementPoints, type Die } from '../dice/dice';
import { hashGame, snapshotGame } from '../../sim/snapshot';
import { canMove, hasLegalAction, movementPointsOf, reduceGame } from './reducer';
import type { GameIntent, GameState } from './types';

function diceWith(values: number[]): Die[] {
  return values.map((value, id) => ({ id, value, reserved: false }));
}

function assertPointConsistency(state: GameState): void {
  const reservedSum = state.dice
    .filter((die) => die.reserved)
    .reduce((sum, die) => sum + die.value, 0);
  const unreservedSum = state.dice
    .filter((die) => !die.reserved)
    .reduce((sum, die) => sum + die.value, 0);
  expect(movementPoints(state.dice, state.spentPoints)).toBe(unreservedSum - state.spentPoints);
  expect(state.spentPoints).toBeGreaterThanOrEqual(0);
  expect(movementPointsOf(state)).toBeGreaterThanOrEqual(0);
  expect(reservedSum).toBeGreaterThanOrEqual(0);
}

describe('开局', () => {
  it('第一回合已掷骰，迷雾只包含起点', () => {
    const state = createGame(12);
    expect(state.turn).toBe(1);
    expect(state.dice).toHaveLength(3);
    expect(movementPointsOf(state)).toBeGreaterThanOrEqual(3);
    expect(state.listenUsed).toBe(0);
    expect(state.spentPoints).toBe(0);
    expect(state.status).toBe('playing');
    expect(state.fog.visited.size).toBe(1);
    expect(state.fog.visited.has(`${state.level.start.q},${state.level.start.r}`)).toBe(true);
    assertPointConsistency(state);
  });
});

describe('移动', () => {
  it('移动消耗 1 点并把目标标记为已踏足', () => {
    const state = createGame(12);
    const target = neighbors(state.player.pos).find(
      (cell) => state.level.cells[cell.r * state.level.width + (cell.q + (cell.r - (cell.r & 1)) / 2)] === 0,
    )!;
    const before = movementPointsOf(state);
    const next = reduceGame(state, { type: 'move', target });
    expect(next.player.pos).toEqual(target);
    expect(movementPointsOf(next)).toBe(before - 1);
    expect(next.spentPoints).toBe(1);
    expect(next.fog.visited.has(`${target.q},${target.r}`)).toBe(true);
    expect(next.notice).toBeNull();
  });

  it('移进墙、不相邻或移动点不足时拒绝且局面不变', () => {
    const state = createGame(12);
    const wall = offsetToAxial(0, 0);
    const before = snapshotGame(state);

    const intoWall = reduceGame(state, { type: 'move', target: wall });
    expect(snapshotGame(intoWall)).toBe(before);
    expect(intoWall.notice).not.toBeNull();

    const far = offsetToAxial(12, 9);
    const tooFar = reduceGame(state, { type: 'move', target: far });
    expect(snapshotGame(tooFar)).toBe(before);
    expect(tooFar.notice).toBe('只能移动到相邻格');

    const drained: GameState = {
      ...state,
      spentPoints: state.dice.reduce((sum, die) => sum + die.value, 0),
    };
    const target = neighbors(drained.player.pos)[0];
    const noPoints = reduceGame(drained, { type: 'move', target });
    expect(noPoints.notice).toBe('移动点不足');
    expect(noPoints.spentPoints).toBe(drained.spentPoints);
  });

  it('踏上出口即胜利', () => {
    const state = createGame(12);
    const path = findPath(levelAsCellGrid(state.level), state.level.start, state.level.exit)!;
    const beforeExit = path[path.length - 2];
    const rich: GameState = {
      ...state,
      player: { ...state.player, pos: beforeExit },
      dice: diceWith([6, 6, 6]),
    };
    expect(areAdjacent(beforeExit, state.level.exit)).toBe(true);
    const won = reduceGame(rich, { type: 'move', target: state.level.exit });
    expect(won.status).toBe('won');
    expect(won.log.some((entry) => entry.text.includes('出口'))).toBe(true);
  });

  it('canMove 给出可读的理由', () => {
    const state = createGame(12);
    expect(canMove(state, state.player.pos).ok).toBe(false);
    expect(canMove(state, offsetToAxial(12, 9)).reason).toBe('只能移动到相邻格');
  });
});

describe('回合流转', () => {
  it('结束回合后换新骰子并清零点数与探听次数', () => {
    let state = createGame(12);
    state = reduceGame(state, { type: 'listen' });
    state = reduceGame(state, { type: 'listen' });
    const beforeDice = state.dice.map((die) => die.value);
    state = reduceGame(state, { type: 'endTurn' });
    expect(state.turn).toBe(2);
    expect(state.listenUsed).toBe(0);
    expect(state.spentPoints).toBe(0);
    expect(state.dice).toHaveLength(3);
    expect(state.dice.every((die) => !die.reserved)).toBe(true);
    expect(state.dice.map((die) => die.value)).not.toEqual(beforeDice);
  });

  it('结束回合保留已探知的迷雾', () => {
    let state = createGame(12);
    state = reduceGame(state, { type: 'listen' });
    const knownBefore = state.fog.known.size;
    state = reduceGame(state, { type: 'endTurn' });
    expect(state.fog.known.size).toBe(knownBefore);
    expect(state.fog.visited.size).toBeGreaterThanOrEqual(1);
  });

  it('无路可走时自动结束回合，存在预留骰子时不触发', () => {
    let state = createGame(12);
    state = { ...state, dice: diceWith([1, 1, 1]) };
    const path = findPath(levelAsCellGrid(state.level), state.level.start, state.level.exit)!;
    for (const target of path.slice(1, 4)) {
      state = reduceGame(state, { type: 'move', target });
    }
    expect(state.turn).toBe(2);
    expect(movementPointsOf(state)).toBeGreaterThan(0);
  });

  it('预留骰子后仍可取消预留', () => {
    let state = createGame(12);
    state = { ...state, dice: diceWith([1, 1, 1]) };
    const reserved = reduceGame(state, { type: 'reserveDie', dieId: 0 });
    expect(reserved.dice[0].reserved).toBe(true);
    expect(movementPointsOf(reserved)).toBe(2);
    expect(hasLegalAction(reserved)).toBe(true);
    const released = reduceGame(reserved, { type: 'unreserveDie', dieId: 0 });
    expect(released.dice[0].reserved).toBe(false);
    expect(movementPointsOf(released)).toBe(3);
  });
});

describe('骰子分配的穷举', () => {
  it('所有点数组合 × 所有排列 × 所有预留子集都合法可完成', () => {
    const values: number[] = [];
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          values.push(a, b, c);
        }
      }
    }
    expect(values.length / 3).toBe(216);

    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];

    let cases = 0;
    const failures: string[] = [];
    const base = createGame(12);
    const check = (state: GameState, label: string) => {
      const unreservedSum = state.dice
        .filter((die) => !die.reserved)
        .reduce((sum, die) => sum + die.value, 0);
      if (movementPoints(state.dice, state.spentPoints) !== unreservedSum - state.spentPoints) {
        failures.push(`${label}: 移动点公式不符`);
      }
      if (state.spentPoints < 0) failures.push(`${label}: 已花点为负`);
      if (movementPointsOf(state) < 0) failures.push(`${label}: 移动点为负`);
    };
    for (let i = 0; i < values.length; i += 3) {
      const triple = values.slice(i, i + 3);
      for (const perm of permutations) {
        const assigned = [triple[perm[0]], triple[perm[1]], triple[perm[2]]];
        for (let mask = 0; mask < 8; mask++) {
          cases++;
          let state: GameState = { ...base, dice: diceWith(assigned) };
          const total = assigned.reduce((sum, value) => sum + value, 0);

          for (let id = 0; id < 3; id++) {
            if (mask & (1 << id)) {
              state = reduceGame(state, { type: 'reserveDie', dieId: id });
            }
          }
          const reservedSum = assigned
            .filter((_, id) => mask & (1 << id))
            .reduce((sum, value) => sum + value, 0);
          expect(movementPointsOf(state)).toBe(total - reservedSum);
          expect(state.spentPoints).toBe(0);
          check(state, `case ${cases}`);

          for (let id = 0; id < 3; id++) {
            if (mask & (1 << id)) {
              state = reduceGame(state, { type: 'unreserveDie', dieId: id });
            }
          }
          expect(movementPointsOf(state)).toBe(total);
          check(state, `case ${cases}`);

          state = reduceGame(state, { type: 'endTurn' });
          if (state.turn !== 2) failures.push(`case ${cases}: 回合数应为 2`);
          if (state.spentPoints !== 0) failures.push(`case ${cases}: 结束回合后花费未清零`);
          if (state.listenUsed !== 0) failures.push(`case ${cases}: 结束回合后探听次数未复位`);
        }
      }
    }
    expect(cases).toBe(216 * 6 * 8);
    expect(failures.slice(0, 5)).toEqual([]);
  }, 60_000);
});

describe('纯度与确定性', () => {
  it('reducer 不修改传入的局面', () => {
    const state = createGame(12);
    const before = snapshotGame(state);
    reduceGame(state, { type: 'listen' });
    reduceGame(state, { type: 'endTurn' });
    expect(snapshotGame(state)).toBe(before);
  });

  it('同种子同操作序列产生完全相同的局面', () => {
    const intents: GameIntent[] = [
      { type: 'listen' },
      { type: 'move', target: offsetToAxial(2, 1) },
      { type: 'endTurn' },
      { type: 'listen' },
      { type: 'listen' },
      { type: 'endTurn' },
    ];
    const run = () => {
      let state = createGame(77);
      for (const intent of intents) {
        state = reduceGame(state, intent);
      }
      return hashGame(state);
    };
    expect(run()).toBe(run());
  });

  it('操作序列不同则局面不同', () => {
    const a = reduceGame(createGame(77), { type: 'listen' });
    const b = reduceGame(createGame(77), { type: 'endTurn' });
    expect(hashGame(a)).not.toBe(hashGame(b));
  });
});
