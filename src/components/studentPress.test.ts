import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeStudentPress, registerStudentPress, studentPressAt } from './studentPress';

const event = (type: string, fields: Record<string, unknown> = {}) => {
  const value = new Event(type, { cancelable: true });
  Object.assign(value, fields); return value;
};
let doc: EventTarget & { elementsFromPoint: () => any[]; elementFromPoint: () => unknown };
let win: EventTarget;
beforeEach(() => {
  doc = Object.assign(new EventTarget(), { elementsFromPoint: () => [] as any[], elementFromPoint: () => null as unknown });
  win = new EventTarget(); vi.stubGlobal('document', doc); vi.stubGlobal('window', win);
});
afterEach(() => { doc.dispatchEvent(event('pointercancel', { pointerId: 1 })); vi.unstubAllGlobals(); });

describe('explicit student press ownership', () => {
  it('resolves the registered child action and refuses an unregistered nested control', () => {
    const backdrop = { contains: (hit: unknown) => hit === backdrop } as unknown as HTMLElement;
    const card = { contains: () => false, matches: () => false, closest: (selector: string) => selector === '[inert]' ? null : card } as unknown as HTMLElement;
    const child = { contains: () => false, matches: () => false, closest: (selector: string) => selector === '[inert]' ? null : child } as unknown as HTMLElement;
    const select = vi.fn(), profile = vi.fn(); registerStudentPress(card, select); registerStudentPress(child, profile);
    doc.elementsFromPoint = () => [backdrop, child, card];
    expect(studentPressAt(10, 10, backdrop)?.action).toBe(profile);
    child.matches = () => true;
    expect(studentPressAt(10, 10, backdrop)).toBeNull();
    child.matches = () => false;
    registerStudentPress(child, null);
    expect(studentPressAt(10, 10, backdrop)).toBeNull();
  });
  it('consumes residual pointer click but leaves native keyboard click available', () => {
    const undo = vi.fn(); const card = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 40, bottom: 40 }), contains: () => true } as unknown as HTMLElement;
    consumeStudentPress({ pointerId: 1, clientX: 10, clientY: 10 }, card, undo);
    const keyboard = event('click', { detail: 0 }); doc.dispatchEvent(keyboard); expect(keyboard.defaultPrevented).toBe(false);
    const up = event('pointerup', { pointerId: 1, clientX: 10, clientY: 10 }); doc.dispatchEvent(up); expect(up.defaultPrevented).toBe(true);
    doc.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 50, clientY: 50 }));
    expect(undo).not.toHaveBeenCalled();
    const click = event('click', { detail: 1 }); doc.dispatchEvent(click); expect(click.defaultPrevented).toBe(true);
    doc.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 90, clientY: 90 }));
    expect(undo).not.toHaveBeenCalled();
    const later = event('click', { detail: 1 }); doc.dispatchEvent(later); expect(later.defaultPrevented).toBe(false);
  });
  it('reverses selection on drag or cancellation exactly once, ignoring other pointers', () => {
    const undo = vi.fn(); consumeStudentPress({ pointerId: 1, clientX: 10, clientY: 10 }, undefined, undo, true);
    doc.dispatchEvent(event('pointercancel', { pointerId: 2 })); expect(undo).not.toHaveBeenCalled();
    doc.dispatchEvent(event('pointerdown', { pointerId: 2, isPrimary: false }));
    doc.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 30, clientY: 10 }));
    doc.dispatchEvent(event('pointercancel', { pointerId: 1 })); expect(undo).toHaveBeenCalledTimes(1);
  });
  it('keeps a completed press when a newly opened dock covers the original card', () => {
    const undo = vi.fn();
    let bounds = { left: 0, top: 0, right: 40, bottom: 40 };
    const card = { getBoundingClientRect: () => ({ ...bounds }), contains: () => false } as unknown as HTMLElement;
    consumeStudentPress({ pointerId: 1, clientX: 10, clientY: 10 }, card, undo);
    // Own UI now covers the card, and can even change its live position.
    doc.elementFromPoint = () => ({ kind: 'participation dock' });
    bounds = { left: 100, top: 100, right: 140, bottom: 140 };
    doc.dispatchEvent(event('pointerup', { pointerId: 1, clientX: 10, clientY: 10 }));
    doc.dispatchEvent(event('click', { detail: 1 }));
    expect(undo).not.toHaveBeenCalled();
  });
  it('preserves native drag initiation while cancelling selection after outside release', () => {
    const undo = vi.fn(); const card = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 40, bottom: 40 }), contains: () => false } as unknown as HTMLElement;
    consumeStudentPress({ pointerId: 1, clientX: 10, clientY: 10 }, card, undo, true);
    const down = event('mousedown'); doc.dispatchEvent(down); expect(down.defaultPrevented).toBe(false);
    doc.dispatchEvent(event('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })); expect(undo).toHaveBeenCalledOnce();
  });
});
