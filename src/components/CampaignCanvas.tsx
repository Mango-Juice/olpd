import { useEffect, useRef } from "react";
import type { SceneComposition } from "../campaign/level";
import type { EntityId, WorldState, Verb } from "../campaign/types";
import {
  CAMPAIGN_VIEW_HEIGHT,
  CAMPAIGN_VIEW_WIDTH,
  hitTestCampaignLayout,
  renderCampaignScene,
  type CampaignEntityLayout,
} from "../render/campaign-scene";
import { onHeroSpriteReady } from "../render/scene";
import "./CampaignCanvas.css";

export interface CampaignCanvasProps {
  world: WorldState;
  scene?: SceneComposition;
  actorVerbs?: Partial<Record<"hero" | "keeper", Verb>>;
  title: string;
  displayNumber?: number;
  reducedMotion: boolean;
  paused: boolean;
  selectedEntityId?: EntityId;
  onSelectEntity?: (id: EntityId) => void;
}

const visibleEntities = (world: WorldState) => {
  const seen = new Set<EntityId>();
  const heroRegion = world.actors.hero?.location.region;
  return world.visible.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const entity = world.entities[id];
    if (!entity || entity.properties.equipment === true) return [];
    if (entity.properties.causeMapVisible === true && entity.location.region !== heroRegion) return [];
    return [entity];
  });
};

export function CampaignCanvas(props: CampaignCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<CampaignEntityLayout[]>([]);
  const liveRef = useRef(props);
  const sceneTimeRef = useRef(0);
  const transitionRef = useRef({ world: props.world, previous: props.world, startedAt: 0 });
  const hiddenRef = useRef(typeof document !== "undefined" ? document.hidden : false);
  liveRef.current = props;

  useEffect(() => {
    const onVisibility = () => { hiddenRef.current = document.hidden; };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let raf = 0;
    let previous = performance.now();
    let paintedWorld: WorldState | null = null;
    let paintedScene: SceneComposition | undefined;
    let paintedSelection: EntityId | undefined;
    let paintedWidth = 0;
    let paintedHeight = 0;
    let paintedAt = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (now: number) => {
      const current = liveRef.current;
      if (transitionRef.current.world !== current.world) {
        const old = transitionRef.current.world;
        transitionRef.current = {
          world: current.world,
          previous: old.segmentId === current.world.segmentId && old.attempt === current.world.attempt
            ? old : current.world,
          startedAt: now,
        };
      }
      const delta = Math.min(50, Math.max(0, now - previous));
      previous = now;
      if (!current.paused && !hiddenRef.current && !current.reducedMotion) {
        sceneTimeRef.current += delta / 1000;
      }
      const transitionAge = now - transitionRef.current.startedAt;
      const transitioning = transitionRef.current.previous !== current.world
        && transitionAge < 280 && !current.reducedMotion;
      const finalFrameNeeded = !current.reducedMotion
        && transitionRef.current.previous !== current.world
        && transitionAge >= 280 && paintedAt < transitionRef.current.startedAt + 280;
      const animated = (!current.paused && !current.reducedMotion && !hiddenRef.current)
        || transitioning || finalFrameNeeded;
      if (paintedWorld === current.world && paintedScene === current.scene
        && paintedSelection === current.selectedEntityId
        && paintedWidth === canvas.width && paintedHeight === canvas.height
        && (!animated || now - paintedAt < 32)) {
        raf = requestAnimationFrame(draw);
        return;
      }
      paintedWorld = current.world;
      paintedScene = current.scene;
      paintedSelection = current.selectedEntityId;
      paintedWidth = canvas.width;
      paintedHeight = canvas.height;
      paintedAt = now;

      const scale = Math.min(
        canvas.width / CAMPAIGN_VIEW_WIDTH,
        canvas.height / CAMPAIGN_VIEW_HEIGHT,
      );
      const offsetX = (canvas.width - CAMPAIGN_VIEW_WIDTH * scale) / 2;
      const offsetY = (canvas.height - CAMPAIGN_VIEW_HEIGHT * scale) / 2;
      const labelScale = canvas.clientWidth >= 720
        ? 1
        : Math.min(2.3, CAMPAIGN_VIEW_WIDTH / Math.max(1, canvas.clientWidth));
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#090b1d";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      layoutRef.current = renderCampaignScene(context, {
        world: current.world,
        scene: current.scene,
        previousWorld: transitionRef.current.previous,
        actorVerbs: current.actorVerbs,
        transitionProgress: current.reducedMotion ? 1 : Math.min(1, transitionAge / 280),
        title: current.title,
        displayNumber: current.displayNumber,
        time: sceneTimeRef.current,
        reducedMotion: current.reducedMotion,
        selectedEntityId: current.selectedEntityId,
        labelScale,
      });
      raf = requestAnimationFrame(draw);
    };

    const stopWatchingSprite = onHeroSpriteReady(() => { paintedWorld = null; });
    raf = requestAnimationFrame(draw);
    return () => {
      stopWatchingSprite();
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const selectFromCanvas = (clientX: number, clientY: number) => {
    if (!props.onSelectEntity || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const scale = Math.min(
      bounds.width / CAMPAIGN_VIEW_WIDTH,
      bounds.height / CAMPAIGN_VIEW_HEIGHT,
    );
    const offsetX = (bounds.width - CAMPAIGN_VIEW_WIDTH * scale) / 2;
    const offsetY = (bounds.height - CAMPAIGN_VIEW_HEIGHT * scale) / 2;
    const x = (clientX - bounds.left - offsetX) / scale;
    const y = (clientY - bounds.top - offsetY) / scale;
    const target = hitTestCampaignLayout(layoutRef.current, x, y);
    if (target) props.onSelectEntity(target);
  };

  const entities = visibleEntities(props.world);
  const selected = props.selectedEntityId && entities.some((entity) => entity.id === props.selectedEntityId)
    ? props.world.entities[props.selectedEntityId]
    : undefined;
  const ariaState = `${props.title}. ${entities.map((entity) => entity.name).join(", ")}.`;

  return (
    <figure className="campaign-scene campaign-canvas" data-scene-width={CAMPAIGN_VIEW_WIDTH}>
      <div className="campaign-map-heading">
        <strong>{props.title}</strong>
        <span>{props.world.stageId}장{props.displayNumber === undefined ? "" : ` · 스테이지 ${props.displayNumber}`}</span>
      </div>
      <div className="campaign-map-viewport">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={ariaState}
          width={CAMPAIGN_VIEW_WIDTH}
          height={CAMPAIGN_VIEW_HEIGHT}
          onClick={(event) => selectFromCanvas(event.clientX, event.clientY)}
          className={props.onSelectEntity ? "campaign-scene-canvas is-interactive" : "campaign-scene-canvas"}
        >
          {ariaState}
        </canvas>
      </div>
      <figcaption className="sr-only">
        <p role="status" aria-live="polite" aria-atomic="true">
          {selected ? `${selected.name} 선택됨` : ""}
        </p>
        {props.onSelectEntity ? (
          <ol aria-label="장면 속 물건">
            {entities.map((entity) => (
              <li key={entity.id}>
                <button
                  type="button"
                  aria-pressed={selected?.id === entity.id}
                  onClick={() => props.onSelectEntity?.(entity.id)}
                >
                  {entity.name}
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </figcaption>
    </figure>
  );
}

export default CampaignCanvas;
