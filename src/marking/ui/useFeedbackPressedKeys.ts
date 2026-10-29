import { useEffect, useRef, type MutableRefObject } from 'react';

export type FeedbackPressedKeys = MutableRefObject<Set<string>>;

/**
 * Passive key lifecycle observation scoped to an open marking workspace. This
 * stores only currently pressed physical codes: no text, logging or persistence.
 * It never handles a shortcut or prevents normal browser/input behavior.
 */
export function useFeedbackPressedKeys(enabled = true): FeedbackPressedKeys {
  const pressed = useRef(new Set<string>());
  useEffect(() => {
    pressed.current.clear();
    if (!enabled) return;
    const down = (event: KeyboardEvent) => { pressed.current.add(event.code); };
    const up = (event: KeyboardEvent) => { pressed.current.delete(event.code); };
    const reset = () => { pressed.current.clear(); };
    window.addEventListener('keydown', down, { capture: true, passive: true });
    window.addEventListener('keyup', up, { capture: true, passive: true });
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      reset(); window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', reset);
    };
  }, [enabled]);
  return pressed;
}
