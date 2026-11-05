import {
  BASE_HEX_SIZE,
  axialToPixel,
  hexCorners,
  parseAxialKey,
  pixelToAxial,
  type Axial,
  type Point,
} from '../rules/grid/geometry';
import { worldToScreen, type Camera, type ViewportSize } from './camera';
import { PALETTE } from './palette';
import type { CellAppearance, RenderModel } from './model';

interface DrawableCell {
  axial: Axial;
  screen: Point;
  appearance: CellAppearance;
}

export class BoardRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 Canvas 2D 上下文');
    this.ctx = ctx;
  }

  /** 按设备像素比重设画布尺寸，CSS 尺寸由布局决定。 */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(model: RenderModel, camera: Camera, size: ViewportSize): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, size.w, size.h);

    const radius = BASE_HEX_SIZE * camera.zoom;
    const margin = radius * 1.6;

    const floors: DrawableCell[] = [];
    for (const [key, cell] of model.cells) {
      const kind = cell.appearance.kind;
      if (kind === 'unknown' || kind === 'knownWall') continue;
      const axial = parseAxialKey(key);
      const world = axialToPixel(axial, BASE_HEX_SIZE);
      const screen = worldToScreen(camera, size, world);
      if (
        screen.x < -margin ||
        screen.y < -margin ||
        screen.x > size.w + margin ||
        screen.y > size.h + margin
      ) {
        continue;
      }
      floors.push({ axial, screen, appearance: cell.appearance });
    }

    // 一、地板与已探听到的通路
    for (const cell of floors) {
      this.drawFloor(cell.screen, radius, cell.appearance);
    }

    // 二、墙：贴在地板格边缘的粗线 + 内侧渐变阴影
    for (const cell of floors) {
      if (cell.appearance.kind !== 'floor') continue;
      const edges = model.cells.get(`${cell.axial.q},${cell.axial.r}`);
      if (edges) this.drawWallEdges(cell.screen, radius, edges.wallEdges);
    }

    // 三、灯光：压在地板与墙之上，但要在高亮之前，否则会冲淡高亮色
    const playerScreen = worldToScreen(camera, size, axialToPixel(model.player, BASE_HEX_SIZE));
    this.drawPlayerGlow(playerScreen, radius);

    // 四、可落脚的邻居高亮
    for (const neighbor of model.standableNeighbors) {
      const world = axialToPixel(neighbor.cell, BASE_HEX_SIZE);
      const screen = worldToScreen(camera, size, world);
      const cell = model.cells.get(`${neighbor.cell.q},${neighbor.cell.r}`);
      this.drawHighlight(screen, radius, cell?.appearance.kind === 'heardPassage');
      this.drawArrow(playerScreen, screen, radius);
    }

    // 五、出口
    const exitCell = model.cells.get(`${model.exit.q},${model.exit.r}`);
    if (exitCell?.appearance.kind === 'floor') {
      const exitScreen = worldToScreen(camera, size, axialToPixel(model.exit, BASE_HEX_SIZE));
      this.drawExit(exitScreen, radius);
    }

    // 六、怪物与意图
    for (const monster of model.monsters) {
      if (!monster.visible) continue;
      const screen = worldToScreen(camera, size, axialToPixel(monster.pos, BASE_HEX_SIZE));
      this.drawMonster(screen, radius, monster.state, monster.targeted);
      this.drawIntent(screen, radius, monster.intent);
    }

    // 七、玩家
    this.drawPlayerMarker(playerScreen, radius);
  }

  private drawFloor(center: Point, radius: number, appearance: CellAppearance): void {
    const ctx = this.ctx;
    const corners = hexCorners(center, radius);

    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();

    if (appearance.kind === 'heardPassage') {
      ctx.strokeStyle = PALETTE.heardStroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      const noisy = appearance.result === 'passage_noisy';
      this.drawGlyph(
        center,
        radius,
        noisy ? '!' : '·',
        noisy ? PALETTE.glyphNoisy : PALETTE.glyphQuiet,
      );
      return;
    }

    ctx.fillStyle = PALETTE.floorFill;
    ctx.fill();
    ctx.strokeStyle = PALETTE.floorStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** 墙线画在地板格与墙格共享的边上；连续的墙边拼成一条折线。 */
  private drawWallEdges(center: Point, radius: number, wallEdges: boolean[]): void {
    const ctx = this.ctx;
    const corners = hexCorners(center, radius);
    const isWallEdge = (edge: number) => wallEdges[(7 - edge) % 6];
    const depth = radius * 0.3;

    for (let edge = 0; edge < 6; edge++) {
      if (!isWallEdge(edge)) continue;
      const a = corners[edge];
      const b = corners[(edge + 1) % 6];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dx = center.x - mid.x;
      const dy = center.y - mid.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;

      const gradient = ctx.createLinearGradient(
        mid.x,
        mid.y,
        mid.x + ux * depth,
        mid.y + uy * depth,
      );
      gradient.addColorStop(0, PALETTE.wallShadow);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x + ux * depth, b.y + uy * depth);
      ctx.lineTo(a.x + ux * depth, a.y + uy * depth);
      ctx.closePath();
      ctx.fill();
    }

    const visited = new Array<boolean>(6).fill(false);
    ctx.strokeStyle = PALETTE.wallLine;
    ctx.lineWidth = Math.min(9, Math.max(2.5, radius * 0.16));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';

    for (let start = 0; start < 6; start++) {
      if (visited[start] || !isWallEdge(start)) continue;
      const run: number[] = [];
      let current = start;
      while (!visited[current] && isWallEdge(current)) {
        run.push(current);
        visited[current] = true;
        current = (current + 1) % 6;
      }

      ctx.beginPath();
      ctx.moveTo(corners[run[0]].x, corners[run[0]].y);
      for (const edge of run) {
        const next = corners[(edge + 1) % 6];
        ctx.lineTo(next.x, next.y);
      }
      if (run.length === 6) ctx.closePath();
      ctx.stroke();
    }
  }

  /** 已知可落脚的邻居：亮色描边 + 中心点。 */
  private drawHighlight(center: Point, radius: number, hasGlyph: boolean): void {
    const ctx = this.ctx;
    const corners = hexCorners(center, radius);

    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.strokeStyle = PALETTE.highlight;
    ctx.lineWidth = Math.min(4, Math.max(1.5, radius * 0.06));
    ctx.stroke();

    if (!hasGlyph) {
      ctx.fillStyle = PALETTE.highlightDot;
      ctx.beginPath();
      ctx.arc(center.x, center.y, Math.max(2, radius * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 共享边上的箭头：指向可落脚的邻居。 */
  private drawArrow(from: Point, to: Point, radius: number): void {
    const ctx = this.ctx;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const tx = -uy;
    const ty = ux;

    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const size = Math.max(6, radius * 0.3);
    const tip = { x: mid.x + ux * size * 0.6, y: mid.y + uy * size * 0.6 };
    const baseX = mid.x - ux * size * 0.35;
    const baseY = mid.y - uy * size * 0.35;

    ctx.fillStyle = PALETTE.highlight;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(baseX + tx * size * 0.32, baseY + ty * size * 0.32);
    ctx.lineTo(baseX - tx * size * 0.32, baseY - ty * size * 0.32);
    ctx.closePath();
    ctx.fill();
  }

  private drawGlyph(center: Point, radius: number, glyph: string, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = `${Math.round(radius * 0.9)}px "SFMono-Regular", Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, center.x, center.y + radius * 0.05);
  }

  private drawExit(center: Point, radius: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = PALETTE.exitMark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = PALETTE.exitMark;
    ctx.font = `${Math.round(radius * 0.8)}px "SFMono-Regular", Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⟩', center.x, center.y);
  }

  /** 灯光：纯装饰，不揭示任何几何。 */
  private drawPlayerGlow(center: Point, radius: number): void {
    const ctx = this.ctx;
    const glow = ctx.createRadialGradient(
      center.x,
      center.y,
      radius * 0.2,
      center.x,
      center.y,
      radius * 2.4,
    );
    glow.addColorStop(0, 'rgba(232, 217, 160, 0.12)');
    glow.addColorStop(1, 'rgba(232, 217, 160, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPlayerMarker(center: Point, radius: number): void {
    const ctx = this.ctx;
    const corners = hexCorners(center, radius);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.strokeStyle = PALETTE.playerFill;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = PALETTE.playerFill;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.playerRing;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /** 怪物：形状 + 颜色双编码（不依赖单一色相）。 */
  private drawMonster(
    center: Point,
    radius: number,
    state: 'wander' | 'alert' | 'chase',
    targeted: boolean,
  ): void {
    const ctx = this.ctx;
    const size = radius * 0.34;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y - size);
    ctx.lineTo(center.x + size, center.y);
    ctx.lineTo(center.x, center.y + size);
    ctx.lineTo(center.x - size, center.y);
    ctx.closePath();
    ctx.fillStyle =
      state === 'chase' ? PALETTE.monsterChase : state === 'alert' ? PALETTE.monsterAlert : PALETTE.monster;
    ctx.fill();
    ctx.strokeStyle = targeted ? PALETTE.highlight : PALETTE.void;
    ctx.lineWidth = targeted ? 3 : 1.5;
    ctx.stroke();
  }

  /** 意图图标：图标 + 数字，提前告知下一步。 */
  private drawIntent(
    center: Point,
    radius: number,
    intent: { kind: 'move'; steps: number } | { kind: 'attack'; damage: number } | { kind: 'search' } | { kind: 'frozen' },
  ): void {
    const ctx = this.ctx;
    const glyph =
      intent.kind === 'move'
        ? `→${intent.steps}`
        : intent.kind === 'attack'
          ? `✕${intent.damage}`
          : intent.kind === 'search'
            ? '?'
            : '≡';
    const color =
      intent.kind === 'attack'
        ? PALETTE.intentAttack
        : intent.kind === 'move'
          ? PALETTE.intentMove
          : intent.kind === 'frozen'
            ? PALETTE.intentFrozen
            : PALETTE.intentSearch;
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.round(radius * 0.42)}px "SFMono-Regular", Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(glyph, center.x, center.y - radius * 0.55);
  }

  /** 屏幕坐标 → 格子（取最近中心）。 */
  screenToCell(camera: Camera, size: ViewportSize, screenX: number, screenY: number): Axial {
    const world = {
      x: (screenX - size.w / 2) / camera.zoom + camera.cx,
      y: (screenY - size.h / 2) / camera.zoom + camera.cy,
    };
    return pixelToAxial(world, BASE_HEX_SIZE);
  }
}
