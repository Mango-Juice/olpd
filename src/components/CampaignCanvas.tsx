import { useRef } from "react";
import type { SceneComposition } from "../campaign/level";
import type { StagePresentation } from "../campaign/run";
import type { EntityId, WorldState, Verb } from "../campaign/types";
import {
  campaignPresentationDuration,
  campaignSoundCuesBetween,
  type SoundCue,
} from "../render/animation";
import {
  CAMPAIGN_VIEW_HEIGHT,
  CAMPAIGN_VIEW_WIDTH,
  hitTestCampaignLayout,
  renderCampaignScene,
  type CampaignEntityLayout,
} from "../render/campaign-scene";
import {
  advancePlaybackTimeline,
  useCanvasPlayback,
  type PlaybackTimeline,
} from "../hooks/useCanvasPlayback";
import { PlaySceneHeading } from "./PlaySessionControls";
import "./CampaignCanvas.css";

export interface CampaignCanvasProps {
  world: WorldState;
  scene?: SceneComposition;
  actorVerbs?: Partial<Record<"hero" | "keeper", Verb>>;
  title: string;
  displayNumber?: number;
  reducedMotion: boolean;
  paused: boolean;
  presentation?: StagePresentation | null;
  /** Keeps terminal Chapter 1-style result frames visible after acknowledgement. */
  settledPresentation?: StagePresentation | null;
  onPlaybackEnd?: () => void;
  onSound?: (cue: SoundCue) => void;
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
  const playbackRef = useRef<(PlaybackTimeline & { id: string }) | null>(null);
  liveRef.current = props;

  useCanvasPlayback({
    canvasRef,
    paused: props.paused,
    reducedMotion: props.reducedMotion,
    draw: ({ canvas, context, deltaMs, sceneTime, reducedMotion }) => {
      const current = liveRef.current;
      let playbackProgress = 1;
      if (current.presentation) {
        const duration = campaignPresentationDuration(
          current.presentation,
          current.reducedMotion,
        );
        if (playbackRef.current?.id !== current.presentation.id) {
          playbackRef.current = {
            id: current.presentation.id,
            elapsed: 0,
            duration,
            cueProgress: 0,
            ended: false,
          };
        }
        playbackProgress = advancePlaybackTimeline(playbackRef.current, {
          deltaMs,
          cuesBetween: (from, to) =>
            campaignSoundCuesBetween(current.presentation!, from, to),
          onCue: current.onSound,
          onEnd: current.onPlaybackEnd,
        });
      } else {
        // Settled state is already the result of a completed presentation.
        // Re-interpolating old world snapshots here would visibly replay it backwards.
        playbackRef.current = null;
      }
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
        actorVerbs: current.actorVerbs,
        presentation: current.presentation ?? current.settledPresentation,
        playbackProgress,
        title: current.title,
        displayNumber: current.displayNumber,
        time: sceneTime,
        reducedMotion,
        selectedEntityId: current.selectedEntityId,
        labelScale,
      });
    },
  });

  const selectFromCanvas = (clientX: number, clientY: number) => {
    if (props.presentation || props.settledPresentation || !props.onSelectEntity || !canvasRef.current) return;
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

  const displayedPresentation = props.presentation ?? props.settledPresentation;
  const visibleWorld = displayedPresentation
    ? displayedPresentation.outcome === "revive"
      ? displayedPresentation.after
      : displayedPresentation.before
    : props.world;
  const entities = visibleEntities(visibleWorld);
  const selected = props.selectedEntityId && entities.some((entity) => entity.id === props.selectedEntityId)
    ? visibleWorld.entities[props.selectedEntityId]
    : undefined;
  const ariaState = `${props.title}. ${entities.map((entity) => entity.name).join(", ")}.`;

  return (
    <figure className="campaign-scene campaign-canvas" data-scene-width={CAMPAIGN_VIEW_WIDTH}>
      <PlaySceneHeading
        eyebrow={`CHAPTER ${String(visibleWorld.stageId).padStart(2, "0")}${props.displayNumber === undefined ? "" : ` · STAGE ${props.displayNumber}`}`}
        title={props.title}
      >
        {props.displayNumber === undefined ? null : (
          <span className="chapter-number">
            {visibleWorld.stageId}-{props.displayNumber}
          </span>
        )}
      </PlaySceneHeading>
      <div className="campaign-map-viewport">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={ariaState}
          width={CAMPAIGN_VIEW_WIDTH}
          height={CAMPAIGN_VIEW_HEIGHT}
          onClick={(event) => selectFromCanvas(event.clientX, event.clientY)}
          className={props.onSelectEntity && !displayedPresentation ? "campaign-scene-canvas is-interactive" : "campaign-scene-canvas"}
        >
          {ariaState}
        </canvas>
      </div>
      <figcaption className="sr-only">
        <p role="status" aria-live="polite" aria-atomic="true">
          {selected ? `${selected.name} 선택됨` : ""}
        </p>
        {props.onSelectEntity && !displayedPresentation ? (
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
