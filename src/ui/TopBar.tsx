import { useGameStore } from '../state/store';

export function TopBar(): JSX.Element {
  const game = useGameStore((s) => s.game);
  const startGame = useGameStore((s) => s.startGame);

  return (
    <header className="topbar">
      <h1 className="topbar__title">迷雾迷径</h1>
      <div className="topbar__stats">
        <span className="stat stat--eye" title="阶段 0 无怪物" data-testid="eye">
          <span className="stat__label">警戒</span>
          ◉0
        </span>
        <span className="stat" data-testid="hp">
          <span className="stat__label">体力</span>
          {game ? `${game.player.hp}/${game.player.maxHp}` : '—'}
        </span>
        <span className="stat" data-testid="turn">
          <span className="stat__label">回合</span>
          {game ? game.turn : 0}
        </span>
        <button type="button" onClick={() => startGame(Math.floor(Math.random() * 0x7fffffff))}>
          换个迷宫
        </button>
      </div>
    </header>
  );
}
