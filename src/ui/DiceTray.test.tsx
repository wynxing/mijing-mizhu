// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiceTray } from './DiceTray';
import { ActionBar } from './ActionBar';
import { useGameStore } from '../state/store';
import { movementPointsOfView } from '../state/selectors';

describe('HUD 组件', () => {
  beforeEach(() => {
    useGameStore.getState().startGame(64);
  });

  afterEach(() => {
    cleanup();
  });

  it('渲染三颗骰子与移动点', () => {
    render(<DiceTray />);
    expect(screen.getByTestId('die-0')).toBeInTheDocument();
    expect(screen.getByTestId('die-1')).toBeInTheDocument();
    expect(screen.getByTestId('die-2')).toBeInTheDocument();
    expect(screen.getByTestId('mp')).toHaveTextContent(
      String(movementPointsOfView(useGameStore.getState().game)),
    );
  });

  it('点击骰子即预留，移动点相应减少', () => {
    render(<DiceTray />);
    const before = movementPointsOfView(useGameStore.getState().game);
    const die = useGameStore.getState().game!.dice[0];
    fireEvent.click(screen.getByTestId('die-0'));
    expect(useGameStore.getState().game!.dice[0].reserved).toBe(true);
    expect(movementPointsOfView(useGameStore.getState().game)).toBe(before - die.value);
  });

  it('再次点击取消预留', () => {
    render(<DiceTray />);
    fireEvent.click(screen.getByTestId('die-0'));
    fireEvent.click(screen.getByTestId('die-0'));
    expect(useGameStore.getState().game!.dice[0].reserved).toBe(false);
  });

  it('探听按钮可用，点击后消耗移动点', () => {
    render(<ActionBar />);
    const button = screen.getByTestId('listen');
    expect(button).toBeEnabled();
    const before = movementPointsOfView(useGameStore.getState().game);
    fireEvent.click(button);
    expect(movementPointsOfView(useGameStore.getState().game)).toBe(before - 1);
  });

  it('探听次数用尽后按钮禁用', () => {
    render(<ActionBar />);
    fireEvent.click(screen.getByTestId('listen'));
    fireEvent.click(screen.getByTestId('listen'));
    expect(screen.getByTestId('listen')).toBeDisabled();
  });

  it('结束回合按钮推进回合数', () => {
    render(<ActionBar />);
    const before = useGameStore.getState().game!.turn;
    fireEvent.click(screen.getByTestId('end-turn'));
    expect(useGameStore.getState().game!.turn).toBe(before + 1);
  });
});
