import { useGameStore } from '../state/store';
import { movementPointsOfView } from '../state/selectors';

export function DiceTray(): JSX.Element {
  const game = useGameStore((s) => s.game);
  const dispatch = useGameStore((s) => s.dispatch);
  const points = movementPointsOfView(game);

  return (
    <div className="dice-tray">
      {(game?.dice ?? []).map((die) => (
        <button
          key={die.id}
          type="button"
          className={die.reserved ? 'dice dice--reserved' : 'dice'}
          data-testid={`die-${die.id}`}
          title={die.reserved ? '已预留（阶段 0 暂无用途）' : '点击预留这颗骰子'}
          onClick={() =>
            dispatch(
              die.reserved
                ? { type: 'unreserveDie', dieId: die.id }
                : { type: 'reserveDie', dieId: die.id },
            )
          }
        >
          {die.value}
          {die.reserved ? <span className="dice__lock">预留</span> : null}
        </button>
      ))}
      <span className="movement">
        <span className="dice-tray__label">移动点</span>
        <span className="movement__value" data-testid="mp">
          {points}
        </span>
      </span>
    </div>
  );
}
