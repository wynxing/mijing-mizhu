import { useEffect } from 'react';
import { useGameStore } from '../state/store';
import { DIRECTIONS, type DirIndex } from '../rules/grid/geometry';

const DIR_BY_KEY: Record<string, DirIndex> = {
  KeyD: 0,
  ArrowRight: 0,
  KeyZ: 1,
  KeyW: 2,
  ArrowUp: 2,
  KeyA: 3,
  ArrowLeft: 3,
  KeyC: 4,
  KeyS: 5,
  ArrowDown: 5,
};

const DIE_KEYS: Record<string, number> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
};

/** 全局快捷键：空格结束回合 · Esc 取消预留 · 1/2/3 选骰子 · Q 探听 · WASD/方向键移动。 */
export function useKeyboard(): void {
  const dispatch = useGameStore((s) => s.dispatch);
  const game = useGameStore((s) => s.game);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!useGameStore.getState().game) return;

      if (event.code === 'Space') {
        event.preventDefault();
        dispatch({ type: 'endTurn' });
        return;
      }

      if (event.code === 'Escape') {
        const store = useGameStore.getState();
        if (store.view.selectedCard) {
          store.selectCard(null);
          return;
        }
        const reserved = store.game?.dice.filter((die) => die.reserved) ?? [];
        for (const die of reserved) dispatch({ type: 'unreserveDie', dieId: die.id });
        return;
      }

      if (event.code === 'KeyQ') {
        dispatch({ type: 'listen' });
        return;
      }

      const dieId = DIE_KEYS[event.code];
      if (dieId !== undefined) {
        const die = useGameStore.getState().game?.dice.find((item) => item.id === dieId);
        if (!die) return;
        dispatch(
          die.reserved
            ? { type: 'unreserveDie', dieId }
            : { type: 'reserveDie', dieId },
        );
        return;
      }

      const dir = DIR_BY_KEY[event.code];
      if (dir === undefined) return;
      const current = useGameStore.getState().game;
      if (!current) return;
      const delta = DIRECTIONS[dir];
      dispatch({
        type: 'move',
        target: { q: current.player.pos.q + delta.q, r: current.player.pos.r + delta.r },
      });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, game]);
}
