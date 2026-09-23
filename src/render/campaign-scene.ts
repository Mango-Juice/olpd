import type { SceneComposition } from "../campaign/level";
import type { SpatialComposition } from "../campaign/spatial/types";
import type { Actor, Entity, EntityId, WorldState } from "../campaign/types";
import type { StagePresentation } from "../campaign/run";
import {
  campaignActorVerb,
  campaignHeroFrame,
  idleHeroFrame,
  spatialCampaignHeroFrame,
  spatialMotionPoint,
} from "./animation";
import { isSpatialScene, projectSpatialPoint, spatialBodyRect } from "./spatial-geometry";
import { drawSpatialBody, drawSpatialContactEffect, drawSpatialDeviceSignal, drawSpatialTerrain } from "./spatial-scene";
import { PALETTE as C } from "./palette";
import { CAMPAIGN_VIEW_WIDTH, CAMPAIGN_VIEW_HEIGHT, HEIGHT_STEP } from "./campaign-dimensions";
import { drawConnection, drawEntityShape, drawKeeper, drawWornLetter, roundedRect } from "./campaign-art";
import { normalizedKind, numberProperty, stringProperty, visibleEntities } from "./campaign-entity-semantics";
export { campaignEntitySignals, campaignUnsupportedKinds } from "./campaign-entity-semantics";
import {
  drawBlockedMotif,
  drawDungeonBackdrop,
  drawDungeonFloor,
  drawDungeonMasonry,
  drawHero,
} from "./scene";

export { CAMPAIGN_VIEW_WIDTH, CAMPAIGN_VIEW_HEIGHT } from "./campaign-dimensions";

const LEFT = 80;
const FLOOR = 400;
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
  bodyBounds?: { x: number; y: number; width: number; height: number };
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
  presentation?: StagePresentation | null;
  playbackProgress?: number;
  labelScale?: number;
}

type Gravity = "down" | "up" | "left" | "right";
interface SceneColumn { worldX: number; anchorX: number }
interface SceneRegion {
  id: string;
  start: number;
  end: number;
  gravity: Gravity;
  label: string;
  columns: SceneColumn[];
}
interface SceneGeometry { width: number; regions: SceneRegion[]; spatial?: SpatialComposition }

interface RenderLayouts {
  geometry: SceneGeometry;
  actors: CampaignActorLayout[];
  entitiesByScale: Map<number, CampaignEntityLayout[]>;
}

// World snapshots in the render path are replaced on change. Public layout helpers
// deliberately stay uncached because callers may edit their worlds in place.
const renderLayoutCache = new WeakMap<WorldState, Map<SceneComposition | undefined, RenderLayouts>>();

function renderLayouts(world: WorldState, scene: SceneComposition | undefined, labelScale: number) {
  let scenes = renderLayoutCache.get(world);
  if (!scenes) {
    scenes = new Map();
    renderLayoutCache.set(world, scenes);
  }
  let cached = scenes.get(scene);
  if (!cached) {
    const geometry = createSceneGeometry(world, scene);
    cached = {
      geometry,
      actors: layoutActorsWithGeometry(world, geometry, layoutCampaignEntitiesBase(world, geometry)),
      entitiesByScale: new Map(),
    };
    scenes.set(scene, cached);
    if (scenes.size > 4) scenes.delete(scenes.keys().next().value!);
  }
  let entities = cached.entitiesByScale.get(labelScale);
  if (!entities) {
    entities = layoutCampaignEntitiesWithGeometry(world, cached.geometry, labelScale);
    cached.entitiesByScale.set(labelScale, entities);
    if (cached.entitiesByScale.size > 4) cached.entitiesByScale.delete(cached.entitiesByScale.keys().next().value!);
  }
  return { geometry: cached.geometry, actors: cached.actors, entities };
}

const gravityValue = (value: string | null): Gravity =>
  value === "up" || value === "left" || value === "right" ? value : "down";

function createSceneGeometry(world: WorldState, scene?: SceneComposition): SceneGeometry {
  if (isSpatialScene(scene)) {
    return { width: CAMPAIGN_VIEW_WIDTH, spatial: scene, regions: [{
      id: world.actors.hero?.location.region ?? world.segmentId,
      start: 0, end: CAMPAIGN_VIEW_WIDTH, gravity: "down", label: "", columns: [],
    }] };
  }
  const entities = visibleEntities(world);
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
      return { worldX, anchorX };
    });
    return { id: regionId, start, end, gravity, label, columns };
  });
  return { width: CAMPAIGN_VIEW_WIDTH, regions };
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
  return layoutCampaignEntitiesWithGeometry(world, geometry, labelScale);
}

function layoutCampaignEntitiesWithGeometry(
  world: WorldState,
  geometry: SceneGeometry,
  labelScale: number,
): CampaignEntityLayout[] {
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
    if (geometry.spatial) {
      const point = projectSpatialPoint(actor.location);
      const rider = actor.riding ? layouts.find((layout) => layout.id === actor.riding) : null;
      return { id: actor.id, x: rider?.x ?? point.x, y: rider ? rider.y - 20 : point.y,
        anchorX: point.x, anchorY: point.y,
        rotation: actor.capabilities.includes("gravity:up") ? Math.PI : 0,
        riding: actor.riding };
    }
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
  if (geometry.spatial) return entities.map((entity, index) => {
    let anchor = projectSpatialPoint(entity.location);
    // A route name belongs on the path, not on the doorway at its destination.
    const terrain = geometry.spatial!.spatial.surfaces;
    if (["bridge", "stairs"].includes(String(entity.properties.kind)) && terrain.length > 2
      && !geometry.spatial!.spatial.bodies.some((body) => body.entity === entity.id)) {
      const middle = terrain[Math.floor(terrain.length / 2)];
      anchor = projectSpatialPoint({ x: (middle.from + middle.to) / 2,
        y: (middle.y + (middle.endY ?? middle.y)) / 2, z: middle.z });
    }
    const scene = geometry.spatial;
    const bodyBounds = scene?.spatial.bodies
      .filter((body) => body.entity === entity.id)
      .map((body) => spatialBodyRect(world, body))
      .filter((rect) => rect !== null)
      .reduce<{ x: number; y: number; width: number; height: number } | undefined>((box, rect) => box
        ? { x: Math.min(box.x, rect.x), y: Math.min(box.y, rect.y),
          width: Math.max(box.x + box.width, rect.x + rect.width) - Math.min(box.x, rect.x),
          height: Math.max(box.y + box.height, rect.y + rect.height) - Math.min(box.y, rect.y) }
        : { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, undefined);
    return { id: entity.id, entity, index, anchorX: anchor.x, anchorY: anchor.y,
      x: anchor.x, y: anchor.y, rotation: 0, labelScale: 1,
      labelBounds: { x: anchor.x - LABEL_WIDTH / 2, y: anchor.y - 96, width: LABEL_WIDTH, height: LABEL_HEIGHT },
      relation: "world", bodyBounds };
  });
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
  const body = [...layouts].reverse().find((layout) => {
    const box = layout.bodyBounds;
    if (!box) return false;
    const dx = layout.x - layout.anchorX, dy = layout.y - layout.anchorY;
    return x >= box.x + dx && x <= box.x + box.width + dx
      && y >= box.y + dy && y <= box.y + box.height + dy;
  });
  if (body) return body.id;
  return [...layouts].reverse().find((layout) => Math.hypot(layout.x - x, layout.y - 30 - y) <= 48)?.id ?? null;
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
    const fog = Object.values(world.entities).find((entity) => typeof entity.properties.visibleRange === "number");
    const opacity = fog ? Math.max(.025, .22 - numberProperty(fog, "visibleRange", 0) * .035) : .08;
    ctx.fillStyle = `rgba(117,190,190,${opacity})`;
    for (let y = 150; y <= 330; y += 72) {
      for (let x = 420; x < geometry.width; x += 820) { ctx.beginPath(); ctx.ellipse(x, y, 390, 23, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    if (!isSpatialScene(scene)) {
      ctx.strokeStyle = "rgba(184,220,222,.16)"; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(70, 385); for (let x = 250; x < geometry.width; x += 180) ctx.lineTo(x, x % 360 ? 280 : 385); ctx.stroke();
    }
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

  if (isSpatialScene(scene)) {
    drawSpatialTerrain(ctx, world, scene);
    return;
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
    }
  }
}

export function renderCampaignScene(
  ctx: CanvasRenderingContext2D,
  options: CampaignSceneOptions,
): CampaignEntityLayout[] {
  const {
    time,
    reducedMotion,
    selectedEntityId,
    presentation = null,
  } = options;
  const world = presentation?.after ?? options.world;
  const labelScale = Math.max(1, Math.min(2.3, options.labelScale ?? 1));
  const currentLayout = renderLayouts(world, options.scene, labelScale);
  const geometry = currentLayout.geometry;
  const presentationProgress = Math.max(
    0,
    Math.min(1, options.playbackProgress ?? 1),
  );
  const worldProgress = presentation
    ? presentation.outcome === "revive"
      ? 1
      : Math.max(0, Math.min(1, (presentationProgress - 0.18) / 0.58))
    : reducedMotion
      ? 1
      : presentationProgress;
  const eased = worldProgress * worldProgress * (3 - 2 * worldProgress);
  const previous = presentation?.before ?? world;
  const stateWorld = presentation && presentationProgress < 0.53
    ? presentation.before
    : world;
  const previousLayout = previous === world ? currentLayout : renderLayouts(previous, options.scene, labelScale);
  const oldActors = previousLayout.actors;
  const finalActors = currentLayout.actors;
  const spatial = isSpatialScene(options.scene);
  const traceForActor = (id: string) => spatial && presentation
    ? presentation.events.find((event) => event.motion?.actor === id)?.motion
    : undefined;
  const actors = finalActors.map((actor) => {
    const old = oldActors.find((item) => item.id === actor.id) ?? actor;
    const moved = Math.hypot(actor.x - old.x, actor.y - old.y) > 1;
    const trace = traceForActor(actor.id);
    const point = trace && spatialMotionPoint(trace, Math.max(0, Math.min(1, (presentationProgress - .08) / .64)));
    const projected = point ? projectSpatialPoint(point) : null;
    return {
      ...actor,
      old,
      x: projected?.x ?? old.x + (actor.x - old.x) * eased,
      y: projected?.y ?? old.y + (actor.y - old.y) * eased,
      moved,
      facing: (actor.x < old.x ? -1 : 1) as 1 | -1,
    };
  });
  const oldLayouts = previousLayout.entities;
  const layouts = currentLayout.entities.map((layout) => {
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
      (spatial || layout.entity.movable || layout.relation !== "world" || old.relation !== "world");
    const x = interpolate ? old.x + (finalX - old.x) * eased : finalX;
    const y = interpolate ? old.y + (finalY - old.y) * eased : finalY;
    const dx = x - layout.x;
    const dy = y - layout.y;
    return {
      ...layout,
      entity: stateWorld.entities[layout.id] ?? layout.entity,
      x,
      y,
      labelBounds: { ...layout.labelBounds, x: layout.labelBounds.x + dx, y: layout.labelBounds.y + dy },
      bodyBounds: layout.bodyBounds ? { ...layout.bodyBounds } : undefined };
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
    if (isSpatialScene(options.scene)) {
      const stateEntity = stateWorld.entities[layout.id];
      const origin = stateEntity ? projectSpatialPoint(stateEntity.location) : { x: layout.x, y: layout.y };
      drawSpatialBody(ctx, stateWorld, options.scene, layout.id, layout.x - origin.x, layout.y - origin.y);
      if (presentation) drawSpatialDeviceSignal(ctx, previous, world, options.scene, layout.id,
        presentationProgress, layout.x - origin.x, layout.y - origin.y);
    }
    const bodyDrawn = spatial && options.scene && isSpatialScene(options.scene) && options.scene.spatial.bodies.some((body) => body.entity === layout.id && spatialBodyRect(stateWorld, body));
    drawEntityShape(ctx, layout, layout.id === selectedEntityId, !!bodyDrawn || (spatial && ["bridge", "gap"].includes(normalizedKind(layout.entity))));
  }
  const carriedMotion = new Map<string, { x: number; y: number; opacity: number }>();
  for (const actor of actors) {
    let actorOpacity = 1;
    const source = stateWorld.actors[actor.id] ?? world.actors[actor.id];
    const moving = actor.moved && worldProgress < 1 && !source.riding;
    const verb = presentation
      ? campaignActorVerb(presentation, actor.id)
      : undefined;
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
        ? (spatial && traceForActor("hero")
          ? spatialCampaignHeroFrame({
            presentation,
            progress: presentationProgress,
            from: actor.old,
            to: finalActors.find((item) => item.id === "hero") ?? actor,
            verb,
            trace: traceForActor("hero")!,
          })
          : campaignHeroFrame({
            presentation,
            progress: presentationProgress,
            from: actor.old,
            to: finalActors.find((item) => item.id === "hero") ?? actor,
            verb,
            ...(target
              ? { contact: { x: target.x, y: target.y - 34 } }
              : {}),
          }))
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
      if (spatial) {
        ctx.save(); ctx.translate(hero.x, hero.y); ctx.scale(.64, .64); ctx.translate(-hero.x, -hero.y);
        drawHero(ctx, { ...hero, dust: 0, shadow: 0 }, reducedMotion ? 0 : time); ctx.restore();
      } else drawHero(ctx, hero, reducedMotion ? 0 : time);
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
      if (spatial) ctx.scale(.42, .42);
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
    const labelOffset = spatial ? (actor.id === "hero" ? 78 : 47) : 116;
    const labelY = actor.rotation === Math.PI ? actor.y + labelOffset : sideways ? actor.y - 57 : actor.y - labelOffset;
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
  if (spatial) {
    const trace = traceForActor("hero") ?? traceForActor("keeper");
    drawSpatialContactEffect(ctx, presentation, trace, presentationProgress);
  }
  return layouts;
}
