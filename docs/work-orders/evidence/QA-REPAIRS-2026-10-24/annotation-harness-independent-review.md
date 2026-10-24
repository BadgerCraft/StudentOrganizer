# Annotation harness repair independent review

Read-only diff review of `scripts/annotationFeedbackSmoke.ts` after exact-head Windows completion. No production file changed in the inspected diff.

The repair waits for observable real-component React commits rather than assuming `page.evaluate(setState)` flushes them:
- Busy setter → disabled Cancel feedback, then existing active-guard/disabled/no-Close assertions.
- Read-only setter → disabled Pen (busy was released and Cancel successfully clicked immediately beforehand), then snapshot and saved-mark selection.
- Saved-mark selection → visible Close feedback, then the real ImageMarkup onFeedbackActiveChange effect reaches false.

Source crosscheck: `src/marking/ui/ImageMarkup.tsx:44` reports selected&&!readOnly from an effect; `:274` disables Pen from disabled; `:340` chooses Close versus Cancel from readOnly. Thus the waits are tied to actual component render/effect state. Original guard, enabled Close, no-write full feedback snapshot, removed editor, unchanged original image bytes and page-error assertions remain intact. No assertion removed or tolerated failure added.

Optional ANNOTATION_DELAY_READONLY_COMMIT injects a100ms delay only into the fictional fixture's state setter, leaving production source unchanged; it can demonstrate the previously missed scheduling race. It is not a production sleep or a weakened test outcome. Owner runs runtime verification; this reviewer did not duplicate it. No concrete blocker in inspected repair.
