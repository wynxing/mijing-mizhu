import { useEffect, useState } from 'react';
import { useGameStore } from '../state/store';

const PHASE_TEXT: Record<number, string> = {
  2: '守卫进入阶段 2 · 召唤',
  3: '守卫进入阶段 3 · 爆发',
};

/** 守卫阶段切换的顶部横幅：阶段变化必须一眼可见，不依赖飘字。 */
export function PhaseBanner(): JSX.Element | null {
  const events = useGameStore((s) => s.game?.events);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const event = events?.find((item) => item.type === 'bossPhase');
    if (!event || event.type !== 'bossPhase') return;
    setText(PHASE_TEXT[event.phase] ?? `守卫进入阶段 ${event.phase}`);
    const timer = window.setTimeout(() => setText(null), 2600);
    return () => window.clearTimeout(timer);
  }, [events]);

  if (!text) return null;
  return (
    <div className="phase-banner" data-testid="phase-banner" role="status">
      {text}
    </div>
  );
}
