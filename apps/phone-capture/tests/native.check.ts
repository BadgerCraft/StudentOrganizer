import { describe, it, expect } from 'vitest';
import { transferStatus, zipBase64, acceptedReceipt, type CaptureBridge } from '../src/native';
describe('native boundary', () => {
  it('keeps transfer unavailable/off without an actual native bridge or valid status', () => {
    expect(transferStatus().enabled).toBe(false);
    const malformed = { getTransferStatus: () => '{"enabled":true}' } as CaptureBridge;
    expect(transferStatus(malformed)).toMatchObject({ available:false, enabled:false });
  });
  it('preserves exact fictional binary ZIP bytes crossing the bridge', () => {
    const bytes = new Uint8Array(100000).map((_, i) => i % 256);
    expect(Uint8Array.from(atob(zipBase64(bytes)), c => c.charCodeAt(0))).toEqual(bytes);
  });
  it('never turns absent/negative native receipts into upload completion', () => {
    expect(() => acceptedReceipt('{}')).toThrow('not accepted');
    expect(() => acceptedReceipt('{"accepted":false,"error":"Fictional storage failure"}')).toThrow('storage failure');
    expect(acceptedReceipt('{"accepted":true}')).toContain('not confirmation');
  });
});
