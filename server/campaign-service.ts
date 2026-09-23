import { parseCampaignInterpretRequest, type CampaignInterpretResult } from "./campaign-contracts.js";
import { interpretCampaignWithDeepSeek } from "./campaign-deepseek.js";
import { ApiError } from "./errors.js";
import { enforceRateLimit } from "./rate-limit.js";
import { parseWorldState } from "../src/campaign/run-validation.js";
import { resolveStage } from "../src/campaign/registry.js";
import { allStageSegments, type CampaignStageDefinition } from "../src/campaign/level.js";
import type { Actor, Entity, WorldState } from "../src/campaign/types.js";
import type { StageId } from "../src/campaign/types.js";

export const CAMPAIGN_HTTP_BODY_LIMIT = 256 * 1024;
export type CampaignStageResolver = (id: StageId) => CampaignStageDefinition | null;
export interface CampaignInterpretOptions {
  signal?: AbortSignal;
  interpret?: typeof interpretCampaignWithDeepSeek;
  resolveStage?: CampaignStageResolver;
}

/** The client owns its local run. Names and physical descriptors come from shipped content. */
export function campaignContext(body: unknown, stageResolver: CampaignStageResolver = resolveStage): { text: string; world: WorldState } {
  const request = parseCampaignInterpretRequest(body);
  if (!request || request.runId.length > 160 || !Number.isSafeInteger(request.revision) || !Number.isSafeInteger(request.attempt)) throw new ApiError(400, "input", "캠페인 요청의 실행 정보를 확인하지 못했어요.");
  const text = request.text.trim();
  if (!text || [...text].length > 500 || /[\u0000-\u001f\u007f]/u.test(text)) throw new ApiError(400, "input", "지침은 줄바꿈이나 제어 문자 없이 1~500자로 적어 주세요.");
  const world = parseWorldState(request.world);
  const stage = stageResolver(request.stageId);
  if (!world || !stage || world.stageId !== request.stageId || world.attempt !== request.attempt) throw new ApiError(400, "input", "현재 장의 세계 상태를 확인하지 못했어요.");
  const segments = [...allStageSegments(stage), stage.practice];
  if (!segments.some((segment) => segment.id === world.segmentId)) throw new ApiError(400, "input", "현재 장에 없는 구간이에요.");
  const catalog = new Map<string, Entity>();
  const actorCatalog = new Map<string, Actor>();
  for (const segment of segments) {
    const initial = segment.enter(null);
    for (const entity of Object.values(initial.entities)) catalog.set(entity.id, entity);
    for (const actor of Object.values(initial.actors)) actorCatalog.set(actor.id, actor);
  }
  if (Object.keys(world.entities).length > 254 || world.facts.length > 10000) throw new ApiError(400, "input", "관찰 정보가 너무 많아요. 현재 구간을 다시 열어 주세요.");
  for (const [id, entity] of Object.entries(world.entities)) {
    const known = catalog.get(id);
    if (!known || Object.keys(entity.properties).length > 80 || Object.entries(entity.properties).some(([key, value]) => key.length > 100 || (typeof value === "string" && value.length > 600))) throw new ApiError(400, "input", "현재 장에 없는 물체나 물성 정보가 있어요.");
    entity.name = known.name;
    entity.description = known.description;
    entity.material = known.material;
    entity.movable = known.movable;
    entity.reach = known.reach;
    if (known.publicKind) entity.publicKind = known.publicKind;
    else delete entity.publicKind;
    if (known.propertyOptions) entity.propertyOptions = structuredClone(known.propertyOptions);
    else delete entity.propertyOptions;
    if (known.properties.kind === "room-gravity-marker" && known.properties.fixedGravity === true) {
      entity.properties.gravity = known.properties.gravity;
      entity.properties.fixedGravity = true;
      entity.properties.kind = known.properties.kind;
    }
  }
  for (const [id, actor] of Object.entries(world.actors)) {
    const known = actorCatalog.get(id);
    if (!known) throw new ApiError(400, "input", "현재 장에 없는 주체예요.");
    const sceneActor = segments.find((segment) => segment.id === world.segmentId)?.enter(null).actors[id];
    if (/^\d{2}-v2-\d+$/.test(world.segmentId) && sceneActor) {
      // Gravity is visible actor orientation in the compact garden, not a fifth
      // clickable rules marker. Crossing its arch may change it during a scene.
      const gravity = actor.capabilities.find((capability) => capability.startsWith("gravity:"));
      actor.capabilities = [...sceneActor.capabilities];
      if (stage.id === 5 && gravity && ["gravity:up", "gravity:down", "gravity:normal"].includes(gravity)) {
        actor.capabilities = [...actor.capabilities.filter((capability) => !capability.startsWith("gravity:")), gravity];
      }
      continue;
    }
    actor.capabilities = [...known.capabilities];
    // Gravity is fixed per public room, but changes when the actor crosses rooms.
    // The last catalog snapshot must not reset a moving actor to its spawn gravity.
    if (actor.capabilities.some((capability) => capability.startsWith("gravity:"))) {
      const marker = [...catalog.values()].find((entity) => entity.location.region === actor.location.region
        && entity.properties.kind === "room-gravity-marker" && entity.properties.fixedGravity === true);
      const gravity = marker?.properties.gravity;
      if (typeof gravity !== "string" || !["normal", "down", "up", "left", "right"].includes(gravity)) throw new ApiError(400, "input", "현재 방의 중력을 확인하지 못했어요.");
      actor.capabilities = [...actor.capabilities.filter((capability) => !capability.startsWith("gravity:")), `gravity:${gravity}`];
    }
  }
  // Old-attempt observations cannot become current knowledge in a provider request.
  world.facts = world.facts.filter((fact) => fact.attempt === world.attempt && catalog.has(fact.entity));
  return { text, world };
}
export async function interpretCampaign(body: unknown, ip: string, options: CampaignInterpretOptions = {}): Promise<CampaignInterpretResult> {
  if (process.env.AI_ENABLED?.toLowerCase() === "false") throw new ApiError(503, "unavailable", "AI 해석 기능이 잠시 중단되었습니다.", true);
  const context = campaignContext(body, options.resolveStage);
  enforceRateLimit(ip);
  return (options.interpret ?? interpretCampaignWithDeepSeek)(context.text, context.world, { signal: options.signal });
}
