import { create } from 'zustand';
import { BASE_HEX_SIZE, axialToPixel, type Point } from '../rules/grid/geometry';
import { createGame } from '../rules/game/createGame';
import { reduceGame } from '../rules/turn/reducer';
import type { GameIntent, GameState } from '../rules/turn/types';
import { panBy, zoomAt, type Camera, type ViewportSize } from '../render/camera';
import type { AxialKey } from '../rules/grid/geometry';

export interface GameView extends Camera {
  /** 选中的卡牌（等待投骰）。 */
  selectedCard: string | null;
  /** 选中的目标怪物。 */
  selectedTarget: AxialKey | null;
  /** 奇遇题面是否展开。面板开合属于视图状态，不进规则层。 */
  encounterOpen: boolean;
}

export interface GameStore {
  /** 规则状态，唯一真相。 */
  game: GameState | null;
  /** 视图状态，规则层不感知。 */
  view: GameView;

  startGame(seed?: number): void;
  dispatch(intent: GameIntent): void;
  /** 注入外部题库的唯一入口（规则层做 schema 过滤）。以后接 LLM 只改这里。 */
  injectQuestions(questions: unknown): void;

  selectCard(cardId: string | null): void;
  selectTarget(key: AxialKey | null): void;
  closeEncounter(): void;

  zoomAt(factor: number, size: ViewportSize, at: Point): void;
  panBy(dx: number, dy: number): void;
  /** 直接设定视图中心：跟随镜头交还给手动拖拽时用来对齐。 */
  setCamera(cx: number, cy: number): void;
  setFollow(follow: boolean): void;
  centerOnPlayer(): void;
}

const INITIAL_VIEW: GameView = {
  zoom: 1,
  cx: 0,
  cy: 0,
  follow: true,
  selectedCard: null,
  selectedTarget: null,
  encounterOpen: false,
};

export const useGameStore = create<GameStore>((set, get) => ({
  game: null,
  view: INITIAL_VIEW,

  startGame: (seed) =>
    set(() => ({
      game: createGame(seed ?? Math.floor(Math.random() * 0x7fffffff)),
      view: { ...INITIAL_VIEW },
    })),

  selectCard: (cardId) =>
    set((state) => ({
      view: { ...state.view, selectedCard: cardId, selectedTarget: null },
    })),

  selectTarget: (key) =>
    set((state) => ({ view: { ...state.view, selectedTarget: key } })),

  // 唯一调用 rules 纯函数的地方。
  dispatch: (intent) =>
    set((state) => {
      if (!state.game) return state;
      const next = reduceGame(state.game, intent);
      // 第一次拿到一间奇遇房的题目时自动展开题面；已结算的题不再自动弹。
      const previous = state.game.encounter;
      const fresh =
        next.encounter !== null &&
        !next.encounter.resolved &&
        (previous === null ||
          previous.resolved ||
          previous.roomIndex !== next.encounter.roomIndex);
      // 关掉面板后再按一次交互，也要能重新打开同一题（被拒绝的交互不算）。
      const reopen =
        intent.type === 'interact' &&
        next.notice === null &&
        next.encounter !== null &&
        !next.encounter.resolved;
      return {
        game: next,
        view: fresh || reopen ? { ...state.view, encounterOpen: true } : state.view,
      };
    }),

  injectQuestions: (questions) => get().dispatch({ type: 'setQuestionBank', questions }),

  closeEncounter: () =>
    set((state) => ({ view: { ...state.view, encounterOpen: false } })),

  zoomAt: (factor, size, at) =>
    set((state) => ({ view: { ...state.view, ...zoomAt(state.view, size, factor, at) } })),

  panBy: (dx, dy) =>
    set((state) => ({ view: { ...state.view, ...panBy(state.view, dx, dy) } })),

  setCamera: (cx, cy) => set((state) => ({ view: { ...state.view, cx, cy } })),

  setFollow: (follow) => set((state) => ({ view: { ...state.view, follow } })),

  centerOnPlayer: () => {
    const game = get().game;
    if (!game) return;
    const point = axialToPixel(game.player.pos, BASE_HEX_SIZE);
    set((state) => ({
      view: { ...state.view, cx: point.x, cy: point.y, follow: true },
    }));
  },
}));
