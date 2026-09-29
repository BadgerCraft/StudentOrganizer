import React, { useEffect, useRef, useCallback } from 'react';
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
  hideHeader?: boolean;
  testId?: string;
  initialFocusRef?: React.RefObject<HTMLElement>;
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
  hideHeader = false,
  testId = 'modal-dialog',
  initialFocusRef
}) => {
  const modalIdRef = useRef<string>(`modal-${crypto.randomUUID()}`);
  const modalId = modalIdRef.current;
  const dialogRef = useRef<HTMLDivElement>(null);
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
        return;
      }
    }
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    activeModalStack.push(modalId);

    // Initial focus on intelligent visible target
    const timer = setTimeout(() => {
      if (!dialogRef.current) return;

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
          'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'
        )
      ).filter(isElementVisible);
      if (visibleInputs.length > 0) {
        visibleInputs[0].focus();
        return;
      }

      // 4. First visible actionable button that is not the header close X button
      const visibleButtons = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([data-testid="modal-close-x-btn"])'
        )
      ).filter(isElementVisible);
      if (visibleButtons.length > 0) {
        visibleButtons[0].focus();
        return;
      }

      // 5. Fallback to first visible focusable element or container
      const allFocusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
          requestDismiss();
        }
        return;
      }

      // Focus trap
      if (e.key === 'Tab') {
        if (activeModalStack[activeModalStack.length - 1] !== modalId) return;

        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ) || []
        ).filter(isElementVisible);

        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
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
        previouslyFocusedRef.current &&
        document.body.contains(previouslyFocusedRef.current) &&
        typeof previouslyFocusedRef.current.focus === 'function'
      ) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isOpen, modalId, requestDismiss]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      requestDismiss();
    }
  };

  return (
    <div
      data-testid={testId}
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-100"
      onClick={handleBackdropClick}
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
        <div className="overflow-y-auto flex-1 p-4">
          {typeof children === 'function' ? children({ requestDismiss }) : children}
        </div>
      </div>
    </div>
  );
};
