import type { StagePresentation } from "../campaign/run";
import type { SpatialComposition, SpatialMotion } from "../campaign/spatial/types";
import type { WorldState } from "../campaign/types";
import { PALETTE as C } from "./palette";
import { activeSpatialCondition, projectSpatialPoint, spatialBodyRect, spatialSurfaceLine } from "./spatial-geometry";

const bodyColor = {
  solid: "#9d6b45", spikes: "#8f94aa", steam: "#c3e8e1", heat: "#de8f65",
  crush: "#8f94aa", water: "#4b91ac", wind: "#b8dcde", fall: "#4b91ac",
} as const;

/** Terrain and collision silhouettes are projected from authored simulation geometry. */
export function drawSpatialTerrain(ctx: CanvasRenderingContext2D, world: WorldState, scene: SpatialComposition) {
  const inverted = world.actors.hero?.capabilities.includes("gravity:up") ?? false;
  for (const surface of scene.spatial.surfaces) {
    if (!activeSpatialCondition(world, surface.enabled)) continue;
    const line = spatialSurfaceLine(surface);
    const start = { ...line.start, x: surface.from === 0 ? 0 : line.start.x };
    const end = { ...line.end, x: surface.to === 10 ? 960 : line.end.x };
    ctx.save();
    ctx.fillStyle = C.stone;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y);
    ctx.lineTo(end.x, end.y + (inverted ? -36 : 36));
    ctx.lineTo(start.x, start.y + (inverted ? -36 : 36)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.stoneLight; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    ctx.strokeStyle = "rgba(8,11,29,.35)"; ctx.lineWidth = 2;
    for (let x = start.x + 48; x < end.x; x += 72) {
      const y = start.y + (end.y - start.y) * (x - start.x) / (end.x - start.x);
      ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(x + 5, y + (inverted ? -30 : 30)); ctx.stroke();
    }
    ctx.restore();
  }
  if (scene.spatial.ceiling !== undefined) {
    const y = projectSpatialPoint({ x: 0, y: scene.spatial.ceiling }).y;
    ctx.fillStyle = C.stone;
    ctx.fillRect(0, Math.max(0, y - 58), 960, 58);
    ctx.strokeStyle = "rgba(12,15,31,.6)"; ctx.lineWidth = 3;
    for (let x = 0; x < 960; x += 80) {
      ctx.strokeRect(x, y - 57, 80, 29); ctx.strokeRect(x - 40, y - 28, 80, 27);
    }
    ctx.fillStyle = C.stoneLight;
    ctx.fillRect(0, y - 2, 960, 3);
  }
}

export function drawSpatialBody(ctx: CanvasRenderingContext2D, world: WorldState, scene: SpatialComposition, entityId: string, dx = 0, dy = 0) {
  const bodies = scene.spatial.bodies.filter((body) => body.entity === entityId);
  for (const body of bodies) {
    const rect = spatialBodyRect(world, body);
    if (!rect) continue;
    const entity = world.entities[entityId];
    ctx.save(); ctx.translate(dx, dy);
    if (entity.properties.kind === "curtain") {
      ctx.fillStyle = "#795071"; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = "#b98096"; ctx.lineWidth = 3;
      for (let x = rect.x + 6; x < rect.x + rect.width; x += 10) {
        ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.quadraticCurveTo(x - 6, rect.y + rect.height / 2, x, rect.y + rect.height); ctx.stroke();
      }
      ctx.strokeStyle = "#d2b77c"; ctx.beginPath(); ctx.moveTo(rect.x, rect.y + rect.height); ctx.lineTo(rect.x + rect.width, rect.y + rect.height); ctx.stroke();
    } else if (body.kind === "solid") {
      const stone = entity.material === "stone" || entity.material === "metal";
      ctx.fillStyle = stone ? "#676b7b" : entity.material === "cork" ? "#bc925e" : "#98643f";
      ctx.beginPath();
      const inset = Math.min(9, rect.width * .08, rect.height * .2);
      ctx.moveTo(rect.x, rect.y + inset); ctx.lineTo(rect.x + inset, rect.y);
      ctx.lineTo(rect.x + rect.width, rect.y); ctx.lineTo(rect.x + rect.width, rect.y + rect.height);
      ctx.lineTo(rect.x, rect.y + rect.height); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(240,237,220,.12)";
      ctx.beginPath(); ctx.moveTo(rect.x, rect.y + inset); ctx.lineTo(rect.x + inset, rect.y);
      ctx.lineTo(rect.x + rect.width, rect.y); ctx.lineTo(rect.x + rect.width - inset, rect.y + inset); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = stone ? "rgba(220,225,226,.36)" : "rgba(76,44,27,.58)";
      ctx.lineWidth = Math.max(2, Math.min(5, rect.height / 13));
      if (rect.height > 20) {
        for (let row = rect.y + 23; row < rect.y + rect.height; row += 23) {
          ctx.beginPath(); ctx.moveTo(rect.x + 4, row); ctx.lineTo(rect.x + rect.width - 4, row); ctx.stroke();
        }
      }
      if (entity.properties.kind === "box") {
        ctx.beginPath(); ctx.moveTo(rect.x + 7, rect.y + 9); ctx.lineTo(rect.x + rect.width - 7, rect.y + rect.height - 7);
        ctx.moveTo(rect.x + rect.width - 7, rect.y + 9); ctx.lineTo(rect.x + 7, rect.y + rect.height - 7); ctx.stroke();
      }
      if (entity.properties.kind === "door" || entity.properties.kind === "gate") {
        ctx.strokeStyle = "#c2aa76"; ctx.lineWidth = 4; ctx.strokeRect(rect.x + 4, rect.y + 3, rect.width - 8, rect.height - 4);
        ctx.fillStyle = "#efcb84"; ctx.beginPath(); ctx.arc(rect.x + rect.width * .77, rect.y + rect.height * .6, 4, 0, Math.PI * 2); ctx.fill();
      }
      if (body.support) {
        ctx.strokeStyle = C.mintDark; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(rect.x + inset, rect.y + 1); ctx.lineTo(rect.x + rect.width - 2, rect.y + 1); ctx.stroke();
      }
    } else if (body.kind === "spikes") {
      ctx.fillStyle = "#8f94aa"; ctx.strokeStyle = "#d7d9dc"; ctx.lineWidth = 2;
      const count = Math.max(1, Math.ceil(rect.width / 17));
      for (let i = 0; i < count; i++) {
        const left = rect.x + i * rect.width / count;
        const right = rect.x + (i + 1) * rect.width / count;
        ctx.beginPath(); ctx.moveTo(left, rect.y + rect.height);
        ctx.lineTo((left + right) / 2, rect.y); ctx.lineTo(right, rect.y + rect.height);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    } else if (body.kind === "steam" || body.kind === "wind") {
      ctx.strokeStyle = body.kind === "steam" ? "rgba(223,242,233,.83)" : "rgba(184,220,222,.72)";
      ctx.lineWidth = body.kind === "steam" ? 8 : 6; ctx.lineCap = "round";
      const count = body.kind === "wind" ? 4 : Math.max(2, Math.floor(rect.width / 26));
      for (let i = 0; i < count; i++) {
        const x = rect.x + (i + .5) * rect.width / count;
        ctx.beginPath();
        if (body.kind === "steam") {
          ctx.moveTo(x, rect.y + rect.height);
          ctx.bezierCurveTo(x - 12, rect.y + rect.height * .7, x + 13, rect.y + rect.height * .35, x - 3, rect.y + 4);
        } else {
          const y = rect.y + (i + .5) * rect.height / count;
          ctx.moveTo(rect.x, y); ctx.bezierCurveTo(x - 12, y - 12, x + 16, y + 12, rect.x + rect.width, y);
        }
        ctx.stroke();
      }
    } else if (body.kind === "heat") {
      ctx.fillStyle = "#704c47";
      ctx.fillRect(rect.x, rect.y + rect.height - 15, rect.width, 15);
      ctx.strokeStyle = "#e9a073"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(rect.x, rect.y + rect.height - 15);
      ctx.lineTo(rect.x + rect.width, rect.y + rect.height - 15); ctx.stroke();
      for (let x = rect.x + 13; x < rect.x + rect.width; x += 22) {
        ctx.beginPath(); ctx.moveTo(x, rect.y + rect.height - 23);
        ctx.bezierCurveTo(x - 9, rect.y + rect.height * .6, x + 10, rect.y + rect.height * .32, x, rect.y + 4); ctx.stroke();
      }
    } else if (body.kind === "crush" && entity.properties.kind === "curtain") {
      ctx.fillStyle = "#795071"; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = "#b98096"; ctx.lineWidth = 4;
      for (let x = rect.x + 8; x < rect.x + rect.width; x += 15) {
        ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.quadraticCurveTo(x - 8, rect.y + rect.height / 2, x, rect.y + rect.height); ctx.stroke();
      }
    } else if (body.kind === "crush" && ["blades", "wing", "fan"].includes(String(entity.properties.kind))) {
      ctx.save(); ctx.translate(rect.center.x, rect.y + rect.height / 2);
      ctx.rotate(world.tick * .7); ctx.fillStyle = "#9ca0ad";
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(rect.width * .45, -rect.height * .3, rect.width * .48, 0);
        ctx.quadraticCurveTo(rect.width * .4, rect.height * .25, 0, 0); ctx.fill();
      }
      ctx.fillStyle = "#c8b081"; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    } else if (body.kind === "crush") {
      ctx.strokeStyle = "#9ca0ad"; ctx.lineWidth = 9; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(rect.center.x, rect.y);
      ctx.lineTo(rect.center.x, rect.y + rect.height * .58);
      ctx.moveTo(rect.center.x, rect.y + rect.height * .58);
      ctx.quadraticCurveTo(rect.x, rect.y + rect.height * .58, rect.x + 8, rect.y + rect.height);
      ctx.moveTo(rect.center.x, rect.y + rect.height * .58);
      ctx.quadraticCurveTo(rect.x + rect.width, rect.y + rect.height * .58, rect.x + rect.width - 8, rect.y + rect.height); ctx.stroke();
    } else if (body.kind === "water" || body.kind === "fall") {
      ctx.fillStyle = body.kind === "water" ? "rgba(58,122,155,.79)" : "rgba(9,11,29,.92)";
      ctx.beginPath(); ctx.moveTo(rect.x, rect.y + 4);
      ctx.quadraticCurveTo(rect.center.x, rect.y - 4, rect.x + rect.width, rect.y + 4);
      ctx.lineTo(rect.x + rect.width, rect.y + rect.height);
      ctx.lineTo(rect.x, rect.y + rect.height); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = body.kind === "water" ? "#86c9d1" : "#6e7385"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(rect.x, rect.y + 4);
      ctx.quadraticCurveTo(rect.center.x, rect.y - 4, rect.x + rect.width, rect.y + 4); ctx.stroke();
    }
    ctx.restore();
  }
}

/** Device warnings come from the recorded state transition, never elapsed wall time. */
export function drawSpatialDeviceSignal(
  ctx: CanvasRenderingContext2D,
  before: WorldState,
  after: WorldState,
  scene: SpatialComposition,
  entityId: string,
  progress: number,
  dx = 0,
  dy = 0,
) {
  for (const body of scene.spatial.bodies.filter((item) => item.entity === entityId)) {
    if (!["steam", "heat", "crush", "wind", "water"].includes(body.kind)) continue;
    const beforeActive = spatialBodyRect(before, body);
    const afterActive = spatialBodyRect(after, body);
    const comingOn = !beforeActive && afterActive && progress < .53;
    const active = progress < .53 ? beforeActive : afterActive;
    const rect = active ?? (comingOn ? afterActive : null);
    if (!rect) continue;
    ctx.save(); ctx.translate(dx, dy);
    ctx.strokeStyle = bodyColor[body.kind];
    ctx.lineWidth = comingOn ? 3 : 4;
    ctx.globalAlpha = comingOn ? .53 : .72;
    const y = body.kind === "crush" ? rect.y + rect.height : rect.y;
    for (let i = 0; i < 3; i++) {
      const x = rect.x + (i + .5) * rect.width / 3;
      ctx.beginPath(); ctx.moveTo(x, y - 4);
      ctx.quadraticCurveTo(x - 8, y - 15 - i * 3, x + 3, y - 24 - i * 3); ctx.stroke();
    }
    ctx.restore();
  }
}

/** Contact is drawn only after the recorded trace has reached its last point. */
export function drawSpatialContactEffect(
  ctx: CanvasRenderingContext2D,
  presentation: StagePresentation | null,
  motion: SpatialMotion | undefined,
  progress: number,
) {
  if (!presentation || !motion?.contact || progress < .69) return;
  const point = projectSpatialPoint({ ...motion.contact,
    z: motion.points.at(-1)?.z });
  const amount = Math.min(1, (progress - .69) / .13);
  const cause = motion.kind === "walk" || motion.kind === "interact" || motion.kind === "jump"
    ? "solid" : motion.kind;
  ctx.save(); ctx.translate(point.x, point.y - 30); ctx.globalAlpha = (1 - Math.max(0, (progress - .88) / .12)) * .9;
  ctx.lineWidth = cause === "water" || cause === "wind" ? 5 : 4;
  ctx.strokeStyle = bodyColor[cause];
  if (cause === "water") {
    ctx.beginPath(); ctx.ellipse(0, 27, 16 + amount * 30, 7 + amount * 8, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (cause === "fall") {
    ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, 40 + amount * 30); ctx.stroke();
  } else if (cause === "steam" || cause === "heat" || cause === "wind") {
    for (const offset of [-20, 0, 20]) {
      ctx.beginPath(); ctx.moveTo(offset, 19); ctx.quadraticCurveTo(offset - 10, -12 - amount * 18, offset + 8, -35 - amount * 22); ctx.stroke();
    }
  } else {
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      ctx.beginPath(); ctx.moveTo(Math.cos(angle) * 9, Math.sin(angle) * 9);
      ctx.lineTo(Math.cos(angle) * (19 + amount * 22), Math.sin(angle) * (19 + amount * 22)); ctx.stroke();
    }
  }
  ctx.restore();
}
