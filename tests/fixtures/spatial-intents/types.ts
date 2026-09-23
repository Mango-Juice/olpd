import type { ProgramNode, StageId } from '../../../src/campaign/types';

export interface SpatialIntentCase { stageId: StageId; segmentId: string; text: string; body: ProgramNode }
