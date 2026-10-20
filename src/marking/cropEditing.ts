import { displayToOriginal, originalToDisplay } from './imageGeometry';
import type { MarkingPageFeedback, MarkingPoint } from './types';

export type PageCrop = MarkingPageFeedback['crop'];
export type CropCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const FULL_PAGE_CROP: PageCrop = { x: 0, y: 0, width: 1, height: 1 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const fullView = (rotation: MarkingPageFeedback['rotation']) => ({ crop: FULL_PAGE_CROP, rotation });
function bounds(points: MarkingPoint[]): PageCrop {
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y };
}
/** The handles use the rotated full-page view; only unrotated original coordinates are persisted. */
export function cropDisplayBounds(crop: PageCrop, rotation: MarkingPageFeedback['rotation']): PageCrop {
  return bounds([{ x: crop.x, y: crop.y }, { x: crop.x + crop.width, y: crop.y }, { x: crop.x, y: crop.y + crop.height }, { x: crop.x + crop.width, y: crop.y + crop.height }].map(point => originalToDisplay(point, fullView(rotation))));
}
export function resizePageCrop(crop: PageCrop, rotation: MarkingPageFeedback['rotation'], corner: CropCorner, point: MarkingPoint): PageCrop {
  const visible = cropDisplayBounds(crop, rotation);
  let left = visible.x, right = visible.x + visible.width, top = visible.y, bottom = visible.y + visible.height;
  if (corner.endsWith('left')) left = clamp(point.x, 0, right - .01); else right = clamp(point.x, left + .01, 1);
  if (corner.startsWith('top')) top = clamp(point.y, 0, bottom - .01); else bottom = clamp(point.y, top + .01, 1);
  const result = bounds([{ x: left, y: top }, { x: right, y: bottom }].map(point => displayToOriginal(point, fullView(rotation))));
  // Remove harmless floating-point overshoot while keeping stored anchors untouched.
  const x = clamp(result.x, 0, .99), y = clamp(result.y, 0, .99);
  return { x, y, width: clamp(result.width, .01, 1 - x), height: clamp(result.height, .01, 1 - y) };
}
/** A left/top edit trims the edge instead of rejecting the user's first edit at a full crop. */
export function setPageCropValue(crop: PageCrop, key: keyof PageCrop, value: number): PageCrop {
  if (!Number.isFinite(value)) return crop;
  if (key === 'x') { const x = clamp(value, 0, .99); return { ...crop, x, width: Math.min(crop.width, 1 - x) }; }
  if (key === 'y') { const y = clamp(value, 0, .99); return { ...crop, y, height: Math.min(crop.height, 1 - y) }; }
  return { ...crop, [key]: clamp(value, .01, 1 - crop[key === 'width' ? 'x' : 'y']) };
}
export interface SurfaceRect { left: number; top: number; width: number; height: number }
export function sameSurfaceRect(a: SurfaceRect, b: SurfaceRect): boolean {
  return ['left', 'top', 'width', 'height'].every(key => Math.abs(a[key as keyof SurfaceRect] - b[key as keyof SurfaceRect]) < .25);
}
