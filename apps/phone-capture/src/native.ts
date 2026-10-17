/** Native-only transfer adapter. Tokens and networking never enter this renderer. */
export interface TransferStatus { available: boolean; enabled: boolean; wifiOnly: boolean; summary: string; }
export interface CaptureBridge {
  deleteAssignment?(batchId:string,captureId:string): string;
  startCamera?(batchId:string,submissionId:string,remainingPages:number): string;
  getPendingCaptures?(batchId:string,submissionId:string): string;
  readPendingCapture?(id:string,batchId:string,submissionId:string): string;
  acknowledgeCapture?(id:string,batchId:string,submissionId:string): string;
  discardPendingCapture?(id:string,batchId:string,submissionId:string): string;
  beginZip?(size:number,captureId:string): string;
  appendZip?(token:string,base64:string): string;
  finishZip?(token:string,captureId:string,revision:number,mode:'local'|'drive'): string;
  cancelZip?(token:string): string;
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

export async function transferZip(bridge: CaptureBridge, bytes: Uint8Array, batch: {captureId:string;revision:number;assignment:string}, mode:'local'|'drive'): Promise<string> {
  if (!bridge.beginZip || !bridge.appendZip || !bridge.finishZip || !bridge.cancelZip) throw new Error('Update the Android app to export completed assignments.');
  if (!bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('Completed assignment exceeds 256 MiB.');
  const begun = JSON.parse(bridge.beginZip(bytes.length,batch.captureId));
  if (begun.accepted !== true || typeof begun.token !== 'string') throw new Error(begun.error || 'Cannot prepare local export.');
  try {
    for(let offset=0;offset<bytes.length;offset+=262144) {
      acceptedReceipt(bridge.appendZip(begun.token,zipBase64(bytes.subarray(offset,offset+262144))));
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    return acceptedReceipt(bridge.finishZip(begun.token,batch.captureId,batch.revision,mode));
  } catch(error) { bridge.cancelZip(begun.token); throw error; }
}
