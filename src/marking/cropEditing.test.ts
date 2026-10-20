import { describe, expect, it } from 'vitest';
import { cropDisplayBounds, FULL_PAGE_CROP, resizePageCrop, sameSurfaceRect, setPageCropValue } from './cropEditing';
import { originalToDisplay } from './imageGeometry';

const close = (actual: object, expected: object) => Object.entries(expected).forEach(([key, value]) => expect((actual as Record<string, number>)[key]).toBeCloseTo(value, 10));
describe('desktop original-coordinate crop edits', () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    it(`drags the visible corner at ${rotation} degrees while retaining original anchors`, () => {
      const crop = resizePageCrop(FULL_PAGE_CROP, rotation, 'top-left', { x: .2, y: .3 });
      close(cropDisplayBounds(crop, rotation), { x: .2, y: .3, width: .8, height: .7 });
      const expected = rotation === 0 ? { x: .2, y: .3, width: .8, height: .7 }
        : rotation === 90 ? { x: .3, y: 0, width: .7, height: .8 }
        : rotation === 180 ? { x: 0, y: 0, width: .8, height: .7 }
        : { x: 0, y: .2, width: .7, height: .8 };
      close(crop, expected);
      const anchor = { x: .5, y: .5 }, before = { ...anchor };
      originalToDisplay(anchor, { crop, rotation }); expect(anchor).toEqual(before);
    });
    it(`bounds crossed and out-of-page handles at ${rotation} degrees`, () => {
      const crop = resizePageCrop({ x: .1, y: .1, width: .8, height: .8 }, rotation, 'bottom-right', { x: -3, y: 4 });
      expect(crop.x).toBeGreaterThanOrEqual(0); expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.width).toBeGreaterThanOrEqual(.01); expect(crop.height).toBeGreaterThanOrEqual(.01);
      expect(crop.x + crop.width).toBeLessThanOrEqual(1); expect(crop.y + crop.height).toBeLessThanOrEqual(1);
    });
  }
  it('accepts left/top trimming before width/height are changed', () => {
    expect(setPageCropValue(FULL_PAGE_CROP, 'x', .1)).toEqual({ x: .1, y: 0, width: .9, height: 1 });
    expect(setPageCropValue(FULL_PAGE_CROP, 'y', .2)).toEqual({ x: 0, y: .2, width: 1, height: .8 });
    expect(setPageCropValue(FULL_PAGE_CROP, 'x', NaN)).toBe(FULL_PAGE_CROP);
  });
  it('detects surface resize and relocation before extending a stroke', () => {
    const start = { left: 10, top: 20, width: 800, height: 600 };
    expect(sameSurfaceRect(start, { ...start })).toBe(true);
    expect(sameSurfaceRect(start, { ...start, width: 400 })).toBe(false);
    expect(sameSurfaceRect(start, { ...start, top: 21 })).toBe(false);
  });
});
