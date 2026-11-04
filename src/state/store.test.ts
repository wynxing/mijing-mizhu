import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './store';
import { reduceGame } from '../rules/turn/reducer';
import { snapshotGame } from '../sim/snapshot';

describe('Zustand store', () => {
  beforeEach(() => {
    useGameStore.getState().startGame(21);
  });

  it('开局后有规则状态与初始视图', () => {
    const { game, view } = useGameStore.getState();
    expect(game).not.toBeNull();
    expect(game!.turn).toBe(1);
    expect(view.zoom).toBe(1);
    expect(view.follow).toBe(true);
  });

  it('dispatch 与 reduceGame 行为一致', () => {
    const before = useGameStore.getState().game!;
    useGameStore.getState().dispatch({ type: 'listen' });
    const after = useGameStore.getState().game!;
    const expected = reduceGame(before, { type: 'listen' });
    expect(snapshotGame(after)).toBe(snapshotGame(expected));
  });

  it('非法操作不会改动规则状态', () => {
    const before = snapshotGame(useGameStore.getState().game!);
    useGameStore.getState().dispatch({ type: 'move', target: { q: 99, r: 99 } });
    const after = useGameStore.getState().game!;
    expect(snapshotGame(after)).toBe(before);
    expect(after.notice).not.toBeNull();
  });

  it('相机操作只动视图，不动规则状态', () => {
    const gameBefore = snapshotGame(useGameStore.getState().game!);
    useGameStore.getState().setFollow(false);
    useGameStore.getState().panBy(20, -10);
    useGameStore.getState().zoomAt(1.2, { w: 800, h: 600 }, { x: 400, y: 300 });
    expect(snapshotGame(useGameStore.getState().game!)).toBe(gameBefore);
    expect(useGameStore.getState().view.follow).toBe(false);
  });

  it('centerOnPlayer 把视图中心移到玩家位置', () => {
    useGameStore.getState().setFollow(false);
    useGameStore.getState().centerOnPlayer();
    const { view, game } = useGameStore.getState();
    expect(view.follow).toBe(true);
    expect(view.cx).not.toBe(0);
    expect(game).not.toBeNull();
  });

  it('restart 用同一种子重建同样的局面', () => {
    const before = snapshotGame(useGameStore.getState().game!);
    useGameStore.getState().dispatch({ type: 'restart' });
    expect(snapshotGame(useGameStore.getState().game!)).toBe(before);
  });
});
