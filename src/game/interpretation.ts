import { ACTION_LABELS, OBSERVATIONS, RULES_VERSION } from "./content";
import type { Interpretation } from "./types";
/** The versioned API requires at least .60 certainty for each used judgment. */
export const MAX_UNCERTAINTY = 0.4;
export function isInterpretation(value: unknown): value is Interpretation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const i = value as Record<string, unknown>;
  return (
    typeof i.action === "string" &&
    Object.hasOwn(ACTION_LABELS, i.action) &&
    Array.isArray(i.appliesTo) &&
    i.appliesTo.every(
      (id) => typeof id === "string" && Object.hasOwn(OBSERVATIONS, id),
    ) &&
    new Set(i.appliesTo).size === i.appliesTo.length &&
    typeof i.uncertainty === "number" &&
    Number.isFinite(i.uncertainty) &&
    i.uncertainty >= 0 &&
    i.uncertainty <= MAX_UNCERTAINTY &&
    typeof i.model === "string" &&
    i.model.trim().length > 0 &&
    i.rulesVersion === RULES_VERSION
  );
}
