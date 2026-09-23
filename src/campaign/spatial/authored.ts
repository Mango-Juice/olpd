import { makeEntity } from '../level';
import { authoredPublicKind } from '../public-kinds';
import type { Entity } from '../types';
import type { SpatialCondition } from './types';
export function authoredEntity(id: string, name: string, region: string, x: number, y: number, properties: Entity['properties'] = {}, patch: Partial<Entity> = {}): Entity {
  let publicKind = String(properties.kind ?? 'object');
  try { publicKind = authoredPublicKind(id); } catch { /* New objects supply an authored physical noun above. */ }
  return makeEntity(id, name, region, x, { description: name, location: { region, x, y }, publicKind, properties, ...patch });
}
export const property = (entity: string, key: string, value: string | number | boolean): SpatialCondition => ({kind:'property',entity,property:key,value});
export const near = (entity: string, target: string, distance = 0.7): SpatialCondition => ({kind:'near',entity,target,distance});
export const atPosition = (entity: string, x: number, y: number, distance = 0.5): SpatialCondition => ({kind:'at',entity,x,y,distance});
export const all = (...conditions: SpatialCondition[]): SpatialCondition => ({kind:'all',conditions});
export const not = (condition: SpatialCondition): SpatialCondition => ({kind:'not',condition});
