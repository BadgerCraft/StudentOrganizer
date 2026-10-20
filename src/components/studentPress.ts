/** Explicit student intents, never synthetic clicks through a dismissed backdrop. */
export type StudentPressAction = () => void | (() => void);
const actions = new WeakMap<HTMLElement, StudentPressAction>();
export function registerStudentPress(element: HTMLElement | null, action: StudentPressAction | null) {
  if (element) { if (action) actions.set(element, action); else actions.delete(element); }
}

export function studentPressAt(x: number, y: number, backdrop: HTMLElement): { element: HTMLElement; action: StudentPressAction } | null {
  for (const hit of document.elementsFromPoint(x, y)) {
    if (backdrop.contains(hit) || hit.contains(backdrop)) continue;
    const interactive = hit.closest<HTMLElement>('button, input, select, textarea, a, [role="button"]');
    // An attendance or other nested control is not an invitation to select its card.
    if (interactive) {
      if (interactive.matches(':disabled,[aria-disabled="true"]') || interactive.closest('[inert]')) return null;
      const action = actions.get(interactive);
      return action ? { element: interactive, action } : null;
    }
  }
  return null;
}

let finishPrevious: (() => void) | undefined;
/** Consume this pointer sequence even if React removes the original target on press.
 * Reversible selection is rolled back on drag, outside release, cancel or blur.
 * Native keyboard click (detail=0) is intentionally unaffected. */
export function consumeStudentPress(event: { pointerId: number; clientX: number; clientY: number }, element?: HTMLElement, undo?: void | (() => void), allowNativeDrag = false) {
  finishPrevious?.();
  const capture = { capture: true };
  const pressBounds = element?.getBoundingClientRect();
  let reverted = false, released = false;
  const revert = () => { if (!reverted) { reverted = true; undo?.(); } };
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const cleanup = () => {
    document.removeEventListener('pointermove', move, capture);
    document.removeEventListener('pointerup', up, capture);
    document.removeEventListener('pointercancel', cancel, capture);
    document.removeEventListener('mousedown', stop, capture);
    document.removeEventListener('mouseup', stop, capture);
    document.removeEventListener('click', click, capture);
    document.removeEventListener('pointerdown', next, capture);
    window.removeEventListener('blur', cancel);
    finishPrevious = undefined;
  };
  const move = (e: PointerEvent) => {
    if (!released && e.pointerId === event.pointerId && Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) > 6) revert();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId || released) return;
    // Opening the participation dock may cover the card after a valid press.
    // Cancellation follows the original geometry, never whatever is now on top.
    if (pressBounds && (e.clientX < pressBounds.left || e.clientX > pressBounds.right || e.clientY < pressBounds.top || e.clientY > pressBounds.bottom)) revert();
    released = true;
    stop(e);
  };
  const cancel = (e?: Event) => {
    if (e && 'pointerId' in e && (e as PointerEvent).pointerId !== event.pointerId) return;
    if (!released) revert();
    cleanup();
  };
  const click = (e: MouseEvent) => { if (e.detail !== 0) { stop(e); cleanup(); } };
  const next = (e: PointerEvent) => { if (e.isPrimary) { if (!released) revert(); cleanup(); } };
  document.addEventListener('pointermove', move, capture);
  document.addEventListener('pointerup', up, capture);
  document.addEventListener('pointercancel', cancel, capture);
  if (!allowNativeDrag) document.addEventListener('mousedown', stop, capture);
  document.addEventListener('mouseup', stop, capture);
  document.addEventListener('click', click, capture);
  document.addEventListener('pointerdown', next, capture);
  window.addEventListener('blur', cancel);
  finishPrevious = cleanup;
}
