import { useGameStore } from '../state/store';
import { canListenIn, listenLimitOf, listenRemaining } from '../state/selectors';

export function ActionBar(): JSX.Element {
  const game = useGameStore((s) => s.game);
  const dispatch = useGameStore((s) => s.dispatch);
  const check = canListenIn(game);
  const remaining = listenRemaining(game);
  const limit = listenLimitOf(game);

  return (
    <div className="actions">
      <button
        type="button"
        data-testid="listen"
        disabled={!check.ok}
        title={check.reason ?? '消耗 1 移动点，听清四周'}
        onClick={() => dispatch({ type: 'listen' })}
      >
        探听 (Q) · 剩余 {remaining}/{limit}
      </button>
      <button type="button" data-testid="end-turn" onClick={() => dispatch({ type: 'endTurn' })}>
        结束回合 (空格)
      </button>
      <span className="actions__hint">点击相邻格移动 · 滚轮缩放 · 拖拽平移</span>
    </div>
  );
}
