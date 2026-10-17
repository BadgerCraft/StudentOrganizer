import { describe, expect, it } from 'vitest';
import { assertMarkingDocument, assertMarkingImagePages } from './validation';
import { MARKING_LIMITS } from './types';

const hash = 'a'.repeat(64);
const image = (base64: string, size = 1) => ({ id: 'fictional-page', name: 'page.png', mime: 'image/png', base64, size, hash, width: 1, height: 1 });
const document = (base64: string, size = 1) => ({ id: 'fictional-document', name: 'work.txt', text: 'Fictional work', hash, original: { name: 'work.txt', mime: 'text/plain', base64, size, hash } });
describe('retained base64 structural validation', () => {
  it.each(['A===', '=AAA', 'AA=A', 'AAAA=', 'AA', 'AA-_', 'AA\n=', 'data:image/png;base64,AA=='])('rejects invalid encoding %j for both retained-byte paths', encoded => {
    expect(() => assertMarkingImagePages([image(encoded)])).toThrow();
    expect(() => assertMarkingDocument(document(encoded))).toThrow();
  });
  it.each([['AA==', 1], ['AAA=', 2], ['AAAA', 3]] as const)('accepts complete base64 quanta %s', (encoded, size) => {
    expect(() => assertMarkingImagePages([image(encoded, size)])).not.toThrow();
    expect(() => assertMarkingDocument(document(encoded, size))).not.toThrow();
  });
  it('validates maximum-size retained originals without overflowing the regex stack', () => {
    const encoded = Buffer.alloc(MARKING_LIMITS.fileBytes, 42).toString('base64');
    expect(() => assertMarkingDocument(document(encoded, MARKING_LIMITS.fileBytes))).not.toThrow();
    expect(() => assertMarkingDocument(document(encoded, MARKING_LIMITS.fileBytes + 1))).toThrow('size limit');
  });
  it('preserves declared-byte and encoded-length limits', () => {
    expect(() => assertMarkingImagePages([image('AA==', 2)])).toThrow('size does not match');
    expect(() => assertMarkingDocument(document('AA==', 2))).toThrow('size does not match');
    expect(() => assertMarkingImagePages([image('AA==', MARKING_LIMITS.imageBytes + 1)])).toThrow('size limit');
    expect(() => assertMarkingImagePages([image('A'.repeat(4 * Math.ceil(MARKING_LIMITS.imageBytes / 3) + 4))])).toThrow('too large');
  });
});
