import { useEffect } from 'react';
import { useGameStore } from '../state/store';
import { useKeyboard } from './useKeyboard';
import { TopBar } from './TopBar';
import { MessageLog } from './MessageLog';
import { BoardCanvas } from './BoardCanvas';
import { DiceTray } from './DiceTray';
import { ActionBar } from './ActionBar';
import { HandArea } from './HandArea';

const LAST_SEED_KEY = 'mijing.lastSeed';

function readLastSeed(): number | undefined {
  const raw = localStorage.getItem(LAST_SEED_KEY);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function App(): JSX.Element {
  const game = useGameStore((s) => s.game);
  const startGame = useGameStore((s) => s.startGame);
  useKeyboard();

  useEffect(() => {
    if (!useGameStore.getState().game) {
      startGame(readLastSeed());
    }
  }, [startGame]);

  useEffect(() => {
    if (game) localStorage.setItem(LAST_SEED_KEY, String(game.seed));
  }, [game]);

  return (
    <div className="app">
      <TopBar />
      <MessageLog />
      <BoardCanvas />
      <div className="controls">
        <div className="controls__row">
          <DiceTray />
          <ActionBar />
        </div>
        <HandArea />
        <div className="legend">
          <span className="legend__item">
            <span className="legend__glyph">✕</span> 有墙
          </span>
          <span className="legend__item">
            <span className="legend__glyph">·</span> 通路（安静）
          </span>
          <span className="legend__item">
            <span className="legend__glyph">!</span> 通路（有异响 · 阶段 0 无陷阱）
          </span>
          <span className="legend__item">虚线 = 只探听到、尚未踏足</span>
        </div>
      </div>
    </div>
  );
}
