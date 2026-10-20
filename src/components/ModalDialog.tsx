import React, { useEffect, useRef, useCallback } from 'react';
import { consumeStudentPress, studentPressAt } from './studentPress';
import { X } from 'lucide-react';

// Module-level stack for managing topmost modal
const activeModalStack: string[] = [];

export function getTopmostModalId(): string | null {
  return activeModalStack.length > 0 ? activeModalStack[activeModalStack.length - 1] : null;
}

function isElementVisible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

export interface ModalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  ariaDescribedBy?: string;
  isDirty?: boolean;
  confirmDiscardMessage?: string;
  children: React.ReactNode | ((props: { requestDismiss: () => void }) => React.ReactNode);
  maxWidthClass?: string;
  contentClassName?: string;
  bodyClassName?: string;
  hideHeader?: boolean;
  testId?: string;
  initialFocusRef?: React.RefObject<HTMLElement>;
  /** Only student-facing dialogs opt into explicit underlying student intents. */
  allowStudentTransfer?: boolean;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({
  isOpen,
  onClose,
  title,
  ariaDescribedBy,
  isDirty = false,
  confirmDiscardMessage = 'You have unsaved changes. Are you sure you want to discard them?',
  children,
  maxWidthClass = 'max-w-md',
  contentClassName = '',
  bodyClassName = 'overflow-y-auto min-h-0 flex-1 p-4',
  hideHeader = false,
  testId = 'modal-dialog',
  initialFocusRef,
  allowStudentTransfer = false
}) => {
  const modalIdRef = useRef<string>(`modal-${crypto.randomUUID()}`);
  const modalId = modalIdRef.current;
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Maintain stable refs so updates to isDirty or callbacks never re-trigger the focus lifecycle
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const confirmDiscardMessageRef = useRef(confirmDiscardMessage);
  confirmDiscardMessageRef.current = confirmDiscardMessage;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestDismiss = useCallback(() => {
    if (isDirtyRef.current) {
      const confirmed = window.confirm(confirmDiscardMessageRef.current);
      if (!confirmed) {
        dialogRef.current?.focus();
        return false;
      }
    }
    onCloseRef.current();
    return true;
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    activeModalStack.push(modalId);

    // Initial focus on intelligent visible target
    const timer = setTimeout(() => {
      if (!dialogRef.current || getTopmostModalId() !== modalId) return;

      // React autofocus or a fast keyboard user may already have entered a
      // field. Delayed setup must not redirect their typing to another input.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== dialogRef.current && dialogRef.current.contains(focused)) return;

      // 1. Explicit initialFocusRef if provided and visible
      if (initialFocusRef?.current && isElementVisible(initialFocusRef.current)) {
        initialFocusRef.current.focus();
        return;
      }

      // 2. Element with autofocus / data-autofocus attribute that is visible
      const autoFocusEl = dialogRef.current.querySelector<HTMLElement>(
        '[data-autofocus], [autofocus]'
      );
      if (autoFocusEl && isElementVisible(autoFocusEl)) {
        autoFocusEl.focus();
        return;
      }

      // 3. First visible editable input, select, or textarea (ignoring hidden file inputs)
      const visibleInputs = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled)'
        )
      ).filter(isElementVisible);
      if (visibleInputs.length > 0) {
        visibleInputs[0].focus();
        return;
      }

      // 4. First visible actionable button that is not the header close X button
      const visibleButtons = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled):not([data-testid="modal-close-x-btn"])'
        )
      ).filter(isElementVisible);
      if (visibleButtons.length > 0) {
        visibleButtons[0].focus();
        return;
      }

      // 5. Fallback to first visible focusable element or container
      const allFocusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(isElementVisible);

      if (allFocusable.length > 0) {
        allFocusable[0].focus();
      } else {
        dialogRef.current.focus();
      }
    }, 10);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape key: only the topmost modal handles it
      if (e.key === 'Escape') {
        if (activeModalStack[activeModalStack.length - 1] === modalId) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          requestDismiss();
        }
        return;
      }

      // Focus trap
      if (e.key === 'Tab') {
        if (activeModalStack[activeModalStack.length - 1] !== modalId) return;

        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          ) || []
        ).filter(isElementVisible);

        if (focusable.length === 0) {
          e.preventDefault();
          dialogRef.current?.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !dialogRef.current?.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || document.activeElement === dialogRef.current || !dialogRef.current?.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown, true);
      const idx = activeModalStack.indexOf(modalId);
      if (idx !== -1) {
        activeModalStack.splice(idx, 1);
      }
      // Resilient focus restoration: only focus if element is still in DOM
      if (
        restoreFocus.current &&
        previouslyFocusedRef.current &&
        document.body.contains(previouslyFocusedRef.current) &&
        typeof previouslyFocusedRef.current.focus === 'function'
      ) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isOpen, modalId, requestDismiss]);

  if (!isOpen) return null;

  const handleBackdropPress = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.target !== event.currentTarget || getTopmostModalId() !== modalId || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const target = allowStudentTransfer ? studentPressAt(event.clientX, event.clientY, event.currentTarget) : null;
    // Snapshot intent before closing. Never retarget from pointer-up coordinates.
    if (!requestDismiss()) { consumeStudentPress(event); return; }
    if (target) {
      restoreFocus.current = false;
      const undo = target.action();
      target.element.focus({ preventScroll: true });
      consumeStudentPress(event, target.element, undo);
    } else consumeStudentPress(event);
  };

  return (
    <div
      data-testid={testId}
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-100"
      onClick={event => event.stopPropagation()}
      onPointerDown={handleBackdropPress}
      onPointerUp={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onMouseUp={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        className={`bg-white rounded-2xl w-full ${maxWidthClass} shadow-2xl border border-slate-200 outline-none animate-in zoom-in-95 duration-100 flex flex-col max-h-[90vh] overflow-hidden ${contentClassName}`}
      >
        {!hideHeader && (
          <div className="flex items-center justify-between p-4 border-b border-slate-100 shrink-0">
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
            <button
              type="button"
              onClick={requestDismiss}
              data-testid="modal-close-x-btn"
              aria-label="Close modal"
              className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className={bodyClassName}>
          {typeof children === 'function' ? children({ requestDismiss }) : children}
        </div>
      </div>
    </div>
  );
};
