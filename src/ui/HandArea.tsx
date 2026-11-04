const SLOT_COUNT = 10;

export function HandArea(): JSX.Element {
  return (
    <div className="hand" data-testid="hand">
      <span className="hand__label">手牌区 · 阶段 0 未启用（卡牌系统于阶段 1 开放）</span>
      <div className="hand__slots">
        {Array.from({ length: SLOT_COUNT }, (_, index) => (
          <div className="hand__slot" key={index} />
        ))}
      </div>
    </div>
  );
}
