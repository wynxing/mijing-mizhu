import { describe, expect, it } from 'vitest';
import { createGame } from '../rules/game/createGame';
import { reduceGame } from '../rules/turn/reducer';
import { hashGame, hashString, levelHash, snapshotGame } from './snapshot';

describe('快照与哈希', () => {
  it('相同局面的快照稳定', () => {
    const a = createGame(31);
    const b = createGame(31);
    expect(snapshotGame(a)).toBe(snapshotGame(b));
    expect(hashGame(a)).toBe(hashGame(b));
  });

  it('快照可读且包含关键字段', () => {
    const snapshot = snapshotGame(createGame(31));
    expect(snapshot).toContain('turn=');
    expect(snapshot).toContain('dice=');
    expect(snapshot).toContain('visited=');
    expect(snapshot).toContain('level=');
  });

  it('局面不同则哈希不同', () => {
    const a = createGame(31);
    const b = reduceGame(a, { type: 'listen' });
    expect(hashGame(a)).not.toBe(hashGame(b));
  });

  it('哈希就是快照文本的 FNV-1a', () => {
    const state = createGame(31);
    expect(hashGame(state)).toBe(hashString(snapshotGame(state)));
  });

  it('迷雾差异会体现在快照里（Set 不会被序列化塌缩）', () => {
    const a = createGame(31);
    const b = reduceGame(a, { type: 'listen' });
    expect(snapshotGame(a)).not.toBe(snapshotGame(b));
    expect(snapshotGame(b)).toContain('known=');
  });

  it('关卡校验和随种子变化', () => {
    expect(levelHash(createGame(1).level)).not.toBe(levelHash(createGame(2).level));
  });
});
