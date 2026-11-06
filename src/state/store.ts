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
}

export interface GameStore {
  /** 规则状态，唯一真相。 */
  game: GameState | null;
  /** 视图状态，规则层不感知。 */
  view: GameView;

  startGame(seed?: number): void;
  dispatch(intent: GameIntent): void;

  selectCard(cardId: string | null): void;
  selectTarget(key: AxialKey | null): void;

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
      return { game: reduceGame(state.game, intent) };
    }),

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
