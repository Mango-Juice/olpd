import type { Entity, EntityId, WorldState } from "../campaign/types";

export const numberProperty = (entity: Entity, key: string, fallback = 0) => {
  const value = entity.properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

export const stringProperty = (entity: Entity, key: string) => {
  const value = entity.properties[key];
  return typeof value === "string" ? value : null;
};

export const booleanProperty = (entity: Entity, key: string) =>
  entity.properties[key] === true;

const SHAPE_ALIASES: Record<string, string> = {
  "crate": "box", "plank": "bridge", "alcove": "safe-platform", "arch": "gate",
  "arm": "boss-arm", "arrival": "exit", "bank": "safe-platform", "bench": "support",
  "blades": "pinwheel", "control": "handle", "duct": "vent", "heat": "hot-path",
  "heated-path": "hot-path", "meeting": "safe-platform", "path": "footway",
  "plate": "pressure-plate", "rail": "bridge", "ratchet": "shaft", "stage": "safe-platform",
  "thorn": "low-vine", "thorns": "low-vine", "vine": "low-vine", "wall": "door",
  "wind": "pinwheel", "wind-panel": "wing", "windmill": "pinwheel",
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

export const normalizedKind = (entity: Entity) => {
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
  "hook", "oven", "rope", "shelf", "shaft", "wedge", "counterweight", "pressure-plate", "weight",
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

export const visibleEntities = (world: WorldState) => {
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
