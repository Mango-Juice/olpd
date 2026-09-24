import { newChapterRun } from "../../src/game/core";
import type { RunState } from "../../src/game/types";

/** Historical save fixture. Production creates current six-scene runs only. */
export function newRun(tutorial: boolean): RunState {
  return { ...newChapterRun(), tutorial, layoutVersion: 1, canWrite: tutorial };
}
