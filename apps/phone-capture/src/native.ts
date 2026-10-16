/** Native-only transfer adapter. Tokens and networking never enter this renderer. */
export interface TransferStatus { available: boolean; enabled: boolean; wifiOnly: boolean; summary: string; }
export interface CaptureBridge {
  getTransferStatus(): string;
  requestDriveSetup(): void;
  enqueueCapture(base64Zip: string, captureId: string, revision: number): string;
  saveLocalZip(base64Zip: string, filename: string): string;
}
declare global { interface Window { CaptureNative?: CaptureBridge; } }
export function transferStatus(bridge?: CaptureBridge): TransferStatus {
  const unavailable = { available: false, enabled: false, wifiOnly: true, summary: 'Private Drive transfer requires the separately configured Android app. Local export remains available.' };
  if (!bridge) return unavailable;
  try {
    const value = JSON.parse(bridge.getTransferStatus());
    if (typeof value.available !== 'boolean' || typeof value.enabled !== 'boolean' || typeof value.wifiOnly !== 'boolean' || typeof value.summary !== 'string') throw new Error('Invalid status');
    return value;
  } catch { return { ...unavailable, summary: 'Transfer status unavailable. No upload queued; use local export or reopen Android settings.' }; }
}
export function zipBase64(bytes: Uint8Array): string {
  if (bytes.length > 34 * 1024 * 1024) throw new Error('Export exceeds the private transfer size limit.');
  let binary = '';
  for (let start = 0; start < bytes.length; start += 32768) binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return btoa(binary);
}
export function acceptedReceipt(receipt: string): string {
  const value = JSON.parse(receipt);
  if (value.accepted !== true) throw new Error(typeof value.error === 'string' ? value.error : 'Native operation was not accepted. Your local batch is retained.');
  return typeof value.summary === 'string' ? value.summary : 'Accepted locally. This is not confirmation of upload or transfer.';
}
