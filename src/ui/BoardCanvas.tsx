import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useGameStore } from '../state/store';
import { buildRenderModel, type RenderModel } from '../render/model';
import { BoardRenderer } from '../render/canvas';
import { BASE_HEX_SIZE, areAdjacent, axialToPixel, type Axial } from '../rules/grid/geometry';
import type { Camera } from '../render/camera';

function playerCenter(pos: Axial): { cx: number; cy: number } {
  const point = axialToPixel(pos, BASE_HEX_SIZE);
  return { cx: point.x, cy: point.y };
}

export function BoardCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  /** 最近一帧的场景与相机：画布尺寸变化会清空画布，需要按这帧重绘。 */
  const frameRef = useRef<{ model: RenderModel; camera: Camera } | null>(null);

  const game = useGameStore((s) => s.game);
  const view = useGameStore((s) => s.view);
  const dispatch = useGameStore((s) => s.dispatch);
  const zoomAt = useGameStore((s) => s.zoomAt);
  const panBy = useGameStore((s) => s.panBy);
  const setFollow = useGameStore((s) => s.setFollow);
  const centerOnPlayer = useGameStore((s) => s.centerOnPlayer);

  const camera = useMemo<Camera>(
    () => (view.follow && game ? { ...view, ...playerCenter(game.player.pos) } : view),
    [view, game],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new BoardRenderer(canvas);
    rendererRef.current = renderer;

    const redraw = () => {
      const frame = frameRef.current;
      if (!frame) return;
      const rect = canvas.getBoundingClientRect();
      renderer.render(frame.model, frame.camera, { w: rect.width, h: rect.height });
    };

    const resize = () => {
      renderer.resize();
      redraw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(
        Math.exp(-event.deltaY * 0.0015),
        { w: rect.width, h: rect.height },
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer || !game) return;
    const model = buildRenderModel(game);
    frameRef.current = { model, camera };
    const rect = canvas.getBoundingClientRect();
    renderer.render(model, camera, { w: rect.width, h: rect.height });
  }, [game, camera]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        drag.moved = true;
        setFollow(false);
      }
      if (drag.moved) {
        panBy(dx, dy);
        dragRef.current = { x: event.clientX, y: event.clientY, moved: true };
      }
    },
    [panBy, setFollow],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.moved) return;

      const canvas = event.currentTarget;
      const rect = canvas.getBoundingClientRect();
      const size = { w: rect.width, h: rect.height };
      const cell = rendererRef.current?.screenToCell(
        camera,
        size,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      if (!cell) return;

      const current = useGameStore.getState().game;
      if (!current) return;
      if (!areAdjacent(current.player.pos, cell)) return;
      dispatch({ type: 'move', target: cell });
    },
    [camera, dispatch],
  );

  const handleDoubleClick = useCallback(() => {
    centerOnPlayer();
  }, [centerOnPlayer]);

  return (
    <div className="board">
      <canvas
        ref={canvasRef}
        data-testid="board"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />
      {game?.status === 'won' ? (
        <div className="board__overlay">
          <div className="board__banner">
            <h2>你找到了出口</h2>
            <p>用时 {game.turn} 回合 · 种子 {game.seed}</p>
          </div>
        </div>
      ) : null}
      {game?.notice ? <div className="board__notice">{game.notice}</div> : null}
    </div>
  );
}
