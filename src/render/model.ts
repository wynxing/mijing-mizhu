import {
  DIRECTIONS,
  axialKey,
  hexDistance,
  neighbor,
  offsetToAxial,
  parseAxialKey,
  type Axial,
  type AxialKey,
  type DirIndex,
} from '../rules/grid/geometry';
import { CELL_FLOOR } from '../rules/grid/path';
import { cellAtLevel } from '../rules/generation/generator';
import { isVisible, knownResult } from '../rules/fog/fog';
import type { ListenResult } from '../rules/fog/fog';
import type { GameState, GameStatus } from '../rules/turn/types';
import type { MonsterIntent, MonsterState } from '../rules/monsters/brain';

/** 警觉与追击的怪物在这个距离内会被察觉。 */
export const MONSTER_SIGHT = 6;

export type CellAppearance =
  /** 纯黑，不画。 */
  | { kind: 'unknown' }
  /** 已踏足、可见地板。 */
  | { kind: 'floor' }
  /** 探听到是墙：不画格子，墙以边线呈现。 */
  | { kind: 'knownWall' }
  /** 只探听到是通路。 */
  | { kind: 'heardPassage'; result: ListenResult };

/** 邻居在画面上的观感：可见地板 / 只探听到的通路 / 虚空（未知或已知是墙）。 */
export type NeighborView = 'floor' | 'passage' | 'void';

export interface RenderCell {
  appearance: CellAppearance;
  /** 玩家已确认可以站立（已踏足，或探听到是通路）。 */
  standable: boolean;
  /** 六条边是否被墙占据，索引与 DIRECTIONS 同序。 */
  wallEdges: boolean[];
  /** 六条边外的邻居观感，索引与 DIRECTIONS 同序；只有地板格有值。 */
  views: NeighborView[];
}

export interface StandableNeighbor {
  cell: Axial;
  dir: DirIndex;
}

export interface RenderMonster {
  uid: string;
  pos: Axial;
  hp: number;
  maxHp: number;
  state: MonsterState;
  intent: MonsterIntent;
  name: string;
  /** 是否对玩家可见：警觉与追击的怪物一定会被看见。 */
  visible: boolean;
  /** 是否是当前选中的卡牌的目标。 */
  targeted: boolean;
  /** 刚发现玩家的预警回合：头顶显示「!」，本回合不会行动。 */
  spotted: boolean;
}

export interface RenderModel {
  cells: Map<AxialKey, RenderCell>;
  player: Axial;
  playerHp: number;
  playerMaxHp: number;
  exit: Axial;
  status: GameStatus;
  /** 关卡种子：表现层靠它认出「换了一局」。 */
  seed: number;
  /** 玩家周围「已知可落脚」的邻居。 */
  standableNeighbors: StandableNeighbor[];
  monsters: RenderMonster[];
  /** 处于警觉或追击的怪物数量（眼睛徽章）。 */
  alertedCount: number;
}

function noWalls(): boolean[] {
  return [false, false, false, false, false, false];
}

function noViews(): NeighborView[] {
  return ['void', 'void', 'void', 'void', 'void', 'void'];
}

/**
 * 状态 → 外观与边信息。只读状态，不做规则判定：
 * 「是否可见」「听到的结论」取自 rules/fog，「哪边是墙」取自关卡地形。
 */
export function buildRenderModel(state: GameState, targetedKey?: AxialKey): RenderModel {
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
          views: noViews(),
        });
        continue;
      }

      const heard = knownResult(state.fog, cell);
      if (heard === 'wall') {
        cells.set(key, {
          appearance: { kind: 'knownWall' },
          standable: false,
          wallEdges: noWalls(),
          views: noViews(),
        });
        continue;
      }
      if (heard !== null) {
        cells.set(key, {
          appearance: { kind: 'heardPassage', result: heard },
          standable: true,
          wallEdges: noWalls(),
          views: noViews(),
        });
        continue;
      }

      cells.set(key, {
        appearance: { kind: 'unknown' },
        standable: false,
        wallEdges: noWalls(),
        views: noViews(),
      });
    }
  }

  // 地块外缘：邻居不是可见地板时，那条边就是石台的断崖
  for (const [key, cell] of cells) {
    if (cell.appearance.kind !== 'floor') continue;
    const axial = parseAxialKey(key);
    cell.views = DIRECTIONS.map((_, dir) => {
      const next = neighbor(axial, dir as DirIndex);
      const neighborCell = cells.get(axialKey(next));
      if (!neighborCell) return 'void';
      if (neighborCell.appearance.kind === 'floor') return 'floor';
      if (neighborCell.appearance.kind === 'heardPassage') return 'passage';
      return 'void';
    });
  }

  const standableNeighbors: StandableNeighbor[] = [];
  for (let dir = 0 as DirIndex; dir < 6; dir = (dir + 1) as DirIndex) {
    const next = neighbor(state.player.pos, dir);
    const cell = cells.get(axialKey(next));
    if (cell?.standable) standableNeighbors.push({ cell: next, dir });
  }

  const monsters: RenderMonster[] = state.monsters.map((monster) => ({
    uid: monster.uid,
    pos: monster.pos,
    hp: monster.hp,
    maxHp: monster.maxHp,
    state: monster.state,
    intent: monster.intent,
    name: monster.def.name,
    // 踩过的格子上的怪物一定看得见；正在追你的怪物在一定距离内也能被察觉
    visible:
      isVisible(state.fog, monster.pos) ||
      ((monster.state === 'alert' || monster.state === 'chase') &&
        hexDistance(state.player.pos, monster.pos) <= MONSTER_SIGHT),
    targeted: targetedKey === axialKey(monster.pos),
    spotted: monster.spotted,
  }));

  return {
    cells,
    player: state.player.pos,
    playerHp: state.player.hp,
    playerMaxHp: state.player.maxHp,
    exit: level.exit,
    status: state.status,
    seed: state.seed,
    standableNeighbors,
    monsters,
    alertedCount: state.monsters.filter(
      (monster) => monster.state === 'alert' || monster.state === 'chase',
    ).length,
  };
}
