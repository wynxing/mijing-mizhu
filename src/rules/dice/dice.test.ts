import { describe, expect, it } from 'vitest';
import { Rng32 } from '../../core/rng';
import {
  DICE_COUNT,
  findDie,
  movementPoints,
  reserveDie,
  rollDice,
  unreserveDie,
} from './dice';

describe('骰子', () => {
  it('掷出三颗骰子，点数在 1–6 之间', () => {
    const dice = rollDice(new Rng32(1));
    expect(dice).toHaveLength(DICE_COUNT);
    for (const die of dice) {
      expect(die.value).toBeGreaterThanOrEqual(1);
      expect(die.value).toBeLessThanOrEqual(6);
      expect(die.reserved).toBe(false);
    }
  });

  it('同一随机状态掷出同样的点数', () => {
    const a = rollDice(new Rng32(12345));
    const b = rollDice(new Rng32(12345));
    expect(a.map((d) => d.value)).toEqual(b.map((d) => d.value));
  });

  it('六个面出现频率接近均匀', () => {
    const rng = new Rng32(2024);
    const counts = new Array(7).fill(0);
    const rolls = 6000;
    for (let i = 0; i < rolls; i++) {
      counts[rollDice(rng)[0].value]++;
    }
    for (let face = 1; face <= 6; face++) {
      expect(Math.abs(counts[face] / rolls - 1 / 6)).toBeLessThan(0.02);
    }
  });

  it('移动点是未预留骰子的面值之和减去已花点', () => {
    const dice = [
      { id: 0, value: 5, reserved: false },
      { id: 1, value: 4, reserved: false },
      { id: 2, value: 1, reserved: true },
    ];
    expect(movementPoints(dice, 0)).toBe(9);
    expect(movementPoints(dice, 4)).toBe(5);
  });

  it('预留与取消预留精确对称', () => {
    const dice = [
      { id: 0, value: 6, reserved: false },
      { id: 1, value: 3, reserved: false },
      { id: 2, value: 2, reserved: false },
    ];
    const reserved = reserveDie(dice, 1);
    expect(findDie(reserved, 1)!.reserved).toBe(true);
    expect(movementPoints(reserved, 0)).toBe(8);
    const back = unreserveDie(reserved, 1);
    expect(findDie(back, 1)!.reserved).toBe(false);
    expect(movementPoints(back, 0)).toBe(11);
  });

  it('预留的骰子不再贡献移动点', () => {
    const dice = [
      { id: 0, value: 1, reserved: true },
      { id: 1, value: 1, reserved: true },
      { id: 2, value: 1, reserved: true },
    ];
    expect(movementPoints(dice, 0)).toBe(0);
    expect(movementPoints(dice, 1)).toBe(-1);
  });
});
