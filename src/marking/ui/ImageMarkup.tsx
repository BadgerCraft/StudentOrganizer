import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { LevelPicker } from '../../components/LevelPicker';
import { CLASSROOM_LEVEL_LABELS } from '../../services/classroomLevels';
import { CommentBankPicker } from './CommentBankPicker';
import { markingImageDecodeBytes } from '../importImages';
import { displayToOriginal, imageDisplaySize, originalToDisplay } from '../imageGeometry';
import { MARKING_LIMITS, type MarkingActor, type MarkingImagePage, type MarkingPageFeedback, type MarkingPoint, type MarkingRubric, type MarkingVisualAnnotation } from '../types';

export interface ImageMarkupProps {
  commentContainer?: HTMLElement | null;
  pages: MarkingImagePage[];
  feedback: MarkingPageFeedback[];
  onChange: (next: MarkingPageFeedback[]) => void;
  rubric: MarkingRubric;
  disabled: boolean;
  /** Reorders retained pages only; the original fields and bytes are never changed. */
  onReorder?: (pageIds: string[]) => void;
  actor?: MarkingActor;
  onComposerDirtyChange?: (dirty: boolean) => void;
}
const colors = { red: '#dc2626', blue: '#2563eb', yellow: '#facc15' };
const buttonClass = 'rounded border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50';

export function ImageMarkup({ commentContainer, pages: originalPages, feedback, onChange, rubric, disabled, onReorder, actor, onComposerDirtyChange }: ImageMarkupProps) {
  // Draft feedback owns the display order; retained attempt bytes keep their original order.
  const pages = feedback.map(item => originalPages.find(page => page.id === item.pageId)).filter((page): page is MarkingImagePage => Boolean(page));
  for (const page of originalPages) if (!pages.some(item => item.id === page.id)) pages.push(page);
  const [pageId, setPageId] = useState(pages[0]?.id ?? '');
  const [tool, setTool] = useState<MarkingVisualAnnotation['kind']>('pen');
  const [color, setColor] = useState<MarkingVisualAnnotation['color']>('red');
  const [selected, setSelected] = useState<string | null>(null);
  const [bankDirty, setBankDirty] = useState(false);
  const allowLeavingComment = () => {
    if (bankDirty && !window.confirm('Discard the unsaved comment bank import? Your recorded comment will be kept.')) return false;
    if (bankDirty) onComposerDirtyChange?.(false);
    setBankDirty(false); return true;
  };
  const selectMark = (id: string | null) => { if (id !== selected && allowLeavingComment()) setSelected(id); };
  const changeVisiblePage = (id: string) => { if (allowLeavingComment()) setPageId(id); };
  const [renderError, setRenderError] = useState('');
  const [previewKey, setPreviewKey] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const latest = useRef({ feedback, onChange, disabled });
  latest.current = { feedback, onChange, disabled };
  const stroke = useRef<{ id: string; pageId: string; pointerId: number; renderKey: string } | null>(null);
  const pageIndex = Math.max(0, pages.findIndex(page => page.id === pageId));
  const page = pages[pageIndex];
  const current = feedback.find(item => item.pageId === page?.id);
  const selectedAnnotation = current?.annotations.find(item => item.id === selected);
  const size = page && current ? imageDisplaySize(page, current) : { width: 1, height: 1 };
  const renderKey = page && current ? JSON.stringify([page.id, page.hash, page.mime, page.width, page.height, current.rotation, current.crop]) : '';
  const previewReady = Boolean(renderKey) && previewKey === renderKey;

  function endStroke() {
    const active = stroke.current;
    stroke.current = null;
    if (active && svgRef.current?.hasPointerCapture(active.pointerId)) svgRef.current.releasePointerCapture(active.pointerId);
  }
  useEffect(() => {
    // Keep the already recorded points; never extend a stroke after focus or geometry changes.
    const interrupt = () => endStroke();
    window.addEventListener('blur', interrupt);
    document.addEventListener('focusin', interrupt);
    document.addEventListener('scroll', interrupt, true);
    document.addEventListener('visibilitychange', interrupt);
    return () => {
      endStroke();
      window.removeEventListener('blur', interrupt);
      document.removeEventListener('focusin', interrupt);
      document.removeEventListener('scroll', interrupt, true);
      document.removeEventListener('visibilitychange', interrupt);
    };
  }, []);
  useEffect(() => { if (disabled) endStroke(); }, [disabled]);

  useEffect(() => { if (!pages.some(item => item.id === pageId)) setPageId(pages[0]?.id ?? ''); }, [pages, pageId]);
  useEffect(() => { setSelected(null); stroke.current = null; }, [page?.id]);
  useEffect(() => {
    if (!page || !current) return;
    const activeStroke = stroke.current;
    stroke.current = null;
    if (activeStroke && svgRef.current?.hasPointerCapture(activeStroke.pointerId)) svgRef.current.releasePointerCapture(activeStroke.pointerId);
    let cancelled = false;
    let disposable: ImageBitmap | null = null;
    let objectUrl = '';
    setRenderError('');
    const draw = (source: CanvasImageSource) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      // Keep the preview bounded; annotations remain in original coordinates regardless of canvas size.
      const ratio = Math.min(1, 1600 / Math.max(size.width, size.height));
      canvas.width = Math.max(1, Math.round(size.width * ratio)); canvas.height = Math.max(1, Math.round(size.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) { setRenderError('Image preview is unavailable in this browser.'); return; }
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.scale(canvas.width / size.width, canvas.height / size.height);
      if (current.rotation === 90) context.translate(size.width, 0);
      if (current.rotation === 180) context.translate(size.width, size.height);
      if (current.rotation === 270) context.translate(0, size.height);
      context.rotate(current.rotation * Math.PI / 180);
      context.drawImage(source, current.crop.x * page.width, current.crop.y * page.height, current.crop.width * page.width, current.crop.height * page.height, 0, 0, current.crop.width * page.width, current.crop.height * page.height);
      setPreviewKey(renderKey);
    };
    const render = async () => {
      try {
        const bytes = Uint8Array.from(atob(page.base64), character => character.charCodeAt(0));
        const blob = new Blob([new Uint8Array(markingImageDecodeBytes(bytes, page.mime))], { type: page.mime });
        if (typeof createImageBitmap === 'function') {
          disposable = await createImageBitmap(blob, { imageOrientation: 'none' });
          if (cancelled) { disposable.close(); return; }
          if (disposable.width !== page.width || disposable.height !== page.height) throw new Error('Image orientation does not match the retained original.');
          draw(disposable);
        } else {
          objectUrl = URL.createObjectURL(blob);
          const image = new Image();
          await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('The retained image cannot be decoded.')); image.src = objectUrl; });
          if (image.naturalWidth !== page.width || image.naturalHeight !== page.height) throw new Error('This browser cannot preserve the original image orientation.');
          draw(image);
        }
      } catch (error) { if (!cancelled) setRenderError(error instanceof Error ? error.message : 'Image preview is unavailable.'); }
    };
    void render();
    return () => { cancelled = true; disposable?.close(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [renderKey, page?.base64]);

  function changePage(targetPageId: string, change: (item: MarkingPageFeedback) => MarkingPageFeedback) {
    const state = latest.current;
    if (state.disabled) return;
    const next = state.feedback.map(item => item.pageId === targetPageId ? change(item) : item);
    // Keep partial strokes visible to draft autosave before pointer-up or unexpected app interruption.
    latest.current = { ...state, feedback: next };
    state.onChange(next);
  }
  function change(change: (item: MarkingPageFeedback) => MarkingPageFeedback) { if (page) changePage(page.id, change); }
  function pointFor(event: React.PointerEvent<SVGSVGElement>): MarkingPoint | null {
    if (!page) return null;
    const item = latest.current.feedback.find(item => item.pageId === page.id);
    const rect = svgRef.current?.getBoundingClientRect();
    if (!item || !rect || !rect.width || !rect.height) return null;
    const original = displayToOriginal({ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }, item);
    return { x: Math.max(0, Math.min(1, original.x)), y: Math.max(0, Math.min(1, original.y)) };
  }
  function pointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (disabled || !previewReady || renderError || !page || !current || (event.pointerType === 'mouse' && event.button !== 0) || stroke.current || current.annotations.length >= MARKING_LIMITS.visualAnnotations) return;
    const point = pointFor(event); if (!point) return;
    event.preventDefault();
    if (!allowLeavingComment()) return;
    const id = crypto.randomUUID();
    const annotation: MarkingVisualAnnotation = { id, kind: tool, points: [point], color: tool === 'highlight' ? 'yellow' : color, width: tool === 'highlight' ? 0.018 : 0.004, text: '', criterionId: null, level: '' };
    change(item => ({ ...item, annotations: [...item.annotations, annotation] }));
    if (tool === 'comment') setSelected(id);
    if (tool !== 'comment') {
      stroke.current = { id, pageId: page.id, pointerId: event.pointerId, renderKey };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const active = stroke.current;
    if (!active || active.pointerId !== event.pointerId || disabled) return;
    if (!previewReady || active.renderKey !== renderKey || (event.pointerType === 'mouse' && event.buttons !== 1)) { endStroke(); return; }
    const point = pointFor(event); if (!point) return;
    changePage(active.pageId, item => ({ ...item, annotations: item.annotations.map(annotation => {
      if (annotation.id !== active.id || annotation.points.length >= MARKING_LIMITS.strokePoints) return annotation;
      const last = annotation.points[annotation.points.length - 1];
      if (Math.abs(last.x - point.x) + Math.abs(last.y - point.y) < 0.0005) return annotation;
      return { ...annotation, points: [...annotation.points, point] };
    }) }));
  }
  function pointerEnd(event: React.PointerEvent<SVGSVGElement>) {
    if (stroke.current?.pointerId !== event.pointerId) return;
    // Movement events already persisted all valid points. Up/cancel coordinates may be stale.
    endStroke();
  }
  function editAnnotation(changes: Partial<MarkingVisualAnnotation>) {
    if (!selected) return;
    change(item => ({ ...item, annotations: item.annotations.map(annotation => annotation.id === selected ? { ...annotation, ...changes } : annotation) }));
  }
  function cropValue(key: keyof MarkingPageFeedback['crop'], value: string) {
    const number = Number(value) / 100;
    if (!Number.isFinite(number)) return;
    change(item => {
      const crop = { ...item.crop, [key]: number };
      if (crop.x < 0 || crop.y < 0 || crop.width < 0.01 || crop.height < 0.01 || crop.x + crop.width > 1 + 1e-9 || crop.y + crop.height > 1 + 1e-9) return item;
      return { ...item, crop };
    });
  }
  function reorder(offset: number) {
    const ids = pages.map(item => item.id), destination = pageIndex + offset;
    if (disabled || destination < 0 || destination >= ids.length) return;
    [ids[pageIndex], ids[destination]] = [ids[destination], ids[pageIndex]];
    if (onReorder) onReorder(ids);
  }

  if (!page || !current) return <p className="text-sm text-gray-600">Import local page images to add visual feedback.</p>;
  return <section aria-label="Image markup" data-testid="image-markup" className="image-markup-layout rounded border border-gray-300 bg-gray-50 p-3">
    <div className="image-work-pane space-y-3" data-testid="marking-image-work">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={buttonClass} disabled={pageIndex === 0} onClick={() => changeVisiblePage(pages[pageIndex - 1].id)}>Previous page</button>
      <span aria-live="polite">Page {pageIndex + 1} of {pages.length}: {page.name}</span>
      <button type="button" className={buttonClass} disabled={pageIndex === pages.length - 1} onClick={() => changeVisiblePage(pages[pageIndex + 1].id)}>Next page</button>
      {onReorder && <><button type="button" className={buttonClass} disabled={disabled || pageIndex === 0} onClick={() => reorder(-1)}>Move page earlier</button><button type="button" className={buttonClass} disabled={disabled || pageIndex === pages.length - 1} onClick={() => reorder(1)}>Move page later</button></>}
    </div>
    <p className="text-xs text-gray-600">Original image retained. Crop, rotation and feedback are saved separately. Cropped-out marks remain saved.</p>
    <div className="flex flex-wrap items-center gap-2" aria-label="Image tools">
      {(['pen', 'highlight', 'comment'] as const).map(value => <button key={value} type="button" className={buttonClass} aria-pressed={tool === value} disabled={disabled} onClick={() => { if (value === 'comment' && selectedAnnotation) { if (!allowLeavingComment()) return; setSelected(null); } setTool(value); }}>{value === 'pen' ? 'Pen' : value === 'highlight' ? 'Highlight' : 'Write a comment'}</button>)}
      <label className="text-sm">Ink <select aria-label="Ink color" className="rounded border p-2" disabled={disabled || tool === 'highlight'} value={color} onChange={event => setColor(event.target.value as typeof color)}><option value="red">Red</option><option value="blue">Blue</option><option value="yellow">Yellow</option></select></label>
      <button type="button" className={buttonClass} disabled={disabled || !current.annotations.length} onClick={() => { if (!allowLeavingComment()) return; change(item => ({ ...item, annotations: item.annotations.slice(0, -1) })); setSelected(null); }}>Undo last mark</button>
      <button type="button" className={buttonClass} disabled={disabled} onClick={() => change(item => ({ ...item, rotation: ((item.rotation + 90) % 360) as MarkingPageFeedback['rotation'] }))}>Rotate clockwise</button>
      <span className="text-sm">Rotation {current.rotation}°</span>
    </div>
    {tool === 'comment' && <p role="status" className="text-sm font-medium">Click the page where you want to place your comment, then write it below.</p>}
    <fieldset disabled={disabled} className="flex flex-wrap items-center gap-2"><legend className="text-sm">Crop original page (%)</legend>
      {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key} className="text-sm">{key === 'x' ? 'Left' : key === 'y' ? 'Top' : key === 'width' ? 'Width' : 'Height'} <input aria-label={`Crop ${key}`} className="w-20 rounded border p-2" type="number" min={key === 'width' || key === 'height' ? 1 : 0} max="100" step="1" value={Math.round(current.crop[key] * 10000) / 100} onChange={event => cropValue(key, event.target.value)} /></label>)}
      <button type="button" className={buttonClass} onClick={() => change(item => ({ ...item, crop: { x: 0, y: 0, width: 1, height: 1 } }))}>Reset crop</button>
    </fieldset>
    {renderError && <p role="alert" className="text-red-700">{renderError}</p>}
    <div className="relative mx-auto w-full overflow-hidden rounded border bg-white" style={{ maxWidth: 900, aspectRatio: `${size.width} / ${size.height}` }}>
      <canvas ref={canvasRef} aria-label={`Original image preview: ${page.name}`} className="absolute inset-0 h-full w-full" style={{ visibility: previewReady ? 'visible' : 'hidden' }} />
      {!previewReady && !renderError && <p role="status" className="absolute inset-0 flex items-center justify-center text-sm text-gray-600">Loading original image…</p>}
      <svg ref={svgRef} aria-label="Page annotation surface" data-testid="image-annotation-surface" className="absolute inset-0 h-full w-full" style={{ visibility: previewReady ? 'visible' : 'hidden', touchAction: disabled ? 'auto' : 'none', cursor: disabled ? 'default' : 'crosshair' }} viewBox={`0 0 ${size.width} ${size.height}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={() => { stroke.current = null; }}>
        {current.annotations.map(annotation => {
          const points = annotation.points.map(point => { const p = originalToDisplay(point, current); return { x: p.x * size.width, y: p.y * size.height }; });
          const first = points[0]; if (!first) return null;
          const thickness = annotation.width * Math.min(page.width, page.height);
          if (annotation.kind === 'comment') return <g key={annotation.id} onPointerDown={event => { event.stopPropagation(); selectMark(annotation.id); }} style={{ cursor: 'pointer' }}><circle cx={first.x} cy={first.y} r={Math.max(8, Math.min(page.width, page.height) * 0.014)} fill={colors[annotation.color]} /><text x={first.x + Math.max(10, page.width * 0.012)} y={first.y} fill={colors[annotation.color]} stroke="white" strokeWidth={1} paintOrder="stroke" fontSize={Math.max(14, Math.min(page.width, page.height) * 0.024)}>{selectedAnnotation && selectedAnnotation.id !== annotation.id ? 'Comment' : annotation.text || 'Comment'}</text></g>;
          const path = points.length === 1 ? `M ${first.x} ${first.y} l 0.01 0` : points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
          return <path key={annotation.id} d={path} stroke={colors[annotation.color]} strokeWidth={thickness} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={annotation.kind === 'highlight' ? 0.4 : 1} pointerEvents="none" />;
        })}
      </svg>
    </div>
    </div>
    {renderComments()}
  </section>;

  function renderComments() {
    if (!current) return null;
    const content = <div className="image-comment-pane space-y-3" data-testid="marking-image-comments">
    {current.annotations.length >= MARKING_LIMITS.visualAnnotations && <p role="status">This page has reached its 500-mark limit. Delete a mark to add another.</p>}
    {!selectedAnnotation && <p className="text-sm">Choose Write a comment and click the page, or select a saved mark. Your page stays in place while you write.</p>}
    {!selectedAnnotation && <div className="flex flex-wrap items-center gap-2"><label className="text-sm">Saved marks <select aria-label="Select saved mark" value={selected ?? ''} className="rounded border p-2" onChange={event => selectMark(event.target.value || null)}><option value="">Select a mark</option>{current.annotations.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.kind}{item.text ? `: ${item.text.slice(0, 40)}` : ''}</option>)}</select></label>
    </div>}
    {selectedAnnotation && <fieldset key={selectedAnnotation.id} disabled={disabled} className="space-y-2 rounded border bg-white p-3"><legend className="text-sm font-semibold">Write a comment for this mark</legend>
      <label className="block text-sm">Comment text <textarea aria-label="Image comment text" className="mt-1 w-full rounded border p-2" maxLength={4000} value={selectedAnnotation.text} onChange={event => editAnnotation({ text: event.target.value })} /></label>
      <div className="flex flex-wrap gap-2"><label className="text-sm">Criterion <select aria-label="Image criterion" className="rounded border p-2" value={selectedAnnotation.criterionId ?? ''} onChange={event => editAnnotation({ criterionId: event.target.value || null, level: '' })}><option value="">General feedback</option>{rubric.criteria.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
      {actor && <CommentBankPicker actor={actor} disabled={disabled} onDirtyChange={dirty => { setBankDirty(dirty); onComposerDirtyChange?.(dirty); }} onSelect={text => {
        const combined = `${selectedAnnotation.text}${selectedAnnotation.text ? '\n' : ''}${text}`;
        if (combined.length > 4000) throw new Error('This bank comment exceeds the 4,000-character limit. Shorten the current comment or choose a shorter bank comment.');
        editAnnotation({ text: combined });
      }} />}
      <p className="text-sm">Selected level: {selectedAnnotation.level || 'Not selected'}</p>
      <LevelPicker label="Evidence level (optional)" value={selectedAnnotation.level} disabled={disabled || !selectedAnnotation.criterionId} onChange={level => editAnnotation({ level })} />
      {!selectedAnnotation.criterionId && <p className="text-xs text-gray-600">Choose a criterion to attach an evidence level.</p>}
      {rubric.levels.some(level => !CLASSROOM_LEVEL_LABELS.includes(level)) && <details className="text-sm"><summary>Other rubric labels</summary><select aria-label="Image level" className="rounded border p-2" disabled={disabled || !selectedAnnotation.criterionId} value={CLASSROOM_LEVEL_LABELS.includes(selectedAnnotation.level) ? '' : selectedAnnotation.level} onChange={event => { if (event.target.value) editAnnotation({ level: event.target.value }); }}><option value="">Choose a saved rubric label</option>{rubric.levels.filter(level => !CLASSROOM_LEVEL_LABELS.includes(level)).map(level => <option key={level} value={level}>{level}</option>)}</select></details>}
      {selectedAnnotation.level && <button type="button" className={buttonClass} disabled={disabled} onClick={() => editAnnotation({ level: '' })}>Clear evidence level</button>}
      <div className="flex gap-2">
        <button type="button" className={buttonClass} disabled={disabled} onClick={() => { if (!allowLeavingComment()) return; change(item => ({ ...item, annotations: item.annotations.filter(annotation => annotation.id !== selected) })); setSelected(null); }}>Delete selected mark</button>
      </div>
    </fieldset>}
    {selectedAnnotation && <button type="button" className={`${buttonClass} font-semibold`} onClick={() => selectMark(null)}>Done — review image</button>}
    </div>;
    return commentContainer ? createPortal(content, commentContainer) : content;
  }
}
