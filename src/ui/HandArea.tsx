import { useGameStore } from '../state/store';

export function HandArea(): JSX.Element {
  const game = useGameStore((s) => s.game);
  const selectedCard = useGameStore((s) => s.view.selectedCard);
  const selectCard = useGameStore((s) => s.selectCard);

  const cards = game?.hand ?? [];
  const selected = cards.find((card) => card.uid === selectedCard) ?? null;

  return (
    <div className="hand" data-testid="hand">
      <span className="hand__label">
        手牌 {cards.length} 张
        {selected ? ` · 已选「${selected.def.name}」，再点一颗够数的骰子` : ' · 点一张牌，再点骰子打出'}
      </span>
      <div className="hand__cards">
        {cards.map((card) => (
          <button
            key={card.uid}
            type="button"
            className={card.uid === selectedCard ? 'card card--selected' : 'card'}
            data-testid={`card-${card.uid}`}
            data-card={card.def.id}
            data-cost={card.def.cost}
            title={`${card.def.name} · 费用 ${card.def.cost} 骰点`}
            onClick={() => selectCard(card.uid === selectedCard ? null : card.uid)}
          >
            <span className="card__cost">{card.def.cost}</span>
            <span className="card__name">{card.def.name}</span>
          </button>
        ))}
        {cards.length === 0 ? <span className="hand__empty">牌已用尽</span> : null}
      </div>
    </div>
  );
}
