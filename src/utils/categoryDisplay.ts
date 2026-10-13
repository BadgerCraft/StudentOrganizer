import type { AchievementCategoryCode } from '../types/schema';

/** Display order only; never changes stored definitions, weights or judgments. */
export const CATEGORY_DISPLAY_ORDER = ['K', 'T', 'C', 'A'] as const;

export function sortCategoriesForDisplay<T extends { categoryCode: AchievementCategoryCode }>(categories: readonly T[]): T[] {
  return [...categories].sort((left, right) =>
    CATEGORY_DISPLAY_ORDER.indexOf(left.categoryCode) - CATEGORY_DISPLAY_ORDER.indexOf(right.categoryCode));
}
