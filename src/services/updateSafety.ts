import { useLayoutEffect } from 'react';

// UI write chains register before their first await, including identity lookups.
// This is not a storage lock: it prevents restart while a teacher action is pending.
let pending = 0;
let locked = false;
const editors = new Set<symbol>();
export function updateSafetyReason(): string | undefined {
  if (pending) return 'Wait for the current save to finish before updating.';
  if (editors.size) return 'Save or close the open editor before updating. Your edits have been kept.';
}
export function setUpdateLocked(value: boolean) { locked = value; }
export async function runUpdateWork<T>(work: () => Promise<T>): Promise<T | undefined> {
  if (locked) return undefined;
  pending++;
  try { return await work(); } finally { pending--; }
}
export function useUpdateEditor(open: boolean) {
  useLayoutEffect(() => {
    if (!open) return;
    const id = Symbol('update-editor'); editors.add(id);
    return () => { editors.delete(id); };
  }, [open]);
}
