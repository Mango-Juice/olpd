import type { CampaignStageDefinition } from './level';
import type { StagePresentation, StageRun } from './run';
import { CONTACT_HINTS, FALL_HINTS, INTERACTION_HINTS } from './hints/catalog';
import { latestDiscovery, type DiscoveryHint } from '../game/hints/discovery';

function candidates(presentation: StagePresentation): DiscoveryHint[] {
  return presentation.events.flatMap(event => {
    if (event.outcome !== 'blocked' && event.outcome !== 'failure') return [];
    const motion = event.motion;
    if (!motion) return [];
    const segment = presentation.before.segmentId;
    const contact = motion.contact;
    if (contact?.surface === 'ceiling') return [{ key: 'low-ceiling', text: '천장이 낮네. 여기서는 높이 뛰기 어렵겠어.' }];
    if (contact?.entity && presentation.before.visible.includes(contact.entity)) {
      const hint = CONTACT_HINTS[`${segment}/${contact.entity}`];
      return hint ? [hint] : [];
    }
    if (motion.kind === 'fall' && contact) {
      const hint = FALL_HINTS[segment];
      if (!hint) return [];
      if (hint.when && presentation.after.entities[hint.when.entity]?.properties[hint.when.property] !== hint.when.value) return [];
      return [hint];
    }
    // A recorded approach proves which object was actually attempted.
    if (!contact && motion.kind === 'interact' && event.target && presentation.before.visible.includes(event.target)) {
      const hint = motion.issue ? INTERACTION_HINTS[`${segment}/${event.target}/${motion.issue}`]
        : CONTACT_HINTS[`${segment}/${event.target}`];
      return hint ? [hint] : [];
    }
    return [];
  });
}

/** One new discovery after a failed encounter, across the complete chapter. */
export function firstContactHint(run: StageRun, stage: CampaignStageDefinition): string | null {
  if (run.presentation || (run.phase !== 'blocked' && run.phase !== 'failed')) return null;
  const current = run.presentationHistory.at(-1);
  if (!current || current.after.segmentId !== run.world.segmentId) return null;
  const scenes = new Set(stage.segments.map(scene => scene.id));
  return latestDiscovery(run.presentationHistory, record => scenes.has(record.before.segmentId) ? candidates(record) : [])?.text ?? null;
}
