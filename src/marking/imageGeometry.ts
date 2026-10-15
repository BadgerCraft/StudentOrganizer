import type { MarkingImagePage, MarkingPageFeedback, MarkingPoint } from './types';

/** All stored anchors remain normalized against the unchanged original image. */
export function originalToDisplay(point: MarkingPoint, feedback: Pick<MarkingPageFeedback, 'crop' | 'rotation'>): MarkingPoint {
  const u = (point.x - feedback.crop.x) / feedback.crop.width;
  const v = (point.y - feedback.crop.y) / feedback.crop.height;
  switch (feedback.rotation) {
    case 90: return { x: 1 - v, y: u };
    case 180: return { x: 1 - u, y: 1 - v };
    case 270: return { x: v, y: 1 - u };
    default: return { x: u, y: v };
  }
}

/** Inverse of originalToDisplay; independent of render size and repeated rotations. */
export function displayToOriginal(point: MarkingPoint, feedback: Pick<MarkingPageFeedback, 'crop' | 'rotation'>): MarkingPoint {
  let u: number, v: number;
  switch (feedback.rotation) {
    case 90: u = point.y; v = 1 - point.x; break;
    case 180: u = 1 - point.x; v = 1 - point.y; break;
    case 270: u = 1 - point.y; v = point.x; break;
    default: u = point.x; v = point.y;
  }
  return { x: feedback.crop.x + u * feedback.crop.width, y: feedback.crop.y + v * feedback.crop.height };
}

export function imageDisplaySize(page: Pick<MarkingImagePage, 'width' | 'height'>, feedback: Pick<MarkingPageFeedback, 'crop' | 'rotation'>): { width: number; height: number } {
  const width = page.width * feedback.crop.width;
  const height = page.height * feedback.crop.height;
  return feedback.rotation === 90 || feedback.rotation === 270 ? { width: height, height: width } : { width, height };
}

export function isWithinCrop(point: MarkingPoint, crop: MarkingPageFeedback['crop']): boolean {
  return point.x >= crop.x && point.y >= crop.y && point.x <= crop.x + crop.width && point.y <= crop.y + crop.height;
}
