/** Immutable classroom scale v1. Values are selected-level equivalents, never bands. */
export const CLASSROOM_LEVELS = Object.freeze([
  { label: 'R', percentage: 50 },
  { label: '1−', percentage: 51 },
  { label: '1', percentage: 55 },
  { label: '1+', percentage: 58 },
  { label: '2−', percentage: 61 },
  { label: '2', percentage: 65 },
  { label: '2+', percentage: 68 },
  { label: '3−', percentage: 71 },
  { label: '3', percentage: 75 },
  { label: '3+', percentage: 78 },
  { label: '4−(low)', percentage: 81 },
  { label: '4−(High)', percentage: 85 },
  { label: '4(low)', percentage: 88 },
  { label: '4(high)', percentage: 91 },
  { label: '4+(low)', percentage: 95 },
  { label: '4+(med)', percentage: 98 },
  { label: '4+(high)', percentage: 100 },
].map(level => Object.freeze(level)));

export const CLASSROOM_LEVEL_LABELS: readonly string[] = Object.freeze(CLASSROOM_LEVELS.map(level => level.label));

/** Exact, case-sensitive labels preserve the published scale and historical codes. */
export function getClassroomLevel(label: string) {
  return CLASSROOM_LEVELS.find(level => level.label === label);
}

/** Evidence may retain labels from the saved rubric alongside automatic classroom choices. */
export function classroomLevelOptions(savedLabels: readonly string[] = []): string[] {
  return [...new Set([...CLASSROOM_LEVEL_LABELS, ...savedLabels])];
}
