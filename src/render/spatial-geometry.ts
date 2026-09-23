import type { SceneComposition } from "../campaign/level";
import { spatialCondition } from "../campaign/spatial/engine";
import type { SpatialBody, SpatialComposition, SpatialSurface } from "../campaign/spatial/types";
import type { Location, WorldState } from "../campaign/types";

export const SPATIAL_LEFT = 80;
export const SPATIAL_FLOOR = 400;
export const SPATIAL_X = 80;
export const SPATIAL_Y = 65;
export const SPATIAL_Z = 30;

export function isSpatialScene(scene?: SceneComposition): scene is SpatialComposition {
  return !!scene && "spatial" in scene && !!scene.spatial;
}

/** The same world units as the simulation: a point is an actor's feet or a body's origin. */
export function projectSpatialPoint(point: Pick<Location, "x" | "y"> & { z?: number }) {
  return { x: SPATIAL_LEFT + point.x * SPATIAL_X,
    y: SPATIAL_FLOOR - point.y * SPATIAL_Y - (point.z ?? 0) * SPATIAL_Z };
}

export function activeSpatialCondition(world: WorldState, condition?: SpatialBody["active"] | SpatialSurface["enabled"]) {
  return !condition || spatialCondition(world, condition);
}

export function spatialBodyRect(world: WorldState, body: SpatialBody) {
  const entity = world.entities[body.entity];
  if (!entity || entity.parent === "hero" || entity.parent === "keeper" || !activeSpatialCondition(world, body.active)) return null;
  const center = projectSpatialPoint({
    x: entity.location.x + (body.offsetX ?? 0),
    y: entity.location.y + (body.offsetY ?? 0),
    z: entity.location.z,
  });
  return {
    x: center.x - body.width * SPATIAL_X / 2,
    y: center.y - body.height * SPATIAL_Y,
    width: body.width * SPATIAL_X,
    height: body.height * SPATIAL_Y,
    depth: (body.depth ?? .8) * SPATIAL_Z,
    center,
    body,
  };
}

export function spatialSurfaceLine(surface: SpatialSurface) {
  const start = projectSpatialPoint({ x: surface.from, y: surface.y, z: surface.z });
  const end = projectSpatialPoint({ x: surface.to, y: surface.endY ?? surface.y, z: surface.z });
  return { start, end, depth: (surface.depth ?? 1.2) * SPATIAL_Z };
}
