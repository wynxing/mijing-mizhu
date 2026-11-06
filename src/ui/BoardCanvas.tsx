import { useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '../state/store';
import { buildRenderModel, type RenderModel } from '../render/model';
import { PresentationDirector } from '../render/presentation';
import { BoardScene } from '../render/scene/BoardScene';
import { areAdjacent } from '../rules/grid/geometry';
import type { Camera } from '../render/camera';

/** 跟随镜头的迟滞时间常数：玩家先动，镜头再跟上，移动感才读得出来。 */
const FOLLOW_LAG_MS = 90;

export function BoardCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BoardScene | null>(null);
  const directorRef = useRef<PresentationDirector | null>(null);
  /** 当前生效的相机：拖拽与缩放都以它为基准。 */
  const cameraRef = useRef<Camera>({ zoom: 1, cx: 0, cy: 0, follow: true });
  const sizeRef = useRef({ w: 800, h: 600 });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  /** 当前场景：模型由状态推出，表现帧由 director 逐帧给出。 */
  const sceneRef = useRef<{ model: RenderModel } | null>(null);

  const game = useGameStore((s) => s.game);
  const view = useGameStore((s) => s.view);
  const dispatch = useGameStore((s) => s.dispatch);
  const zoomAt = useGameStore((s) => s.zoomAt);
  const panBy = useGameStore((s) => s.panBy);
  const setFollow = useGameStore((s) => s.setFollow);
  const setCamera = useGameStore((s) => s.setCamera);
  const centerOnPlayer = useGameStore((s) => s.centerOnPlayer);
  const selectedCard = useGameStore((s) => s.view.selectedCard);
  const selectedTarget = useGameStore((s) => s.view.selectedTarget);
  const selectTarget = useGameStore((s) => s.selectTarget);

  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // 一、渲染循环：表现帧每帧更新，相机跟着插值后的玩家走。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new BoardScene(canvas);
    const director = new PresentationDirector();
    rendererRef.current = renderer;
    directorRef.current = director;
    if (import.meta.env.DEV) {
      const hook = window as unknown as { __mijing?: Record<string, unknown> };
      if (hook.__mijing) hook.__mijing.scene = renderer;
    }

    const smooth = { x: 0, y: 0 };
    let cameraReady = false;
    let last = performance.now();
    let raf = 0;

    const resize = (): void => {
      renderer.resize();
      const rect = canvas.getBoundingClientRect();
      sizeRef.current = { w: rect.width, h: rect.height };
    };

    const loop = (now: number): void => {
      const dt = Math.min(64, now - last);
      last = now;
      const scene = sceneRef.current;
      if (scene) {
        const frame = director.tick(now);
        const current = viewRef.current;
        if (current.follow) {
          if (!cameraReady) {
            smooth.x = frame.player.pos.x;
            smooth.y = frame.player.pos.y;
            cameraReady = true;
          }
          const k = 1 - Math.exp(-dt / FOLLOW_LAG_MS);
          smooth.x += (frame.player.pos.x - smooth.x) * k;
          smooth.y += (frame.player.pos.y - smooth.y) * k;
        } else {
          smooth.x = current.cx;
          smooth.y = current.cy;
        }
        const camera: Camera = {
          zoom: current.zoom,
          cx: smooth.x,
          cy: smooth.y,
          follow: current.follow,
        };
        cameraRef.current = camera;
        renderer.render(scene.model, camera, sizeRef.current, frame);
      }
      raf = requestAnimationFrame(loop);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.dispose();
    };
  }, []);

  // 二、状态变化 → 新场景 + 新事件。换局由 director 自己认种子。
  useEffect(() => {
    if (!game) return;
    const model = buildRenderModel(game, selectedTarget ?? undefined);
    sceneRef.current = { model };
    directorRef.current?.push(model, game.events, performance.now());
  }, [game, selectedTarget]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      // 跟随状态下视图中心不在玩家身上，先对齐再缩放，否则锚点会跑偏。
      if (viewRef.current.follow) {
        const camera = cameraRef.current;
        setCamera(camera.cx, camera.cy);
      }
      zoomAt(
        Math.exp(-event.deltaY * 0.0015),
        { w: rect.width, h: rect.height },
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAt, setCamera]);

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
        // 交出跟随镜头时以当前画面为准接管，避免画面跳一下。
        setFollow(false);
        setCamera(cameraRef.current.cx, cameraRef.current.cy);
      }
      if (drag.moved) {
        panBy(dx, dy);
        dragRef.current = { x: event.clientX, y: event.clientY, moved: true };
      }
    },
    [panBy, setFollow, setCamera],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.moved) return;

      const canvas = event.currentTarget;
      const rect = canvas.getBoundingClientRect();
      const cell = rendererRef.current?.screenToCell(
        cameraRef.current,
        sizeRef.current,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      if (!cell) return;

      const current = useGameStore.getState().game;
      if (!current) return;

      // 选中的卡需要指定目标：点怪物而不是移动
      const card = current.hand.find((item) => item.uid === selectedCard)?.def ?? null;
      if (card?.needsTarget) {
        const monster = current.monsters.find(
          (item) => item.pos.q === cell.q && item.pos.r === cell.r,
        );
        if (monster) selectTarget(`${monster.pos.q},${monster.pos.r}`);
        return;
      }

      if (!areAdjacent(current.player.pos, cell)) return;
      dispatch({ type: 'move', target: cell });
    },
    [dispatch, selectedCard, selectTarget],
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
      {game?.status === 'lost' ? (
        <div className="board__overlay">
          <div className="board__banner">
            <h2>你倒在了黑暗里</h2>
            <p>坚持了 {game.turn} 回合 · 种子 {game.seed}</p>
          </div>
        </div>
      ) : null}
      {game?.notice ? <div className="board__notice">{game.notice}</div> : null}
    </div>
  );
}
