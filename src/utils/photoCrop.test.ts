import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PHOTO_CROP, photoCropBounds, loadLocalCropImage, readLocalPhotoFile, renderPhotoCrop } from './photoCrop';

afterEach(() => vi.unstubAllGlobals());

describe('Local square photo crop geometry and network boundary', () => {
  it('rejects oversized uploads before allocating FileReader', async () => {
    await expect(readLocalPhotoFile({ type: 'image/png', size: 20 * 1024 * 1024 + 1 } as File)).rejects.toThrow('10 MB');
  });
  it('rejects oversized encoded and decoded sources', async () => {
    await expect(loadLocalCropImage('data:image/png;base64,' + 'A'.repeat(14 * 1024 * 1024))).rejects.toThrow('10 MB');
    vi.stubGlobal('Image', class {
      naturalWidth = 8192; naturalHeight = 8192; onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    });
    await expect(loadLocalCropImage('data:image/png;base64,AAAA')).rejects.toThrow('16 megapixels');
  });
  it('renders a fresh 256-square JPEG and rejects oversized output', () => {
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: vi.fn(() => 'data:image/jpeg;base64,AAAA') };
    const image = { naturalWidth: 800, naturalHeight: 400 } as HTMLImageElement;
    expect(renderPhotoCrop(image, DEFAULT_PHOTO_CROP, canvas as unknown as HTMLCanvasElement)).toBe('data:image/jpeg;base64,AAAA');
    expect([canvas.width, canvas.height]).toEqual([256, 256]);
    expect(context.drawImage).toHaveBeenCalledWith(image, 200, 0, 400, 400, 0, 0, 256, 256);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', .85);
    canvas.toDataURL.mockReturnValue('data:image/jpeg;base64,' + 'A'.repeat(64 * 1024));
    expect(() => renderPhotoCrop(image, DEFAULT_PHOTO_CROP, canvas as unknown as HTMLCanvasElement)).toThrow('64 KB');
  });
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
