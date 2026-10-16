import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UserCheck, ShieldAlert, AlertCircle, RefreshCw, X } from 'lucide-react';
import { db } from '../db/database';
import { getAvailableTeachers } from '../services/identityService';
import { createTeacherProfile, updateTeacherProfile } from '../services/teacherProfileService';
import type { UUID, User } from '../types/schema';

interface TeacherSelectorModalProps {
  isOpen: boolean;
  canDismiss: boolean;
  currentTeacherId?: UUID | null;
  onSelectTeacher: (userId: UUID, keepOpen?: boolean) => Promise<void>;
  onCancel?: () => void;
  onClose?: () => void;
}

function isElementVisible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

export const TeacherSelectorModal: React.FC<TeacherSelectorModalProps> = ({
  isOpen,
  canDismiss,
  currentTeacherId,
  onSelectTeacher,
  onCancel,
  onClose
}) => {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recentTeacherId, setRecentTeacherId] = useState<UUID | null>(null);
  const [editor, setEditor] = useState<'create' | User | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const submitGuard = useRef(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const fetchTeachers = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      let list = await getAvailableTeachers(db);
      // This remembers only a suggestion. It never establishes an actor or
      // bypasses explicit session confirmation and membership validation.
      let recent: string | null = null;
      try { recent = window.localStorage.getItem('ota.last-confirmed-teacher.v1'); } catch { /* Selection still works without storage. */ }
      setRecentTeacherId(list.some(teacher => teacher.id === recent) ? recent : null);
      if (list.length === 0) { setEditor('create'); setProfileName(''); setProfileEmail(''); }
      setTeachers([...list].sort((a, b) => Number(b.id === recent) - Number(a.id === recent) || a.name.localeCompare(b.name)));
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load teachers.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleCancelAction = useCallback(() => {
    if (isSubmitting) return;
    if (onCancel) {
      onCancel();
    } else if (onClose) {
      onClose();
    }
  }, [isSubmitting, onCancel, onClose]);

  // Reset state and fetch teachers whenever modal opens
  useEffect(() => {
    if (isOpen) {
      submitGuard.current = false;
      setIsSubmitting(false);
      setErrorMessage(null);
      setEditor(null);
      fetchTeachers();
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    }
  }, [isOpen, fetchTeachers]);

  // Focus trap and focus restoration
  useEffect(() => {
    if (!isOpen) return;

    // Focus first actionable element after loading
    const timer = setTimeout(() => {
      if (!dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(isElementVisible);

      const nameInput = dialogRef.current.querySelector<HTMLInputElement>('input[name="teacherName"]');
      if (nameInput && isElementVisible(nameInput)) { nameInput.focus(); return; }
      // Prefer first teacher button, or fallback to first focusable
      const firstTeacherBtn = dialogRef.current.querySelector<HTMLElement>(
        'button[data-testid^="select-teacher-"]:not([disabled])'
      );
      if (firstTeacherBtn && isElementVisible(firstTeacherBtn)) {
        firstTeacherBtn.focus();
      } else if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (canDismiss && !isSubmitting) {
          e.preventDefault();
          e.stopPropagation();
          handleCancelAction();
        }
        return;
      }

      if (e.key === 'Tab') {
        if (!dialogRef.current) return;
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter(isElementVisible);

        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !dialogRef.current.contains(document.activeElement)) {
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

      // Restore focus to previously focused element if still in DOM
      if (
        previouslyFocusedRef.current &&
        document.body.contains(previouslyFocusedRef.current) &&
        typeof previouslyFocusedRef.current.focus === 'function'
      ) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isOpen, canDismiss, isSubmitting, handleCancelAction, isLoading, editor]);

  if (!isOpen) return null;

  const handleSelect = async (userId: UUID) => {
    if (submitGuard.current) return;
    submitGuard.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onSelectTeacher(userId);
      try { window.localStorage.setItem('ota.last-confirmed-teacher.v1', userId); } catch { /* Optional convenience only. */ }
      submitGuard.current = false;
      setIsSubmitting(false);
      // NOTE: Do not call handleCancelAction() or onClose() here.
      // Selection is complete and distinct from cancellation.
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to select teacher.');
      submitGuard.current = false;
      setIsSubmitting(false);
    }
  };

  const startCreate = () => {
    setEditor('create'); setProfileName(''); setProfileEmail(''); setErrorMessage(null);
  };
  const startEdit = async (teacher: User) => {
    if (submitGuard.current) return;
    submitGuard.current = true; setIsSubmitting(true); setErrorMessage(null);
    try {
      // This explicit action establishes the actor before a profile write.
      await onSelectTeacher(teacher.id, true);
      setEditor(teacher); setProfileName(teacher.name);
      setProfileEmail(teacher.email.endsWith('@local.invalid') ? '' : teacher.email);
    } catch (err: any) { setErrorMessage(err.message || 'Could not choose this teacher for editing.'); }
    finally { submitGuard.current = false; setIsSubmitting(false); }
  };
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor || submitGuard.current) return;
    submitGuard.current = true; setIsSubmitting(true); setErrorMessage(null);
    try {
      const fields = { name: profileName, email: profileEmail };
      const teacher = editor === 'create'
        ? await createTeacherProfile(db, fields)
        : await updateTeacherProfile(db, editor.id, fields);
      // Show the saved profile even if selecting its device/session then fails.
      setEditor(null);
      await fetchTeachers();
      await onSelectTeacher(teacher.id);
      try { window.localStorage.setItem('ota.last-confirmed-teacher.v1', teacher.id); } catch { /* Optional suggestion. */ }
    } catch (err: any) { setErrorMessage(err.message || 'Could not save the teacher profile. Please retry.'); }
    finally { submitGuard.current = false; setIsSubmitting(false); }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && canDismiss && !isSubmitting) {
      handleCancelAction();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-selector-title"
      data-testid="teacher-selector-modal"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 pointer-events-auto"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl max-w-lg max-h-[90dvh] w-full overflow-hidden border border-slate-200 outline-none animate-in fade-in zoom-in-95 duration-150 flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 id="teacher-selector-title" className="text-lg font-bold text-slate-900 leading-tight">
                {editor === 'create' && teachers.length === 0 ? 'Enter Teacher here' : editor && editor !== 'create' ? 'Edit teacher profile' : canDismiss ? 'Teacher profiles' : 'Confirm teacher for this session'}
              </h2>
              <span className="text-xs text-slate-500">
                Local session attribution for marks, attendance, and audit records
              </span>
            </div>
          </div>
          {canDismiss && !isSubmitting && (
            <button
              onClick={handleCancelAction}
              data-testid="teacher-selector-close-btn"
              aria-label="Close dialog"
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Local Attribution Disclaimer Banner */}
        <div className="px-6 py-3 bg-amber-50/80 border-b border-amber-100 flex items-start space-x-2.5 shrink-0">
          <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 leading-relaxed">
            Confirm who is using the app so marks, attendance and edits have the correct teacher's name. Your choice lasts for this session and across class changes. A new launch asks again to protect shared-device attribution; this is a local profile choice, not a password sign-in.
          </p>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {errorMessage && (
            <div
              role="alert"
              className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-start space-x-2"
            >
              <AlertCircle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {isLoading ? (
            <div className="py-10 text-center space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mx-auto" />
              <p className="text-xs text-slate-500">Loading active teachers...</p>
            </div>
          ) : editor ? (
            <form onSubmit={saveProfile} className="space-y-4" aria-label={editor === 'create' ? 'Create teacher profile' : 'Edit teacher profile'}>
              <label className="block text-sm font-semibold text-slate-700">Teacher name
                <input name="teacherName" value={profileName} onChange={event => setProfileName(event.target.value)} placeholder="Enter Teacher here" required maxLength={100} disabled={isSubmitting} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
              </label>
              <label className="block text-sm font-semibold text-slate-700">Email (optional)
                <input name="teacherEmail" type="email" value={profileEmail} onChange={event => setProfileEmail(event.target.value)} maxLength={254} disabled={isSubmitting} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
              </label>
              <p className="text-xs text-slate-500">Saved on this device. Email does not create an online account. New teachers start with their own classes; existing class ownership stays unchanged.</p>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={isSubmitting || !profileName.trim()} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm disabled:opacity-50">{isSubmitting ? 'Saving…' : 'Save and use teacher'}</button>
                {teachers.length > 0 && <button type="button" disabled={isSubmitting} onClick={() => { setEditor(null); setErrorMessage(null); }} className="px-4 py-2 rounded-lg border border-slate-300 text-sm">Back to teachers</button>}
              </div>
            </form>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Choose Teacher:
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {teachers.map(teacher => {
                  const isCurrent = teacher.id === currentTeacherId;
                  const isRecent = !canDismiss && teacher.id === recentTeacherId;
                  return (
                    <div key={teacher.id} className="flex gap-2 items-center">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleSelect(teacher.id)}
                      data-testid={`select-teacher-${teacher.id}`}
                      className={`w-full text-left p-3.5 rounded-xl border transition flex items-center justify-between group ${
                        isCurrent
                          ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20'
                          : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                            isCurrent
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-700 group-hover:bg-blue-100 group-hover:text-blue-700'
                          }`}
                        >
                          {teacher.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="truncate">
                          <p className="font-semibold text-sm text-slate-900 truncate">
                            {teacher.name}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {isRecent ? 'Last confirmed on this device' : teacher.email.endsWith('@local.invalid') ? 'Local teacher profile' : teacher.email}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 ml-2">
                        {isCurrent ? (
                          <span className="text-xs font-semibold px-2.5 py-1 bg-blue-100 text-blue-800 rounded-md">
                            Active
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-slate-500 group-hover:text-blue-600">
                            {isRecent ? 'Continue →' : 'Select →'}
                          </span>
                        )}
                      </div>
                    </button>
                    <button type="button" disabled={isSubmitting} onClick={() => startEdit(teacher)} aria-label={`Choose and edit ${teacher.name}`} className="shrink-0 px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">Edit profile</button>
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={startCreate} disabled={isSubmitting} className="w-full px-4 py-2 rounded-lg border border-blue-300 text-blue-700 font-semibold text-sm disabled:opacity-50">Add another teacher</button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-slate-400">
            {canDismiss ? 'You can switch back at any time from the top bar.' : 'Selection required to record or edit student data.'}
          </p>
          {canDismiss && !isSubmitting && (
            <button
              onClick={handleCancelAction}
              type="button"
              data-testid="teacher-selector-cancel-btn"
              className="px-4 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-lg transition"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
