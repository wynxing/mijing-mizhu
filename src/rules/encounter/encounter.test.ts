import { describe, expect, it } from 'vitest';
import { axialKey, offsetToAxial, type Axial } from '../grid/geometry';
import { CELL_FLOOR } from '../grid/path';
import { createGame } from '../game/createGame';
import { cellAtLevel } from '../generation/generator';
import { canAnswerEncounter } from '../rooms/rooms';
import { hasLegalAction, reduceGame } from '../turn/reducer';
import type { GameState } from '../turn/types';
import { BUILTIN_QUESTIONS, QUESTION_MAX_LENGTH, sanitizeQuestions } from './questions';
import { STREAK_TARGET } from './encounter';

function encounterCells(state: GameState): { roomIndex: number; cell: Axial; kind: string }[] {
  const out: { roomIndex: number; cell: Axial; kind: string }[] = [];
  state.level.rooms.forEach((room, roomIndex) => {
    if (room.kind !== 'encounter') return;
    for (let row = room.row; row < room.row + room.h; row++) {
      for (let col = room.col; col < room.col + room.w; col++) {
        const cell = offsetToAxial(col, row);
        if (cellAtLevel(state.level, cell) === CELL_FLOOR) {
          out.push({ roomIndex, cell, kind: room.kind });
          return;
        }
      }
    }
  });
  return out;
}

const TRUE_ONLY = [
  {
    id: 'test-true',
    question: '这是一道测试题。',
    answer: true,
    hint: '线索不告诉你答案。',
    difficulty: 'easy' as const,
    topic: '测试',
  },
];

function enterRoom(state: GameState, cell: Axial): GameState {
  return {
    ...state,
    player: { ...state.player, pos: cell },
    questionBank: TRUE_ONLY,
    roomStates: state.roomStates.map(() => ({ settled: false })),
  };
}

describe('内置题库', () => {
  it('至少 40 题，字段与出题硬约束齐全', () => {
    expect(BUILTIN_QUESTIONS.length).toBeGreaterThanOrEqual(40);
    const ids = new Set(BUILTIN_QUESTIONS.map((question) => question.id));
    expect(ids.size).toBe(BUILTIN_QUESTIONS.length);
    for (const question of BUILTIN_QUESTIONS) {
      expect(question.question.length).toBeLessThanOrEqual(QUESTION_MAX_LENGTH);
      expect(typeof question.answer).toBe('boolean');
      expect(question.hint.length).toBeGreaterThan(0);
      expect(question.question.endsWith('？')).toBe(false);
    }
  });

  it('schema 过滤丢弃超长 / 非布尔 / 缺 hint / 重复 id', () => {
    const long = {
      ...TRUE_ONLY[0],
      id: 'long',
      question: '长'.repeat(QUESTION_MAX_LENGTH + 1),
    };
    const wrongAnswer = { ...TRUE_ONLY[0], id: 'wrong-answer', answer: 'yes' };
    const noHint = { ...TRUE_ONLY[0], id: 'no-hint', hint: '' };
    const kept = sanitizeQuestions([
      ...TRUE_ONLY,
      long,
      wrongAnswer,
      noHint,
      { ...TRUE_ONLY[0] }, // 重复 id
      null,
      'garbage',
    ]);
    expect(kept.map((question) => question.id)).toEqual(['test-true']);
  });

  it('空题库被规则层拒绝', () => {
    const state = createGame(3);
    const after = reduceGame(state, { type: 'setQuestionBank', questions: [] });
    expect(after.notice).toBe('题库里没有合法题目');
    expect(after.questionBank.length).toBe(BUILTIN_QUESTIONS.length);
  });
});

describe('奇遇房问答', () => {
  it('首次交互固定题目，重复交互不会换题', () => {
    const base = createGame(3);
    const [first] = encounterCells(base);
    const opened = reduceGame(enterRoom(base, first.cell), { type: 'interact' });
    expect(opened.encounter?.question.id).toBe('test-true');
    expect(opened.encounter?.resolved).toBe(false);

    const again = reduceGame(opened, { type: 'interact' });
    expect(again.encounter?.question.id).toBe('test-true');
    expect(again.roomStates[first.roomIndex].settled).toBe(false);
  });

  it('答对后房间结算、再次交互被拒绝', () => {
    const base = createGame(3);
    const [first] = encounterCells(base);
    const opened = reduceGame(enterRoom(base, first.cell), { type: 'interact' });
    const answered = reduceGame(opened, { type: 'answerQuestion', choice: true });
    expect(answered.encounter?.correct).toBe(true);
    expect(answered.roomStates[first.roomIndex].settled).toBe(true);
    expect(answered.answerStreak).toBe(1);

    const again = reduceGame(answered, { type: 'interact' });
    expect(again.notice).toBe('这个房间已经结算过了');
  });

  it('答错扣 15% 最大 HP 或扣一张卡，休整锁定的卡不被扣', () => {
    let sawCardLoss = false;
    for (let seed = 1; seed <= 40; seed++) {
      const base = createGame(seed);
      const [first] = encounterCells(base);
      if (!first) continue;
      const locked = base.hand[0].uid;
      const opened = reduceGame(
        { ...enterRoom(base, first.cell), restLockUid: locked },
        { type: 'interact' },
      );
      const before = opened;
      const after = reduceGame(opened, { type: 'answerQuestion', choice: false });
      expect(after.answerStreak).toBe(0);
      if (after.player.hp < before.player.hp) {
        expect(before.player.hp - after.player.hp).toBe(
          Math.floor(before.player.maxHp * 0.15),
        );
      } else {
        sawCardLoss = true;
        expect(after.hand.length).toBe(before.hand.length - 1);
        expect(after.hand.some((card) => card.uid === locked)).toBe(true);
      }
    }
    expect(sawCardLoss).toBe(true);
  });

  it('提示消耗一张手牌且每题只限一次', () => {
    const base = createGame(3);
    const [first] = encounterCells(base);
    const opened = reduceGame(enterRoom(base, first.cell), { type: 'interact' });
    const target = opened.hand[1];
    const hinted = reduceGame(opened, { type: 'useHint', cardUid: target.uid });
    expect(hinted.encounter?.hintUsed).toBe(true);
    expect(hinted.hand.some((card) => card.uid === target.uid)).toBe(false);

    const again = reduceGame(hinted, {
      type: 'useHint',
      cardUid: hinted.hand[0].uid,
    });
    expect(again.notice).toBe('这道题已经用过提示');
  });

  it('连答 3 题额外抽 2 张普通卡并清零计数', () => {
    let state = createGame(3);
    const rooms = encounterCells(state);
    expect(rooms).toHaveLength(STREAK_TARGET);
    let handBeforeThird = 0;
    for (const [index, room] of rooms.entries()) {
      state = reduceGame(enterRoom(state, room.cell), { type: 'interact' });
      const before = state;
      state = reduceGame(state, { type: 'answerQuestion', choice: true });
      if (index === STREAK_TARGET - 1) handBeforeThird = before.hand.length;
      expect(state.encounter?.correct).toBe(true);
    }
    expect(state.answerStreak).toBe(0);
    // 第三题本身最多 +1 张（或回血/buff），连答奖励再 +2，因此至少 +2。
    expect(state.hand.length - handBeforeThird).toBeGreaterThanOrEqual(2);
  });

  it('未结算的题目算合法动作，不会被自动结束回合打断', () => {
    const base = createGame(3);
    const [first] = encounterCells(base);
    const opened = reduceGame(enterRoom(base, first.cell), { type: 'interact' });
    const noPoints: GameState = {
      ...opened,
      dice: opened.dice.map((die) => ({ ...die, value: 0 })),
      hand: [],
    };
    expect(hasLegalAction(noPoints)).toBe(true);
    expect(canAnswerEncounter(noPoints).ok).toBe(true);

    const left: GameState = { ...noPoints, player: { ...noPoints.player, pos: base.level.start } };
    expect(canAnswerEncounter(left).ok).toBe(false);
    expect(hasLegalAction(left)).toBe(false);
  });

  it('答题后同一道题不能再答', () => {
    const base = createGame(3);
    const [first] = encounterCells(base);
    const opened = reduceGame(enterRoom(base, first.cell), { type: 'interact' });
    const answered = reduceGame(opened, { type: 'answerQuestion', choice: true });
    const again = reduceGame(answered, { type: 'answerQuestion', choice: true });
    expect(again.notice).toBe('没有进行中的奇遇');
    expect(axialKey(answered.player.pos)).toBe(axialKey(first.cell));
  });
});
