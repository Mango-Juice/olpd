import type { CampaignStageDefinition } from "./level";
import type { StageId } from "./types";
import { RAIN_STAGE } from "./stages/rain";
import { KITCHEN_STAGE } from "./stages/kitchen";
import { FORGE_STAGE } from "./stages/forge";
import { GARDEN_STAGE } from "./stages/garden";
import { STOREHOUSE_STAGE } from "./stages/storehouse";
import { THEATRE_STAGE } from "./stages/theatre";
import { FOG_STAGE } from "./stages/fog";
import { TOWER_STAGE } from "./stages/tower";
import { WARDEN_STAGE } from "./stages/warden";
import { ONBOARDING_STAGES } from "./stages/onboarding";

const DEFINITIONS: Partial<Record<StageId, CampaignStageDefinition>> = {
  2: RAIN_STAGE,
  3: KITCHEN_STAGE,
  4: FORGE_STAGE,
  5: GARDEN_STAGE,
  6: STOREHOUSE_STAGE,
  7: THEATRE_STAGE,
  8: FOG_STAGE,
  9: TOWER_STAGE,
  10: WARDEN_STAGE,
};
for (const stage of Object.values(DEFINITIONS)) {
  DEFINITIONS[stage.id] = { ...stage, onboarding: ONBOARDING_STAGES[stage.id] ?? [] };
}
/** Stage access is separately governed by campaign completion, never this lookup. */
export function resolveStage(id: StageId): CampaignStageDefinition | null {
  return DEFINITIONS[id] ?? null;
}
