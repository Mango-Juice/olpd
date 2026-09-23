import type { SceneComposition } from "../campaign/level";
import type { Actor, Entity, EntityId, Verb, WorldState } from "../campaign/types";
import type { StagePresentation } from "../campaign/run";
import {
  campaignActorVerb,
  campaignHeroFrame,
  idleHeroFrame,
} from "./animation";
import { PALETTE as C } from "./palette";
import {
  drawBlockedMotif,
  drawDungeonBackdrop,
  drawDungeonFloor,
  drawDungeonMasonry,
  drawHero,
} from "./scene";

export const CAMPAIGN_VIEW_WIDTH = 960;
export const CAMPAIGN_VIEW_HEIGHT = 500;

const LEFT = 80;
const FLOOR = 400;
const HEIGHT_STEP = 65;
const LABEL_WIDTH = 116;
const LABEL_HEIGHT = 30;

export interface CampaignEntityLayout {
  id: EntityId;
  entity: Entity;
  index: number;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  rotation: number;
  labelScale: number;
  labelBounds: { x: number; y: number; width: number; height: number };
  relation: "world" | "held" | "carried";
  actorId?: Actor["id"];
}

export interface CampaignActorLayout {
  id: Actor["id"];
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  rotation: number;
  riding: EntityId | null;
}

export interface CampaignSceneOptions {
  world: WorldState;
  scene?: SceneComposition;
  title: string;
  displayNumber?: number;
  time: number;
  reducedMotion: boolean;
  selectedEntityId?: EntityId;
  previousWorld?: WorldState;
  transitionProgress?: number;
  actorVerbs?: Partial<Record<Actor["id"], Verb>>;
  presentation?: StagePresentation | null;
  playbackProgress?: number;
  labelScale?: number;
}

const numberProperty = (entity: Entity, key: string, fallback = 0) => {
  const value = entity.properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const stringProperty = (entity: Entity, key: string) => {
  const value = entity.properties[key];
  return typeof value === "string" ? value : null;
};

const booleanProperty = (entity: Entity, key: string) =>
  entity.properties[key] === true;

const SHAPE_ALIASES: Record<string, string> = {
  "lift": "elevator", "lift-platform": "elevator", "lift-route": "ladder", "gravity-path": "ladder",
  "obstacle": "rail-pot", "reinforcement-plate": "tray", "hazard-cover": "tray", "floor-route": "footway",
  "seed-pedestal": "support", "workbench": "support", "story-object": "display-board", "story-prop": "display-board",
  "inventory-display": "display-board", "inventory-board": "display-board", "ability-board": "display-board", "beam-display": "display-board",
  "ignition-stand": "fixed-lantern", "light-sensor": "light-sensor", "recovery-net": "net", "seal-chest": "box",
  "lever": "handle", "hold-plate": "pressure-plate", "wide-hold-bar": "handle", "light-cart": "cart", "rail-rope-handle": "handle",
  "lens": "scope", "window": "section-model", "axle": "shaft", "passage": "footway", "route": "ladder",
  "water-vessel": "bottle", "sealed-float": "buoy", "connection-sample": "pipe", "connection-end": "shaft", "connection": "shaft",
  "safe-alcove": "safe-platform", "console": "display-board", "checkpoint-balcony": "balcony", "step-socket": "support-socket", "rail-box": "box",
  "bridge": "bridge", "mist": "fog", "waterway": "water", "destination": "exit",
  "inside": "exit", "beyond-place": "exit", "meeting-place": "safe-platform", "upper-floor": "safe-platform",
  "safe-spot": "safe-platform", "support-block": "support",
  "dark-stairs": "ladder", "fog-stairs": "ladder",
  "moving-bell": "bell", "wind-vane": "pinwheel",
  "cooling-vane": "pinwheel", "vane": "pinwheel", "warden-arm": "boss-arm",
  "armor-latch": "latch", "final-latch": "latch", "armor-plate": "bridge",
  "hot-armor-path": "hot-path", "holding-ring": "hold-handle", "final-door": "door",
  "dock": "safe-platform", "stairs": "ladder", "wind-path": "bridge", "signal-flag": "signal",
};

const normalizedKind = (entity: Entity) => {
  const rawKind = stringProperty(entity, "kind") ?? "object";
  const declared = SHAPE_ALIASES[rawKind] ?? rawKind;
  const hint = `${entity.id} ${entity.name}`.toLowerCase();
  if ((declared === "portable-small" || declared === "portable-large" || declared === "portable-tool")
    && /평형추|압력추|무게추|이동 추|counterweight/.test(hint)) return "counterweight";
  if (rawKind === "winch" && /갈고리/.test(entity.name)) return "hook";
  if (rawKind === "route") return entity.properties.climbable === true || /승강|쇠사슬/.test(entity.name) ? "climb-route" : "footway";
  if (declared === "portable-tool") {
    if (/쐐기/.test(hint)) return "wedge";
    if (/판자|지지물|받침/.test(hint)) return "support";
    return "handle";
  }
  if (declared !== "object") return declared;
  if (/갑옷|warden|boss/.test(hint)) return "boss";
  if (/종축|회전축|승강 축|shaft|axis/.test(hint)) return "shaft";
  if (/신호|signal|깃발|flag|부표|buoy/.test(hint)) return "signal";
  if (/바람개비|풍차|wind.?vane|pinwheel/.test(hint)) return "pinwheel";
  if (/자물쇠|lock/.test(hint)) return "lock";
  if (/열쇠|key/.test(hint)) return "key";
  if (/걸쇠|latch|잠금핀/.test(hint)) return "latch";
  if (/문|door|gate|커튼|curtain/.test(hint) && "open" in entity.properties) return "door";
  if (/평형추|압력추|무게추|weight/.test(hint)) return "counterweight";
  if (/상자|box/.test(hint)) return "box";
  if (/빵|반죽|bread|dough/.test(hint)) return "food";
  if (/집게|claw/.test(hint)) return "claw";
  if (/덩굴|vine/.test(hint)) return "low-vine";
  if (/꽃|flower/.test(hint)) return "closed-flower";
  return declared;
};

const QUIET_SCENE_KINDS = new Set([
  "box", "exit", "bridge", "water", "handle", "hold-handle", "vent", "furnace",
  "claw", "platform", "safe-platform", "pinwheel", "elevator", "pressure", "latch",
  "fog", "flag", "boat", "support", "bell", "section-model", "boss-arm", "hot-path",
  "wing", "ladder", "hazard", "gap", "lantern", "wall-hook", "gate", "door", "food",
  "key", "gravity-boundary", "signal", "turbine", "footway",
  "closed-flower", "low-vine", "curtain", "viewing-window", "bell-pendulum", "tilted-stairs",
]);

/** Lets content tests report missing art semantics without exposing them in the game UI. */
export function campaignUnsupportedKinds(world: WorldState): string[] {
  return [...new Set(visibleEntities(world)
    .map(normalizedKind)
    .filter((kind) => !QUIET_SCENE_KINDS.has(kind)))].sort();
}

/** Public, deterministic state cues used by both the canvas and accessibility tests. */
export function campaignEntitySignals(entity: Entity): string[] {
  const signals: string[] = [];
  for (const key of [
    "open", "locked", "latched", "powered", "active", "on", "lit",
    "flowing", "spinning", "raised", "lowered", "released", "extended",
    "safe", "held", "wedged", "unlocked", "rung", "supported", "cooled",
    "illuminated", "readable", "engaged",
  ]) {
    if (typeof entity.properties[key] === "boolean") {
      signals.push(`${key}:${entity.properties[key]}`);
    }
  }
  for (const [currentKey, totalKey] of [
    ["safeBeat", "requiredTurns"],
    ["stampHits", "requiredHits"],
    ["returned", "required"],
    ["beams", "requiredBeams"],
    ["reading", "opensAt"],
  ] as const) {
    const current = entity.properties[currentKey];
    const total = entity.properties[totalKey];
    if (typeof current === "number" && Number.isFinite(current)
      && typeof total === "number" && Number.isFinite(total) && total > 0) {
      signals.push(`progress:${Math.max(0, current)}/${total}`);
      break;
    }
  }
  if (!signals.some((item) => item.startsWith("progress:"))) {
    const kind = normalizedKind(entity);
    const boundedProgress = kind === "heavy-weight"
      ? [entity.properties.height, 3] as const
      : kind === "pressure-plate"
        ? [entity.properties.pressure, 2] as const
        : null;
    if (boundedProgress && typeof boundedProgress[0] === "number" && Number.isFinite(boundedProgress[0])) {
      signals.push(`progress:${Math.max(0, boundedProgress[0])}/${boundedProgress[1]}`);
    }
  }
  if (!signals.some((item) => item.startsWith("progress:"))) {
    const orientation = entity.properties.orientation;
    const cycle = stringProperty(entity, "cycle")?.split("|").filter(Boolean);
    if (typeof orientation === "number" && Number.isFinite(orientation) && cycle?.length) {
      signals.push(`progress:${Math.abs(Math.trunc(orientation)) % cycle.length + 1}/${cycle.length}`);
    }
  }
  const direction = stringProperty(entity, "flowDirection")
    ?? stringProperty(entity, "gravity")
    ?? stringProperty(entity, "direction");
  if (direction) signals.push(`direction:${direction}`);
  return signals;
}

const visibleEntities = (world: WorldState) => {
  const seen = new Set<EntityId>();
  return world.visible.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const entity = world.entities[id];
    return entity
      && entity.properties.equipment !== true
      && !(entity.properties.causeMapVisible === true && entity.location.region !== world.actors.hero.location.region)
      ? [entity]
      : [];
  });
};

type Gravity = "down" | "up" | "left" | "right";
interface SceneColumn { worldX: number; start: number; width: number; anchorX: number; clusterSize: number; actorLane: number }
interface SceneRegion {
  id: string;
  start: number;
  end: number;
  gravity: Gravity;
  label: string;
  columns: SceneColumn[];
}
interface SceneGeometry { width: number; regions: SceneRegion[]; authored: boolean }
const sceneGeometryCache = new Map<string, SceneGeometry>();

const gravityValue = (value: string | null): Gravity =>
  value === "up" || value === "left" || value === "right" ? value : "down";

function sceneSignature(scene?: SceneComposition): string {
  return scene ? `${scene.ceiling === true}:${scene.floors.map((floor) => `${floor.from},${floor.to},${floor.y}`).join("|")}` : "fallback";
}

function createSceneGeometry(world: WorldState, scene?: SceneComposition): SceneGeometry {
  const entities = visibleEntities(world);
  const actorSignature = Object.values(world.actors)
    .map((actor) => `${actor.id}@${actor.location.region},${actor.location.x},${actor.location.y}`)
    .sort().join("+");
  const cacheKey = `${world.stageId}:${world.segmentId}:${world.attempt}:${sceneSignature(scene)}:${actorSignature}:${entities.map((entity) => `${entity.id}@${entity.location.region},${entity.location.x},${entity.location.y}`).join("|")}`;
  const cached = sceneGeometryCache.get(cacheKey);
  if (cached) return cached;
  const regionIds = [...new Set(entities.map((entity) => entity.location.region))];
  if (!regionIds.length) regionIds.push(world.actors.hero?.location.region ?? world.segmentId);
  const regionGap = regionIds.length > 1 ? 24 : 0;
  const regionWidth = (CAMPAIGN_VIEW_WIDTH - LEFT * 2 - regionGap * (regionIds.length - 1)) / regionIds.length;
  const regions = regionIds.map((regionId, regionIndex) => {
    const local = entities.filter((entity) => entity.location.region === regionId);
    const gravityMarker = local.find((entity) => {
      const kind = normalizedKind(entity);
      return typeof entity.properties.gravity === "string"
        && (kind === "room-gravity-marker" || (kind === "sign" && entity.properties.fixed === true)
          || entity.properties.fixedGravity === true);
    });
    const actorOnCeiling = Boolean(scene?.ceiling && world.stageId === 5
      && Object.values(world.actors).some((actor) => actor.location.region === regionId && actor.location.y >= 3));
    const gravity = actorOnCeiling ? "up" : gravityValue(gravityMarker ? stringProperty(gravityMarker, "gravity") : null);
    const label = gravityMarker?.name ?? (regionIds.length > 1 ? `구역 ${regionIds.indexOf(regionId) + 1}` : "");
    const actorXs = Object.values(world.actors)
      .filter((actor) => actor.location.region === regionId)
      .map((actor) => actor.location.x);
    const xValues = [...new Set([...local.map((entity) => entity.location.x), ...actorXs])].sort((a, b) => a - b);
    if (!xValues.length) xValues.push(0);
    const start = LEFT + regionIndex * (regionWidth + regionGap);
    const end = start + regionWidth;
    const minimum = Math.min(...xValues);
    const maximum = Math.max(...xValues);
    const columns = xValues.map((worldX) => {
      const authoredX = LEFT + Math.max(0, Math.min(10, worldX)) * 80;
      const amount = maximum === minimum ? .5 : (worldX - minimum) / (maximum - minimum);
      const anchorX = scene && regionIds.length === 1 ? authoredX : start + 20 + amount * Math.max(1, regionWidth - 40);
      return { worldX, start: anchorX, width: 0, anchorX, clusterSize: 1, actorLane: 0 };
    });
    return { id: regionId, start, end, gravity, label, columns };
  });
  const geometry = { width: CAMPAIGN_VIEW_WIDTH, regions, authored: Boolean(scene) };
  sceneGeometryCache.set(cacheKey, geometry);
  if (sceneGeometryCache.size > 80) sceneGeometryCache.delete(sceneGeometryCache.keys().next().value!);
  return geometry;
}

function sceneRegion(geometry: SceneGeometry, regionId: string): SceneRegion {
  return geometry.regions.find((region) => region.id === regionId) ?? geometry.regions[0];
}

function projectX(region: SceneRegion, worldX: number): number {
  const exact = region.columns.find((column) => column.worldX === worldX);
  if (exact) return exact.anchorX;
  const right = region.columns.find((column) => column.worldX > worldX);
  const left = [...region.columns].reverse().find((column) => column.worldX < worldX);
  if (left && right) {
    const amount = (worldX - left.worldX) / (right.worldX - left.worldX);
    return left.anchorX + (right.anchorX - left.anchorX) * amount;
  }
  if (left) return Math.min(region.end - 18, left.anchorX + (worldX - left.worldX) * 80);
  if (right) return Math.max(region.start + 18, right.anchorX - (right.worldX - worldX) * 80);
  return (region.start + region.end) / 2;
}

function projectY(region: SceneRegion, worldY: number): number {
  if (region.gravity === "left" || region.gravity === "right") return 275 - Math.abs(worldY) * HEIGHT_STEP;
  return Math.min(FLOOR, Math.max(120, FLOOR - Math.max(0, worldY) * HEIGHT_STEP));
}

function projectAnchor(region: SceneRegion, worldX: number, worldY: number) {
  if (region.gravity === "left" || region.gravity === "right") {
    const firstX = region.columns[0]?.worldX ?? 0;
    const lastX = region.columns.at(-1)?.worldX ?? firstX + 1;
    const amount = lastX === firstX ? 0.5 : Math.max(0, Math.min(1, (worldX - firstX) / (lastX - firstX)));
    return {
      x: region.gravity === "left" ? region.start + 37 : region.end - 27,
      y: 160 + amount * 205 - Math.abs(worldY) * 20,
    };
  }
  return { x: projectX(region, worldX), y: projectY(region, worldY) };
}

function actorRotation(gravity: Gravity): number {
  if (gravity === "up") return Math.PI;
  if (gravity === "left") return Math.PI / 2;
  if (gravity === "right") return -Math.PI / 2;
  return 0;
}

export function campaignSceneWidth(_world?: WorldState, _scene?: SceneComposition): number {
  return CAMPAIGN_VIEW_WIDTH;
}

/** Maps deterministic world coordinates to inspectable screen positions. */
export function layoutCampaignEntities(
  world: WorldState,
  scene?: SceneComposition,
  labelScale = 1,
): CampaignEntityLayout[] {
  const geometry = createSceneGeometry(world, scene);
  const base = layoutCampaignEntitiesBase(world, geometry);
  const actors = layoutActorsWithGeometry(world, geometry, base);
  const attachedCount = new Map<string, number>();
  const safeLabelScale = Math.max(1, Math.min(2.3, labelScale));
  const attached = base.map((layout) => {
    const actor = Object.values(world.actors).find((item) =>
      item.carrying.includes(layout.id) || layout.entity.parent === item.id
      || (item.holding === layout.id && layout.entity.movable));
    if (!actor || layout.entity.properties.equipment === true) return layout;
    const actorLayout = actors.find((item) => item.id === actor.id);
    if (!actorLayout) return layout;
    const relation: CampaignEntityLayout["relation"] = actor.holding === layout.id ? "held" : "carried";
    const count = attachedCount.get(actor.id) ?? 0;
    attachedCount.set(actor.id, count + 1);
    const localX = (actor.id === "hero" ? 1 : -1) * 55;
    const localY = -27 - count * 46;
    const cosine = Math.cos(actorLayout.rotation); const sine = Math.sin(actorLayout.rotation);
    const x = actorLayout.x + cosine * localX - sine * localY;
    const y = actorLayout.y + sine * localX + cosine * localY;
    const labelY = actorLayout.rotation === Math.PI ? actorLayout.y + 84 + count * 36
      : Math.abs(actorLayout.rotation) === Math.PI / 2 ? 22 + count * 36 : actorLayout.y - 126 - count * 36;
    return { ...layout, x, y, anchorX: actorLayout.anchorX, anchorY: actorLayout.anchorY,
      labelScale: safeLabelScale,
      labelBounds: { x: x - LABEL_WIDTH * safeLabelScale / 2, y: labelY,
        width: LABEL_WIDTH * safeLabelScale, height: LABEL_HEIGHT * safeLabelScale }, relation, actorId: actor.id };
  });
  return placeEntityLabels(attached.map((layout) => ({ ...layout, labelScale: safeLabelScale })), actors, safeLabelScale);
}

function overlaps(a: CampaignEntityLayout["labelBounds"], b: CampaignEntityLayout["labelBounds"], padding = 5) {
  return a.x < b.x + b.width + padding && a.x + a.width + padding > b.x
    && a.y < b.y + b.height + padding && a.y + a.height + padding > b.y;
}

function placeEntityLabels(layouts: CampaignEntityLayout[], actors: CampaignActorLayout[], labelScale: number): CampaignEntityLayout[] {
  const labelWidth = LABEL_WIDTH * labelScale;
  const labelHeight = LABEL_HEIGHT * labelScale;
  const occupied = actors.map((actor) => ({ x: actor.x - 36, y: actor.y - 100, width: 72, height: 106 }));
  return layouts.map((layout, index) => {
    const row = index % 2;
    const candidates = [
      { x: layout.x - labelWidth / 2, y: layout.y - 82 - labelHeight - row * (labelHeight + 5) },
      { x: layout.x - labelWidth / 2, y: layout.y + 12 + row * (labelHeight + 5) },
      { x: layout.x + 42, y: layout.y - 54 - labelHeight / 2 },
      { x: layout.x - labelWidth - 42, y: layout.y - 54 - labelHeight / 2 },
      { x: index % 2 ? CAMPAIGN_VIEW_WIDTH - labelWidth - 10 : 10,
        y: 70 + Math.floor(index / 2) * (labelHeight + 8) },
    ];
    const boxes = candidates.map((candidate) => ({
      x: Math.max(8, Math.min(CAMPAIGN_VIEW_WIDTH - labelWidth - 8, candidate.x)),
      y: Math.max(8, Math.min(CAMPAIGN_VIEW_HEIGHT - labelHeight - 8, candidate.y)),
      width: labelWidth,
      height: labelHeight,
    }));
    const chosen = boxes.find((box) => !occupied.some((other) => overlaps(box, other, 3))) ?? boxes[boxes.length - 1];
    occupied.push(chosen);
    return { ...layout, labelBounds: chosen };
  });
}

function layoutActorsWithGeometry(world: WorldState, geometry: SceneGeometry, layouts: CampaignEntityLayout[]): CampaignActorLayout[] {
  return Object.values(world.actors).map((actor) => {
    const region = sceneRegion(geometry, actor.location.region);
    const anchor = projectAnchor(region, actor.location.x, actor.location.y);
    const anchorX = anchor.x;
    const anchorY = anchor.y;
    const rider = actor.riding ? layouts.find((layout) => layout.id === actor.riding) : null;
    const colocated = Object.values(world.actors).filter((item) => item.location.region === actor.location.region
      && item.location.x === actor.location.x && item.location.y === actor.location.y);
    const actorIndex = colocated.findIndex((item) => item.id === actor.id);
    const sideGravity = region.gravity === "left" || region.gravity === "right";
    const laneX = sideGravity ? anchorX
      : anchorX + (actorIndex - (colocated.length - 1) / 2) * 76;
    return {
      id: actor.id,
      x: rider ? (sideGravity ? rider.anchorX : rider.x) : laneX,
      y: rider ? (sideGravity ? rider.anchorY : rider.y - 20) : anchorY,
      anchorX,
      anchorY,
      rotation: actorRotation(region.gravity),
      riding: actor.riding,
    };
  });
}

export function layoutCampaignActors(world: WorldState, scene?: SceneComposition): CampaignActorLayout[] {
  const geometry = createSceneGeometry(world, scene);
  const layouts = layoutCampaignEntitiesBase(world, geometry);
  return layoutActorsWithGeometry(world, geometry, layouts);
}

function layoutCampaignEntitiesBase(world: WorldState, geometry: SceneGeometry): CampaignEntityLayout[] {
  const entities = visibleEntities(world);
  const groups = new Map<string, Entity[]>();
  for (const entity of entities) {
    const key = `${entity.location.region}:${entity.location.x}:${entity.location.y}`;
    const group = groups.get(key) ?? [];
    group.push(entity); groups.set(key, group);
  }
  return entities.map((entity, index) => {
    const region = sceneRegion(geometry, entity.location.region);
    const anchor = projectAnchor(region, entity.location.x, entity.location.y);
    const anchorX = anchor.x;
    const anchorY = anchor.y;
    const group = groups.get(`${entity.location.region}:${entity.location.x}:${entity.location.y}`) ?? [entity];
    const groupIndex = group.findIndex((item) => item.id === entity.id);
    const logicalX = projectX(region, entity.location.x);
    const spacing = Math.min(62, 132 / Math.max(1, group.length - 1));
    const x = logicalX + (groupIndex - (group.length - 1) / 2) * spacing;
    const labelY = region.gravity === "up" ? anchorY + 38 : anchorY - 112;
    return { id: entity.id, entity, index, anchorX, anchorY, x, y: anchorY,
      rotation: actorRotation(region.gravity),
      labelScale: 1,
      labelBounds: { x: x - LABEL_WIDTH / 2, y: labelY, width: LABEL_WIDTH, height: LABEL_HEIGHT }, relation: "world" };
  });
}

export function hitTestCampaignLayout(layouts: CampaignEntityLayout[], x: number, y: number): EntityId | null {
  const label = [...layouts].reverse().find((layout) => {
    const box = layout.labelBounds;
    return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  });
  if (label) return label.id;
  return [...layouts].reverse().find((layout) => Math.hypot(layout.x - x, layout.y - 30 - y) <= 48)?.id ?? null;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  time: number,
  reducedMotion: boolean,
  geometry: SceneGeometry,
  scene?: SceneComposition,
) {
  const skies: Record<number, [string, string]> = {
    2: ["#111b38", "#101425"],
    3: ["#241a31", "#130f22"],
    4: ["#2d1b29", "#151221"],
    5: ["#172d31", "#101623"],
    6: ["#30261f", "#13131d"],
    7: ["#2a1c35", "#11101e"],
    8: ["#24203c", "#101725"],
    9: ["#241b37", "#0d1320"],
    10: ["#321c2d", "#0b0d19"],
  };
  const [sky] = skies[world.stageId] ?? [C.deep, C.abyss];
  drawDungeonBackdrop(ctx, time, reducedMotion, geometry.width);
  ctx.fillStyle = `${sky}40`;
  ctx.fillRect(0, 0, geometry.width, CAMPAIGN_VIEW_HEIGHT);

  if (world.stageId === 2) {
    ctx.strokeStyle = "rgba(184,220,222,.28)";
    ctx.lineWidth = 1.5;
    const offset = reducedMotion ? 0 : (time * 22) % 28;
    for (let x = -30; x < geometry.width + 30; x += 31) {
      ctx.beginPath();
      ctx.moveTo(x + offset, 82);
      ctx.lineTo(x - 8 + offset, 112);
      ctx.stroke();
    }
  } else if (world.stageId === 3) {
    ctx.strokeStyle = "rgba(246,199,109,.13)";
    ctx.lineWidth = 2;
    for (let y = 105; y < 390; y += 55) {
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(geometry.width - 40, y);
      ctx.stroke();
    }
  } else if (world.stageId === 4) {
    ctx.strokeStyle = "rgba(246,199,109,.17)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (let x = 30; x < geometry.width; x += 420) {
      ctx.moveTo(x, 344); ctx.lineTo(x + 180, 344); ctx.quadraticCurveTo(x + 220, 344, x + 220, 304); ctx.lineTo(x + 220, 126);
    }
    ctx.stroke();
  } else if (world.stageId === 5) {
    ctx.strokeStyle = "rgba(128,215,182,.18)";
    ctx.lineWidth = 3;
    for (let x = 150; x < geometry.width; x += 330) {
      ctx.beginPath(); ctx.moveTo(x, 96); ctx.bezierCurveTo(x - 60, 180, x + 70, 260, x, 405); ctx.stroke();
    }
    ctx.fillStyle = "rgba(246,199,109,.65)";
    for (let x = 92; x < geometry.width; x += 388) {
      const y = x % 2 ? 126 : 146;
      const rotation = (x / 388) % 4 * Math.PI / 2;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(9, 6); ctx.lineTo(-9, 6); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  } else if (world.stageId === 6) {
    ctx.fillStyle = "rgba(246,199,109,.08)";
    for (let x = 55; x < geometry.width; x += 150) ctx.fillRect(x, 122, 88, 8);
    ctx.strokeStyle = "rgba(246,199,109,.2)";
    ctx.lineWidth = 2;
    for (let x = 98; x < geometry.width; x += 150) { ctx.beginPath(); ctx.arc(x, 115, 18, Math.PI, 0); ctx.stroke(); }
  } else if (world.stageId === 7) {
    ctx.strokeStyle = "rgba(199,131,130,.18)";
    ctx.lineWidth = 12;
    for (let x = 26; x < geometry.width; x += 520) { ctx.beginPath(); ctx.moveTo(x, 82); ctx.quadraticCurveTo(x + 124, 180, x + 36, 402); ctx.stroke(); }
    ctx.strokeStyle = "rgba(246,199,109,.16)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(70, 394); ctx.lineTo(geometry.width - 70, 394); ctx.stroke();
  } else if (world.stageId === 8) {
    ctx.fillStyle = "rgba(117,190,190,.08)";
    for (let y = 150; y <= 330; y += 72) {
      for (let x = 420; x < geometry.width; x += 820) { ctx.beginPath(); ctx.ellipse(x, y, 390, 23, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.strokeStyle = "rgba(184,220,222,.16)"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(70, 385); for (let x = 250; x < geometry.width; x += 180) ctx.lineTo(x, x % 360 ? 280 : 385); ctx.stroke();
  } else if (world.stageId === 9) {
    ctx.strokeStyle = "rgba(246,199,109,.23)"; ctx.lineWidth = 9;
    for (let x = 380; x < geometry.width; x += 520) { ctx.beginPath(); ctx.moveTo(x, 92); ctx.lineTo(x, 406); ctx.stroke(); }
    ctx.lineWidth = 3;
    for (let y = 142; y < 390; y += 74) { for (let x = 380; x < geometry.width; x += 520) { ctx.beginPath(); ctx.moveTo(x - 50, y); ctx.lineTo(x + 50, y); ctx.stroke(); } }
  } else if (world.stageId === 10) {
    ctx.strokeStyle = "rgba(199,131,130,.2)"; ctx.lineWidth = 10;
    for (let x = 320; x < geometry.width; x += 640) { ctx.beginPath(); ctx.arc(x, 305, 184, Math.PI, 0); ctx.lineTo(x + 184, 406); ctx.moveTo(x - 184, 305); ctx.lineTo(x - 184, 406); ctx.stroke(); }
    ctx.strokeStyle = "rgba(246,199,109,.22)"; ctx.lineWidth = 3;
    for (let x = 245; x < geometry.width; x += 75) { ctx.beginPath(); ctx.arc(x, 118, 18, 0, Math.PI * 2); ctx.stroke(); }
    // The final mechanisms belong to one dormant warden, even when only a
    // latch or ring is interactive in the foreground.
    ctx.save();
    ctx.translate(560, 386);
    ctx.fillStyle = "rgba(111,116,143,.18)";
    ctx.strokeStyle = "rgba(199,131,130,.26)";
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-92, 0); ctx.lineTo(-72, -148); ctx.quadraticCurveTo(0, -214, 72, -148); ctx.lineTo(92, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-48, -145); ctx.quadraticCurveTo(0, -192, 48, -145); ctx.lineTo(36, -92); ctx.lineTo(-36, -92); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "rgba(246,199,109,.25)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-18, -128); ctx.lineTo(-5, -122); ctx.moveTo(18, -128); ctx.lineTo(5, -122); ctx.stroke();
    ctx.restore();
  }

  if (scene) {
    if (scene.ceiling) {
      drawDungeonMasonry(ctx, 0, 0, CAMPAIGN_VIEW_WIDTH, 58);
      ctx.fillStyle = "rgba(184,220,222,.18)";
      ctx.fillRect(0, 54, CAMPAIGN_VIEW_WIDTH, 5);
    }
    const floors = [...scene.floors]
      .filter((floor) => Number.isFinite(floor.from) && Number.isFinite(floor.to) && Number.isFinite(floor.y))
      .sort((a, b) => a.from - b.from);
    for (const floor of floors) {
      const low = Math.max(0, Math.min(10, Math.min(floor.from, floor.to)));
      const high = Math.max(0, Math.min(10, Math.max(floor.from, floor.to)));
      const from = low === 0 ? 0 : LEFT + low * 80;
      const to = high === 10 ? CAMPAIGN_VIEW_WIDTH : LEFT + high * 80;
      const surfaceY = FLOOR - Math.max(0, Math.min(4, floor.y)) * HEIGHT_STEP;
      const parallelBranch = floors.some((other) => other !== floor
        && other.from === floor.from && other.to === floor.to && other.y !== floor.y);
      if (parallelBranch) {
        const branchEnd = Math.min(CAMPAIGN_VIEW_WIDTH, to + 80);
        drawDungeonMasonry(ctx, from, surfaceY, Math.max(1, branchEnd - from), 22);
        ctx.fillStyle = "rgba(128,215,182,.3)";
        ctx.fillRect(from, surfaceY, Math.max(1, branchEnd - from), 4);
        ctx.strokeStyle = "rgba(240,237,220,.28)"; ctx.lineWidth = 2;
        for (let x = from + 18; x < branchEnd; x += 28) { ctx.beginPath(); ctx.moveTo(x, surfaceY + 3); ctx.lineTo(x, surfaceY + 20); ctx.stroke(); }
      } else if (geometry.regions[0]?.gravity === "up" && floor.y >= 3.5) {
        drawDungeonMasonry(ctx, from, 58, Math.max(1, to - from), Math.max(12, surfaceY - 58));
        ctx.fillStyle = "rgba(211,202,229,.3)";
        ctx.fillRect(from, surfaceY - 5, Math.max(1, to - from), 5);
      } else {
        drawDungeonFloor(ctx, from, surfaceY, Math.max(1, to - from));
      }
    }
    const floorEdges = floors.flatMap((floor) => [floor.from, floor.to]);
    const hazards = visibleEntities(world).filter((entity) =>
      ["water", "waterway", "gap"].includes(normalizedKind(entity))
      && entity.properties.safe !== true && entity.properties.level !== "low");
    for (const hazard of hazards) {
      const nearestLeft = Math.max(0, ...floorEdges.filter((edge) => edge <= hazard.location.x));
      const nearestRight = Math.min(10, ...floorEdges.filter((edge) => edge >= hazard.location.x));
      const left = nearestLeft === 0 ? 0 : LEFT + nearestLeft * 80;
      const right = nearestRight === 10 ? CAMPAIGN_VIEW_WIDTH : LEFT + nearestRight * 80;
      if (normalizedKind(hazard) === "water" || normalizedKind(hazard) === "waterway") {
        const wave = reducedMotion ? 0 : Math.sin(time * 1.8) * 2;
        const water = ctx.createLinearGradient(0, FLOOR - 4, 0, CAMPAIGN_VIEW_HEIGHT);
        water.addColorStop(0, "rgba(89,170,190,.88)");
        water.addColorStop(1, "rgba(31,68,112,.82)");
        ctx.fillStyle = water;
        ctx.fillRect(left, FLOOR + wave, Math.max(12, right - left), CAMPAIGN_VIEW_HEIGHT - FLOOR);
        ctx.strokeStyle = "#86c9d1";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(left, FLOOR + wave);
        ctx.lineTo(right, FLOOR + wave);
        ctx.stroke();
      }
    }
    return;
  }

  const visible = visibleEntities(world);
  for (const [regionIndex, region] of geometry.regions.entries()) {
    const previousRegion = geometry.regions[regionIndex - 1];
    const nextRegion = geometry.regions[regionIndex + 1];
    const gap = geometry.regions.length > 1 ? 24 : 0;
    const surfaceStart = regionIndex === 0 ? 0
      : previousRegion.gravity === "down" && region.gravity === "down" ? region.start - gap / 2 : region.start;
    const surfaceEnd = regionIndex === geometry.regions.length - 1 ? geometry.width
      : nextRegion.gravity === "down" && region.gravity === "down" ? region.end + gap / 2 : region.end;
    if (regionIndex > 0) {
      ctx.strokeStyle = "rgba(240,237,220,.2)"; ctx.lineWidth = 2; ctx.setLineDash([8, 9]);
      ctx.beginPath(); ctx.moveTo(region.start - gap / 2, 84); ctx.lineTo(region.start - gap / 2, 468); ctx.stroke(); ctx.setLineDash([]);
    }
    if (region.label) {
      ctx.fillStyle = "rgba(9,11,29,.7)"; roundedRect(ctx, region.start + 12, 82, Math.min(250, region.end - region.start - 24), 26, 8); ctx.fill();
      ctx.fillStyle = C.moon; ctx.font = '600 11px "Noto Sans KR", sans-serif'; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(region.label, region.start + 23, 95);
    }
    const local = visible.filter((entity) => entity.location.region === region.id);
    if (region.gravity === "up") {
      ctx.fillStyle = C.stone; ctx.fillRect(surfaceStart, 76, surfaceEnd - surfaceStart, 35);
      ctx.fillStyle = C.stoneLight; ctx.fillRect(surfaceStart, 106, surfaceEnd - surfaceStart, 7);
    } else if (region.gravity === "left" || region.gravity === "right") {
      const wallX = region.gravity === "left" ? region.start + 9 : region.end - 27;
      ctx.fillStyle = C.stone; ctx.fillRect(wallX, 108, 28, 310);
      ctx.fillStyle = C.stoneLight; ctx.fillRect(region.gravity === "left" ? wallX + 23 : wallX, 108, 5, 310);
    } else {
      const hazards = local.filter((entity) => ["water", "current", "water-channel", "gap"].includes(normalizedKind(entity)));
      const supports = local.filter((entity) => ["platform", "safe-platform", "safe-circle", "exit", "footway", "walkway"].includes(normalizedKind(entity)))
        .sort((a, b) => a.location.x - b.location.x);
      const cuts = hazards.map((hazard) => {
        const startProp = numberProperty(hazard, "rangeStart", Number.NaN);
        const endProp = numberProperty(hazard, "rangeEnd", Number.NaN);
        let startX = Number.isFinite(startProp) ? startProp : hazard.location.x - 0.48;
        let endX = Number.isFinite(endProp) ? endProp : hazard.location.x + 0.48;
        if (["water", "current", "water-channel"].includes(normalizedKind(hazard))) {
          const after = supports.find((item) => item.location.x > hazard.location.x);
          if (after) { startX = hazard.location.x - 0.48; endX = after.location.x - 0.42; }
          const distance = numberProperty(hazard, "flowDistance", 0);
          if (distance > 0) { startX = Math.min(startX, hazard.location.x - distance / 2); endX = Math.max(endX, hazard.location.x + distance / 2); }
        }
        return { left: projectX(region, startX), right: projectX(region, endX), water: normalizedKind(hazard) !== "gap" };
      }).sort((a, b) => a.left - b.left);
      let floorStart = surfaceStart;
      ctx.fillStyle = C.stone;
      for (const cut of cuts) {
        if (cut.left > floorStart) drawDungeonFloor(ctx, floorStart, FLOOR, cut.left - floorStart);
        floorStart = Math.max(floorStart, cut.right);
        if (cut.water) {
          ctx.fillStyle = "rgba(75,145,172,.78)"; ctx.fillRect(cut.left, FLOOR, Math.max(8, cut.right - cut.left), CAMPAIGN_VIEW_HEIGHT - FLOOR);
          ctx.strokeStyle = "#86c9d1"; ctx.lineWidth = 4; ctx.beginPath();
          for (let x = cut.left; x <= cut.right; x += 12) { const y = FLOOR + 3 + Math.sin((x + (reducedMotion ? 0 : time * 24)) / 13) * 3; if (x === cut.left) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
          ctx.fillStyle = C.stone;
        }
      }
      if (floorStart < surfaceEnd) drawDungeonFloor(ctx, floorStart, FLOOR, surfaceEnd - floorStart);
      const solidSegments = [{ left: surfaceStart, right: surfaceEnd }];
      for (const cut of cuts) {
        for (let i = solidSegments.length - 1; i >= 0; i--) {
          const segment = solidSegments[i];
          if (cut.right <= segment.left || cut.left >= segment.right) continue;
          solidSegments.splice(i, 1,
            ...(cut.left > segment.left ? [{ left: segment.left, right: cut.left }] : []),
            ...(cut.right < segment.right ? [{ left: cut.right, right: segment.right }] : []));
        }
      }
      // drawDungeonFloor already supplies the beveled top edge for every solid segment.
    }
  }
}

function drawConnection(
  ctx: CanvasRenderingContext2D,
  from: CampaignEntityLayout,
  to: CampaignEntityLayout,
) {
  const rope = normalizedKind(from.entity).includes("rope") || normalizedKind(to.entity).includes("rope")
    || from.entity.material === "cloth";
  ctx.save();
  ctx.strokeStyle = rope ? "#c89b6b" : "rgba(128,215,182,.58)";
  ctx.lineWidth = rope ? 4 : 3;
  ctx.setLineDash(rope ? [] : [7, 6]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y - 18);
  const midpoint = (from.x + to.x) / 2;
  ctx.bezierCurveTo(midpoint, from.y + 28, midpoint, to.y + 28, to.x, to.y - 18);
  ctx.stroke();
  const effectiveFlow = (entity: Entity) => {
    if ((typeof entity.properties.open === "boolean" && entity.properties.open === false)
      || (typeof entity.properties.flowing === "boolean" && entity.properties.flowing === false)
      || (typeof entity.properties.active === "boolean" && entity.properties.active === false)) return 0;
    return numberProperty(entity, "flow", booleanProperty(entity, "flowing") ? 1 : 0);
  };
  const flow = Math.max(effectiveFlow(from.entity), effectiveFlow(to.entity));
  if (flow > 0) {
    drawFlowArrow(
      ctx,
      (from.x + to.x) / 2,
      (from.y + to.y) / 2 - 22,
      to.x >= from.x ? "right" : "left",
      flow,
    );
  }
  ctx.restore();
}

function drawFlowArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: string,
  amount: number,
) {
  const horizontal = direction === "right" || direction === "left";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const length = 24 + Math.min(3, Math.abs(amount)) * 6;
  const dx = horizontal ? sign * length : 0;
  const dy = horizontal ? 0 : sign * length;
  ctx.save();
  ctx.strokeStyle = C.moon;
  ctx.fillStyle = C.moon;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - dx / 2, y - dy / 2);
  ctx.lineTo(x + dx / 2, y + dy / 2);
  ctx.stroke();
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(x + dx / 2, y + dy / 2);
  ctx.lineTo(x + dx / 2 - Math.cos(angle - 0.65) * 9, y + dy / 2 - Math.sin(angle - 0.65) * 9);
  ctx.lineTo(x + dx / 2 - Math.cos(angle + 0.65) * 9, y + dy / 2 - Math.sin(angle + 0.65) * 9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGear(ctx: CanvasRenderingContext2D, radius: number) {
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const r = i % 2 === 0 ? radius + 7 : radius;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.abyss;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.32, 0, Math.PI * 2);
  ctx.fill();
}

function drawStateRing(
  ctx: CanvasRenderingContext2D,
  on: boolean,
  x = 27,
  y = -59,
) {
  ctx.save();
  ctx.strokeStyle = on ? C.gold : "rgba(240,237,220,.55)";
  ctx.fillStyle = on ? C.gold : C.abyss;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  on ? ctx.fill() : ctx.stroke();
  if (!on) {
    ctx.beginPath(); ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 5, y - 5); ctx.stroke();
  }
  ctx.restore();
}

function drawDoor(ctx: CanvasRenderingContext2D, entity: Entity) {
  ctx.save();
  ctx.scale(1.55, 1.7);
  const open = booleanProperty(entity, "open");
  ctx.lineWidth = 5;
  ctx.strokeRect(-28, -70, 56, 70);
  ctx.fillStyle = open ? C.abyss : "#686b7f";
  if (open) {
    ctx.fillRect(-21, -62, 42, 62);
    ctx.strokeStyle = C.gold;
    ctx.beginPath(); ctx.moveTo(20, -62); ctx.lineTo(34, -70); ctx.lineTo(34, -8); ctx.lineTo(20, 0); ctx.stroke();
  } else {
    roundedRect(ctx, -22, -62, 44, 62, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(11, -30, 3, 0, Math.PI * 2); ctx.fill();
  }
  if (booleanProperty(entity, "wedged")) {
    ctx.fillStyle = "#c79762"; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(2, -13); ctx.lineTo(8, 0); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawLatch(ctx: CanvasRenderingContext2D, entity: Entity) {
  const hasOpenState = typeof entity.properties.open === "boolean";
  const locked = hasOpenState ? !booleanProperty(entity, "open")
    : booleanProperty(entity, "locked") || booleanProperty(entity, "latched");
  ctx.lineWidth = 6;
  ctx.strokeRect(-28, -43, 56, 20);
  ctx.save();
  ctx.translate(locked ? 0 : 15, -33);
  ctx.rotate(locked ? 0 : -0.65);
  ctx.fillRect(-31, -5, 62, 10);
  ctx.restore();
  ctx.beginPath(); ctx.arc(-27, -33, 7, 0, Math.PI * 2); ctx.arc(27, -33, 7, 0, Math.PI * 2); ctx.stroke();
  drawStateRing(ctx, locked, 0, -61);
}

function drawPinwheel(ctx: CanvasRenderingContext2D, entity: Entity) {
  const spinning = booleanProperty(entity, "spinning") || booleanProperty(entity, "powered")
    || booleanProperty(entity, "active") || booleanProperty(entity, "flowing")
    || (stringProperty(entity, "phase") !== null && stringProperty(entity, "phase") !== "still");
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(0, 0); ctx.stroke();
  for (let index = 0; index < 4; index++) {
    ctx.save(); ctx.translate(0, -43); ctx.rotate(index * Math.PI / 2 + numberProperty(entity, "angle", numberProperty(entity, "orientation", 0)) * 0.28);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(11, -24, 29, -16); ctx.lineTo(13, 4); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(0, -43, 6, 0, Math.PI * 2); ctx.fill();
  drawStateRing(ctx, spinning);
}

function drawGravityDevice(ctx: CanvasRenderingContext2D, entity: Entity, kind: string, rotation = 0) {
  const direction = stringProperty(entity, "gravity") ?? stringProperty(entity, "direction") ?? "down";
  const angles: Record<string, number> = { down: Math.PI, up: 0, left: -Math.PI / 2, right: Math.PI / 2, normal: Math.PI };
  const angle = angles[direction] ?? Math.PI;
  ctx.lineWidth = kind.includes("boundary") ? 7 : 4;
  ctx.beginPath();
  if (kind.includes("boundary")) {
    ctx.arc(0, 0, 34, Math.PI, 0); ctx.lineTo(34, 0); ctx.moveTo(-34, 0); ctx.lineTo(-34, 0);
  } else {
    ctx.moveTo(-35, -8); ctx.lineTo(35, -8); ctx.moveTo(-35, 2); ctx.lineTo(35, 2);
    for (let x = -28; x <= 28; x += 14) { ctx.moveTo(x, -12); ctx.lineTo(x, 6); }
  }
  ctx.stroke();
  ctx.save(); ctx.translate(0, -38); ctx.rotate(angle - rotation);
  ctx.fillStyle = C.gold; ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 5); ctx.lineTo(3, 3); ctx.lineTo(3, 14); ctx.lineTo(-3, 14); ctx.lineTo(-3, 3); ctx.lineTo(-9, 5); ctx.closePath(); ctx.fill(); ctx.restore();
}

function drawLock(ctx: CanvasRenderingContext2D, entity: Entity) {
  const unlocked = booleanProperty(entity, "unlocked") || booleanProperty(entity, "open");
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(unlocked ? 9 : 0, -47, 18, Math.PI, 0);
  ctx.lineTo(unlocked ? 27 : 18, -27);
  if (!unlocked) ctx.lineTo(-18, -27);
  ctx.stroke();
  roundedRect(ctx, -25, -31, 50, 31, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = C.abyss; ctx.beginPath(); ctx.arc(0, -18, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-2, -17, 4, 10);
  drawStateRing(ctx, unlocked);
}

function drawKey(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(-13, -39, 13, 0, Math.PI * 2); ctx.moveTo(-2, -31); ctx.lineTo(28, -4); ctx.lineTo(20, 4); ctx.moveTo(16, -15); ctx.lineTo(25, -24); ctx.stroke();
}

function drawCounterweight(ctx: CanvasRenderingContext2D, entity: Entity) {
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -72); ctx.lineTo(0, -50); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -55, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-20, -45); ctx.lineTo(20, -45); ctx.lineTo(28, 0); ctx.lineTo(-28, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  const mark = Math.max(1, Math.min(3, Math.round(numberProperty(entity, "weightMark", entity.weight))));
  ctx.strokeStyle = C.abyss; ctx.lineWidth = 3;
  for (let index = 0; index < mark; index++) { ctx.beginPath(); ctx.moveTo(-10 + index * 10, -32); ctx.lineTo(-10 + index * 10, -12); ctx.stroke(); }
}

function drawSignal(ctx: CanvasRenderingContext2D, entity: Entity) {
  const shape = stringProperty(entity, "shape") ?? stringProperty(entity, "signal") ?? entity.name;
  const on = booleanProperty(entity, "on") || booleanProperty(entity, "lit")
    || booleanProperty(entity, "active") || booleanProperty(entity, "open");
  ctx.lineWidth = on ? 5 : 3;
  ctx.beginPath(); ctx.moveTo(0, -48); ctx.lineTo(0, 0); ctx.stroke();
  ctx.beginPath();
  if (/tri|삼각/.test(shape)) { ctx.moveTo(0, -73); ctx.lineTo(22, -40); ctx.lineTo(-22, -40); ctx.closePath(); }
  else if (/square|사각/.test(shape)) ctx.rect(-18, -73, 36, 33);
  else { ctx.arc(0, -56, 18, 0, Math.PI * 2); }
  if (on) ctx.fill(); else ctx.stroke();
  if (!on) { ctx.beginPath(); ctx.moveTo(-18, -72); ctx.lineTo(18, -40); ctx.stroke(); }
}

function drawShaft(ctx: CanvasRenderingContext2D, entity: Entity) {
  const locked = booleanProperty(entity, "locked") || booleanProperty(entity, "fixed")
    || booleanProperty(entity, "supported") || booleanProperty(entity, "level");
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(0, -82); ctx.lineTo(0, 0); ctx.stroke();
  ctx.lineWidth = 3;
  for (const y of [-64, -34]) { ctx.beginPath(); ctx.arc(0, y, 16, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = C.gold;
  if (locked) { ctx.fillRect(-26, -57, 10, 46); ctx.fillRect(16, -57, 10, 46); }
  else { ctx.beginPath(); ctx.moveTo(-24, -56); ctx.lineTo(-9, -35); ctx.lineTo(-24, -15); ctx.stroke(); }
  drawStateRing(ctx, locked);
}

function drawBoss(ctx: CanvasRenderingContext2D, entity: Entity) {
  const released = booleanProperty(entity, "released") || booleanProperty(entity, "disabled") || booleanProperty(entity, "open");
  ctx.fillStyle = released ? "#55586c" : "#85899e";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-31, -68); ctx.quadraticCurveTo(0, -91, 31, -68); ctx.lineTo(25, -34); ctx.lineTo(-25, -34); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-24, -31); ctx.lineTo(-39, -2); ctx.moveTo(24, -31); ctx.lineTo(39, -2); ctx.moveTo(-14, -32); ctx.lineTo(-17, 0); ctx.moveTo(14, -32); ctx.lineTo(17, 0); ctx.stroke();
  ctx.strokeStyle = released ? C.mint : C.gold;
  ctx.beginPath(); ctx.moveTo(-12, -58); ctx.lineTo(-4, -54); ctx.moveTo(12, -58); ctx.lineTo(4, -54); ctx.stroke();
}

function drawBossArm(ctx: CanvasRenderingContext2D, entity: Entity) {
  const phase = stringProperty(entity, "phase") ?? "retracted";
  ctx.lineWidth = 13; ctx.lineCap = "round";
  ctx.beginPath();
  if (phase === "low") {
    ctx.moveTo(-42, -17); ctx.lineTo(27, -17); ctx.lineTo(39, -5);
  } else if (phase === "high") {
    ctx.moveTo(-30, -68); ctx.lineTo(19, -34); ctx.lineTo(38, -58);
  } else {
    ctx.moveTo(-24, -58); ctx.lineTo(2, -38); ctx.lineTo(-18, -18);
  }
  ctx.stroke(); ctx.lineCap = "butt";
  ctx.fillStyle = C.gold;
  ctx.beginPath(); ctx.arc(-31, phase === "low" ? -17 : -65, 8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(199,131,130,.58)"; ctx.lineWidth = 3;
  if (phase === "low") { ctx.beginPath(); ctx.moveTo(-46, 3); ctx.lineTo(46, 3); ctx.stroke(); }
  if (phase === "high") { ctx.beginPath(); ctx.moveTo(-42, -82); ctx.lineTo(42, -82); ctx.stroke(); }
}

function drawSealPin(ctx: CanvasRenderingContext2D, entity: Entity) {
  const removed = booleanProperty(entity, "removed") || booleanProperty(entity, "latchedOut");
  ctx.lineWidth = 6;
  ctx.strokeRect(-30, -54, 60, 43);
  ctx.save(); ctx.translate(removed ? 31 : 0, -32); ctx.rotate(removed ? -0.45 : 0);
  ctx.fillRect(-37, -6, 74, 12); ctx.restore();
  ctx.fillStyle = C.gold;
  ctx.beginPath(); ctx.arc(removed ? 34 : 0, -32, 7, 0, Math.PI * 2); ctx.fill();
  drawStateRing(ctx, removed);
}

function drawPressurePlate(ctx: CanvasRenderingContext2D, entity: Entity) {
  const pressure = numberProperty(entity, "pressure", numberProperty(entity, "requiredWeight") > 0 ? 0 : 1);
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-37, -5); ctx.lineTo(37, -5); ctx.lineTo(29, 5); ctx.lineTo(-29, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = C.gold; ctx.lineWidth = 3;
  for (let index = 0; index < 2; index++) {
    ctx.beginPath(); ctx.rect(-15 + index * 20, -21, 10, 10);
    if (index < pressure) ctx.fill(); else ctx.stroke();
  }
}

function drawWeakGrid(ctx: CanvasRenderingContext2D, entity: Entity) {
  const reinforced = booleanProperty(entity, "reinforced");
  const collapsed = booleanProperty(entity, "collapsed");
  ctx.lineWidth = reinforced ? 6 : 3;
  ctx.strokeStyle = collapsed ? "#c78382" : reinforced ? C.mint : "rgba(240,237,220,.64)";
  for (let index = -2; index <= 2; index++) {
    ctx.beginPath(); ctx.moveTo(index * 13, -50); ctx.lineTo(index * 13, 0); ctx.moveTo(-32, -25 + index * 10); ctx.lineTo(32, -25 + index * 10); ctx.stroke();
  }
  if (collapsed) { ctx.beginPath(); ctx.moveTo(-28, -48); ctx.lineTo(4, -20); ctx.lineTo(-9, 0); ctx.lineTo(27, -39); ctx.stroke(); }
}

function drawObservation(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(-7, -43, 22, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(9, -27); ctx.lineTo(31, -4); ctx.stroke();
  ctx.lineWidth = 3; ctx.strokeStyle = C.gold;
  ctx.beginPath(); ctx.arc(-7, -43, 8, Math.PI * 0.1, Math.PI * 1.5); ctx.stroke();
}

function drawFogBoundary(ctx: CanvasRenderingContext2D, entity: Entity) {
  const cleared = booleanProperty(entity, "cleared") || booleanProperty(entity, "illuminated");
  ctx.save();
  ctx.globalAlpha = cleared ? .18 : 1;
  ctx.lineWidth = 4;
  for (let row = 0; row < 3; row++) {
    const y = -54 + row * 18;
    ctx.globalAlpha = 0.38 + row * 0.15;
    ctx.beginPath(); ctx.moveTo(-36, y); ctx.bezierCurveTo(-12, y - 9, 12, y + 9, 36, y); ctx.stroke();
  }
  ctx.restore();
}

function drawBridge(ctx: CanvasRenderingContext2D, entity: Entity) {
  const visibleState = stringProperty(entity, "visibleState");
  const unknown = visibleState === "unknown";
  const broken = !unknown && (visibleState === "broken" || booleanProperty(entity, "broken") || entity.properties.extended === false);
  const safe = !unknown && (visibleState === "intact" || booleanProperty(entity, "safeToCross") || booleanProperty(entity, "stable")
    || booleanProperty(entity, "bridged") || booleanProperty(entity, "extended"));
  ctx.save();
  const branch = /^08-v2-(?:2|5)-/.test(entity.id);
  const longSpan = entity.id.startsWith("08-v2-1-") ? [2, 8] as const
    : entity.id.startsWith("09-v2-5-") || entity.id.startsWith("10-v2-2-") ? [3, 7] as const
      : entity.id.startsWith("02-v2-") ? [4, 6] as const : null;
  if (branch || longSpan) {
    const [fromWorld, toWorld] = branch ? [2, 8] : longSpan!;
    const endpointY = branch ? 1 : entity.location.y;
    const fromX = (fromWorld - entity.location.x) * 80;
    const toX = (toWorld - entity.location.x) * 80;
    const toY = (entity.location.y - endpointY) * HEIGHT_STEP;
    ctx.strokeStyle = safe ? C.mint : unknown ? "rgba(184,220,222,.38)" : broken ? "#c78382" : "rgba(240,237,220,.62)";
    ctx.lineWidth = branch ? 14 : 12;
    ctx.beginPath();
    ctx.moveTo(fromX, toY);
    if (branch) ctx.quadraticCurveTo(0, -8, toX, toY);
    else if (broken) { ctx.lineTo(-22, 0); ctx.moveTo(22, 0); ctx.lineTo(toX, toY); }
    else ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.strokeStyle = "rgba(240,237,220,.35)"; ctx.lineWidth = 2;
    for (let step = 0; step <= 8; step++) {
      const amount = step / 8;
      const x = fromX + (toX - fromX) * amount;
      const y = branch ? toY * (1 - amount) * (1 - amount) + toY * amount * amount : toY;
      ctx.beginPath(); ctx.moveTo(x - 7, y - 5); ctx.lineTo(x + 7, y + 5); ctx.stroke();
    }
    if (unknown) {
      ctx.fillStyle = "rgba(184,220,222,.2)";
      for (let step = 1; step < 6; step++) { const x = fromX + (toX - fromX) * step / 6; ctx.beginPath(); ctx.arc(x, toY / 2, 25, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    return;
  }
  if (/의자|bench/i.test(`${entity.id} ${entity.name}`)) {
    const bridged = booleanProperty(entity, "bridged");
    const half = bridged ? 160 : 82;
    ctx.fillStyle = "#9d6b45"; ctx.strokeStyle = safe || bridged ? C.mint : "rgba(240,237,220,.58)"; ctx.lineWidth = 4;
    roundedRect(ctx, -half, -31, half * 2, 19, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#795033";
    for (const x of bridged ? [-half + 22, half - 32] : [-58, 48]) { ctx.fillRect(x, -12, 10, 18); ctx.strokeRect(x, -12, 10, 18); }
    ctx.strokeStyle = "rgba(240,237,220,.26)"; ctx.lineWidth = 2;
    for (let x = -half + 20; x < half; x += 28) { ctx.beginPath(); ctx.moveTo(x, -29); ctx.lineTo(x, -14); ctx.stroke(); }
    ctx.restore();
    return;
  }
  ctx.lineWidth = safe ? 5 : 3;
  ctx.strokeStyle = safe ? C.mint : "rgba(240,237,220,.62)";
  ctx.fillStyle = entity.material === "metal" ? "#85899e" : "#9d6b45";
  const pieces = broken ? [[-50, -28], [24, 50]] : [[-50, 50]];
  for (const [from, to] of pieces) {
    ctx.beginPath();
    ctx.moveTo(from, -10);
    ctx.lineTo(to, -10);
    ctx.lineTo(to, 1);
    ctx.lineTo(from, 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let x = from + 12; x < to; x += 18) {
      ctx.beginPath(); ctx.moveTo(x, -10); ctx.lineTo(x, 1); ctx.stroke();
    }
  }
  if (broken) {
    ctx.strokeStyle = "#c78382";
    ctx.beginPath(); ctx.moveTo(-28, -10); ctx.lineTo(-14, 7); ctx.moveTo(24, -10); ctx.lineTo(11, 7); ctx.stroke();
  }
  if (unknown) {
    ctx.fillStyle = "rgba(184,220,222,.22)";
    for (let x = -43; x <= 43; x += 22) { ctx.beginPath(); ctx.arc(x, -14, 16, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

function drawCurtain(ctx: CanvasRenderingContext2D, entity: Entity) {
  const open = booleanProperty(entity, "open") || booleanProperty(entity, "raised");
  ctx.save();
  ctx.strokeStyle = "#d9b46e";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-42, -84); ctx.lineTo(42, -84); ctx.stroke();
  ctx.fillStyle = "#8d5879";
  if (open) {
    for (const x of [-31, 31]) {
      ctx.beginPath(); ctx.moveTo(x - 10, -82); ctx.quadraticCurveTo(x, -44, x - 4, 0); ctx.lineTo(x + 10, 0); ctx.quadraticCurveTo(x + 5, -45, x + 10, -82); ctx.closePath(); ctx.fill();
    }
  } else {
    roundedRect(ctx, -39, -82, 78, 82, 4); ctx.fill();
    ctx.strokeStyle = "rgba(240,237,220,.22)"; ctx.lineWidth = 2;
    for (let x = -26; x <= 26; x += 13) { ctx.beginPath(); ctx.moveTo(x, -79); ctx.lineTo(x, -3); ctx.stroke(); }
  }
  drawStateRing(ctx, open);
  ctx.restore();
}

function drawClaw(ctx: CanvasRenderingContext2D, entity: Entity) {
  const raised = booleanProperty(entity, "raised");
  ctx.save();
  ctx.strokeStyle = "#8f94aa";
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(0, -110); ctx.lineTo(0, raised ? -62 : -30); ctx.stroke();
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(0, raised ? -62 : -30); ctx.quadraticCurveTo(-29, raised ? -53 : -21, -24, raised ? -27 : -2); ctx.moveTo(0, raised ? -62 : -30); ctx.quadraticCurveTo(29, raised ? -53 : -21, 24, raised ? -27 : -2); ctx.stroke();
  drawStateRing(ctx, raised);
  ctx.restore();
}

function drawVine(ctx: CanvasRenderingContext2D, entity: Entity) {
  const dangerous = booleanProperty(entity, "danger") || booleanProperty(entity, "fixedSpike");
  ctx.save();
  ctx.strokeStyle = C.mint;
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(-48, -12); ctx.bezierCurveTo(-20, -48, 18, 3, 48, -34); ctx.stroke();
  ctx.fillStyle = dangerous ? "#c78382" : "#74a986";
  for (let x = -36; x <= 36; x += 18) {
    ctx.beginPath(); ctx.moveTo(x, -19); ctx.lineTo(x + 8, -35); ctx.lineTo(x + 11, -15); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawFlower(ctx: CanvasRenderingContext2D, entity: Entity) {
  const dangerous = booleanProperty(entity, "danger") || booleanProperty(entity, "fixedSpike");
  ctx.save();
  ctx.strokeStyle = C.mint; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -42); ctx.stroke();
  ctx.fillStyle = dangerous ? "#c78382" : "#be7fa1";
  for (let index = 0; index < 6; index++) {
    ctx.save(); ctx.translate(0, -48); ctx.rotate(index * Math.PI / 3);
    ctx.beginPath(); ctx.ellipse(0, -13, 8, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(0, -48, 8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawViewingWindow(ctx: CanvasRenderingContext2D, entity: Entity) {
  const observed = booleanProperty(entity, "observed");
  ctx.save();
  ctx.fillStyle = "rgba(24,32,63,.82)";
  ctx.strokeStyle = observed ? C.mint : "rgba(240,237,220,.55)";
  ctx.lineWidth = 5;
  roundedRect(ctx, -38, -78, 76, 72, 8); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -75); ctx.lineTo(0, -9); ctx.moveTo(-35, -42); ctx.lineTo(35, -42); ctx.stroke();
  if (observed) {
    ctx.fillStyle = C.gold;
    ctx.beginPath(); ctx.ellipse(0, -42, 19, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.abyss; ctx.beginPath(); ctx.arc(0, -42, 5, 0, Math.PI * 2); ctx.fill();
  }
  drawStateRing(ctx, observed);
  ctx.restore();
}

function drawPendulum(ctx: CanvasRenderingContext2D, entity: Entity) {
  const phase = stringProperty(entity, "phase");
  const unknown = stringProperty(entity, "visibleState") === "unknown";
  const angle = phase === "near" ? -.42 : phase === "away" ? .42 : 0;
  ctx.save();
  ctx.rotate(angle);
  ctx.strokeStyle = "#c89b6b"; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(0, -105); ctx.lineTo(0, -51); ctx.stroke();
  ctx.fillStyle = "#b28a51"; ctx.strokeStyle = C.gold;
  ctx.beginPath(); ctx.arc(0, -35, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
  if (unknown) {
    ctx.fillStyle = "rgba(184,220,222,.28)"; ctx.beginPath(); ctx.arc(0, -44, 31, 0, Math.PI * 2); ctx.fill();
  }
}

function drawTiltedStairs(ctx: CanvasRenderingContext2D, entity: Entity) {
  const supported = booleanProperty(entity, "supported");
  ctx.save();
  ctx.rotate(supported ? 0 : .24);
  ctx.strokeStyle = supported ? C.mint : "rgba(240,237,220,.58)";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(38, -78);
  for (let step = 0; step < 5; step++) {
    const x = -34 + step * 16; const y = -8 - step * 16;
    ctx.moveTo(x, y); ctx.lineTo(x + 25, y); ctx.lineTo(x + 25, y - 13);
  }
  ctx.stroke();
  ctx.restore();
  if (supported) { ctx.fillStyle = "#9d6b45"; ctx.fillRect(-25, -22, 20, 22); }
}

function drawJunction(ctx: CanvasRenderingContext2D, entity: Entity) {
  const orientation = numberProperty(entity, "orientation");
  ctx.lineWidth = 10; ctx.lineCap = "round";
  ctx.save(); ctx.rotate(orientation * Math.PI / 2);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -34); ctx.moveTo(0, -23); ctx.lineTo(-27, -51); ctx.moveTo(0, -23); ctx.lineTo(27, -51); ctx.stroke();
  ctx.restore(); ctx.lineCap = "butt";
  ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(0, -23, 6, 0, Math.PI * 2); ctx.fill();
}

function drawPiston(ctx: CanvasRenderingContext2D, entity: Entity) {
  const extended = stringProperty(entity, "position") !== "retracted";
  ctx.lineWidth = 4;
  ctx.strokeRect(-32, -61, 22, 45);
  ctx.fillRect(-10, -47, extended ? 43 : 20, 13);
  ctx.strokeRect(extended ? 25 : 12, -57, 14, 33);
  if (booleanProperty(entity, "locked")) {
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.moveTo(7, -50); ctx.lineTo(18, -65); ctx.lineTo(25, -50); ctx.closePath(); ctx.fill();
  }
}

function drawBell(ctx: CanvasRenderingContext2D, entity: Entity) {
  const rung = booleanProperty(entity, "rung") || booleanProperty(entity, "on");
  const phase = stringProperty(entity, "visibleState") ?? stringProperty(entity, "phase");
  ctx.save();
  if (phase === "near") ctx.rotate(-.2);
  if (phase === "away") ctx.rotate(.2);
  if (phase === "unknown") ctx.globalAlpha = .38;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-29, -15); ctx.quadraticCurveTo(-20, -61, 0, -66); ctx.quadraticCurveTo(20, -61, 29, -15); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-34, -12); ctx.lineTo(34, -12); ctx.stroke();
  ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(0, -5, 7, 0, Math.PI * 2); ctx.fill();
  if (rung) {
    ctx.strokeStyle = C.gold; ctx.lineWidth = 2;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(side * 31, -36, 14, side < 0 ? Math.PI * 0.5 : Math.PI * 1.5, side < 0 ? Math.PI * 1.5 : Math.PI * 2.5); ctx.stroke(); }
  }
  ctx.restore();
}

function drawPot(ctx: CanvasRenderingContext2D, entity: Entity) {
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-27, -43); ctx.lineTo(27, -43); ctx.lineTo(19, 0); ctx.lineTo(-19, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeRect(-31, -50, 62, 9);
  ctx.strokeStyle = C.mint;
  ctx.beginPath(); ctx.moveTo(0, -49); ctx.bezierCurveTo(-19, -65, -25, -83, -7, -80); ctx.moveTo(0, -49); ctx.bezierCurveTo(18, -65, 24, -80, 8, -78); ctx.stroke();
  const gravity = stringProperty(entity, "gravity");
  if (gravity) drawGravityDevice(ctx, entity, "marker");
}

function drawLantern(ctx: CanvasRenderingContext2D, entity: Entity) {
  const lit = booleanProperty(entity, "lit");
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, -56, 15, Math.PI, 0); ctx.stroke();
  ctx.strokeRect(-22, -48, 44, 43);
  ctx.fillStyle = lit ? "rgba(246,199,109,.72)" : "rgba(184,220,222,.16)";
  ctx.beginPath(); ctx.moveTo(0, -42); ctx.quadraticCurveTo(17, -21, 0, -9); ctx.quadraticCurveTo(-17, -21, 0, -42); ctx.fill();
  drawStateRing(ctx, lit);
}

function drawSlot(ctx: CanvasRenderingContext2D, entity: Entity) {
  const shape = stringProperty(entity, "accepts") ?? entity.name;
  ctx.lineWidth = 4; ctx.setLineDash([5, 4]);
  ctx.beginPath();
  if (/tri|삼각/.test(shape)) { ctx.moveTo(0, -54); ctx.lineTo(27, -5); ctx.lineTo(-27, -5); ctx.closePath(); }
  else if (/round|lens|원|둥근/.test(shape)) ctx.arc(0, -27, 25, 0, Math.PI * 2);
  else roundedRect(ctx, -28, -54, 56, 49, 7);
  ctx.stroke(); ctx.setLineDash([]);
}

function drawExit(ctx: CanvasRenderingContext2D) {
  ctx.save();
  const glow = ctx.createRadialGradient(0, -49, 3, 0, -49, 54);
  glow.addColorStop(0, "rgba(128,215,182,.45)");
  glow.addColorStop(1, "rgba(128,215,182,0)");
  ctx.fillStyle = glow; ctx.fillRect(-58, -112, 116, 116);
  ctx.fillStyle = "rgba(8,11,31,.9)";
  ctx.strokeStyle = "#777894"; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(-42, 0); ctx.lineTo(-42, -57); ctx.arc(0, -57, 42, Math.PI, 0); ctx.lineTo(42, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = C.mint; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, -46, 16, .15, Math.PI * 1.75); ctx.stroke();
  ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(12, -48, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawEntityShape(
  ctx: CanvasRenderingContext2D,
  layout: CampaignEntityLayout,
  selected: boolean,
) {
  const { entity, x, y } = layout;
  const kind = normalizedKind(entity);
  ctx.save();
  ctx.translate(x, y);
  if (x !== layout.anchorX || y !== layout.anchorY) {
    ctx.strokeStyle = "rgba(184,220,222,.28)";
    ctx.lineWidth = layout.relation === "world" ? 1.5 : 3;
    ctx.setLineDash(layout.relation === "world" ? [3, 4] : []);
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(layout.anchorX - x, layout.anchorY - y + 8);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.save();
  ctx.rotate(layout.rotation);


  const material: Record<Entity["material"], string> = {
    wood: "#9d6b45",
    cork: "#c79762",
    stone: C.stoneLight,
    metal: "#8f94aa",
    glass: "rgba(184,220,222,.45)",
    cloth: "#c78382",
    water: "#4b91ac",
    light: C.gold,
  };
  ctx.fillStyle = material[entity.material];
  ctx.strokeStyle = entity.movable ? C.mint : "rgba(240,237,220,.48)";
  ctx.lineWidth = entity.movable ? 3 : 2;

  if (kind === "winch" || kind === "pulley") {
    ctx.lineWidth = 4; ctx.strokeRect(-31, -70, 62, 65);
    ctx.beginPath(); ctx.arc(0, -43, 23, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#c89b6b"; ctx.lineWidth = 3;
    for (const radius of [9, 15, 20]) { ctx.beginPath(); ctx.arc(0, -43, radius, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(20, -43); ctx.lineTo(20, -9); ctx.quadraticCurveTo(21, 5, 8, -2); ctx.stroke();
    if (kind === "winch") { ctx.strokeStyle = C.gold; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, -43); ctx.lineTo(-20, -57); ctx.lineTo(-34, -57); ctx.stroke(); }
  } else if (kind === "hook") {
    ctx.strokeStyle = "#c89b6b"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -91); ctx.lineTo(0, -61); ctx.stroke();
    ctx.strokeStyle = "#b8dcde"; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(0, -62); ctx.lineTo(0, -38); ctx.bezierCurveTo(-32, -31, -27, 0, -5, -3); ctx.quadraticCurveTo(17, -6, 14, -27); ctx.stroke();
  } else if (kind === "anchor") {
    ctx.fillRect(-12, -52, 24, 47); ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, -31, 21, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = C.gold; for (const py of [-48, -9]) { ctx.beginPath(); ctx.arc(0, py, 3, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === "support") {
    roundedRect(ctx, -34, -35, 68, 12, 3); ctx.fill(); ctx.stroke();
    for (const px of [-25, 19]) { ctx.fillRect(px, -24, 7, 24); ctx.strokeRect(px, -24, 7, 24); }
  } else if (kind === "display-board") {
    ctx.fillStyle = "#9d6b45"; roundedRect(ctx, -35, -80, 70, 65, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#d8d4b9"; ctx.fillRect(-28, -73, 56, 50);
    ctx.strokeStyle = "#627562"; ctx.lineWidth = 3;
    for (let row = 0; row < 3; row++) { ctx.beginPath(); ctx.moveTo(-19, -61 + row * 13); ctx.lineTo(17, -61 + row * 13); ctx.stroke(); }
    ctx.fillStyle = "#9d6b45"; ctx.fillRect(-4, -15, 8, 15);
  } else if (kind === "bottle") {
    ctx.beginPath(); ctx.moveTo(-10, -68); ctx.lineTo(10, -68); ctx.lineTo(10, -49); ctx.quadraticCurveTo(27, -37, 25, -5); ctx.quadraticCurveTo(0, 6, -25, -5); ctx.quadraticCurveTo(-27, -37, -10, -49); ctx.closePath(); ctx.fill(); ctx.stroke();
    const water = Math.max(0, Math.min(1, numberProperty(entity, "amount") / Math.max(1, entity.capacity)));
    ctx.fillStyle = "#4b91ac"; ctx.fillRect(-19, -3 - water * 24, 38, water * 24); ctx.fillStyle = "#c79762"; ctx.fillRect(-12, -72, 24, 9);
  } else if (kind === "cargo-basket" || kind === "seed-bag") {
    ctx.beginPath(); ctx.moveTo(-32, -40); ctx.lineTo(32, -40); ctx.lineTo(23, 0); ctx.lineTo(-23, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -39, 22, Math.PI, Math.PI * 2); ctx.stroke();
    for (let px = -18; px <= 18; px += 12) { ctx.beginPath(); ctx.moveTo(px, -34); ctx.lineTo(px * .8, -5); ctx.stroke(); }
  } else if (kind === "cart") {
    roundedRect(ctx, -37, -28, 74, 16, 4); ctx.fill(); ctx.stroke();
    for (const px of [-24, 24]) { ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(px, -8, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(33, -23); ctx.lineTo(43, -49); ctx.lineTo(51, -49); ctx.stroke();
    if (/조명|등불/.test(entity.name)) { ctx.save(); ctx.translate(0, -28); drawLantern(ctx, entity); ctx.restore(); }
  } else if (kind === "elevator") {
    const raised = booleanProperty(entity, "raised");
    const deckY = raised ? -83 : -8;
    ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-36, -120); ctx.lineTo(-36, 0); ctx.lineTo(36, 0); ctx.lineTo(36, -120); ctx.moveTo(-36, -120); ctx.lineTo(36, -120); ctx.stroke();
    ctx.fillRect(-38, deckY, 76, 10); ctx.strokeRect(-38, deckY, 76, 10);
    ctx.strokeStyle = "#c89b6b"; ctx.beginPath(); ctx.moveTo(0, -120); ctx.lineTo(0, -65); ctx.stroke();
    drawStateRing(ctx, booleanProperty(entity, "powered") || raised);
  } else if (kind === "safe-line" || kind === "light-sensor") {
    ctx.strokeStyle = C.mint; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.ellipse(0, -3, 34, kind === "light-sensor" ? 25 : 7, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  } else if (kind === "vent") {
    roundedRect(ctx, -34, -62, 68, 58, 5); ctx.fill(); ctx.stroke(); ctx.strokeStyle = C.abyss; ctx.lineWidth = 5;
    for (let py = -51; py < -8; py += 11) { ctx.beginPath(); ctx.moveTo(-25, py); ctx.lineTo(25, py); ctx.stroke(); }
    if (booleanProperty(entity, "active") || booleanProperty(entity, "flowing")) {
      ctx.strokeStyle = "rgba(240,237,220,.78)"; ctx.lineWidth = 4;
      for (const x of [-18, 0, 18]) { ctx.beginPath(); ctx.moveTo(x, -66); ctx.bezierCurveTo(x - 9, -78, x + 9, -89, x, -104); ctx.stroke(); }
    }
  } else if (kind === "ruler") {
    ctx.fillStyle = "#c79762"; ctx.fillRect(-11, -85, 22, 85); ctx.strokeRect(-11, -85, 22, 85);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    for (let py = -75; py < 0; py += 10) { ctx.beginPath(); ctx.moveTo(-11, py); ctx.lineTo(py % 20 ? 0 : 7, py); ctx.stroke(); }
  } else if (kind === "pressure-gauge") {
    ctx.fillStyle = "#e0dcc7"; ctx.beginPath(); ctx.arc(0, -40, 30, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const amount = numberProperty(entity, "reading", numberProperty(entity, "pressure"));
    const limit = Math.max(1, numberProperty(entity, "opensAt", numberProperty(entity, "requiredPressure", 2)));
    const needle = -.75 * Math.PI + Math.max(0, Math.min(1, amount / limit)) * 1.5 * Math.PI;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(Math.cos(needle) * 22, -40 + Math.sin(needle) * 22); ctx.stroke();
    ctx.fillRect(-5, -10, 10, 10);
  } else if (kind === "scale") {
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -75); ctx.moveTo(-40, -61); ctx.lineTo(40, -61); ctx.stroke();
    for (const px of [-30, 30]) { ctx.beginPath(); ctx.moveTo(px, -61); ctx.lineTo(px, -25); ctx.moveTo(px - 15, -25); ctx.quadraticCurveTo(px, -9, px + 15, -25); ctx.stroke(); }
  } else if (["door", "gate", "light-gate", "latched-door", "spring-door", "shutter", "delivery-door"].includes(kind)) {
    drawDoor(ctx, entity);
  } else if (["latch", "seal", "pin", "locking-pin"].includes(kind)) {
    drawLatch(ctx, entity);
  } else if (["pinwheel", "wheel", "wind-wheel", "wind-vane", "wind-clock", "vane", "turbine", "water-wheel", "fan"].includes(kind)) {
    drawPinwheel(ctx, entity);
  } else if (kind === "rail-pot" || kind === "planter") {
    drawPot(ctx, entity);
    ctx.strokeStyle = C.gold; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-35, -83); ctx.lineTo(35, -83); ctx.stroke();
  } else if (kind === "sign" || kind === "compass" || kind === "route-marker") {
    const direction = stringProperty(entity, "gravity") ?? stringProperty(entity, "direction") ?? "up";
    const angle = direction === "down" ? Math.PI : direction === "left" ? -Math.PI / 2 : direction === "right" ? Math.PI / 2 : 0;
    ctx.save(); ctx.translate(0, -35); ctx.rotate(angle - layout.rotation); ctx.fillStyle = C.gold; ctx.beginPath();
    ctx.moveTo(0, -34); ctx.lineTo(18, -10); ctx.lineTo(7, -10); ctx.lineTo(7, 28); ctx.lineTo(-7, 28); ctx.lineTo(-7, -10); ctx.lineTo(-18, -10); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  } else if (kind === "flag") {
    const phase = stringProperty(entity, "phase");
    const fluttering = booleanProperty(entity, "fluttering") || booleanProperty(entity, "active") || phase === "up";
    ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-18, -72); ctx.stroke();
    ctx.fillStyle = fluttering ? C.gold : material[entity.material]; ctx.beginPath(); ctx.moveTo(-16, -68);
    if (fluttering) { ctx.quadraticCurveTo(8, -80, 31, -64); ctx.quadraticCurveTo(8, -49, -16, -57); }
    else { ctx.lineTo(28, -68); ctx.lineTo(22, -41); ctx.lineTo(-16, -48); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (kind === "wedge") {
    ctx.beginPath(); ctx.moveTo(-32, 0); ctx.lineTo(31, 0); ctx.lineTo(20, -25); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (["hazard", "gravity-hazard"].includes(kind)) {
    ctx.fillStyle = "#c78382"; ctx.beginPath(); for (let i = 0; i < 5; i++) { const px = -38 + i * 19; ctx.moveTo(px, 0); ctx.lineTo(px + 9, -42); ctx.lineTo(px + 19, 0); } ctx.fill(); ctx.stroke();
  } else if (kind === "gap") {
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-44, 0); ctx.lineTo(-18, 0); ctx.lineTo(-8, 14); ctx.moveTo(44, 0); ctx.lineTo(18, 0); ctx.lineTo(8, 14); ctx.stroke();
  } else if (["ladder", "rotating-ladder", "ladder-end", "climb-route", "wall-vine"].includes(kind)) {
    if (booleanProperty(entity, "illuminated")) {
      ctx.shadowColor = C.gold; ctx.shadowBlur = 18; ctx.strokeStyle = C.gold;
    }
    const ladderHeight = booleanProperty(entity, "requiresTwoHands") ? 198 : 92;
    ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-20, 3); ctx.lineTo(-20, -ladderHeight); ctx.moveTo(20, 3); ctx.lineTo(20, -ladderHeight);
    for (let py = -9; py >= -ladderHeight + 7; py -= 17) { ctx.moveTo(-20, py); ctx.lineTo(20, py); } ctx.stroke();
    ctx.fillStyle = "#6f7289"; ctx.fillRect(-29, -ladderHeight - 7, 58, 10);
    if (kind.includes("vine") || kind === "climb-route") { ctx.strokeStyle = C.mint; ctx.lineWidth = 2; ctx.beginPath(); ctx.bezierCurveTo(-28, -12, 29, -ladderHeight / 2, -10, -ladderHeight); ctx.stroke(); }
    ctx.shadowBlur = 0;
  } else if (kind === "boat") {
    ctx.beginPath(); ctx.moveTo(-43, -27); ctx.lineTo(43, -27); ctx.lineTo(30, 1); ctx.quadraticCurveTo(0, 15, -30, 1); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(0, -65); ctx.lineTo(25, -42); ctx.lineTo(0, -42); ctx.stroke();
    if (/점/.test(entity.name)) { ctx.fillStyle = C.gold; for (const px of [-20, 0, 20]) { ctx.beginPath(); ctx.arc(px, -14, 3, 0, Math.PI * 2); ctx.fill(); } }
    else { ctx.strokeStyle = C.gold; for (const px of [-18, 0, 18]) { ctx.beginPath(); ctx.moveTo(px, -25); ctx.lineTo(px - 6, 0); ctx.stroke(); } }
  } else if (kind === "season-seed") {
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.ellipse(0, -27, 16, 27, -0.45, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = C.mint; ctx.beginPath(); ctx.moveTo(0, -48); ctx.quadraticCurveTo(18, -67, 27, -50); ctx.stroke();
  } else if (["bridge", "light-bridge", "spring-bridge", "rotating-bridge"].includes(kind)) {
    if (kind === "bridge") {
      drawBridge(ctx, entity);
    } else {
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-49, -8); ctx.lineTo(49, -8); ctx.stroke();
    if (kind === "light-bridge") { ctx.strokeStyle = C.gold; ctx.shadowColor = C.gold; ctx.shadowBlur = 10; ctx.beginPath(); ctx.moveTo(-45, -17); ctx.lineTo(45, -17); ctx.stroke(); ctx.shadowBlur = 0; }
    else if (kind === "spring-bridge") { ctx.lineWidth = 2; for (let px = -38; px < 38; px += 15) { ctx.beginPath(); ctx.arc(px, 0, 8, Math.PI, 0); ctx.stroke(); } }
    else { ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(0, -8, 8, 0, Math.PI * 2); ctx.fill(); }
    }
  } else if (kind === "section-model") {
    ctx.lineWidth = 4; for (let level = 0; level < 3; level++) { const py = -level * 24; ctx.strokeRect(-34 + level * 4, py - 22, 68 - level * 8, 20); }
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.moveTo(-38, -70); ctx.lineTo(0, -91); ctx.lineTo(38, -70); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (kind === "gravity-boundary" || kind === "room-gravity-marker" || kind === "rail-socket" || kind === "rail-carrier" || kind === "rail-stop" || kind === "rail-spur" || kind === "lift-rail") {
    drawGravityDevice(ctx, entity, kind, layout.rotation);
  } else if (kind === "lock") {
    drawLock(ctx, entity);
  } else if (kind === "key" || entity.properties.tool === "brass-key") {
    drawKey(ctx);
  } else if (["counterweight", "weight", "heavy-weight", "fixed-load", "weight-stand", "return-home"].includes(kind)
    || entity.properties.tool === "counterweight") {
    drawCounterweight(ctx, entity);
  } else if (kind.includes("signal") || ["flag", "buoy", "semaphore", "alarm-eye"].includes(kind)
    || ((kind === "fixed-actuator" || kind === "valve") && /신호|삼각|원 |사각/.test(entity.name))) {
    drawSignal(ctx, entity);
  } else if (["shaft", "bell-shaft", "bell-axis", "axis", "counterweight-axis"].includes(kind)) {
    drawShaft(ctx, entity);
  } else if (["boss", "warden", "armor", "empty-armor"].includes(kind)) {
    drawBoss(ctx, entity);
  } else if (kind === "boss-arm" || kind === "attack-model") {
    drawBossArm(ctx, entity);
  } else if (kind === "seal-pin") {
    drawSealPin(ctx, entity);
  } else if (kind === "observation-scope" || kind === "scope") {
    drawObservation(ctx);
  } else if (kind === "fog-boundary" || kind === "fog") {
    drawFogBoundary(ctx, entity);
  } else if (["routing-junction", "wind-diverter", "wind-control", "route-lever"].includes(kind)) {
    drawJunction(ctx, entity);
  } else if (kind === "piston") {
    drawPiston(ctx, entity);
  } else if (["bell", "signal-bell"].includes(kind)) {
    drawBell(ctx, entity);
  } else if (kind === "bell-pendulum") {
    drawPendulum(ctx, entity);
  } else if (kind === "viewing-window") {
    drawViewingWindow(ctx, entity);
  } else if (kind === "tilted-stairs") {
    drawTiltedStairs(ctx, entity);
  } else if (kind === "curtain") {
    drawCurtain(ctx, entity);
  } else if (kind === "claw") {
    drawClaw(ctx, entity);
  } else if (kind === "low-vine") {
    drawVine(ctx, entity);
  } else if (kind === "closed-flower") {
    drawFlower(ctx, entity);
  } else if (kind === "bell-cord" || kind === "climb-rope") {
    ctx.strokeStyle = "#c89b6b"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, -78); ctx.lineTo(0, -12); ctx.stroke();
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(12, 0); ctx.lineTo(-12, 0); ctx.closePath(); ctx.fill();
  } else if (["fixed-lantern", "portable-lantern", "flame", "moon-light", "fixed-light"].includes(kind)
    || entity.properties.tool === "lantern") {
    drawLantern(ctx, entity);
  } else if (["device-slot", "weight-socket", "support-socket", "wedge-socket", "cart-socket", "shape-slot"].includes(kind)) {
    drawSlot(ctx, entity);
  } else if (kind === "pressure-plate" || kind === "weight-plate" || kind === "pressure") {
    drawPressurePlate(ctx, entity);
    if (booleanProperty(entity, "heated") && !booleanProperty(entity, "safe")) {
      ctx.strokeStyle = "#f3a785"; ctx.lineWidth = 3;
      for (const x of [-20, 0, 20]) { ctx.beginPath(); ctx.moveTo(x, -26); ctx.quadraticCurveTo(x - 8, -38, x, -50); ctx.stroke(); }
    }
  } else if (kind === "weak-grid") {
    drawWeakGrid(ctx, entity);
  } else if (kind === "lock-panel") {
    drawLatch(ctx, entity);
  } else if (kind === "exit") {
    drawExit(ctx);
  } else if (kind === "furnace") {
    const open = booleanProperty(entity, "open");
    ctx.beginPath(); ctx.moveTo(-38, 0); ctx.lineTo(-30, -51); ctx.lineTo(30, -51); ctx.lineTo(38, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.abyss; ctx.beginPath(); ctx.arc(0, -15, 20, Math.PI, 0); ctx.lineTo(20, 0); ctx.lineTo(-20, 0); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.translate(0, -52); ctx.rotate(open ? -0.42 : 0); ctx.fillStyle = "#8f94aa"; ctx.fillRect(-35, -8, 70, 12); ctx.restore();
    drawStateRing(ctx, open);
  } else if (kind === "platform" || kind === "safe-platform" || kind === "safe-circle" || kind === "balcony" || kind === "footway" || kind === "hot-path") {
    roundedRect(ctx, -40, -16, 80, 18, 5);
    ctx.fill();
    ctx.stroke();
    if (entity.properties.safe === true || entity.properties.safeToCross === true || entity.properties.cooled === true) {
      ctx.strokeStyle = C.mint;
      ctx.beginPath();
      ctx.arc(0, -18, 9, 0.2, Math.PI * 1.75);
      ctx.stroke();
    }
  } else if (kind === "box" || kind === "plug" || kind === "portable-large" || kind === "portable-small") {
    const wide = kind === "box" ? 34 : 24;
    const tall = kind === "box" ? 54 : 42;
    ctx.fillStyle = entity.material === "wood" ? "#9d6b45" : material[entity.material];
    ctx.beginPath(); ctx.moveTo(-wide, -tall + 9); ctx.lineTo(-wide + 10, -tall); ctx.lineTo(wide, -tall); ctx.lineTo(wide + 8, -tall + 9); ctx.lineTo(wide, 0); ctx.lineTo(-wide, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(240,237,220,.09)";
    ctx.beginPath(); ctx.moveTo(-wide + 10, -tall); ctx.lineTo(wide, -tall); ctx.lineTo(wide + 8, -tall + 9); ctx.lineTo(-wide, -tall + 9); ctx.closePath(); ctx.fill();
    if (kind === "box") {
      ctx.strokeStyle = "#6e5138"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-wide + 7, -tall + 14); ctx.lineTo(wide - 5, -5); ctx.moveTo(wide - 5, -tall + 14); ctx.lineTo(-wide + 7, -5); ctx.stroke();
      ctx.fillStyle = "#b9a26f";
      for (const x of [-wide + 4, wide - 8]) for (const y of [-tall + 15, -9]) ctx.fillRect(x, y, 5, 5);
    }
  } else if (kind === "water" || kind === "channel" || kind === "drain" || kind === "water-channel" || kind === "wind-corridor") {
    const drained = entity.properties.safe === true || entity.properties.level === "low";
    ctx.strokeStyle = "#86c9d1";
    ctx.globalAlpha = drained ? .38 : 1;
    ctx.lineWidth = kind === "water" ? (drained ? 3 : 8) : 5;
    ctx.beginPath();
    for (let i = drained ? -15 : -32; i <= (drained ? 15 : 32); i += 8) {
      const py = Math.sin(i / 8) * 3 - (drained ? 1 : 5);
      if (i === -32) ctx.moveTo(i, py);
      else ctx.lineTo(i, py);
    }
    ctx.stroke();
    if (kind !== "water") {
      ctx.beginPath();
      ctx.moveTo(-31, -27);
      ctx.lineTo(-31, 2);
      ctx.lineTo(31, 2);
      ctx.lineTo(31, -27);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (kind === "tank" || kind === "float-tank" || kind === "water-container" || kind === "container" || kind === "barrel") {
    const level = numberProperty(entity, "level", numberProperty(entity, "amount"));
    const maximum = Math.max(1, numberProperty(entity, "overflowMark", entity.capacity || 1));
    ctx.strokeRect(-29, -76, 58, 76);
    const fill = Math.max(0, Math.min(1, level / maximum));
    ctx.fillStyle = "rgba(75,145,172,.72)";
    ctx.fillRect(-27, -74 * fill, 54, 74 * fill);
    for (const key of ["upperMark", "overflowMark"]) {
      const mark = numberProperty(entity, key, -1);
      if (mark >= 0) {
        const markY = -(mark / maximum) * 74;
        ctx.beginPath();
        ctx.moveTo(-35, markY);
        ctx.lineTo(35, markY);
        ctx.stroke();
      }
    }
  } else if (kind === "valve") {
    ctx.beginPath();
    ctx.arc(0, -29, 24, Math.PI, 0);
    ctx.lineTo(24, 0);
    ctx.lineTo(-24, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.rotate(entity.properties.open === true ? -0.85 : 0);
    ctx.fillRect(-4, -56, 8, 34);
  } else if (kind === "raft") {
    for (let i = -2; i <= 2; i++) {
      roundedRect(ctx, i * 13 - 6, -15, 12, 22, 4);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-33, 9);
    ctx.quadraticCurveTo(0, 22, 33, 9);
    ctx.stroke();
  } else if (kind === "rope" || kind === "release-cord") {
    ctx.strokeStyle = "#c89b6b";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-20, -46);
    ctx.bezierCurveTo(24, -32, -18, -9, 20, 0);
    ctx.stroke();
  } else if (kind === "handle" || kind === "hold-handle" || kind === "latch-handle" || kind === "seal-handle") {
    ctx.fillStyle = "#5f6378"; ctx.strokeStyle = "rgba(240,237,220,.52)"; ctx.lineWidth = 3;
    roundedRect(ctx, -29, -59, 58, 58, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.gold;
    for (const [x, y] of [[-20, -50], [20, -50], [-20, -10], [20, -10]] as const) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.lineWidth = 6;
    ctx.strokeStyle = entity.movable ? C.mint : "rgba(240,237,220,.7)";
    ctx.beginPath();
    ctx.arc(0, -20, 17, 0, Math.PI * 2);
    ctx.stroke();
    const orientation = numberProperty(entity, "orientation", booleanProperty(entity, "open") ? 1 : 0);
    ctx.save(); ctx.translate(0, -20); ctx.rotate(orientation * Math.PI / 2 - Math.PI / 4);
    ctx.strokeStyle = C.gold; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -31); ctx.stroke(); ctx.restore();
    if (booleanProperty(entity, "held") || booleanProperty(entity, "latched") || booleanProperty(entity, "open")) drawStateRing(ctx, true, 27, -49);
  } else if (kind === "net") {
    ctx.strokeRect(-31, -59, 62, 59);
    ctx.lineWidth = 1.5;
    for (let i = -28; i <= 28; i += 14) {
      ctx.beginPath();
      ctx.moveTo(i, -57);
      ctx.lineTo(i + 24, -2);
      ctx.moveTo(i, -2);
      ctx.lineTo(i + 24, -57);
      ctx.stroke();
    }
  } else if (kind === "oven") {
    ctx.beginPath();
    ctx.arc(0, -31, 36, Math.PI, 0);
    ctx.lineTo(36, 0);
    ctx.lineTo(-36, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.abyss;
    ctx.beginPath();
    ctx.arc(0, -17, 18, Math.PI, 0);
    ctx.lineTo(18, 0);
    ctx.lineTo(-18, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(0, -53);
    ctx.lineTo(entity.properties.open === true ? 13 : -9, -67);
    ctx.stroke();
  } else if (kind === "gear" || kind === "crank" || kind === "event-clock" || kind === "drive") {
    ctx.save();
    ctx.rotate(
      numberProperty(entity, "angle", numberProperty(entity, "phase", 0)),
    );
    drawGear(ctx, 24);
    ctx.restore();
  } else if (kind === "tongs") {
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-5, -62);
    ctx.lineTo(-12, -6);
    ctx.quadraticCurveTo(-17, 4, -25, -2);
    ctx.moveTo(5, -62);
    ctx.lineTo(12, -6);
    ctx.quadraticCurveTo(17, 4, 25, -2);
    ctx.stroke();
  } else if (kind === "pipe" || kind === "gutter" || kind === "source" || kind === "current" || kind === "wind-pipe") {
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(-24, -63);
    ctx.lineTo(-24, -22);
    ctx.quadraticCurveTo(-24, -7, -8, -7);
    ctx.lineTo(23, -7);
    ctx.stroke();
    if (entity.properties.steam === true || entity.properties.active === true) {
      ctx.strokeStyle = "rgba(240,237,220,.75)";
      ctx.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(34 + i * 10, -7, 7, Math.PI, 0);
        ctx.stroke();
      }
    }
  } else if (kind === "wall-hook") {
    ctx.fillStyle = "#64697b"; ctx.fillRect(-23, -66, 46, 17); ctx.strokeRect(-23, -66, 46, 17);
    ctx.strokeStyle = "#b8dcde"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(0, -51); ctx.lineTo(0, -22); ctx.quadraticCurveTo(0, -4, 18, -9); ctx.stroke();
    if (entity.properties.accepts === "lantern") { ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(18, -12, 4, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === "tray" || kind === "shelf" || kind === "return-tray") {
    roundedRect(ctx, -35, -12, 70, 12, 3);
    ctx.fill();
    ctx.stroke();
    if (kind === "shelf") {
      ctx.fillRect(-30, -50, 6, 39);
      ctx.fillRect(24, -50, 6, 39);
    }
  } else if (kind === "awning") {
    ctx.beginPath();
    ctx.moveTo(-42, -43);
    ctx.lineTo(42, -43);
    ctx.lineTo(30, -19);
    ctx.lineTo(-30, -19);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "food") {
    ctx.fillStyle = "#d8aa6c";
    ctx.beginPath(); ctx.ellipse(0, -17, 30, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#8b5b3b"; ctx.lineWidth = 3;
    for (const x of [-12, 0, 12]) { ctx.beginPath(); ctx.moveTo(x - 5, -30); ctx.lineTo(x + 2, -7); ctx.stroke(); }
  } else if (kind === "wing") {
    ctx.fillStyle = "#8f94aa";
    ctx.beginPath(); ctx.moveTo(-44, 0); ctx.quadraticCurveTo(-20, -76, 0, -44); ctx.quadraticCurveTo(20, -76, 44, 0); ctx.quadraticCurveTo(0, -28, -44, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    drawStateRing(ctx, booleanProperty(entity, "folded") || booleanProperty(entity, "climbable"));
  } else {
    // Unsupported semantics get a distinct placeholder rather than pretending to be a box.
    ctx.strokeStyle = "#c78382"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -57); ctx.lineTo(28, -29); ctx.lineTo(0, -1); ctx.lineTo(-28, -29); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = C.gold; ctx.font = '700 24px "Noto Sans KR", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("?", 0, -29);
  }

  const direction = stringProperty(entity, "flowDirection");
  const flow = numberProperty(entity, "flow", numberProperty(entity, "flowSpeed", 1));
  if (direction && entity.properties.open !== false && entity.properties.active !== false
    && entity.properties.flowing !== false) {
    ctx.save(); ctx.translate(0, -83); ctx.rotate(-layout.rotation);
    drawFlowArrow(ctx, 0, 0, direction, flow); ctx.restore();
  }

  ctx.restore();

  const shortName = entity.name.length > 10 ? `${entity.name.slice(0, 9)}…` : entity.name;
  const box = layout.labelBounds;
  const bx = box.x - x;
  const by = box.y - y;
  const labelCenterX = bx + box.width / 2;
  const labelCenterY = by + box.height / 2;
  if (Math.hypot(labelCenterX, labelCenterY + 36) > 86) {
    const angle = Math.atan2(labelCenterY + 36, labelCenterX);
    const startX = Math.cos(angle) * 39;
    const startY = -36 + Math.sin(angle) * 39;
    const endX = labelCenterX - Math.cos(angle) * Math.min(box.width / 2, 34);
    const endY = labelCenterY - Math.sin(angle) * Math.min(box.height / 2, 24);
    ctx.strokeStyle = "rgba(184,220,222,.42)";
    ctx.lineWidth = Math.max(1.5, layout.labelScale);
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = selected ? "rgba(33,57,46,.97)" : "rgba(9,11,29,.9)";
  ctx.strokeStyle = selected ? C.mint : layout.relation === "world" ? "rgba(184,220,222,.5)" : C.mint;
  ctx.lineWidth = selected ? 2.5 : 1.5;
  roundedRect(ctx, bx, by, box.width, box.height, 7 * layout.labelScale); ctx.fill(); ctx.stroke();
  if (layout.relation !== "world") {
    ctx.fillStyle = C.mint; ctx.beginPath(); ctx.arc(bx + 9, by + 9, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#f0eddc";
  ctx.font = `600 ${14 * layout.labelScale}px "Noto Sans KR", sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(shortName, bx + box.width / 2, by + box.height / 2);
  ctx.restore();
}

function drawKeeper(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#6e5138";
  ctx.fillStyle = "#9d6b45";
  ctx.lineWidth = 4;
  roundedRect(ctx, -23, -53, 46, 43, 11); ctx.fill(); ctx.stroke();
  ctx.fillStyle = C.moon;
  ctx.beginPath(); ctx.arc(-8, -39, 3, 0, Math.PI * 2); ctx.arc(8, -39, 3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.gold;
  ctx.beginPath(); ctx.arc(0, -63, 15, Math.PI, 0); ctx.lineTo(15, -49); ctx.moveTo(-15, -49); ctx.lineTo(-15, -63); ctx.stroke();
  ctx.fillStyle = "rgba(246,199,109,.7)"; ctx.beginPath(); ctx.moveTo(0, -60); ctx.quadraticCurveTo(9, -51, 0, -45); ctx.quadraticCurveTo(-9, -51, 0, -60); ctx.fill();
  ctx.strokeStyle = "#8f94aa"; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-21, -34); ctx.lineTo(-33, -17); ctx.lineTo(-25, -9); ctx.moveTo(21, -34); ctx.lineTo(34, -23); ctx.moveTo(34, -23); ctx.lineTo(29, -13); ctx.moveTo(34, -23); ctx.lineTo(40, -14); ctx.stroke();
  ctx.strokeStyle = C.gold; ctx.lineWidth = 4;
  for (const foot of [-12, 12]) {
    ctx.beginPath(); ctx.moveTo(foot, -10); ctx.lineTo(foot, 0); ctx.lineTo(foot + 8, 0); ctx.moveTo(foot - 4, -2); ctx.lineTo(foot, -7); ctx.lineTo(foot + 4, -2); ctx.stroke();
  }
  ctx.restore();
}

function drawWornLetter(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x + 24, y - 39);
  ctx.fillStyle = "#c78382";
  ctx.strokeStyle = "#f0eddc";
  ctx.lineWidth = 2;
  roundedRect(ctx, -10, -8, 20, 15, 3); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(0, 1); ctx.lineTo(9, -6); ctx.stroke();
  ctx.restore();
}

export function renderCampaignScene(
  ctx: CanvasRenderingContext2D,
  options: CampaignSceneOptions,
): CampaignEntityLayout[] {
  const {
    time,
    reducedMotion,
    selectedEntityId,
    actorVerbs = {},
    presentation = null,
  } = options;
  const world = presentation?.after ?? options.world;
  const labelScale = Math.max(1, Math.min(2.3, options.labelScale ?? 1));
  const geometry = createSceneGeometry(world, options.scene);
  const presentationProgress = Math.max(
    0,
    Math.min(1, options.playbackProgress ?? options.transitionProgress ?? 1),
  );
  const worldProgress = presentation
    ? presentation.outcome === "revive"
      ? 1
      : Math.max(0, Math.min(1, (presentationProgress - 0.18) / 0.58))
    : reducedMotion
      ? 1
      : presentationProgress;
  const eased = worldProgress * worldProgress * (3 - 2 * worldProgress);
  const previous = presentation?.before ??
    (options.previousWorld?.segmentId === world.segmentId && options.previousWorld.attempt === world.attempt
      ? options.previousWorld
      : world);
  const stateWorld = presentation && presentationProgress < 0.53
    ? presentation.before
    : world;
  const oldActors = layoutCampaignActors(previous, options.scene);
  const finalActors = layoutCampaignActors(world, options.scene);
  const actors = finalActors.map((actor) => {
    const old = oldActors.find((item) => item.id === actor.id) ?? actor;
    const moved = Math.hypot(actor.x - old.x, actor.y - old.y) > 1;
    return {
      ...actor,
      old,
      x: old.x + (actor.x - old.x) * eased,
      y: old.y + (actor.y - old.y) * eased,
      moved,
      facing: (actor.x < old.x ? -1 : 1) as 1 | -1,
    };
  });
  const oldLayouts = layoutCampaignEntities(previous, options.scene, labelScale);
  const layouts = layoutCampaignEntities(world, options.scene, labelScale).map((layout) => {
    let finalX = layout.x;
    let finalY = layout.y;
    if (layout.relation !== "world" && layout.actorId) {
      const actor = actors.find((item) => item.id === layout.actorId);
      const final = finalActors.find((item) => item.id === layout.actorId);
      if (actor && final) {
        finalX += actor.x - final.x;
        finalY += actor.y - final.y;
      }
    }
    const old = oldLayouts.find((item) => item.id === layout.id);
    const interpolate = worldProgress < 1 && old &&
      (layout.entity.movable || layout.relation !== "world" || old.relation !== "world");
    const x = interpolate ? old.x + (finalX - old.x) * eased : finalX;
    const y = interpolate ? old.y + (finalY - old.y) * eased : finalY;
    const dx = x - layout.x;
    const dy = y - layout.y;
    return {
      ...layout,
      entity: stateWorld.entities[layout.id] ?? layout.entity,
      x,
      y,
      labelBounds: { ...layout.labelBounds, x: layout.labelBounds.x + dx, y: layout.labelBounds.y + dy } };
  });
  drawBackdrop(ctx, stateWorld, time, reducedMotion, geometry, options.scene);
  const byId = new Map(layouts.map((layout) => [layout.id, layout]));
  const drawnConnections = new Set<string>();
  const connect = (from: CampaignEntityLayout, to: CampaignEntityLayout) => {
    const key = [from.id, to.id].sort().join("\u0000");
    if (drawnConnections.has(key) || from.id === to.id) return;
    drawnConnections.add(key);
    drawConnection(ctx, from, to);
  };
  for (const layout of layouts) {
    for (const id of stringProperty(layout.entity, "connectedTo")?.split("|") ?? []) {
      const target = byId.get(id); if (target) connect(layout, target);
    }
    for (const id of stringProperty(layout.entity, "connectedFrom")?.split("|") ?? []) {
      const source = byId.get(id); if (source) connect(source, layout);
    }
    const parent = layout.entity.parent ? byId.get(layout.entity.parent) : null;
    if (parent) connect(parent, layout);
  }
  for (const layout of layouts.filter((item) => item.relation !== "carried")) {
    drawEntityShape(ctx, layout, layout.id === selectedEntityId);
  }
  const carriedMotion = new Map<string, { x: number; y: number; opacity: number }>();
  for (const actor of actors) {
    let actorOpacity = 1;
    const source = stateWorld.actors[actor.id] ?? world.actors[actor.id];
    const moving = actor.moved && worldProgress < 1 && !source.riding;
    const verb = presentation
      ? campaignActorVerb(presentation, actor.id)
      : actorVerbs[actor.id];
    if (actor.id !== "hero" && !source.riding && !(moving && verb === "jump")) {
      ctx.save(); ctx.translate(actor.x, actor.y); ctx.rotate(actor.rotation);
      ctx.fillStyle = "rgba(5,8,20,.25)"; ctx.beginPath(); ctx.ellipse(0, 2, 29, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (actor.id === "hero") {
      const targetId = presentation?.events.find(
        (event) => event.actor === "hero" && event.target,
      )?.target;
      const target = targetId ? byId.get(targetId) : undefined;
      const hero = presentation
        ? campaignHeroFrame({
            presentation,
            progress: presentationProgress,
            from: actor.old,
            to: finalActors.find((item) => item.id === "hero") ?? actor,
            verb,
            ...(target
              ? { contact: { x: target.x, y: target.y - 34 } }
              : {}),
          })
        : {
            ...idleHeroFrame(reducedMotion ? 0 : time),
            x: actor.x,
            y: actor.y,
            rotation: actor.rotation,
            pose: moving
              ? verb === "jump"
                ? "jump" as const
                : verb === "duck"
                  ? "duck" as const
                  : "walk" as const
              : "idle" as const,
            phase: worldProgress * 3,
            facing: actor.facing,
            dust: 0,
            shadow: 0,
          };
      carriedMotion.set(actor.id, { x: hero.x - actor.x, y: hero.y - actor.y, opacity: hero.opacity });
      actor.x = hero.x; actor.y = hero.y; actor.rotation = hero.rotation;
      actorOpacity = hero.opacity;
      drawHero(ctx, hero, reducedMotion ? 0 : time);
      if (
        presentation?.outcome === "blocked" &&
        presentationProgress > 0.76
      ) {
        drawBlockedMotif(ctx, hero, reducedMotion ? 0 : time);
      }
      if (world.visible.some((id) => world.entities[id]?.properties.equipment === true && world.entities[id]?.parent === "hero")) {
        ctx.save(); ctx.globalAlpha = hero.opacity; ctx.translate(hero.x, hero.y); ctx.rotate(hero.rotation);
        drawWornLetter(ctx, 0, 0); ctx.restore();
      }
    } else {
      const interaction = !!verb && !["move", "jump", "duck", "climb", "board", "dismount", "observe", "remember"].includes(verb);
      const contactAmount = presentation && interaction
        ? Math.sin(Math.max(0, Math.min(1, (presentationProgress - 0.2) / 0.72)) * Math.PI)
        : 0;
      ctx.save();
      ctx.translate(actor.x, actor.y);
      ctx.rotate(actor.rotation + contactAmount * 0.045);
      ctx.scale(1 - contactAmount * 0.025, 1 + contactAmount * 0.025);
      drawKeeper(ctx, 0, 0); ctx.restore();
      const targetId = presentation?.events.find(
        (event) => event.actor === actor.id && event.target,
      )?.target;
      const target = targetId ? byId.get(targetId) : undefined;
      if (target && contactAmount > 0.01 && Math.hypot(target.x - actor.x, target.y - actor.y) < 95) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.85, contactAmount);
        ctx.strokeStyle = C.mintDark;
        ctx.lineWidth = 9;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(actor.x - 18, actor.y - 35);
        ctx.quadraticCurveTo((actor.x + target.x) / 2, actor.y - 26, target.x, target.y - 34);
        ctx.stroke();
        ctx.fillStyle = C.peachLight;
        ctx.beginPath(); ctx.arc(target.x, target.y - 34, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    if (source.holding && (!presentation || presentationProgress >= 1)) {
      const target = byId.get(source.holding);
      if (target) {
        ctx.save(); ctx.lineCap = "round";
        const cosine = Math.cos(actor.rotation); const sine = Math.sin(actor.rotation);
        const contactX = target.x + sine * 25; const contactY = target.y - cosine * 25;
        const handX = actor.x + cosine * 23 + sine * 35;
        const handY = actor.y + sine * 23 - cosine * 35;
        ctx.strokeStyle = C.mintDark; ctx.lineWidth = 9;
        ctx.beginPath(); ctx.moveTo(handX, handY); ctx.lineTo(contactX, contactY); ctx.stroke();
        ctx.strokeStyle = "#dcebc9"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(handX, handY); ctx.lineTo(contactX, contactY); ctx.stroke();
        ctx.fillStyle = C.peachLight; ctx.beginPath(); ctx.arc(contactX, contactY, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
    ctx.save(); ctx.globalAlpha = actorOpacity; ctx.fillStyle = actor.id === "hero" ? "#dcebc9" : C.gold;
    ctx.font = '600 13px "Noto Sans KR", sans-serif'; ctx.textAlign = "center";
    const sideways = Math.abs(actor.rotation) === Math.PI / 2;
    const labelY = actor.rotation === Math.PI ? actor.y + 124 : sideways ? actor.y - 57 : actor.y - 116;
    const labelX = sideways ? actor.x + Math.sign(actor.rotation) * 57 : actor.x;
    ctx.fillText(actor.id === "hero" ? "용사" : "등지기", labelX, labelY);
    ctx.restore();
  }
  for (const layout of layouts.filter((item) => item.relation === "carried")) {
    const motion = layout.actorId ? carriedMotion.get(layout.actorId) : undefined;
    ctx.save();
    ctx.globalAlpha = motion?.opacity ?? 1;
    const presented = motion ? { ...layout, x: layout.x + motion.x, y: layout.y + motion.y,
      labelBounds: { ...layout.labelBounds, x: layout.labelBounds.x + motion.x, y: layout.labelBounds.y + motion.y } } : layout;
    drawEntityShape(ctx, presented, layout.id === selectedEntityId);
    ctx.restore();
  }
  return layouts;
}
