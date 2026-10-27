import { useEffect } from 'react';
import type { KTAC, MarkingRubric } from '../types';

/** Standard Tab navigation is untouched; this binding only belongs to an open editor. */
export function feedbackShortcutCategory(event: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'isComposing' | 'repeat'>, editable: boolean): KTAC | null {
  if (editable || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.repeat) return null;
  return ({ Digit1: 'K', Digit2: 'T', Digit3: 'C', Digit4: 'A' } as Record<string, KTAC>)[event.code] ?? null;
}

export function useFeedbackCategoryShortcut(active: boolean, rubric: MarkingRubric | undefined, onSelect: (category: KTAC) => void) {
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      const target = event.target;
      const editable = target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"]'));
      const category = feedbackShortcutCategory(event, editable);
      if (!category || !rubric?.criteria.some(item => item.categoryCode === category)) return;
      event.preventDefault();
      onSelect(category);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [active, rubric, onSelect]);
}
