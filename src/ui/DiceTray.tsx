import { useGameStore } from '../state/store';
import { movementPointsOfView } from '../state/selectors';
import { cardDef } from '../rules/cards/content';

export function DiceTray(): JSX.Element {
  const game = useGameStore((s) => s.game);
  const selectedCard = useGameStore((s) => s.view.selectedCard);
  const selectedTarget = useGameStore((s) => s.view.selectedTarget);
  const dispatch = useGameStore((s) => s.dispatch);
  const selectCard = useGameStore((s) => s.selectCard);
  const points = movementPointsOfView(game);
  const selectedDef = game?.hand.find((card) => card.uid === selectedCard)?.def ?? null;
  const cost = selectedDef ? cardDef(selectedDef.id).cost : null;

  return (
    <div className="dice-tray">
      {(game?.dice ?? []).map((die) => {
        const eligible = cost !== null && !die.reserved && die.value >= cost;
        const classes = ['dice'];
        if (die.reserved) classes.push('dice--reserved');
        if (eligible) classes.push('dice--eligible');
        return (
          <button
            key={die.id}
            type="button"
            className={classes.join(' ')}
            data-testid={`die-${die.id}`}
            title={
              die.reserved
                ? '已用掉'
                : eligible
                  ? `花掉这颗 ${die.value} 点骰子打出`
                  : '点击预留这颗骰子'
            }
            onClick={() => {
              if (selectedCard) {
                // 交给规则层判定，出错时会把原因显示出来
                const before = useGameStore.getState().game?.hand.length ?? 0;
                dispatch({
                  type: 'playCard',
                  cardUid: selectedCard,
                  dieId: die.id,
                  targetKey: selectedTarget ?? undefined,
                });
                if ((useGameStore.getState().game?.hand.length ?? 0) < before) {
                  selectCard(null);
                }
                return;
              }
              dispatch(
                die.reserved
                  ? { type: 'unreserveDie', dieId: die.id }
                  : { type: 'reserveDie', dieId: die.id },
              );
            }}
          >
            {die.value}
            {die.reserved ? <span className="dice__lock">预留</span> : null}
          </button>
        );
      })}
      <span className="movement">
        <span className="dice-tray__label">移动点</span>
        <span className="movement__value" data-testid="mp">
          {points}
        </span>
      </span>
    </div>
  );
}
