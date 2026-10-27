import { describe, expect, it } from 'vitest';
import { feedbackShortcutCategory } from './useFeedbackCategoryShortcut';

const key = { code: 'Digit1', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, repeat: false };
describe('feedback category shortcut', () => {
  it('maps physical shifted digits to the four confirmed categories', () => {
    expect([1,2,3,4].map(n => feedbackShortcutCategory({ ...key, code: `Digit${n}` }, false))).toEqual(['K','T','C','A']);
  });
  it('leaves typing, assistive modifiers, composition, repeats and ordinary focus navigation alone', () => {
    expect(feedbackShortcutCategory(key, true)).toBeNull();
    for (const patch of [{ shiftKey:false },{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true},{repeat:true},{code:'Tab'},{code:'ArrowRight'},{code:'Digit5'}]) {
      expect(feedbackShortcutCategory({...key,...patch}, false)).toBeNull();
    }
  });
});
