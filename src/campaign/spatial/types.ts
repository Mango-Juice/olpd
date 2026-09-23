import type { Entity, Actor, Location, Scalar, StageId } from '../types';
import type { SceneComposition } from '../level';

/** Authored simulation data, never supplied by the language model. World units match scene floors. */
export type SpatialCondition =
  | { kind: 'property'; entity: string; property: string; value: Scalar }
  | { kind: 'near'; entity: string; target: string; distance?: number }
  | { kind: 'at'; entity: string; x: number; y: number; z?: number; distance?: number }
  | { kind: 'parent'; entity: string; parent: string | null }
  | { kind: 'holding' | 'carrying'; actor: 'hero' | 'keeper'; entity: string }
  | { kind: 'all' | 'any'; conditions: SpatialCondition[] }
  | { kind: 'not'; condition: SpatialCondition };
export type ContactKind = 'solid' | 'spikes' | 'steam' | 'heat' | 'crush' | 'water' | 'wind' | 'fall';
export interface SpatialBody {
  entity: string;
  width: number;
  height: number;
  depth?: number;
  /** Offset from the entity origin, normally its feet. */
  offsetX?: number;
  offsetY?: number;
  kind: ContactKind;
  active?: SpatialCondition;
  /** Supports feet; movable crates/platforms share collision and rendered bounds. */
  support?: boolean;
  /** A moving or closing solid can crush an actor; a stationary wall only blocks. */
  kinematic?: boolean;
}
export interface SpatialSurface {
  from: number; to: number; y: number; z?: number; depth?: number;
  /** Sloped surface end elevation. */
  endY?: number;
  enabled?: SpatialCondition;
}
export type SpatialInteraction =
  | { kind: 'movable'; entity: string; pushTo?: { x: number; y: number; z?: number }; placements?: Record<string, { x: number; y: number; z?: number }>; joint?: boolean }
  | { kind: 'control'; entity: string; property: string; value: Scalar; offValue?: Scalar; destinations?: Record<string, Scalar> }
  | { kind: 'door'; entity: string; key?: string; spring?: boolean }
  | { kind: 'handle'; entity: string }
  | { kind: 'ladder'; entity: string; destination: string; freeHands?: boolean }
  | { kind: 'transport'; entity: string; from: { x: number; y: number; z?: number }; to: { x: number; y: number; z?: number }; period: number; enabled?: SpatialCondition }
  | { kind: 'gravity'; entity: string; gravity: 'up' | 'down'; destinationY: number };
export interface SpatialRule {
  when: SpatialCondition;
  /** Assign both branches every tick so release/removal restores actual mechanisms. */
  effects: { entity: string; property: string; value: Scalar; otherwise?: Scalar }[];
  delayTicks?: number;
  locations?: { entity: string; x: number; y: number; z?: number; otherwise?: { x: number; y: number; z?: number } }[];
}
export interface SpatialCycle { entity: string; property: string; values: Scalar[]; ticksPerValue?: number; locations?: { x: number; y: number; z?: number }[] }
export interface SpatialSceneDefinition {
  id: string; title: string; goal: string;
  entities: Entity[];
  hero?: Partial<Actor>;
  keeper?: Partial<Actor>;
  surfaces: SpatialSurface[];
  bodies: SpatialBody[];
  interactions?: SpatialInteraction[];
  rules?: SpatialRule[];
  cycles?: SpatialCycle[];
  goals: SpatialCondition[];
  /** Authored approach target for explicit movement checks; never an automatic action. */
  defaultTarget: string;
  ceiling?: number;
  /** Explicit player-named paths, never chosen from hidden safety information. */
  routes?: Record<string, { x: number; y: number; z?: number }[]>;
  carry?: { from: string; to: string; properties?: Record<string, string>; location?: boolean }[];
  hints?: readonly [string, string, string];
}
export interface SpatialComposition extends SceneComposition {
  spatial: { bodies: SpatialBody[]; surfaces: SpatialSurface[]; ceiling?: number };
}
export interface SpatialChapterDefinition {
  id: Exclude<StageId, 1>; title: string; objective: string;
  scenes: SpatialSceneDefinition[];
  story: { afterSegment: string; object: string; text: string };
}
export interface SpatialMotion {
  actor: 'hero' | 'keeper';
  kind: 'walk' | 'jump' | 'interact' | ContactKind;
  target?: string;
  /** Observed limitation after approaching an interaction, never inferred by UI. */
  issue?: 'out-of-reach' | 'needs-partner';
  points: { x: number; y: number; z?: number; t: number }[];
  contact?: Pick<Location, 'x' | 'y'> & { entity?: string; surface?: 'ceiling' };
}
