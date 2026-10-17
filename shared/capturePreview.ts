import { markingImageDecodeBytes } from '../src/marking/importImages';
import type { CaptureEdits } from './capturePackage';
/** Both phone and desktop crop original pixel axes first, then rotate clockwise. */
export async function drawCapturePreview(canvas: HTMLCanvasElement, bytes: Uint8Array, mime: 'image/png'|'image/jpeg', edits: CaptureEdits): Promise<void> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(markingImageDecodeBytes(bytes,mime))], { type: mime }));
  try {
    const c = edits.crop, w = bitmap.width*c.width, h = bitmap.height*c.height;
    const swap = edits.rotation === 90 || edits.rotation === 270;
    const scale = Math.min(1,1200/Math.max(w,h));
    canvas.width = Math.max(1,Math.round((swap?h:w)*scale)); canvas.height = Math.max(1,Math.round((swap?w:h)*scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Photo preview unavailable.');
    ctx.translate(canvas.width/2,canvas.height/2); ctx.rotate(edits.rotation*Math.PI/180);
    ctx.drawImage(bitmap,c.x*bitmap.width,c.y*bitmap.height,w,h,-w*scale/2,-h*scale/2,w*scale,h*scale);
  } finally { bitmap.close(); }
}
