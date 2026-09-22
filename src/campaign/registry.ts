import type { CampaignStageDefinition } from "./level";
import type { StageId } from "./types";
import { RAIN_STAGE } from "./stages/rain";
import { KITCHEN_STAGE } from "./stages/kitchen";
import { FORGE_STAGE } from "./stages/forge";
import { GARDEN_STAGE } from "./stages/garden";
import { STOREHOUSE_STAGE } from "./stages/storehouse";

const DEFINITIONS: Partial<Record<StageId, CampaignStageDefinition>> = {
  2: RAIN_STAGE,
  3: KITCHEN_STAGE,
  4: FORGE_STAGE,
  5: GARDEN_STAGE,
  6: STOREHOUSE_STAGE,
};
/** Stage access is separately governed by campaign completion, never this lookup. */
export function resolveStage(id: StageId): CampaignStageDefinition | null {
  return DEFINITIONS[id] ?? null;
}
