import { describe, expect, it } from 'vitest';
import { sortCategoriesForDisplay } from './categoryDisplay';

describe('KTCA display sorting', () => {
  it('orders complete and partial sets without mutating identities, scores, weights or the input', () => {
    const categories = Object.freeze((['A', 'C', 'K', 'T'] as const).map((categoryCode, index) =>
      Object.freeze({ id: `fictional-${categoryCode}`, categoryCode, evidenceWeight: index + 1, maxScore: index + 10 })));
    const sorted = sortCategoriesForDisplay(categories);
    expect(sorted.map(category => category.categoryCode)).toEqual(['K', 'T', 'C', 'A']);
    for (const category of sorted) expect(category).toBe(categories.find(original => original.id === category.id));
    expect(categories.map(category => category.categoryCode)).toEqual(['A', 'C', 'K', 'T']);
    expect(sortCategoriesForDisplay([categories[0], categories[2]]).map(category => category.categoryCode)).toEqual(['K', 'A']);
  });
});
