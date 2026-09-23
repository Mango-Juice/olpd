import { describe, expect, it } from 'vitest';
import { firstContactHint } from '../src/campaign/contact-hints';
import { CONTACT_HINTS } from '../src/campaign/hints/catalog';
import { resolveStage } from '../src/campaign/registry';
import { stageDynamics } from '../src/campaign/level';
import { abandonStage, acknowledgePresentation, advanceStage, createCampaignRun, departStage, retryStage, writeStageProgram, type StageRun } from '../src/campaign/run';
import { parseStageRun } from '../src/campaign/run-validation';
import type { InstructionProgram, StageId } from '../src/campaign/types';
const stage = resolveStage(2)!;
function settle(initial: StageRun, definition = stage) {
  let run = initial;
  for (let i = 0; i < 100 && ['running', 'waiting'].includes(run.phase); i++) run = advanceStage(acknowledgePresentation(run), stageDynamics(definition));
  return run;
}
function collision(verb: 'move' | 'jump') {
  const program: InstructionProgram = { version: 2, id: 'hint-fixture', text: 'fixture', model: 'fixture', scope: {region:'02-v2-1'}, guard: false,
    body: { kind: 'action', actor: 'hero', verb, target: verb === 'move' ? '02-v2-1-exit' : '02-v2-1-box' } };
  return settle(departStage(writeStageProgram(createCampaignRun('hint-run', stage), program)));
}
describe('first-contact discoveries', () => {
  it('waits for playback and identifies the crate actually hit while walking toward the exit', () => {
    const run = collision('move');
    expect(firstContactHint(run, stage)).toBeNull();
    const event = run.presentation!.events.find(event => event.motion?.contact)!;
    expect(event.target).toBe('02-v2-1-exit');
    expect(event.motion!.contact!.entity).toBe('02-v2-1-box');
    const settled = acknowledgePresentation(run);
    expect(firstContactHint(settled, stage)).toContain('밀');
    expect(firstContactHint(parseStageRun(JSON.parse(JSON.stringify(settled)))!, stage)).toBe(firstContactHint(settled, stage));
  });
  it('hints about the low ceiling, never the jump destination crate', () => {
    const run = acknowledgePresentation(collision('jump'));
    expect(run.events.find(event => event.motion?.contact)?.motion?.contact?.surface).toBe('ceiling');
    expect(firstContactHint(run, stage)).toContain('천장');
    expect(firstContactHint(run, stage)).not.toContain('상자');
  });
  it('does not repeat the same discovery in the next life or after restoring its history', () => {
    const first = acknowledgePresentation(collision('move'));
    const restarted = departStage(acknowledgePresentation(retryStage(acknowledgePresentation(abandonStage(first)))));
    const next = acknowledgePresentation(settle(restarted));
    expect(firstContactHint(next, stage)).toBeNull();
    expect(firstContactHint(parseStageRun(JSON.parse(JSON.stringify(next)))!, stage)).toBeNull();
  });
  it('supports the early lantern chapter only after actually approaching its ladder', () => {
    const six = resolveStage(6)!;
    const isolated = { ...six, segments: [six.segments[1]], onboarding: [] };
    const initial = createCampaignRun('ladder-hint', isolated);
    const note: InstructionProgram = { version: 2, id: 'climb', text: '사다리를 올라', model: 'fixture', scope: {}, guard: false,
      body: { kind: 'action', actor: 'hero', verb: 'climb', target: '06-v2-2-ladder' } };
    const run = acknowledgePresentation(settle(departStage(writeStageProgram(initial, note)), isolated));
    expect(run.world.actors.hero.location.x).toBeGreaterThan(initial.world.actors.hero.location.x);
    expect(firstContactHint(run, six)).toContain('두 손');
  });
  it('does not guess a contact hint when the hero simply lacks instructions', () => {
    const run = acknowledgePresentation(settle(departStage(createCampaignRun('no-command', stage))));
    expect(firstContactHint(run, stage)).toBeNull();
  });
  it('rejects malformed saved contact identity without invalidating older coordinate-only contacts', () => {
    const run = collision('move');
    const malformed = structuredClone(run);
    const contact = malformed.presentation!.events.find(event => event.motion?.contact)!.motion!.contact!;
    (contact as unknown as { entity: unknown }).entity = 42;
    expect(parseStageRun(malformed)).toBeNull();
    for (const presentation of [run.presentation!, ...run.presentationHistory]) for (const event of presentation.events) {
      if (event.motion?.contact) delete event.motion.contact.entity;
    }
    expect(parseStageRun(run)).not.toBeNull();
  });
  it('authors real contact bodies or the approached ladder throughout the chapter', () => {
    for (const key of Object.keys(CONTACT_HINTS)) {
      const [segmentId, id] = key.split('/');
      const chapter = Number(segmentId.slice(0, 2)) as StageId;
      const scene = resolveStage(chapter)!.segments.find(scene => scene.id === segmentId)!;
      expect(scene?.enter(null).entities[id], key).toBeTruthy();
      expect(scene.scene?.spatial?.bodies.some(body => body.entity === id) || key === '06-v2-2/06-v2-2-ladder', key).toBe(true);
    }
  });
});

function sceneAttempt(chapter: StageId, index: number, verb: 'move' | 'pull' | 'push' | 'take', target: string) {
  const full = resolveStage(chapter)!;
  const isolated = { ...full, onboarding: [], segments: [full.segments[index]] };
  const note: InstructionProgram = { version: 2, id: `attempt-${chapter}-${index}`, text: 'fixture', model: 'fixture', scope: {}, guard: false,
    body: { kind: 'action', actor: 'hero', verb, target } };
  return { full, run: acknowledgePresentation(settle(departStage(writeStageProgram(createCampaignRun(`scene-${chapter}-${index}`, isolated), note)), isolated)) };
}
it('gives a useful fourth-scene water hint without claiming the fixed cork platform moves', () => {
  const {full,run}=sceneAttempt(2,3,'move','02-v2-4-bank');
  expect(firstContactHint(run,full)).toContain('코르크');
  expect(firstContactHint(run,full)).not.toContain('오가');
});
it('teaches shared lifting after an actual failed solo attempt', () => {
  const {full,run}=sceneAttempt(7,4,'push','07-v2-5-bench');
  expect(run.events.some(event=>event.motion?.issue==='needs-partner')).toBe(true);
  expect(firstContactHint(run,full)).toContain('양쪽');
});
it('uses a fall observation without inventing contact with an unbuilt stair surface', () => {
  const {full,run}=sceneAttempt(9,0,'move','upper');
  const fall=run.events.find(event=>event.motion?.kind==='fall');
  expect(fall?.motion?.contact?.entity).toBeUndefined();
  expect(firstContactHint(run,full)).toContain('계단');
});
it('stops at the high final latch and hints only after the approach fails', () => {
  const {full,run}=sceneAttempt(10,4,'pull','latch');
  expect(run.world.entities.latch.properties.unlocked).toBe(false);
  expect(run.phase).toBe('blocked');
  expect(run.events.some(event=>event.motion?.issue==='out-of-reach')).toBe(true);
  expect(firstContactHint(run,full)).toContain('너무 높');
  expect(parseStageRun(run)).not.toBeNull();
});
it('retains chapter-wide hint memory across different rooms', () => {
  const first=sceneAttempt(6,3,'move','06-v2-4-door');
  const second=sceneAttempt(6,4,'move','06-v2-5-lower-door');
  expect(firstContactHint(first.run,first.full)).toContain('네모');
  expect(firstContactHint(second.run,second.full)).toContain('네모');
  second.run.presentationHistory=[...first.run.presentationHistory,...second.run.presentationHistory];
  expect(firstContactHint(second.run,second.full)).toBeNull();
});

it('does not allow taking a joint object alone before showing its partner hint', () => {
  const {full,run}=sceneAttempt(7,4,'take','07-v2-5-bench');
  expect(run.phase).toBe('blocked');
  expect(run.world.entities['07-v2-5-bench'].parent).toBeNull();
  expect(firstContactHint(run,full)).toContain('양쪽');
});
