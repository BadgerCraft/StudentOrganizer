import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_PHOTO_CROP, loadLocalCropImage, renderPhotoCrop, type PhotoCrop } from '../utils/photoCrop';

export function PhotoCropEditor({ source, onApply, onCancel }: { source: string; onApply: (photo: string) => void; onCancel: () => void }) {
  const [crop, setCrop] = useState<PhotoCrop>({ ...DEFAULT_PHOTO_CROP });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    setImg(null); setPreview(null); setCrop({ ...DEFAULT_PHOTO_CROP }); setError(null);
    loadLocalCropImage(source).then(image => { if (!cancelled) setImg(image); }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [source]);
  useEffect(() => {
    if (!img || !canvas.current) return;
    try { setPreview(renderPhotoCrop(img, crop, canvas.current)); setError(null); }
    catch (err) { setPreview(null); setError(err instanceof Error ? err.message : 'Failed to crop photo.'); }
  }, [img, crop]);
  return <div data-testid="photo-crop-editor" className="space-y-3 p-4 border border-blue-200 rounded-xl bg-blue-50">
    <h4 className="font-bold text-sm text-blue-900">Crop and position photo</h4>
    <p className="text-xs text-slate-600">Preview the square photo. Apply keeps it in this draft; Save Changes stores it on this device.</p>
    <canvas ref={canvas} role="img" aria-label="Cropped student photo preview" className="w-48 h-48 mx-auto rounded-xl bg-white" />
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {([
      ['zoom', 'Zoom', 1, 4, 0.05], ['horizontal', 'Horizontal position', -100, 100, 1], ['vertical', 'Vertical position', -100, 100, 1]
    ] as const).map(([key, label, min, max, step]) => <label key={key} className="block text-xs text-slate-700">
      {label}<input aria-label={label} data-testid={`photo-crop-${key}`} type="range" min={min} max={max} step={step} value={crop[key]}
        onChange={event => setCrop(current => ({ ...current, [key]: Number(event.target.value) }))} className="block w-full" />
    </label>)}
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancel} data-testid="cancel-photo-crop-btn" className="px-3 py-2 text-xs rounded-lg bg-white">Cancel Crop</button>
      <button type="button" disabled={!preview} onClick={() => preview && onApply(preview)} data-testid="apply-photo-crop-btn" className="px-3 py-2 text-xs font-bold rounded-lg text-white bg-blue-600 disabled:opacity-50">Apply Crop</button>
    </div>
  </div>;
}
