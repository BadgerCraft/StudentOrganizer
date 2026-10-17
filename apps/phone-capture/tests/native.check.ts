import { describe, it, expect } from 'vitest';
import { transferStatus, captureTransferStatus, zipBase64, acceptedReceipt, type CaptureBridge } from '../src/native';
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

describe('exact-package delivery confirmation',()=>{
  const bridge=(value:unknown)=>({getCaptureTransferStatus:()=>JSON.stringify(value)}) as CaptureBridge;
  it('accepts explicit verified delivery only for the requested package and revision',()=>{
    expect(captureTransferStatus(bridge({captureId:'fictional-package',revision:3,state:'COMPLETE',message:'Verified on Drive'}),'fictional-package',3).state).toBe('COMPLETE');
    for(const value of [
      {captureId:'other-package',revision:3,state:'COMPLETE',message:'Verified'},
      {captureId:'fictional-package',revision:2,state:'COMPLETE',message:'Verified'},
      {captureId:'fictional-package',revision:3,state:'accepted',message:'Queued'},
      {captureId:'fictional-package',revision:3,state:'COMPLETE'},
    ])expect(captureTransferStatus(bridge(value),'fictional-package',3).state).toBe('UNAVAILABLE');
  });
  it('keeps unavailable/malformed bridges and retry/auth states unconfirmed',()=>{
    expect(captureTransferStatus(undefined,'fictional-package',3).state).toBe('UNAVAILABLE');
    expect(captureTransferStatus({getCaptureTransferStatus:()=>{throw new Error('unavailable');}} as CaptureBridge,'fictional-package',3).state).toBe('UNAVAILABLE');
    for(const state of ['NOT_QUEUED','QUEUED','UPLOADING','RETRY','NEEDS_AUTH','PAUSED','BLOCKED'])
      expect(captureTransferStatus(bridge({captureId:'fictional-package',revision:3,state,message:'Fictional status'}),'fictional-package',3).state).toBe(state);
  });
});
