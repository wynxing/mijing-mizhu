import { useGameStore } from '../state/store';
import { recentLog } from '../state/selectors';

export function MessageLog(): JSX.Element {
  const game = useGameStore((s) => s.game);
  const entries = recentLog(game);

  return (
    <div className="log" data-testid="log">
      {entries.length === 0 ? (
        <span className="log__entry">黑暗中只有你自己的呼吸声。</span>
      ) : (
        entries.map((entry, index) => (
          <span className="log__entry" key={`${entry.turn}-${index}`}>
            {entry.text}
          </span>
        ))
      )}
    </div>
  );
}
