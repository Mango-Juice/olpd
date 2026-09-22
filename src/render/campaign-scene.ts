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
  displayNumber?: number;
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

const booleanProperty = (entity: Entity, key: string) =>
  entity.properties[key] === true;

const normalizedKind = (entity: Entity) => {
  const declared = stringProperty(entity, "kind") ?? "object";
  const hint = `${entity.id} ${entity.name}`.toLowerCase();
  if ((declared === "portable-small" || declared === "portable-large")
    && /평형추|압력추|무게추|이동 추|counterweight/.test(hint)) return "counterweight";
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
  return declared;
};

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
  const sharesGroundObject = actor.id === "hero" && actor.riding === null && layouts.some(({ entity }) => {
    if (entity.parent !== null || entity.location.region !== actor.location.region
      || entity.location.x !== actor.location.x || entity.location.y !== actor.location.y) return false;
    const kind = normalizedKind(entity);
    return !["platform", "safe-platform", "safe-circle", "water", "channel", "drain", "fog-boundary"].includes(kind);
  });
  return {
    x: Math.max(46, Math.min(914, x - (sharesGroundObject ? 46 : 0))),
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
  const [sky, depth] = skies[world.stageId] ?? [C.deep, C.abyss];
  const gradient = ctx.createLinearGradient(0, 0, 0, CAMPAIGN_VIEW_HEIGHT);
  gradient.addColorStop(0, sky);
  gradient.addColorStop(1, depth);
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
  } else if (world.stageId === 4) {
    ctx.strokeStyle = "rgba(246,199,109,.17)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(30, 344); ctx.lineTo(210, 344); ctx.quadraticCurveTo(250, 344, 250, 304); ctx.lineTo(250, 126);
    ctx.moveTo(930, 344); ctx.lineTo(750, 344); ctx.quadraticCurveTo(710, 344, 710, 304); ctx.lineTo(710, 126);
    ctx.stroke();
  } else if (world.stageId === 5) {
    ctx.strokeStyle = "rgba(128,215,182,.18)";
    ctx.lineWidth = 3;
    for (const x of [150, 480, 810]) {
      ctx.beginPath(); ctx.moveTo(x, 96); ctx.bezierCurveTo(x - 60, 180, x + 70, 260, x, 405); ctx.stroke();
    }
    ctx.fillStyle = "rgba(246,199,109,.65)";
    for (const [x, y, rotation] of [[92, 126, 0], [868, 146, Math.PI], [480, 112, Math.PI / 2]] as const) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(9, 6); ctx.lineTo(-9, 6); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  } else if (world.stageId === 6) {
    ctx.fillStyle = "rgba(246,199,109,.08)";
    for (let x = 55; x < 960; x += 150) ctx.fillRect(x, 122, 88, 8);
    ctx.strokeStyle = "rgba(246,199,109,.2)";
    ctx.lineWidth = 2;
    for (let x = 98; x < 960; x += 150) { ctx.beginPath(); ctx.arc(x, 115, 18, Math.PI, 0); ctx.stroke(); }
  } else if (world.stageId === 7) {
    ctx.strokeStyle = "rgba(199,131,130,.18)";
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(26, 82); ctx.quadraticCurveTo(150, 180, 62, 402); ctx.moveTo(934, 82); ctx.quadraticCurveTo(810, 180, 898, 402); ctx.stroke();
    ctx.strokeStyle = "rgba(246,199,109,.16)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(70, 394); ctx.lineTo(890, 394); ctx.stroke();
  } else if (world.stageId === 8) {
    ctx.fillStyle = "rgba(117,190,190,.08)";
    for (let y = 150; y <= 330; y += 72) {
      ctx.beginPath(); ctx.ellipse(480, y, 440, 23, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = "rgba(184,220,222,.16)"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(70, 385); ctx.lineTo(250, 280); ctx.lineTo(420, 385); ctx.lineTo(600, 260); ctx.lineTo(890, 385); ctx.stroke();
  } else if (world.stageId === 9) {
    ctx.strokeStyle = "rgba(246,199,109,.23)"; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(480, 92); ctx.lineTo(480, 406); ctx.stroke();
    ctx.lineWidth = 3;
    for (let y = 142; y < 390; y += 74) { ctx.beginPath(); ctx.moveTo(430, y); ctx.lineTo(530, y); ctx.stroke(); }
  } else if (world.stageId === 10) {
    ctx.strokeStyle = "rgba(199,131,130,.2)"; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(480, 305, 184, Math.PI, 0); ctx.lineTo(664, 406); ctx.moveTo(296, 305); ctx.lineTo(296, 406); ctx.stroke();
    ctx.strokeStyle = "rgba(246,199,109,.22)"; ctx.lineWidth = 3;
    for (const x of [405, 480, 555]) { ctx.beginPath(); ctx.arc(x, 118, 18, 0, Math.PI * 2); ctx.stroke(); }
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
  const flow = Math.max(
    numberProperty(from.entity, "flow", booleanProperty(from.entity, "flowing") ? 1 : 0),
    numberProperty(to.entity, "flow", booleanProperty(to.entity, "flowing") ? 1 : 0),
  );
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

function drawProgressPips(ctx: CanvasRenderingContext2D, entity: Entity) {
  const signal = campaignEntitySignals(entity).find((item) => item.startsWith("progress:"));
  if (!signal) return;
  const [current, total] = signal.slice("progress:".length).split("/").map(Number);
  const count = Math.min(5, Math.max(1, Math.ceil(total)));
  ctx.save();
  ctx.lineWidth = 1.5;
  for (let index = 0; index < count; index++) {
    ctx.fillStyle = index < current ? C.gold : C.abyss;
    ctx.strokeStyle = "rgba(240,237,220,.72)";
    ctx.beginPath();
    ctx.rect((index - (count - 1) / 2) * 9 - 3, -75, 6, 6);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function drawDoor(ctx: CanvasRenderingContext2D, entity: Entity) {
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
}

function drawLatch(ctx: CanvasRenderingContext2D, entity: Entity) {
  const locked = booleanProperty(entity, "locked") || booleanProperty(entity, "latched");
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

function drawGravityDevice(ctx: CanvasRenderingContext2D, entity: Entity, kind: string) {
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
  ctx.save(); ctx.translate(0, -38); ctx.rotate(angle);
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

function drawFogBoundary(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = 4;
  for (let row = 0; row < 3; row++) {
    const y = -54 + row * 18;
    ctx.globalAlpha = 0.38 + row * 0.15;
    ctx.beginPath(); ctx.moveTo(-36, y); ctx.bezierCurveTo(-12, y - 9, 12, y + 9, 36, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
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
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-29, -15); ctx.quadraticCurveTo(-20, -61, 0, -66); ctx.quadraticCurveTo(20, -61, 29, -15); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-34, -12); ctx.lineTo(34, -12); ctx.stroke();
  ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(0, -5, 7, 0, Math.PI * 2); ctx.fill();
  if (rung) {
    ctx.strokeStyle = C.gold; ctx.lineWidth = 2;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(side * 31, -36, 14, side < 0 ? Math.PI * 0.5 : Math.PI * 1.5, side < 0 ? Math.PI * 1.5 : Math.PI * 2.5); ctx.stroke(); }
  }
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
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(-30, -38); ctx.arc(0, -38, 30, Math.PI, 0); ctx.lineTo(30, 0); ctx.stroke();
  ctx.strokeStyle = C.mint; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, -28, 10, 0.15, Math.PI * 1.75); ctx.stroke();
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

  if (["door", "gate", "light-gate", "latched-door", "spring-door", "shutter", "delivery-door"].includes(kind)) {
    drawDoor(ctx, entity);
  } else if (["latch", "seal", "pin", "locking-pin"].includes(kind)) {
    drawLatch(ctx, entity);
  } else if (["pinwheel", "wheel", "wind-wheel", "wind-vane", "wind-clock", "vane", "turbine", "water-wheel"].includes(kind)) {
    drawPinwheel(ctx, entity);
  } else if (kind === "rail-pot") {
    drawPot(ctx, entity);
  } else if (kind === "gravity-boundary" || kind === "room-gravity-marker" || kind === "rail-socket" || kind === "rail-carrier" || kind === "rail-stop" || kind === "rail-spur" || kind === "lift-rail") {
    drawGravityDevice(ctx, entity, kind);
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
    drawFogBoundary(ctx);
  } else if (["routing-junction", "wind-diverter", "wind-control", "route-lever"].includes(kind)) {
    drawJunction(ctx, entity);
  } else if (kind === "piston") {
    drawPiston(ctx, entity);
  } else if (["bell", "signal-bell"].includes(kind)) {
    drawBell(ctx, entity);
  } else if (kind === "bell-cord" || kind === "climb-rope") {
    ctx.strokeStyle = "#c89b6b"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, -78); ctx.lineTo(0, -12); ctx.stroke();
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(12, 0); ctx.lineTo(-12, 0); ctx.closePath(); ctx.fill();
  } else if (["fixed-lantern", "portable-lantern", "flame", "moon-light", "fixed-light"].includes(kind)
    || entity.properties.tool === "lantern") {
    drawLantern(ctx, entity);
  } else if (["device-slot", "weight-socket", "support-socket", "wedge-socket", "cart-socket", "shape-slot"].includes(kind)) {
    drawSlot(ctx, entity);
  } else if (kind === "pressure-plate" || kind === "weight-plate") {
    drawPressurePlate(ctx, entity);
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
  } else if (kind === "platform" || kind === "safe-platform" || kind === "safe-circle" || kind === "balcony" || kind === "footway") {
    roundedRect(ctx, -40, -16, 80, 18, 5);
    ctx.fill();
    ctx.stroke();
    if (entity.properties.safe === true) {
      ctx.strokeStyle = C.mint;
      ctx.beginPath();
      ctx.arc(0, -18, 9, 0.2, Math.PI * 1.75);
      ctx.stroke();
    }
  } else if (kind === "box" || kind === "plug" || kind === "portable-large" || kind === "portable-small") {
    roundedRect(ctx, -26, -43, 52, 43, kind === "box" ? 7 : 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-13, -45, 6, Math.PI, 0);
    ctx.arc(13, -45, 6, Math.PI, 0);
    ctx.stroke();
  } else if (kind === "water" || kind === "channel" || kind === "drain" || kind === "water-channel" || kind === "wind-corridor") {
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
  } else if (kind === "tray" || kind === "shelf" || kind === "return-tray" || kind === "wall-hook") {
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
    (!entity.location.region.includes("-learn-") || entity.properties.boardable === true) &&
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

  drawProgressPips(ctx, entity);

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
  const { world, title, displayNumber, time, reducedMotion, selectedEntityId } = options;
  const layouts = layoutCampaignEntities(world);
  drawBackdrop(ctx, world, time, reducedMotion);

  const byId = new Map(layouts.map((layout) => [layout.id, layout]));
  const drawnConnections = new Set<string>();
  const connect = (from: CampaignEntityLayout, to: CampaignEntityLayout) => {
    const key = [from.id, to.id].sort().join("\u0000");
    if (drawnConnections.has(key) || from.id === to.id) return;
    drawnConnections.add(key);
    drawConnection(ctx, from, to);
  };
  for (const layout of layouts) {
    const connectedTo = stringProperty(layout.entity, "connectedTo");
    for (const id of connectedTo?.split("|") ?? []) {
      const target = byId.get(id);
      if (target) connect(layout, target);
    }
    const connectedFrom = stringProperty(layout.entity, "connectedFrom");
    for (const id of connectedFrom?.split("|") ?? []) {
      const source = byId.get(id);
      if (source) connect(source, layout);
    }
    const parent = layout.entity.parent ? byId.get(layout.entity.parent) : null;
    if (parent) connect(parent, layout);
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
    if (world.visible.some((id) => world.entities[id]?.properties.equipment === true
      && world.entities[id]?.parent === "hero")) {
      drawWornLetter(ctx, position.x, position.y);
    }
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
  ctx.fillText(displayNumber === undefined
    ? `${world.stageId}장`
    : `${world.stageId}장 · 스테이지 ${displayNumber}`, 28, 53);
  ctx.textAlign = "right";
  ctx.fillText(`시도 ${world.attempt} · 변화 ${world.tick}`, 932, 31);
  if (selected) {
    ctx.fillStyle = C.gold;
    ctx.fillText(`선택 · ${selected.name}`, 932, 53);
  }
  return layouts;
}
