import {
  BASE_HEX_SIZE,
  PENTAGON_RATIO,
  axialToPixel,
  parseAxialKey,
  pentagonVertices,
  pixelToAxial,
  type Axial,
} from '../rules/grid/geometry';
import { worldToScreen, type Camera, type ViewportSize } from './camera';
import { PALETTE } from './palette';
import type { CellAppearance, RenderModel } from './model';

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

    const radius = BASE_HEX_SIZE * camera.zoom * PENTAGON_RATIO;
    const margin = radius + 8;

    for (const [key, cell] of model.cells) {
      if (cell.appearance.kind === 'unknown') continue;

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

      this.drawCell(screen, radius, cell.appearance);
    }

    const exitWorld = axialToPixel(model.exit, BASE_HEX_SIZE);
    const exitScreen = worldToScreen(camera, size, exitWorld);
    const exitCell = model.cells.get(`${model.exit.q},${model.exit.r}`);
    if (exitCell && exitCell.appearance.kind !== 'unknown') {
      this.drawExit(exitScreen, radius);
    }

    const playerWorld = axialToPixel(model.player, BASE_HEX_SIZE);
    const playerScreen = worldToScreen(camera, size, playerWorld);
    this.drawPlayer(playerScreen, radius);
  }

  private drawCell(center: { x: number; y: number }, radius: number, appearance: CellAppearance): void {
    const ctx = this.ctx;
    const verts = pentagonVertices(center, radius);

    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();

    switch (appearance.kind) {
      case 'floor': {
        ctx.fillStyle = PALETTE.floorFill;
        ctx.fill();
        ctx.strokeStyle = PALETTE.floorStroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      }
      case 'wall': {
        ctx.fillStyle = PALETTE.wallFill;
        ctx.fill();
        ctx.strokeStyle = PALETTE.wallStroke;
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'heardWall': {
        ctx.fillStyle = PALETTE.wallFill;
        ctx.fill();
        ctx.strokeStyle = PALETTE.wallStroke;
        ctx.lineWidth = 2;
        ctx.stroke();
        this.drawGlyph(center, radius, '✕', PALETTE.glyphWall);
        break;
      }
      case 'heardPassage': {
        ctx.strokeStyle = PALETTE.heardStroke;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        const glyph = appearance.result === 'passage_noisy' ? '!' : '·';
        const color = appearance.result === 'passage_noisy' ? PALETTE.glyphNoisy : PALETTE.glyphQuiet;
        this.drawGlyph(center, radius, glyph, color);
        break;
      }
      default:
        break;
    }
  }

  private drawGlyph(center: { x: number; y: number }, radius: number, glyph: string, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = `${Math.round(radius * 0.9)}px "SFMono-Regular", Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, center.x, center.y + radius * 0.05);
  }

  private drawExit(center: { x: number; y: number }, radius: number): void {
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

  private drawPlayer(center: { x: number; y: number }, radius: number): void {
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

    ctx.fillStyle = PALETTE.playerFill;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.playerRing;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /** 屏幕坐标 → 格子；点在画布外返回 null。 */
  screenToCell(camera: Camera, size: ViewportSize, screenX: number, screenY: number): Axial | null {
    const world = {
      x: (screenX - size.w / 2) / camera.zoom + camera.cx,
      y: (screenY - size.h / 2) / camera.zoom + camera.cy,
    };
    return pixelToAxial(world, BASE_HEX_SIZE);
  }
}
