import { useEffect, useId, useRef, useState } from 'react';
import { useFeedbackPressedKeys, type FeedbackPressedKeys } from './useFeedbackPressedKeys';
import type { KTAC } from '../types';
import { FeedbackKeyboardGesture, feedbackShortcutLevel, stepFeedbackLevel, type FeedbackKeyboardAction, type FeedbackKeyboardPhase } from './useFeedbackCategoryShortcut';

interface Props {
  categories: readonly KTAC[];
  pressedKeys?: FeedbackPressedKeys;
  category: KTAC | undefined;
  level: string;
  disabled?: boolean;
  onCategory: (category: KTAC) => void;
  onLevel: (level: string) => void;
}

/** Deliberately focused control: no window/document keyboard shortcut listener. */
export function FeedbackKeyboardControl({ categories, category, level, disabled = false, onCategory, onLevel, pressedKeys }: Props) {
  const [phase, setPhase] = useState<FeedbackKeyboardPhase>('category');
  const [focused, setFocused] = useState(false);
  const gesture = useRef(new FeedbackKeyboardGesture());
  const localPressed = useFeedbackPressedKeys(!pressedKeys && !disabled);
  const pressed = pressedKeys ?? localPressed;
  const control = useRef<HTMLDivElement>(null), exit = useRef<HTMLButtonElement>(null);
  const hint = useId();
  useEffect(() => {
    gesture.current.reset();
    if (disabled) { setFocused(false); setPhase('category'); return; }
    const reset = () => { gesture.current.reset(); setFocused(false); };
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      reset();
      window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', reset);
    };
  }, [disabled]);
  function enter() { gesture.current.quarantine(pressed.current); setFocused(true); }
  function apply(action: FeedbackKeyboardAction | null) {
    if (!action) return;
    if (action.kind === 'category') {
      if (!categories.includes(action.category)) return;
      onCategory(action.category); setPhase('level');
    } else if (action.kind === 'level') {
      onLevel(feedbackShortcutLevel(action.digit));
    } else {
      const next = stepFeedbackLevel(level, action.direction);
      if (next !== null) onLevel(next);
    }
  }
  return <section className="rounded-lg border-2 border-slate-400 bg-slate-50 p-2 text-slate-900 space-y-1" aria-label="Feedback keyboard shortcuts">
    <div ref={control} tabIndex={disabled ? -1 : 0} role="group" aria-label="Feedback keyboard control" aria-describedby={hint} aria-disabled={disabled} data-testid="feedback-keyboard-control" data-phase={phase}
      className="rounded border-2 border-slate-500 p-2 outline-offset-2 focus:outline focus:outline-2 focus:outline-blue-700 cursor-pointer"
      onClick={() => { if (!disabled) control.current?.focus(); }}
      onFocus={enter} onBlur={() => { gesture.current.reset(); setFocused(false); }}
      onKeyDown={event => {
        if (disabled || event.target !== event.currentTarget || document.activeElement !== event.currentTarget) return;
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) { gesture.current.reset(); event.preventDefault(); exit.current?.focus(); return; }
        const action = gesture.current.keyDown(event.nativeEvent, phase);
        if (action || (phase === 'level' && event.code === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.nativeEvent.isComposing)) event.preventDefault();
        apply(action);
      }}
      onKeyUp={event => { if (!disabled && event.target === event.currentTarget && document.activeElement === event.currentTarget) apply(gesture.current.keyUp(event.nativeEvent, phase)); }}>
      <strong>{phase === 'category' ? '1. Choose category' : '2. Choose evidence level'}</strong>
      <p aria-live="polite">{category || 'No category'} · {level || 'No evidence level'}{focused ? ' · Keyboard active here' : ' · Focus here to use shortcuts'}</p>
    </div>
    <p id={hint} className="text-xs">{phase === 'category' ? 'Shift+1 K · Shift+2 T · Shift+3 C · Shift+4 A.' : `Shift+1: 1 · Shift+2: 2 · Shift+3: 3 · Shift+4: 4(low). Tab +1 step · Shift alone −1 on release.${level ? '' : ' Choose a level first.'}`} Release all keys between actions. Esc exits · Shift+Tab back. Does not save.</p>
    <div className="flex flex-wrap gap-2"><button type="button" aria-label="Choose category with keyboard" className="rounded border border-slate-500 px-2 py-1" disabled={disabled} onClick={() => { enter(); setPhase('category'); control.current?.focus(); }}>Choose category</button><button type="button" ref={exit} className="rounded border border-slate-500 px-2 py-1" disabled={disabled} onClick={() => exit.current?.focus()}>Leave keyboard grading</button></div>
  </section>;
}
