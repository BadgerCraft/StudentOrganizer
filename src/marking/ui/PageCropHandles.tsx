import { useRef } from 'react';
import { cropDisplayBounds, resizePageCrop, sameSurfaceRect, type CropCorner, type PageCrop, type SurfaceRect } from '../cropEditing';
import type { MarkingPageFeedback } from '../types';

const corners: CropCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export function PageCropHandles({ crop, rotation, disabled, onChange }: { crop: PageCrop; rotation: MarkingPageFeedback['rotation']; disabled: boolean; onChange: (crop: PageCrop) => void }) {
  const overlay = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; corner: CropCorner; rect: SurfaceRect; start: PageCrop } | null>(null);
  const visible = cropDisplayBounds(crop, rotation);
  function end(event: React.PointerEvent<HTMLButtonElement>, cancel = false) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (cancel) onChange(active.start);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div ref={overlay} className="absolute inset-0" data-testid="page-crop-overlay" style={{ pointerEvents: 'none' }}>
    <div className="absolute border-2 border-blue-700" style={{ left: `${visible.x * 100}%`, top: `${visible.y * 100}%`, width: `${visible.width * 100}%`, height: `${visible.height * 100}%`, boxShadow: '0 0 0 10000px rgba(15,23,42,.3)' }} />
    {corners.map(corner => {
      const x = visible.x + (corner.endsWith('right') ? visible.width : 0), y = visible.y + (corner.startsWith('bottom') ? visible.height : 0);
      return <button key={corner} type="button" aria-label={`Crop ${corner.replace('-', ' ')} corner`} data-testid={`crop-handle-${corner}`} disabled={disabled}
        className="absolute h-7 w-7 rounded-full border-2 border-white bg-blue-700 shadow outline-offset-2 focus:outline focus:outline-blue-700"
        style={{ left: `clamp(14px, ${x * 100}%, calc(100% - 14px))`, top: `clamp(14px, ${y * 100}%, calc(100% - 14px))`, transform: 'translate(-50%, -50%)', pointerEvents: 'auto', touchAction: 'none', cursor: corner === 'top-left' || corner === 'bottom-right' ? 'nwse-resize' : 'nesw-resize' }}
        onPointerDown={event => { if (disabled || !event.isPrimary || event.button !== 0 || drag.current || !overlay.current) return; event.preventDefault(); event.stopPropagation(); const rect = overlay.current.getBoundingClientRect(); drag.current = { pointerId: event.pointerId, corner, rect, start: crop }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { const active = drag.current; if (!active || active.pointerId !== event.pointerId || disabled) return; event.stopPropagation(); const rect = overlay.current?.getBoundingClientRect(); if (!rect || !rect.width || !rect.height) return; if (!sameSurfaceRect(active.rect, rect)) { end(event); return; } onChange(resizePageCrop(crop, rotation, active.corner, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height })); }}
        onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => { const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; const offset = offsets[event.key]; if (!offset || disabled) return; event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? .05 : .01; onChange(resizePageCrop(crop, rotation, corner, { x: x + offset[0] * step, y: y + offset[1] * step })); }} />;
    })}
  </div>;
}
