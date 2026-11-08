import { useEffect } from 'react';
import { useGameStore } from '../state/store';

/**
 * 奇遇房题面：覆盖在棋盘上，只有它自己接收指针事件。
 * 键盘 T/F/H/Esc 由面板自管；面板打开时 useKeyboard 会整体早退，避免误触移动。
 */
export function QuestionPanel(): JSX.Element | null {
  const game = useGameStore((s) => s.game);
  const open = useGameStore((s) => s.view.encounterOpen);
  const dispatch = useGameStore((s) => s.dispatch);
  const closeEncounter = useGameStore((s) => s.closeEncounter);

  const encounter = game?.encounter ?? null;
  const hand = game?.hand ?? [];
  const hintable = hand.filter((card) => card.uid !== game?.restLockUid);
  const canHint = !!encounter && !encounter.hintUsed && !encounter.resolved && hand.length > 0;

  useEffect(() => {
    if (!open || !encounter) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        closeEncounter();
        return;
      }
      if (encounter.resolved) return;
      if (event.code === 'KeyT') {
        event.preventDefault();
        dispatch({ type: 'answerQuestion', choice: true });
        return;
      }
      if (event.code === 'KeyF') {
        event.preventDefault();
        dispatch({ type: 'answerQuestion', choice: false });
        return;
      }
      if (event.code === 'KeyH' && canHint && hintable.length > 0) {
        event.preventDefault();
        dispatch({ type: 'useHint', cardUid: hintable[0].uid });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, encounter, canHint, hintable, dispatch, closeEncounter]);

  if (!open || !encounter || !game) return null;
  const { question } = encounter;

  return (
    <div className="question" data-testid="question-panel" role="dialog" aria-modal="true">
      <div className="question__meta">
        <span className="question__topic">{question.topic}</span>
        <span className="question__difficulty">
          {question.difficulty === 'easy' ? '简单' : question.difficulty === 'normal' ? '普通' : '困难'}
        </span>
        {encounter.hintUsed && <span className="question__hint-used">已用提示</span>}
      </div>

      <p className="question__text">{question.question}</p>

      {encounter.hintUsed && <p className="question__hint">线索：{question.hint}</p>}

      {encounter.resolved ? (
        <div className="question__result">
          <p className={encounter.correct ? 'question__ok' : 'question__bad'}>
            {encounter.correct ? '答对了。' : '答错了。'}
            {encounter.correct ? '' : ` 正确答案：「${question.answer ? '对' : '错'}」`}
          </p>
          <button type="button" data-testid="question-close" onClick={closeEncounter}>
            离开 (Esc)
          </button>
        </div>
      ) : (
        <>
          <div className="question__choices">
            <button
              type="button"
              data-testid="answer-true"
              onClick={() => dispatch({ type: 'answerQuestion', choice: true })}
            >
              对 (T)
            </button>
            <button
              type="button"
              data-testid="answer-false"
              onClick={() => dispatch({ type: 'answerQuestion', choice: false })}
            >
              错 (F)
            </button>
          </div>
          <div className="question__hint-row">
            <span className="question__label">用一张卡换线索：</span>
            {hintable.length === 0 ? (
              <span className="question__muted">没有可用的卡</span>
            ) : (
              hintable.map((card) => (
                <button
                  type="button"
                  key={card.uid}
                  className="question__card"
                  data-testid={`hint-card-${card.uid}`}
                  onClick={() => dispatch({ type: 'useHint', cardUid: card.uid })}
                >
                  {card.def.name}
                </button>
              ))
            )}
          </div>
          <button type="button" className="question__leave" onClick={closeEncounter}>
            先离开 (Esc)
          </button>
        </>
      )}
    </div>
  );
}
