import { useEffect, useId, useRef, useState } from "react";
import { formatEntityFacts } from "../campaign/presentation";
import type { EntityId, WorldState, Verb } from "../campaign/types";
import {
  CAMPAIGN_VIEW_HEIGHT,
  CAMPAIGN_VIEW_WIDTH,
  renderCampaignScene,
  campaignSceneWidth,
  layoutCampaignActors,
  hitTestCampaignLayout,
  type CampaignEntityLayout,
} from "../render/campaign-scene";
import { onHeroSpriteReady } from "../render/scene";
import "./CampaignCanvas.css";

export interface CampaignCanvasProps {
  world: WorldState;
  actorVerbs?: Partial<Record<"hero" | "keeper", Verb>>;
  title: string;
  displayNumber?: number;
  reducedMotion: boolean;
  paused: boolean;
  selectedEntityId?: EntityId;
  onSelectEntity?: (id: EntityId) => void;
}

const allVisibleEntities = (world: WorldState) => {
  const seen = new Set<EntityId>();
  return world.visible.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const entity = world.entities[id];
    return entity && entity.properties.equipment !== true ? [entity] : [];
  });
};

function isPreviousCauseMapEntity(world: WorldState, entityId: EntityId) {
  const entity = world.entities[entityId];
  const heroRegion = world.actors.hero?.location.region;
  return Boolean(
    entity
    && heroRegion
    && entity.location.region !== heroRegion
    && entity.properties.causeMapVisible === true,
  );
}

const visibleEntities = (world: WorldState) =>
  allVisibleEntities(world).filter((entity) =>
    !isPreviousCauseMapEntity(world, entity.id));

const previousCauseMapEntities = (world: WorldState) =>
  allVisibleEntities(world).filter((entity) =>
    isPreviousCauseMapEntity(world, entity.id));

export function CampaignCanvas(props: CampaignCanvasProps) {
  const selectedTitleId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(960);
  const [overview, setOverview] = useState(false);
  const sceneWidth = campaignSceneWidth(props.world);
  const sceneScale = overview ? viewportWidth / sceneWidth : Math.max(0.85, Math.min(1, viewportWidth / CAMPAIGN_VIEW_WIDTH));
  const scrollToPoint = (x: number) => {
    viewportRef.current?.scrollTo({ left: x * sceneScale - viewportWidth / 2, behavior: props.reducedMotion ? "instant" : "smooth" });
  };
  const focusHero = () => {
    setOverview(false);
    const hero = layoutCampaignActors(props.world).find((actor) => actor.id === "hero");
    if (hero) scrollToPoint(hero.x);
  };
  const liveRef = useRef(props);
  const layoutRef = useRef<CampaignEntityLayout[]>([]);
  const sceneTimeRef = useRef(0);
  const transitionRef = useRef({ world: props.world, previous: props.world, startedAt: 0 });
  const hiddenRef = useRef(
    typeof document !== "undefined" ? document.hidden : false,
  );
  liveRef.current = props;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => setViewportWidth(viewport.clientWidth);
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      hiddenRef.current = document.hidden;
    };
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
    let paintedSelection: EntityId | undefined;
    let paintedWidth = 0; let paintedHeight = 0; let paintedAt = 0;

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
          previous: old.segmentId === current.world.segmentId && old.attempt === current.world.attempt ? old : current.world,
          startedAt: now,
        };
      }
      const delta = Math.min(50, Math.max(0, now - previous));
      previous = now;
      if (!current.paused && !hiddenRef.current && !current.reducedMotion) {
        sceneTimeRef.current += delta / 1000;
      }
      const transitioning = transitionRef.current.previous !== current.world && now - transitionRef.current.startedAt < 280 && !current.reducedMotion;
      const finalFrameNeeded = !current.reducedMotion && transitionRef.current.previous !== current.world && now >= transitionRef.current.startedAt + 280 && paintedAt < transitionRef.current.startedAt + 280;
      const animated = (!current.paused && !current.reducedMotion && !hiddenRef.current) || transitioning || finalFrameNeeded;
      if (paintedWorld === current.world && paintedSelection === current.selectedEntityId
        && paintedWidth === canvas.width && paintedHeight === canvas.height
        && (!animated || now - paintedAt < 32)) {
        raf = requestAnimationFrame(draw);
        return;
      }
      paintedWorld = current.world; paintedSelection = current.selectedEntityId;
      paintedWidth = canvas.width; paintedHeight = canvas.height; paintedAt = now;
      const scale = Math.min(
        canvas.width / campaignSceneWidth(current.world),
        canvas.height / CAMPAIGN_VIEW_HEIGHT,
      );
      const width = campaignSceneWidth(current.world) * scale;
      const height = CAMPAIGN_VIEW_HEIGHT * scale;
      const offsetX = (canvas.width - width) / 2;
      const offsetY = (canvas.height - height) / 2;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#090b1d";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      layoutRef.current = renderCampaignScene(context, {
        world: current.world,
        previousWorld: transitionRef.current.previous,
        actorVerbs: current.actorVerbs,
        transitionProgress: current.reducedMotion ? 1 : Math.min(1, (now - transitionRef.current.startedAt) / 280),
        title: current.title,
        displayNumber: current.displayNumber,
        time: sceneTimeRef.current,
        reducedMotion: current.reducedMotion,
        selectedEntityId: current.selectedEntityId,
      });
      // Static scenes repaint on state, selection, resize or sprite readiness; moving scenes cap at 30 fps.
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

  const heroLocation = props.world.actors.hero.location;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const current = liveRef.current;
      const hero = layoutCampaignActors(current.world).find((actor) => actor.id === "hero");
      const scale = Math.max(0.85, Math.min(1, viewportWidth / CAMPAIGN_VIEW_WIDTH));
      if (hero) viewportRef.current?.scrollTo({ left: hero.x * scale - viewportWidth / 2, behavior: current.reducedMotion ? "instant" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [heroLocation.region, heroLocation.x, heroLocation.y, viewportWidth, overview]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const current = liveRef.current;
      const target = layoutRef.current.find((layout) => layout.id === current.selectedEntityId);
      const scale = Math.max(0.85, Math.min(1, viewportWidth / CAMPAIGN_VIEW_WIDTH));
      if (target) viewportRef.current?.scrollTo({ left: target.x * scale - viewportWidth / 2, behavior: current.reducedMotion ? "instant" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [props.selectedEntityId, viewportWidth, overview]);

  const entities = visibleEntities(props.world);
  const previousEntities = previousCauseMapEntities(props.world);
  const selected = props.selectedEntityId
    && worldHasVisibleEntity(props.world, props.selectedEntityId)
    ? props.world.entities[props.selectedEntityId]
    : undefined;
  const selectedFacts = selected
    ? formatEntityFacts(props.world, selected)
    : [];
  const selectedDescription = selected && selected.description.trim() !== selected.name.trim()
    ? selected.description.trim() : "";
  const selectedFromPreviousRegion = selected
    ? isPreviousCauseMapEntity(props.world, selected.id)
    : false;
  const selectFromCanvas = (clientX: number, clientY: number) => {
    if (!props.onSelectEntity || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const scale = Math.min(
      bounds.width / sceneWidth,
      bounds.height / CAMPAIGN_VIEW_HEIGHT,
    );
    const offsetX = (bounds.width - sceneWidth * scale) / 2;
    const offsetY = (bounds.height - CAMPAIGN_VIEW_HEIGHT * scale) / 2;
    const x = (clientX - bounds.left - offsetX) / scale;
    const y = (clientY - bounds.top - offsetY) / scale;
    const target = hitTestCampaignLayout(layoutRef.current, x, y);
    if (target && worldHasVisibleEntity(props.world, target) && !isPreviousCauseMapEntity(props.world, target)) {
      setOverview(false);
      props.onSelectEntity(target);
    }
  };

  const ariaState = `${props.title}. 장면에 보이는 물건 ${entities.length}개. 아래 물건 목록에서 키보드로도 살펴볼 수 있어요.`;
  return (
    <figure className="campaign-scene">
      <div className="campaign-map-heading"><strong>{props.title}</strong><span>{props.world.stageId}장{props.displayNumber === undefined ? "" : ` · 스테이지 ${props.displayNumber}`}</span></div>
      <div ref={viewportRef} className="campaign-map-viewport" role="region" aria-label="스테이지 지도 · 좌우로 살펴보기" tabIndex={0}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaState}
        style={{ width: sceneWidth * sceneScale, height: CAMPAIGN_VIEW_HEIGHT * sceneScale }}
        width={sceneWidth}
        height={CAMPAIGN_VIEW_HEIGHT}
        onClick={(event) => selectFromCanvas(event.clientX, event.clientY)}
        className={props.onSelectEntity ? "campaign-scene-canvas is-interactive" : "campaign-scene-canvas"}
      >
        {ariaState}
      </canvas>
      </div>
      {sceneWidth * Math.max(0.85, Math.min(1, viewportWidth / CAMPAIGN_VIEW_WIDTH)) > viewportWidth + 1 && <nav className="campaign-map-navigation" aria-label="지도 이동">
        <button type="button" disabled={overview} aria-label="지도 왼쪽 보기" onClick={() => viewportRef.current?.scrollBy({ left: -viewportWidth * 0.7, behavior: props.reducedMotion ? "instant" : "smooth" })}>← 왼쪽</button>
        <button type="button" onClick={focusHero}>용사 위치</button>
        <button type="button" aria-pressed={overview} onClick={() => setOverview(!overview)}>{overview ? "가까이 보기" : "전체 지도"}</button>
        <span>좌우로 밀어 살펴보기</span>
        <button type="button" disabled={overview} aria-label="지도 오른쪽 보기" onClick={() => viewportRef.current?.scrollBy({ left: viewportWidth * 0.7, behavior: props.reducedMotion ? "instant" : "smooth" })}>오른쪽 →</button>
      </nav>}
      <figcaption className="campaign-scene-caption">
        <p className="campaign-scene-prompt">궁금한 물건을 눌러 살펴보세요.</p>
        <div className="campaign-object-picker">
          <ol aria-label="장면 속 물건">
            {entities.map((entity) => (
              <li key={entity.id}>
                {props.onSelectEntity ? (
                  <button
                    type="button"
                    aria-pressed={selected?.id === entity.id}
                    aria-label={entity.name}
                    onClick={() => { setOverview(false); props.onSelectEntity?.(entity.id); }}
                  >
                    {entity.name}
                  </button>
                ) : <span>{entity.name}</span>}
              </li>
            ))}
          </ol>
          {props.world.entities.letter ? <p>배달할 편지는 몸의 주머니에 있어요. 손과 물건 고리를 쓰지 않아요.</p> : null}
        </div>
        {previousEntities.length ? (
          <div className="campaign-object-picker campaign-previous-objects">
            <p className="campaign-object-group-title">이전 스테이지의 장치 상태 · {previousEntities.length}개</p>
            <ol aria-label="이전 구역의 장치">
              {previousEntities.map((entity) => (
                <li key={entity.id}>
                  {props.onSelectEntity ? (
                    <button
                      type="button"
                      aria-pressed={selected?.id === entity.id}
                      aria-label={`이전 구역의 ${entity.name}`}
                      onClick={() => { setOverview(false); props.onSelectEntity?.(entity.id); }}
                    >
                      {entity.name}
                    </button>
                  ) : <span>{entity.name}</span>}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {selected ? `${selected.name} 선택됨` : ""}
        </p>
        {selected ? (
          <section className="campaign-scene-observation" aria-labelledby={selectedTitleId}>
            {selectedFromPreviousRegion ? (
              <p className="campaign-observation-context">이전 구역에서 이어진 장치 상태</p>
            ) : null}
            <h2 id={selectedTitleId}>{selected.name}</h2>
            {selectedDescription ? <p>{selectedDescription}</p> : null}
            <dl className="campaign-entity-facts">
              {selectedFacts.map((fact) => {
                const separator = fact.indexOf(" · ");
                const label = separator < 0 ? "이동" : fact.slice(0, separator);
                const value = separator < 0 ? fact : fact.slice(separator + 3);
                return <div key={fact}><dt>{label}</dt><dd>{value}</dd></div>;
              })}
            </dl>
          </section>
        ) : null}
      </figcaption>
    </figure>
  );
}

function worldHasVisibleEntity(world: WorldState, id: EntityId) {
  return world.visible.includes(id) && Boolean(world.entities[id]);
}

export default CampaignCanvas;
