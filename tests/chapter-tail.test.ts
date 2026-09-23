import { describe, expect, it } from 'vitest';
import { addInstruction, finishRetiredChapterTail, newChapterRun, retry, startRun, step } from '../src/game/core';
import { loadSave, makeSave } from '../src/game/storage';
import { ROOMS } from '../src/game/content';
import { INTEGRATED_V2_ROOMS } from '../src/game/chapter-layout';
import type { Action, ObservationId, RunState } from '../src/game/types';

function playV2() {
  let run: RunState = { ...newChapterRun(), layoutVersion: 2 };
  const notes: [Action, ObservationId[]][] = [
    ['advance', ['clear','pit','bridge','floorSpikes','lowCeiling','pitCeilingPath','spikesCeilingPath']],
    ['jump', ['pit','bridge','floorSpikes','pitCeilingPath','spikesCeilingPath']],
    ['duck', ['lowCeiling','pitCeilingPath','spikesCeilingPath']],
    ['detour', ['pitCeilingPath','spikesCeilingPath']],
  ];
  for (const [action, appliesTo] of notes) {
    run = addInstruction(run, action, { action, appliesTo, model: 'fixture', uncertainty: 0, rulesVersion: '1' });
    run = startRun(run.phase === 'dead' ? retry(run) : run);
    for (let n = 0; run.phase === 'running' && n < 30; n++) run = step(run);
  }
  return run;
}
const readable = (run: RunState) => loadSave({ getItem: () => JSON.stringify(makeSave(run, { writer: 'test' })), setItem: () => undefined });

describe('one map per stage and retired v2 tail', () => {
  it('authors exactly one map for every current Chapter 1 stage', () => {
    expect(ROOMS).toHaveLength(6);
    expect(ROOMS.every(room => room.points.length === 1)).toBe(true);
    expect(INTEGRATED_V2_ROOMS[5].points).toHaveLength(2);
  });
  it('clears even a v2 run at the final bridge without executing the removed encounter', () => {
    const run = playV2();
    expect(run.phase).toBe('cleared');
    expect(run.lastEvent).toMatchObject({ room: 5, point: 0, observation: 'bridge', outcome: 'safe' });
    expect(run.events.some(event => event.room === 5 && event.point === 1)).toBe(false);
    expect(readable(run).ok).toBe(true);
  });
  it('finishes an already saved pending tail without losing or inventing history', () => {
    const pending: RunState = { ...playV2(), phase: 'running', point: 1 };
    expect(readable(pending).ok).toBe(true);
    const cleared = finishRetiredChapterTail(pending);
    expect(cleared).toMatchObject({ phase: 'cleared', point: 2, revision: pending.revision + 1 });
    expect(cleared.events).toBe(pending.events);
    expect(cleared.history).toBe(pending.history);
    expect(cleared.instructions).toBe(pending.instructions);
    expect(cleared.deaths).toBe(pending.deaths);
    expect(readable(cleared).ok).toBe(true);
    expect(finishRetiredChapterTail(cleared)).toBe(cleared);
    expect(step(pending)).toEqual(cleared);
  });
  it('does not grant a clear before the bridge was actually crossed', () => {
    const run = { ...newChapterRun(), layoutVersion: 2 as const, room: 5, point: 1 };
    expect(finishRetiredChapterTail(run)).toBe(run);
    const earlier = { ...playV2(), phase: 'running' as const, room: 5, point: 0 };
    expect(finishRetiredChapterTail(earlier)).toBe(earlier);
  });
});
