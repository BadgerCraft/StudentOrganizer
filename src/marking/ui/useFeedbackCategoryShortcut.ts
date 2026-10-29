import { CLASSROOM_LEVEL_LABELS } from '../../services/classroomLevels';
import type { KTAC } from '../types';

export type FeedbackKeyboardPhase = 'category' | 'level';
export type FeedbackKeyboardAction = { kind: 'category'; category: KTAC } | { kind: 'level'; digit: 1 | 2 | 3 | 4 } | { kind: 'step'; direction: 1 | -1 };
export type FeedbackKeyEvent = Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'isComposing' | 'repeat'>;

/** One gesture owns the keyboard until every observed key is released. No timers. */
export class FeedbackKeyboardGesture {
  private down = new Set<string>();
  private consumed = false;
  private poisoned = false;
  private shiftCandidate: string | null = null;

  reset() { this.down.clear(); this.consumed = false; this.poisoned = false; this.shiftCandidate = null; }

  /** Focus entry cannot reuse a key sequence that began in another control. */
  quarantine(keys: Iterable<string>) {
    this.reset();
    this.down = new Set(keys);
    this.poisoned = this.down.size > 0;
  }

  keyDown(event: FeedbackKeyEvent, phase: FeedbackKeyboardPhase): FeedbackKeyboardAction | null {
    const shift = event.code === 'ShiftLeft' || event.code === 'ShiftRight';
    if (event.repeat || this.down.has(event.code)) {
      // In particular, a repeated standalone Shift is never a decrement on release.
      this.shiftCandidate = null;
      this.down.add(event.code);
      this.poisoned = true;
      return null;
    }
    this.down.add(event.code);
    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) this.poisoned = true;
    if (this.consumed || this.poisoned) return null;
    if (shift && this.down.size === 1) { this.shiftCandidate = event.code; return null; }
    this.shiftCandidate = null;
    const digit = /^Digit([1-4])$/.exec(event.code);
    const onlyShift = this.down.size === 2 && (this.down.has('ShiftLeft') || this.down.has('ShiftRight'));
    if (digit && event.shiftKey && onlyShift) {
      this.consumed = true;
      const value = Number(digit[1]) as 1 | 2 | 3 | 4;
      return phase === 'category' ? { kind: 'category', category: (['K', 'T', 'C', 'A'] as const)[value - 1] } : { kind: 'level', digit: value };
    }
    if (event.code === 'Tab' && !event.shiftKey && this.down.size === 1 && phase === 'level') {
      this.consumed = true;
      return { kind: 'step', direction: 1 };
    }
    // Unknown keys, unobserved modifiers, reverse/partial chords and two Shifts
    // cannot become a new gesture merely by releasing some of their keys.
    this.poisoned = true;
    return null;
  }

  keyUp(event: FeedbackKeyEvent, phase: FeedbackKeyboardPhase): FeedbackKeyboardAction | null {
    const observed = this.down.delete(event.code);
    const decrement = observed && this.down.size === 0 && this.shiftCandidate === event.code && !this.consumed && !this.poisoned && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && !event.repeat && phase === 'level';
    if (this.down.size === 0) this.reset();
    return decrement ? { kind: 'step', direction: -1 } : null;
  }
}

/** User-confirmed: plain Level 4 starts at its existing lower subdivision. */
export function feedbackShortcutLevel(digit: 1 | 2 | 3 | 4): string {
  return (['1', '2', '3', '4(low)'] as const)[digit - 1];
}

/** Walk the immutable published scale, never percentages or rubric-label guesses. */
export function stepFeedbackLevel(current: string, direction: 1 | -1): string | null {
  const index = CLASSROOM_LEVEL_LABELS.indexOf(current);
  if (index < 0) return null;
  return CLASSROOM_LEVEL_LABELS[Math.min(CLASSROOM_LEVEL_LABELS.length - 1, Math.max(0, index + direction))];
}
