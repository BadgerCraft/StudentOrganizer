import { describe, expect, it } from 'vitest';
import { CLASSROOM_LEVEL_LABELS } from '../../services/classroomLevels';
import { FeedbackKeyboardGesture, feedbackShortcutLevel, stepFeedbackLevel, type FeedbackKeyEvent } from './useFeedbackCategoryShortcut';

const key = (code: string, patch: Partial<FeedbackKeyEvent> = {}): FeedbackKeyEvent => ({ code, shiftKey: code.startsWith('Shift'), ctrlKey: false, altKey: false, metaKey: false, isComposing: false, repeat: false, ...patch });
const up = (code: string, patch: Partial<FeedbackKeyEvent> = {}) => key(code, { shiftKey: false, ...patch });

describe('feedback keyboard release guard', () => {
  it('selects each category then reuses the chord for a level only after complete release', () => {
    for (const [index, category] of ['K', 'T', 'C', 'A'].entries()) {
      const machine = new FeedbackKeyboardGesture();
      expect(machine.keyDown(key('ShiftLeft'), 'category')).toBeNull();
      expect(machine.keyDown(key(`Digit${index + 1}`, { shiftKey: true }), 'category')).toEqual({ kind: 'category', category });
      expect(machine.keyUp(up(`Digit${index + 1}`, { shiftKey: true }), 'level')).toBeNull();
      expect(machine.keyDown(key('Digit3', { shiftKey: true }), 'level')).toBeNull();
      expect(machine.keyUp(up('Digit3', { shiftKey: true }), 'level')).toBeNull();
      expect(machine.keyUp(up('ShiftLeft'), 'level')).toBeNull();
      machine.keyDown(key('ShiftRight'), 'level');
      expect(machine.keyDown(key(`Digit${index + 1}`, { shiftKey: true }), 'level')).toEqual({ kind: 'level', digit: index + 1 });
      machine.keyUp(up('ShiftRight'), 'level');
      expect(machine.keyUp(up(`Digit${index + 1}`), 'level')).toBeNull();
    }
  });
  it('decrements only a standalone Shift release, never Shift down or the category-phase release', () => {
    for (const code of ['ShiftLeft', 'ShiftRight']) {
      const machine = new FeedbackKeyboardGesture();
      expect(machine.keyDown(key(code), 'level')).toBeNull();
      expect(machine.keyUp(up(code), 'level')).toEqual({ kind: 'step', direction: -1 });
      machine.keyDown(key(code), 'category');
      expect(machine.keyUp(up(code), 'category')).toBeNull();
    }
  });
  it('increments once per unmodified Tab and requires every key up before another action', () => {
    const machine = new FeedbackKeyboardGesture();
    expect(machine.keyDown(key('Tab'), 'level')).toEqual({ kind: 'step', direction: 1 });
    expect(machine.keyDown(key('Tab', { repeat: true }), 'level')).toBeNull();
    machine.keyDown(key('ShiftLeft'), 'level');
    expect(machine.keyUp(up('Tab', { shiftKey: true }), 'level')).toBeNull();
    expect(machine.keyDown(key('Digit3', { shiftKey: true }), 'level')).toBeNull();
    machine.keyUp(up('Digit3', { shiftKey: true }), 'level');
    expect(machine.keyUp(up('ShiftLeft'), 'level')).toBeNull();
    expect(machine.keyDown(key('Tab'), 'level')).toEqual({ kind: 'step', direction: 1 });
  });
  it('does not turn Shift+Tab, two Shifts, unknown keys or partial chords into decrements', () => {
    for (const extra of ['Tab', 'KeyX', 'ShiftRight', 'Digit5', 'ArrowLeft']) {
      const machine = new FeedbackKeyboardGesture();
      machine.keyDown(key('ShiftLeft'), 'level');
      expect(machine.keyDown(key(extra, { shiftKey: true }), 'level')).toBeNull();
      machine.keyUp(up(extra, { shiftKey: true }), 'level');
      expect(machine.keyDown(key('Digit3', { shiftKey: true }), 'level')).toBeNull();
      machine.keyUp(up('Digit3', { shiftKey: true }), 'level');
      expect(machine.keyUp(up('ShiftLeft'), 'level')).toBeNull();
    }
  });
  it('blocks modifier, composition and repeat sequences even if the initial press was missed', () => {
    for (const patch of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { repeat: true }]) {
      const machine = new FeedbackKeyboardGesture();
      machine.keyDown(key('ShiftLeft', patch), 'level');
      expect(machine.keyDown(key('Digit2', { shiftKey: true }), 'level')).toBeNull();
      machine.keyUp(up('Digit2', { shiftKey: true }), 'level');
      expect(machine.keyUp(up('ShiftLeft'), 'level')).toBeNull();
    }
    const machine = new FeedbackKeyboardGesture();
    expect(machine.keyDown(key('Digit1', { shiftKey: true }), 'category')).toBeNull();
    machine.keyUp(up('Digit1'), 'category');
    expect(machine.keyUp(up('ShiftLeft'), 'level')).toBeNull();
  });
  it('cancels standalone Shift on repeat, and clears all transient state on reset', () => {
    const machine = new FeedbackKeyboardGesture();
    machine.keyDown(key('ShiftLeft'), 'level');
    machine.keyDown(key('ShiftLeft', { repeat: true }), 'level');
    expect(machine.keyUp(up('ShiftLeft'), 'level')).toBeNull();
    machine.keyDown(key('ShiftLeft'), 'level');
    machine.reset();
    expect(machine.keyUp(up('ShiftLeft'), 'level')).toBeNull();
    machine.keyDown(key('ShiftLeft'), 'level');
    expect(machine.keyUp(up('ShiftLeft'), 'level')).toEqual({ kind: 'step', direction: -1 });
  });
  it('quarantines keys that began outside the focused control until every key is released', () => {
    const machine = new FeedbackKeyboardGesture();
    machine.quarantine(['KeyA']);
    expect(machine.keyDown(key('Tab'), 'level')).toBeNull();
    machine.keyUp(up('Tab'), 'level');
    machine.keyDown(key('ShiftLeft'), 'level');
    machine.keyUp(up('KeyA', { shiftKey: true }), 'level');
    expect(machine.keyUp(up('ShiftLeft'), 'level')).toBeNull();
    expect(machine.keyDown(key('Tab'), 'level')).toEqual({ kind: 'step', direction: 1 });
  });
  it('a nonmodifier held across an attempted chord requires full release', () => {
    const machine = new FeedbackKeyboardGesture();
    machine.keyDown(key('KeyA'), 'level');
    machine.keyDown(key('ShiftLeft'), 'level');
    machine.keyUp(up('KeyA', { shiftKey: true }), 'level');
    expect(machine.keyDown(key('Digit3', { shiftKey: true }), 'level')).toBeNull();
    machine.keyUp(up('Digit3', { shiftKey: true }), 'level');
    expect(machine.keyUp(up('ShiftLeft'), 'level')).toBeNull();
    expect(machine.keyDown(key('Tab'), 'level')).toEqual({ kind: 'step', direction: 1 });
  });
});

describe('exact published scale stepping', () => {
  it('maps level chords to confirmed existing labels, with Shift4 starting at4(low)', () => {
    expect(([1, 2, 3, 4] as const).map(feedbackShortcutLevel)).toEqual(['1', '2', '3', '4(low)']);
    expect(stepFeedbackLevel(feedbackShortcutLevel(4), 1)).toBe('4(high)');
  });
  it('steps through every existing label in both directions without invented conversions', () => {
    CLASSROOM_LEVEL_LABELS.forEach((label, index) => {
      expect(stepFeedbackLevel(label, 1)).toBe(CLASSROOM_LEVEL_LABELS[Math.min(index + 1, CLASSROOM_LEVEL_LABELS.length - 1)]);
      expect(stepFeedbackLevel(label, -1)).toBe(CLASSROOM_LEVEL_LABELS[Math.max(index - 1, 0)]);
    });
    expect(stepFeedbackLevel('3', 1)).toBe('3+');
    expect(stepFeedbackLevel('3+', 1)).toBe('4−(low)');
  });
  it('retains unknown historic rubric labels and an unselected level until an explicit level is chosen', () => {
    for (const value of ['', '4', 'Custom rubric level', '3-']) {
      expect(stepFeedbackLevel(value, 1)).toBeNull();
      expect(stepFeedbackLevel(value, -1)).toBeNull();
    }
  });
});
