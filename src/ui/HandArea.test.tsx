// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiceTray } from './DiceTray';
import { HandArea } from './HandArea';
import { useGameStore } from '../state/store';

describe('手牌与出牌', () => {
  beforeEach(() => {
    useGameStore.getState().startGame(64);
    useGameStore.getState().selectCard(null);
  });

  afterEach(() => {
    cleanup();
  });

  it('手牌显示 10 张卡', () => {
    render(<HandArea />);
    expect(screen.getByTestId('hand')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(10);
  });

  it('选中卡片后，够数的骰子会被点亮', () => {
    render(<HandArea />);
    render(<DiceTray />);
    fireEvent.click(screen.getByTestId('card-ironwall-6'));
    expect(useGameStore.getState().view.selectedCard).toBe('ironwall-6');

    const dice = useGameStore.getState().game!.dice;
    const eligible = dice.filter((die) => !die.reserved && die.value >= 1);
    for (const die of eligible) {
      expect(screen.getByTestId(`die-${die.id}`).className).toContain('dice--eligible');
    }
  });

  it('点骰子即打出卡牌：卡消失、骰子被吃掉', () => {
    render(<HandArea />);
    render(<DiceTray />);
    const before = useGameStore.getState().game!;
    const die = before.dice.find((item) => !item.reserved && item.value >= 2)!;

    fireEvent.click(screen.getByTestId('card-ironwall-6'));
    fireEvent.click(screen.getByTestId(`die-${die.id}`));

    const after = useGameStore.getState().game!;
    expect(after.hand.some((card) => card.def.id === 'ironwall')).toBe(false);
    expect(after.dice[die.id].reserved).toBe(true);
    expect(useGameStore.getState().view.selectedCard).toBeNull();
  });

  it('点数不够的卡不能打出', () => {
    useGameStore.setState((state) => ({
      game: state.game
        ? { ...state.game, dice: state.game.dice.map((die) => ({ ...die, value: 1 })) }
        : null,
    }));
    render(<HandArea />);
    render(<DiceTray />);
    fireEvent.click(screen.getAllByTestId('card-sling-4')[0]);
    const die = useGameStore.getState().game!.dice[0];
    fireEvent.click(screen.getByTestId(`die-${die.id}`));
    const after = useGameStore.getState().game!;
    expect(after.hand.some((card) => card.def.id === 'sling')).toBe(true);
    expect(after.notice).toContain('不小于 2 点');
  });
});
