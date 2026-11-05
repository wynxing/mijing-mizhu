import { describe, expect, it } from 'vitest';
import { axialKey, offsetToAxial } from '../grid/geometry';
import {
  addScent,
  clearScentAround,
  createScent,
  decayScent,
  highestScentWithin,
  inLowScentArea,
  scentAt,
} from './scent';

describe('气味场', () => {
  it('玩家途经的每一格气味 +1', () => {
    const cell = offsetToAxial(3, 3);
    const scent = addScent(createScent(), [cell, cell]);
    expect(scentAt(scent, cell)).toBe(2);
  });

  it('每回合全图衰减 1，下限为 0，归零的格子移出表', () => {
    const cell = offsetToAxial(3, 3);
    const scent = addScent(createScent(), [cell]);
    const once = decayScent(scent);
    expect(scentAt(once, cell)).toBe(0);
    expect(once.cells.has(axialKey(cell))).toBe(false);
  });

  it('范围内气味最高的格子会被选中', () => {
    const a = offsetToAxial(1, 1);
    const b = offsetToAxial(2, 1);
    const scent = addScent(createScent(), [a, a, a, b]);
    expect(highestScentWithin(scent, [a, b])).toEqual(a);
    expect(highestScentWithin(scent, [b])).toEqual(b);
    expect(highestScentWithin(createScent(), [a, b])).toBeNull();
  });

  it('相邻格气味都 ≤ 1 才算低气味区', () => {
    const player = offsetToAxial(5, 5);
    const neighbor = offsetToAxial(6, 5);
    // 邻格气味 2 → 不是低气味区
    const strong = addScent(createScent(), [player, neighbor, neighbor]);
    expect(inLowScentArea(strong, player)).toBe(false);

    // 邻格只剩 1 → 低气味区
    const mild = decayScent(strong);
    expect(inLowScentArea(mild, player)).toBe(true);
  });

  it('特殊地形把该格与相邻格的气味清零', () => {
    const center = offsetToAxial(4, 4);
    const neighbor = offsetToAxial(5, 4);
    const scent = addScent(createScent(), [center, neighbor]);
    const cleared = clearScentAround(scent, center);
    expect(scentAt(cleared, center)).toBe(0);
    expect(scentAt(cleared, neighbor)).toBe(0);
  });
});
