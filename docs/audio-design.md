# Audio design

All audio is synthesized with Web Audio. The project does not download, sample,
or redistribute a music recording.

## Playback contract

Sound effects and music share the master gain in `src/game/audio.ts`, so
`setAudioMuted(true)` silences both. `unlockAudio()` remains the only operation
that creates or resumes the `AudioContext`; this preserves the browser's user
gesture requirement.

The application controls background music through:

```ts
setMusicPlayback({ stageId: "memory-dungeon", playing: true });
```

A play request can arrive before the first gesture. It is remembered, but no
notes are scheduled until `unlockAudio()` reports a running context. Passing
`playing: false`, hiding the document, or selecting an unknown stage stops the
loop, clears its scheduler, and stops both active and future sources. Repeated
calls with the same active stage do not create overlapping loops.

The current eight-door run is one chapter with the stage ID
`memory-dungeon`. Its quiet 68 BPM theme uses overlapping sine-wave fifths and
a sparse triangle-wave motif. The track is deliberately lower than the foley
effects so movement and feedback remain clear.

## Adding a stage

Add a `MusicTrack` entry to `MUSIC_TRACKS` in `src/game/music-config.ts`, then
pass its key as `stageId`. Tracks define tempo, loop length, output gain, and
their synthesized note events. A later boss theme can therefore use a separate
entry without changing the playback API or audio unlock flow.
