import type { Actor, Entity, EntityId, WorldState } from "../campaign/types";
import { idleHeroFrame } from "./animation";
import { PALETTE as C } from "./palette";
import { drawHero } from "./scene";

export const CAMPAIGN_VIEW_WIDTH = 960;
export const CAMPAIGN_VIEW_HEIGHT = 500;

const LEFT = 82;
const RIGHT = 878;
const FLOOR = 406;
const HEIGHT_STEP = 42;

export interface CampaignEntityLayout {
  id: EntityId;
  entity: Entity;
  index: number;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
}

export interface CampaignSceneOptions {
  world: WorldState;
  title: string;
  time: number;
  reducedMotion: boolean;
  selectedEntityId?: EntityId;
}

const numberProperty = (entity: Entity, key: string, fallback = 0) => {
  const value = entity.properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const stringProperty = (entity: Entity, key: string) => {
  const value = entity.properties[key];
  return typeof value === "string" ? value : null;
};

const visibleEntities = (world: WorldState) => {
  const seen = new Set<EntityId>();
  return world.visible.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const entity = world.entities[id];
    return entity && !(entity.properties.causeMapVisible === true && entity.location.region !== world.actors.hero.location.region) ? [entity] : [];
  });
};

function xDomain(world: WorldState, entities: Entity[]): [number, number] {
  const values = [
    ...entities.map((entity) => entity.location.x),
    ...Object.values(world.actors).map((actor) => actor.location.x),
  ];
  if (!values.length) return [0, 8];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 2) return [min - 1, max + 1];
  const padding = Math.max(0.45, (max - min) * 0.06);
  return [min - padding, max + padding];
}

function spreadOffset(index: number, count: number): number {
  if (count <= 1) return 0;
  return (index - (count - 1) / 2) * Math.max(24, 70 - count * 6);
}

/** Maps deterministic world coordinates to inspectable screen positions. */
export function layoutCampaignEntities(
  world: WorldState,
): CampaignEntityLayout[] {
  const entities = visibleEntities(world);
  const [minX, maxX] = xDomain(world, entities);
  const range = Math.max(1, maxX - minX);
  const groups = new Map<string, Entity[]>();
  for (const entity of entities) {
    const key = `${entity.location.x}:${entity.location.y}`;
    const group = groups.get(key) ?? [];
    group.push(entity);
    groups.set(key, group);
  }
  return entities.map((entity, index) => {
    const anchorX = LEFT + ((entity.location.x - minX) / range) * (RIGHT - LEFT);
    const anchorY = Math.min(
      FLOOR,
      Math.max(116, FLOOR - entity.location.y * HEIGHT_STEP),
    );
    const key = `${entity.location.x}:${entity.location.y}`;
    const group = groups.get(key) ?? [entity];
    const groupIndex = group.findIndex((item) => item.id === entity.id);
    return {
      id: entity.id,
      entity,
      index,
      anchorX,
      anchorY,
      x: Math.max(38, Math.min(922, anchorX + spreadOffset(groupIndex, group.length))),
      y: anchorY,
    };
  });
}

function mapActor(
  actor: Actor,
  world: WorldState,
  layouts: CampaignEntityLayout[],
) {
  const entities = layouts.map((layout) => layout.entity);
  const [minX, maxX] = xDomain(world, entities);
  const x = LEFT + ((actor.location.x - minX) / Math.max(1, maxX - minX)) * (RIGHT - LEFT);
  return {
    x: Math.max(46, Math.min(914, x)),
    y: Math.min(FLOOR, Math.max(116, FLOOR - actor.location.y * HEIGHT_STEP)),
  };
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
) {
  const gradient = ctx.createLinearGradient(0, 0, 0, CAMPAIGN_VIEW_HEIGHT);
  gradient.addColorStop(0, world.stageId === 2 ? "#111b38" : world.stageId === 3 ? "#241a31" : C.deep);
  gradient.addColorStop(1, C.abyss);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CAMPAIGN_VIEW_WIDTH, CAMPAIGN_VIEW_HEIGHT);

  ctx.strokeStyle = "rgba(184,220,222,.12)";
  ctx.lineWidth = 3;
  for (let x = 60; x < 960; x += 210) {
    ctx.beginPath();
    ctx.moveTo(x, 405);
    ctx.lineTo(x, 210);
    ctx.arc(x + 70, 210, 70, Math.PI, 0);
    ctx.lineTo(x + 140, 405);
    ctx.stroke();
  }

  if (world.stageId === 2) {
    ctx.strokeStyle = "rgba(184,220,222,.28)";
    ctx.lineWidth = 1.5;
    const offset = reducedMotion ? 0 : (time * 22) % 28;
    for (let x = -30; x < 1000; x += 31) {
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
      ctx.lineTo(920, y);
      ctx.stroke();
    }
  }

  ctx.fillStyle = C.stone;
  ctx.fillRect(0, FLOOR + 18, CAMPAIGN_VIEW_WIDTH, 82);
  ctx.fillStyle = C.stoneLight;
  ctx.fillRect(0, FLOOR + 18, CAMPAIGN_VIEW_WIDTH, 7);
}

function drawConnection(
  ctx: CanvasRenderingContext2D,
  from: CampaignEntityLayout,
  to: CampaignEntityLayout,
) {
  const rope = from.entity.properties.kind === "rope" || from.entity.material === "cloth";
  ctx.save();
  ctx.strokeStyle = rope ? "#c89b6b" : "rgba(128,215,182,.58)";
  ctx.lineWidth = rope ? 4 : 3;
  ctx.setLineDash(rope ? [] : [7, 6]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y - 18);
  const midpoint = (from.x + to.x) / 2;
  ctx.bezierCurveTo(midpoint, from.y + 28, midpoint, to.y + 28, to.x, to.y - 18);
  ctx.stroke();
  const flow = numberProperty(from.entity, "flow");
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

function drawEntityShape(
  ctx: CanvasRenderingContext2D,
  layout: CampaignEntityLayout,
  selected: boolean,
) {
  const { entity, x, y } = layout;
  const kind = stringProperty(entity, "kind") ?? "object";
  ctx.save();
  ctx.translate(x, y);
  if (x !== layout.anchorX) {
    ctx.strokeStyle = "rgba(184,220,222,.28)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(layout.anchorX - x, layout.anchorY - y + 8);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (selected) {
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -21, 37, 45, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

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

  if (kind === "platform") {
    roundedRect(ctx, -40, -16, 80, 18, 5);
    ctx.fill();
    ctx.stroke();
    if (entity.properties.safe === true) {
      ctx.strokeStyle = C.mint;
      ctx.beginPath();
      ctx.arc(0, -18, 9, 0.2, Math.PI * 1.75);
      ctx.stroke();
    }
  } else if (kind === "box" || kind === "plug") {
    roundedRect(ctx, -26, -43, 52, 43, kind === "box" ? 7 : 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-13, -45, 6, Math.PI, 0);
    ctx.arc(13, -45, 6, Math.PI, 0);
    ctx.stroke();
  } else if (kind === "water" || kind === "channel" || kind === "drain") {
    ctx.strokeStyle = "#86c9d1";
    ctx.lineWidth = kind === "water" ? 8 : 5;
    ctx.beginPath();
    for (let i = -32; i <= 32; i += 8) {
      const py = Math.sin(i / 8) * 3 - 5;
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
  } else if (kind === "tank") {
    const level = numberProperty(entity, "level");
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
  } else if (kind === "rope") {
    ctx.strokeStyle = "#c89b6b";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-20, -46);
    ctx.bezierCurveTo(24, -32, -18, -9, 20, 0);
    ctx.stroke();
  } else if (kind === "handle") {
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, -20, 17, 0, Math.PI * 2);
    ctx.stroke();
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
  } else if (kind === "gear") {
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
  } else if (kind === "pipe") {
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
  } else if (kind === "tray" || kind === "shelf") {
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
  } else {
    const radius = entity.properties.slot === "small" ? 15 : 24;
    roundedRect(ctx, -radius, -radius * 2, radius * 2, radius * 2, 7);
    ctx.fill();
    ctx.stroke();
  }

  if (
    entity.capacity > 0 &&
    (entity.properties.boardable === true || ["box", "raft", "tray"].includes(kind))
  ) {
    const pips = Math.min(4, Math.ceil(entity.capacity));
    ctx.fillStyle = C.gold;
    for (let i = 0; i < pips; i++) {
      ctx.beginPath();
      ctx.arc((i - (pips - 1) / 2) * 8, -67, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (entity.capacity > 4) {
      ctx.font = "700 10px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`×${entity.capacity}`, 19, -67);
    }
  }
  const direction = stringProperty(entity, "flowDirection");
  const flow = numberProperty(entity, "flow", numberProperty(entity, "flowSpeed", 1));
  if (direction) drawFlowArrow(ctx, 0, -83, direction, flow);

  ctx.fillStyle = selected ? C.gold : "rgba(240,237,220,.9)";
  ctx.beginPath();
  ctx.arc(0, 12, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.font = "700 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(layout.index + 1), 0, 12);
  ctx.restore();
}

function drawKeeper(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = C.gold;
  ctx.fillStyle = "#62677f";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, -42, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.moon;
  ctx.beginPath();
  ctx.arc(-8, -45, 3, 0, Math.PI * 2);
  ctx.arc(8, -45, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8f94aa";
  ctx.beginPath();
  ctx.moveTo(-17, -21);
  ctx.lineTo(-25, 0);
  ctx.moveTo(17, -21);
  ctx.lineTo(25, 0);
  ctx.stroke();
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  ctx.moveTo(0, -78);
  ctx.lineTo(7, -65);
  ctx.lineTo(-7, -65);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function renderCampaignScene(
  ctx: CanvasRenderingContext2D,
  options: CampaignSceneOptions,
): CampaignEntityLayout[] {
  const { world, title, time, reducedMotion, selectedEntityId } = options;
  const layouts = layoutCampaignEntities(world);
  drawBackdrop(ctx, world, time, reducedMotion);

  const byId = new Map(layouts.map((layout) => [layout.id, layout]));
  for (const layout of layouts) {
    const connectedTo = stringProperty(layout.entity, "connectedTo") ?? layout.entity.parent;
    const target = connectedTo ? byId.get(connectedTo) : null;
    if (target) drawConnection(ctx, layout, target);
  }
  for (const layout of layouts) {
    drawEntityShape(ctx, layout, layout.id === selectedEntityId);
  }

  const hero = world.actors.hero;
  if (hero) {
    const position = mapActor(hero, world, layouts);
    drawHero(ctx, {
      ...idleHeroFrame(reducedMotion ? 0 : time),
      x: position.x,
      y: position.y,
      dust: 0,
      shadow: 0,
    }, reducedMotion ? 0 : time);
  }
  const keeper = world.actors.keeper;
  if (keeper) {
    const position = mapActor(keeper, world, layouts);
    drawKeeper(ctx, position.x, position.y);
  }

  const selected = selectedEntityId
    ? layouts.find((layout) => layout.id === selectedEntityId)?.entity
    : null;
  ctx.fillStyle = "rgba(9,11,29,.82)";
  ctx.fillRect(0, 0, CAMPAIGN_VIEW_WIDTH, 72);
  ctx.fillStyle = "#f0eddc";
  ctx.font = '600 21px "Noto Sans KR", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText(title, 28, 31);
  ctx.fillStyle = C.moon;
  ctx.font = '12px "Noto Sans KR", sans-serif';
  ctx.fillText(`${world.stageId}장 · 스테이지 ${world.segmentId.replace(/^0/, "")}`, 28, 53);
  ctx.textAlign = "right";
  ctx.fillText(`시도 ${world.attempt} · 변화 ${world.tick}`, 932, 31);
  if (selected) {
    ctx.fillStyle = C.gold;
    ctx.fillText(`선택 · ${selected.name}`, 932, 53);
  }
  return layouts;
}
