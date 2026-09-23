/** A single physical observation, independent of rendering and either game engine. */
export interface DiscoveryHint { key: string; text: string }

/** Replay persisted encounters to select only the first unseen observation at the latest encounter. */
export function latestDiscovery<T>(history: readonly T[], candidates: (entry: T) => readonly DiscoveryHint[], learned: readonly string[] = []): DiscoveryHint | null {
  const seen = new Set(learned);
  let latest: DiscoveryHint | null = null;
  for (const entry of history) {
    latest = candidates(entry).find(hint => !seen.has(hint.key)) ?? null;
    if (latest) seen.add(latest.key);
  }
  return latest;
}
