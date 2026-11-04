import { axialKey, offsetToAxial, type Axial, type AxialKey } from '../rules/grid/geometry';
import { CELL_FLOOR } from '../rules/grid/path';
import { cellAtLevel } from '../rules/generation/generator';
import { isVisible, knownResult } from '../rules/fog/fog';
import type { ListenResult } from '../rules/fog/fog';
import type { GameState, GameStatus } from '../rules/turn/types';

export type CellAppearance =
  | { kind: 'unknown' }
  | { kind: 'floor' }
  | { kind: 'wall' }
  | { kind: 'heardWall' }
  | { kind: 'heardPassage'; result: ListenResult };

export interface RenderCell {
  appearance: CellAppearance;
  terrain: 'floor' | 'wall';
}

export interface RenderModel {
  cells: Map<AxialKey, RenderCell>;
  player: Axial;
  exit: Axial;
  status: GameStatus;
}

/**
 * 状态 → 外观分类。只读状态，不做规则判断：
 * 「是否可见」与「听到的结论」都直接取自 rules/fog。
 */
export function buildRenderModel(state: GameState): RenderModel {
  const cells = new Map<AxialKey, RenderCell>();
  const { level } = state;

  for (let row = 0; row < level.height; row++) {
    for (let col = 0; col < level.width; col++) {
      const cell = offsetToAxial(col, row);
      const key = axialKey(cell);
      const floor = cellAtLevel(level, cell) === CELL_FLOOR;

      if (isVisible(state.fog, cell)) {
        cells.set(key, {
          appearance: { kind: floor ? 'floor' : 'wall' },
          terrain: floor ? 'floor' : 'wall',
        });
        continue;
      }

      const heard = knownResult(state.fog, cell);
      if (heard === 'wall') {
        cells.set(key, { appearance: { kind: 'heardWall' }, terrain: 'wall' });
        continue;
      }
      if (heard !== null) {
        cells.set(key, {
          appearance: { kind: 'heardPassage', result: heard },
          terrain: 'floor',
        });
        continue;
      }

      cells.set(key, { appearance: { kind: 'unknown' }, terrain: floor ? 'floor' : 'wall' });
    }
  }

  return {
    cells,
    player: state.player.pos,
    exit: level.exit,
    status: state.status,
  };
}
