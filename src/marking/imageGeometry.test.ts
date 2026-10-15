import { describe, expect, it } from 'vitest';
import { displayToOriginal, imageDisplaySize, isWithinCrop, originalToDisplay } from './imageGeometry';
import type { MarkingPageFeedback, MarkingPoint } from './types';

const crop = { x: 0.15, y: 0.25, width: 0.7, height: 0.5 };
describe('non-destructive original image anchors', () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    it(`round-trips cropped original anchors through ${rotation}° view coordinates`, () => {
      const feedback = { crop, rotation };
      for (const point of [{ x: crop.x, y: crop.y }, { x: crop.x + crop.width, y: crop.y + crop.height }, { x: 0.52, y: 0.63 }, { x: 0, y: 1 }]) {
        const result = displayToOriginal(originalToDisplay(point, feedback), feedback);
        expect(result.x).toBeCloseTo(point.x, 12); expect(result.y).toBeCloseTo(point.y, 12);
      }
    });
  }
  it('maps clockwise rotation corners correctly on a non-square page', () => {
    const feedback = { crop, rotation: 90 as const };
    expect(originalToDisplay({ x: crop.x, y: crop.y }, feedback)).toEqual({ x: 1, y: 0 });
    expect(displayToOriginal({ x: 0, y: 0 }, feedback)).toEqual({ x: crop.x, y: crop.y + crop.height });
    expect(imageDisplaySize({ width: 1000, height: 2000 }, feedback)).toEqual({ width: 1000, height: 700 });
  });
  it('preserves every stored anchor over repeated crops and rotations, including hidden marks', () => {
    const original: MarkingPoint[] = [{ x: 0.05, y: 0.1 }, { x: 0.6, y: 0.65 }];
    const snapshot = JSON.stringify(original);
    for (let run = 0; run < 20; run++) for (const rotation of [90, 180, 270, 0] as const) {
      for (const point of original) originalToDisplay(point, { crop, rotation });
    }
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(isWithinCrop(original[0], crop)).toBe(false); expect(isWithinCrop(original[1], crop)).toBe(true);
    expect(originalToDisplay(original[0], { crop, rotation: 0 }).x).toBeLessThan(0);
    const restored: Pick<MarkingPageFeedback, 'crop' | 'rotation'> = { crop: { x: 0, y: 0, width: 1, height: 1 }, rotation: 0 };
    expect(originalToDisplay(original[0], restored)).toEqual(original[0]);
  });
});
