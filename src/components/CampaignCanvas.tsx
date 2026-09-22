import { useEffect, useId, useRef } from "react";
import { formatEntityFacts } from "../campaign/presentation";
import type { EntityId, WorldState } from "../campaign/types";
import {
  CAMPAIGN_VIEW_HEIGHT,
  CAMPAIGN_VIEW_WIDTH,
  renderCampaignScene,
  type CampaignEntityLayout,
} from "../render/campaign-scene";
import "./CampaignCanvas.css";

export interface CampaignCanvasProps {
  world: WorldState;
  title: string;
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
    return entity ? [entity] : [];
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

function conciseDescription(description: string, fallback: string) {
  const normalized = description.trim() || fallback;
  const firstSentence = normalized.match(/^[^.!?。]+[.!?。]/u)?.[0];
  return firstSentence?.trim() || normalized;
}

export function CampaignCanvas(props: CampaignCanvasProps) {
  const selectedTitleId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef(props);
  const layoutRef = useRef<CampaignEntityLayout[]>([]);
  const sceneTimeRef = useRef(0);
  const hiddenRef = useRef(
    typeof document !== "undefined" ? document.hidden : false,
  );
  liveRef.current = props;

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
      const delta = Math.min(50, Math.max(0, now - previous));
      previous = now;
      if (!current.paused && !hiddenRef.current && !current.reducedMotion) {
        sceneTimeRef.current += delta / 1000;
      }
      const scale = Math.min(
        canvas.width / CAMPAIGN_VIEW_WIDTH,
        canvas.height / CAMPAIGN_VIEW_HEIGHT,
      );
      const width = CAMPAIGN_VIEW_WIDTH * scale;
      const height = CAMPAIGN_VIEW_HEIGHT * scale;
      const offsetX = (canvas.width - width) / 2;
      const offsetY = (canvas.height - height) / 2;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#090b1d";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      layoutRef.current = renderCampaignScene(context, {
        world: current.world,
        title: current.title,
        time: sceneTimeRef.current,
        reducedMotion: current.reducedMotion,
        selectedEntityId: current.selectedEntityId,
      });
      // Repainting also lets the asynchronously decoded local hero sprite replace its fallback.
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const entities = visibleEntities(props.world);
  const previousEntities = previousCauseMapEntities(props.world);
  const selected = props.selectedEntityId
    && worldHasVisibleEntity(props.world, props.selectedEntityId)
    ? props.world.entities[props.selectedEntityId]
    : undefined;
  const selectedFacts = selected
    ? formatEntityFacts(props.world, selected)
    : [];
  const selectedDescription = selected
    ? conciseDescription(selected.description, selected.name)
    : "";
  const selectedFromPreviousRegion = selected
    ? isPreviousCauseMapEntity(props.world, selected.id)
    : false;
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
    const nearest = layoutRef.current
      .map((layout) => ({
        id: layout.id,
        distance: Math.hypot(layout.x - x, layout.y - 24 - y),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (
      nearest
      && nearest.distance <= 48
      && worldHasVisibleEntity(props.world, nearest.id)
      && !isPreviousCauseMapEntity(props.world, nearest.id)
    ) {
      props.onSelectEntity(nearest.id);
    }
  };

  const ariaState = `${props.title}. 장면에 보이는 물건 ${entities.length}개. 물건 목록을 열어 키보드로 살펴볼 수 있어요.`;
  return (
    <figure className="campaign-scene">
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
      <figcaption className="campaign-scene-caption">
        <p className="campaign-scene-prompt">궁금한 물건을 눌러 살펴보세요.</p>
        <details className="campaign-object-picker">
          <summary>물건 목록 열기 · {entities.length}개</summary>
          <ol aria-label="장면 속 물건">
            {entities.map((entity) => (
              <li key={entity.id}>
                {props.onSelectEntity ? (
                  <button
                    type="button"
                    aria-pressed={selected?.id === entity.id}
                    aria-label={entity.name}
                    onClick={() => props.onSelectEntity?.(entity.id)}
                  >
                    {entity.name}
                  </button>
                ) : <span>{entity.name}</span>}
              </li>
            ))}
          </ol>
        </details>
        {previousEntities.length ? (
          <details className="campaign-object-picker campaign-previous-objects">
            <summary>이전 스테이지의 장치 상태 · {previousEntities.length}개</summary>
            <p>이전 구역에서 이어지는 장치예요. 현재 장면의 물건과 구분해 살펴볼 수 있어요.</p>
            <ol aria-label="이전 구역의 장치">
              {previousEntities.map((entity) => (
                <li key={entity.id}>
                  {props.onSelectEntity ? (
                    <button
                      type="button"
                      aria-pressed={selected?.id === entity.id}
                      aria-label={`이전 구역의 ${entity.name}`}
                      onClick={() => props.onSelectEntity?.(entity.id)}
                    >
                      {entity.name}
                    </button>
                  ) : <span>{entity.name}</span>}
                </li>
              ))}
            </ol>
          </details>
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
            <p>{selectedDescription}</p>
            <details>
              <summary>자세한 성질 보기</summary>
              {selected.description.trim() && selected.description.trim() !== selectedDescription ? (
                <p>{selected.description}</p>
              ) : null}
              <ul>
                {selectedFacts.map((fact) => <li key={fact}>{fact}</li>)}
              </ul>
            </details>
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
