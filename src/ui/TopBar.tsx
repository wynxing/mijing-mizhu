import { useEffect, useState } from 'react';
import { useGameStore } from '../state/store';

export function TopBar(): JSX.Element {
  const game = useGameStore((s) => s.game);
  const startGame = useGameStore((s) => s.startGame);
  const [hurt, setHurt] = useState(false);
  const events = game?.events;
  const alerted =
    game?.monsters.filter((monster) => monster.state === 'alert' || monster.state === 'chase')
      .length ?? 0;

  // 挨打时闪一下：事件流是唯一知道「谁在什么时候打到我」的来源。
  useEffect(() => {
    const hit = events?.some((event) => event.type === 'monsterAttacked' && !event.avoided);
    if (!hit) return;
    setHurt(true);
    const timer = window.setTimeout(() => setHurt(false), 320);
    return () => window.clearTimeout(timer);
  }, [events]);

  const hp = game?.player.hp ?? 0;
  const maxHp = game?.player.maxHp ?? 100;
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;

  return (
    <header className="topbar">
      <h1 className="topbar__title">迷雾迷径</h1>
      <div className="topbar__stats">
        <span
          className="stat stat--eye"
          title="处于警觉或追击的怪物数量"
          data-testid="eye"
        >
          <span className="stat__label">警戒</span>
          ◉{alerted}
        </span>
        <span
          className={`stat stat--hp${hurt ? ' stat--hp--hurt' : ''}`}
          title="体力"
          data-testid="hp"
        >
          <span className="stat__label">体力</span>
          <span className="hpbar">
            <span className="hpbar__ghost" style={{ width: `${ratio * 100}%` }} />
            <span className="hpbar__fill" style={{ width: `${ratio * 100}%` }} />
          </span>
          <span className="hpbar__text">
            {hp}/{maxHp}
          </span>
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
