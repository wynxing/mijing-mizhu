import { describe, expect, it } from 'vitest';
import { createGame } from '../rules/game/createGame';
import { reduceGame } from '../rules/turn/reducer';
import { axialKey, neighbors } from '../rules/grid/geometry';
import { buildRenderModel } from './model';

describe('渲染外观分类', () => {
  it('未知格子标记为 unknown', () => {
    const state = createGame(55);
    const model = buildRenderModel(state);
    const far = neighbors(state.player.pos).find(
      (cell) => !state.fog.visited.has(axialKey(cell)) && !state.fog.known.has(axialKey(cell)),
    );
    expect(far).toBeDefined();
    expect(model.cells.get(axialKey(far!))!.appearance.kind).toBe('unknown');
  });

  it('踏足过的地面与墙分别归类', () => {
    const state = createGame(55);
    const model = buildRenderModel(state);
    const start = state.player.pos;
    expect(model.cells.get(axialKey(start))!.appearance.kind).toBe('floor');
  });

  it('探听到的墙与通路外观不同', () => {
    const state = reduceGame(createGame(55), { type: 'listen' });
    const model = buildRenderModel(state);
    const kinds = new Set<string>();
    for (const [key, cell] of model.cells) {
      if (cell.appearance.kind === 'heardWall' || cell.appearance.kind === 'heardPassage') {
        kinds.add(cell.appearance.kind);
      }
      expect(key).toBeTruthy();
    }
    expect(kinds.has('heardWall') || kinds.has('heardPassage')).toBe(true);
  });

  it('出口只有在可见时才会被标记', () => {
    const state = createGame(55);
    const model = buildRenderModel(state);
    const exitCell = model.cells.get(axialKey(state.level.exit))!;
    expect(exitCell.appearance.kind).toBe('unknown');
  });
});
