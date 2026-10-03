/** Keep the Blob alive while Safari hands the download to Files. */
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can interrupt a browser's asynchronous download handoff.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
