import { describe, expect, it } from 'vitest';
import { DEFAULT_PHOTO_CROP, photoCropBounds, loadLocalCropImage } from './photoCrop';

describe('Local square photo crop geometry and network boundary', () => {
  it('centres landscape and portrait rasters without stretching', () => {
    expect(photoCropBounds(800, 400, DEFAULT_PHOTO_CROP)).toEqual({ x: 200, y: 0, size: 400 });
    expect(photoCropBounds(400, 800, DEFAULT_PHOTO_CROP)).toEqual({ x: 0, y: 200, size: 400 });
  });
  it('keeps zoom and reposition inside source bounds', () => {
    expect(photoCropBounds(800, 400, { zoom: 2, horizontal: -100, vertical: 100 })).toEqual({ x: 0, y: 200, size: 200 });
    expect(photoCropBounds(800, 400, { zoom: 99, horizontal: 500, vertical: -500 })).toEqual({ x: 700, y: 0, size: 100 });
    expect(() => photoCropBounds(0, 400, DEFAULT_PHOTO_CROP)).toThrow('dimensions');
  });
  it('rejects external, blob and SVG inputs before constructing an image or making a request', async () => {
    for (const source of ['https://example.com/photo.png', 'blob:local-image', 'data:image/svg+xml;base64,AAAA']) {
      await expect(loadLocalCropImage(source)).rejects.toThrow('Only local raster');
    }
  });
});
