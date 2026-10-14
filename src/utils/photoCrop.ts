import { isLocalPhoto } from './localPhoto';

export interface PhotoCrop { zoom: number; horizontal: number; vertical: number }
export const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PHOTO_PIXELS = 16 * 1024 * 1024;
export const DEFAULT_PHOTO_CROP: PhotoCrop = { zoom: 1, horizontal: 0, vertical: 0 };
const bounded = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/** Coordinates stay inside the source raster even at extreme slider positions. */
export function photoCropBounds(width: number, height: number, crop: PhotoCrop) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Image dimensions are invalid.');
  const size = Math.min(width, height) / bounded(crop.zoom, 1, 4);
  return { x: (width - size) * (bounded(crop.horizontal, -100, 100) + 100) / 200,
    y: (height - size) * (bounded(crop.vertical, -100, 100) + 100) / 200, size };
}

export function readLocalPhotoFile(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return Promise.reject(new Error('Please upload a local JPEG, PNG, or WebP image.'));
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_PHOTO_UPLOAD_BYTES) return Promise.reject(new Error('Choose an image of at most 10 MB.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

export function loadLocalCropImage(source: string): Promise<HTMLImageElement> {
  // Raw local uploads may exceed the stored 64 KB budget; crop output is checked separately.
  if (source.length > Math.ceil(MAX_PHOTO_UPLOAD_BYTES / 3) * 4 + 64) return Promise.reject(new Error('Choose an image of at most 10 MB.'));
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) return Promise.reject(new Error('Only local raster images can be cropped.'));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > MAX_PHOTO_PIXELS) {
        reject(new Error('Choose an image of at most 16 megapixels.'));
        return;
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error('Failed to decode image file.'));
    img.src = source;
  });
}

export function renderPhotoCrop(img: HTMLImageElement, crop: PhotoCrop, canvas = document.createElement('canvas')): string {
  canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Photo preview is unavailable.');
  const bounds = photoCropBounds(img.naturalWidth, img.naturalHeight, crop);
  // Flatten alpha against white and strip metadata by drawing a fresh JPEG raster.
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 256, 256);
  context.drawImage(img, bounds.x, bounds.y, bounds.size, bounds.size, 0, 0, 256, 256);
  const result = canvas.toDataURL('image/jpeg', 0.85);
  if (!isLocalPhoto(result)) throw new Error('Processed photo exceeds the 64 KB limit. Choose a simpler crop or another image.');
  return result;
}
