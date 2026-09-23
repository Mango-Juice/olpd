import type { InstructionProgram } from '../../../src/campaign/types';
import { SPATIAL_EARLY_CASES } from './early';
import { SPATIAL_MIDDLE_CASES } from './middle';
import { SPATIAL_LATE_CASES } from './late';
import type { SpatialIntentCase } from './types';

export { SPATIAL_EARLY_CASES, SPATIAL_MIDDLE_CASES, SPATIAL_LATE_CASES };
export type { SpatialIntentCase };
export const SPATIAL_INTENT_CASES: readonly SpatialIntentCase[] = [...SPATIAL_EARLY_CASES, ...SPATIAL_MIDDLE_CASES, ...SPATIAL_LATE_CASES];
export function spatialFixtureProgram(intent: SpatialIntentCase): InstructionProgram {
  return { version: 2, id: `spatial-fixture-${intent.segmentId}`, model: 'explicit-test-fixture', text: intent.text,
    scope: { region: intent.segmentId }, guard: false, body: structuredClone(intent.body) };
}
