import { describe, expect, it } from 'vitest';
import { createGame } from '../rules/game/createGame';
import { reduceGame } from '../rules/turn/reducer';
import { axialKey, neighbor, offsetToAxial, type DirIndex } from '../rules/grid/geometry';
import { cellAtLevel } from '../rules/generation/generator';
import { CELL_FLOOR } from '../rules/grid/path';
import { buildRenderModel } from './model';

describe('渲染外观分类', () => {
  it('未知格子不携带任何地形信息', () => {
    const state = createGame(55);
    const model = buildRenderModel(state);
    const unknown = model.cells.get(axialKey(offsetToAxial(0, 0)))!;
    expect(unknown.appearance.kind).toBe('unknown');
    expect(unknown.standable).toBe(false);
    expect(unknown.wallEdges.every((edge) => !edge)).toBe(true);
    expect('terrain' in unknown).toBe(false);
  });

  it('已踏足格的墙边与真实地形逐方向一致', () => {
    const state = createGame(55);
    const model = buildRenderModel(state);
    const start = state.player.pos;
    const cell = model.cells.get(axialKey(start))!;
    expect(cell.appearance.kind).toBe('floor');
    expect(cell.standable).toBe(true);
    for (let dir = 0 as DirIndex; dir < 6; dir = (dir + 1) as DirIndex) {
      const next = neighbor(start, dir);
      const isWall = cellAtLevel(state.level, next) !== CELL_FLOOR;
      expect(cell.wallEdges[dir]).toBe(isWall);
    }
  });

  it('探听到的墙不画格子，通路可落脚', () => {
    const state = reduceGame(createGame(55), { type: 'listen' });
    const model = buildRenderModel(state);
    const kinds = new Set<string>();
    for (const cell of model.cells.values()) {
      kinds.add(cell.appearance.kind);
    }
    expect(kinds.has('heardPassage') || kinds.has('knownWall')).toBe(true);

    for (const cell of model.cells.values()) {
      if (cell.appearance.kind === 'knownWall') {
        expect(cell.standable).toBe(false);
        expect(cell.wallEdges.every((edge) => !edge)).toBe(true);
      }
      if (cell.appearance.kind === 'heardPassage') {
        expect(cell.standable).toBe(true);
      }
    }
  });

  it('可落脚邻居只包含已踏足或探听到通路的格', () => {
    const state = reduceGame(createGame(55), { type: 'listen' });
    const model = buildRenderModel(state);
    for (const neighborInfo of model.standableNeighbors) {
      const cell = model.cells.get(axialKey(neighborInfo.cell))!;
      expect(cell.standable).toBe(true);
      expect(cell.appearance.kind).not.toBe('unknown');
      expect(cell.appearance.kind).not.toBe('knownWall');
    }
  });

  it('未知邻居永远不会被列为可落脚（泄露守卫）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = createGame(seed);
      const model = buildRenderModel(state);
      for (const neighborInfo of model.standableNeighbors) {
        const cell = model.cells.get(axialKey(neighborInfo.cell))!;
        expect(cell.appearance.kind).not.toBe('unknown');
      }
    }
  });

  it('出口只有在踏足后才被标记为地板', () => {
    const state = createGame(55);
    const model = buildRenderModel(state);
    expect(model.cells.get(axialKey(state.level.exit))!.appearance.kind).toBe('unknown');
  });
});
