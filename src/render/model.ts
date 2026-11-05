import {
  axialKey,
  neighbor,
  offsetToAxial,
  type Axial,
  type AxialKey,
  type DirIndex,
} from '../rules/grid/geometry';
import { CELL_FLOOR } from '../rules/grid/path';
import { cellAtLevel } from '../rules/generation/generator';
import { isVisible, knownResult } from '../rules/fog/fog';
import type { ListenResult } from '../rules/fog/fog';
import type { GameState, GameStatus } from '../rules/turn/types';

export type CellAppearance =
  /** 纯黑，不画。 */
  | { kind: 'unknown' }
  /** 已踏足、可见地板。 */
  | { kind: 'floor' }
  /** 探听到是墙：不画格子，墙以边线呈现。 */
  | { kind: 'knownWall' }
  /** 只探听到是通路。 */
  | { kind: 'heardPassage'; result: ListenResult };

export interface RenderCell {
  appearance: CellAppearance;
  /** 玩家已确认可以站立（已踏足，或探听到是通路）。 */
  standable: boolean;
  /** 六条边是否被墙占据，索引与 DIRECTIONS 同序。 */
  wallEdges: boolean[];
}

export interface StandableNeighbor {
  cell: Axial;
  dir: DirIndex;
}

export interface RenderModel {
  cells: Map<AxialKey, RenderCell>;
  player: Axial;
  exit: Axial;
  status: GameStatus;
  /** 玩家周围「已知可落脚」的邻居。 */
  standableNeighbors: StandableNeighbor[];
}

function noWalls(): boolean[] {
  return [false, false, false, false, false, false];
}

/**
 * 状态 → 外观与边信息。只读状态，不做规则判定：
 * 「是否可见」「听到的结论」取自 rules/fog，「哪边是墙」取自关卡地形。
 */
export function buildRenderModel(state: GameState): RenderModel {
  const cells = new Map<AxialKey, RenderCell>();
  const { level } = state;

  for (let row = 0; row < level.height; row++) {
    for (let col = 0; col < level.width; col++) {
      const cell = offsetToAxial(col, row);
      const key = axialKey(cell);

      if (isVisible(state.fog, cell)) {
        const wallEdges = noWalls().map((_, dir) => {
          const next = neighbor(cell, dir as DirIndex);
          return cellAtLevel(level, next) !== CELL_FLOOR;
        });
        cells.set(key, {
          appearance: { kind: 'floor' },
          standable: true,
          wallEdges,
        });
        continue;
      }

      const heard = knownResult(state.fog, cell);
      if (heard === 'wall') {
        cells.set(key, {
          appearance: { kind: 'knownWall' },
          standable: false,
          wallEdges: noWalls(),
        });
        continue;
      }
      if (heard !== null) {
        cells.set(key, {
          appearance: { kind: 'heardPassage', result: heard },
          standable: true,
          wallEdges: noWalls(),
        });
        continue;
      }

      cells.set(key, {
        appearance: { kind: 'unknown' },
        standable: false,
        wallEdges: noWalls(),
      });
    }
  }

  const standableNeighbors: StandableNeighbor[] = [];
  for (let dir = 0 as DirIndex; dir < 6; dir = (dir + 1) as DirIndex) {
    const next = neighbor(state.player.pos, dir);
    const cell = cells.get(axialKey(next));
    if (cell?.standable) standableNeighbors.push({ cell: next, dir });
  }

  return {
    cells,
    player: state.player.pos,
    exit: level.exit,
    status: state.status,
    standableNeighbors,
  };
}
