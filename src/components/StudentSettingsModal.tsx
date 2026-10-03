import { safePhotoSource } from '../utils/localPhoto';
import React, { useState, useEffect, useRef } from 'react';
import { Camera, Trash2, AlertCircle, Save } from 'lucide-react';
import type { Student } from '../types/schema';
import { ModalDialog } from './ModalDialog';
import { StudentDomainService } from '../services/studentService';
import { getAppIdentity } from '../services/identityService';
import { AuthorizationError } from '../services/authHelper';
import { db } from '../db/database';

export interface StudentSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student | null;
  onSaveSuccess: (updatedStudent: Student) => void;
  userId: string;
  deviceId: string;
}

export const StudentSettingsModal: React.FC<StudentSettingsModalProps> = ({
  isOpen,
  onClose,
  student,
  onSaveSuccess,
  userId,
  deviceId
}) => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (student && isOpen) {
      setFirstName(student.firstName || '');
      setLastName(student.lastName || '');
      setPreferredName(student.preferredName || '');
      setPronouns(student.pronouns || '');
      setPhotoUrl(student.photoUrl || null);
      setIsDirty(false);
      setError(null);
      setIsSaving(false);
    }
  }, [student, isOpen]);

  if (!isOpen || !student) return null;

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reject non-image or unaccepted formats
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setError('Please upload a valid local image (JPEG, PNG, or WebP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const result = readerEvent.target?.result;
      if (typeof result !== 'string') {
        setError('Failed to read image file.');
        return;
      }

      // Process via canvas to strip EXIF and resize to max 256x256
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        const maxDim = 256;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setError('Canvas rendering context not available.');
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Strips EXIF metadata and generates lean JPEG
        const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

        // Verify stored size <= 64 KB
        const byteSize = new TextEncoder().encode(resizedDataUrl).length;
        if (byteSize > 64 * 1024) {
          setError('Processed photo exceeds the maximum allowed size of 64 KB.');
          return;
        }

        setPhotoUrl(resizedDataUrl);
        setIsDirty(true);
        setError(null);
      };

      img.onerror = () => {
        setError('Failed to process image file.');
      };

      img.src = result;
    };

    reader.onerror = () => {
      setError('Failed to read image file.');
    };

    reader.readAsDataURL(file);
    // Reset file input value so re-selecting same file triggers change
    e.target.value = '';
  };

  const handleRemovePhoto = () => {
    setPhotoUrl(null);
    setIsDirty(true);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();

    if (!trimmedFirst) {
      setError('First name is required.');
      return;
    }
    if (!trimmedLast) {
      setError('Last name is required.');
      return;
    }

    setIsSaving(true);
    try {
      const studentService = new StudentDomainService(db);
      const currentIdentity = await getAppIdentity(db);
      if (userId && userId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher has changed. Please reopen settings.');
      }
      const updated = await studentService.updateStudentProfile({
        studentId: student.id,
        expectedVersion: student.version,
        firstName: trimmedFirst,
        lastName: trimmedLast,
        preferredName: preferredName.trim() || null,
        pronouns: pronouns.trim() || null,
        photoUrl: photoUrl,
        userId: currentIdentity.userId,
        deviceId: currentIdentity.deviceId
      });

      setIsDirty(false);
      onSaveSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update student profile.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Student Settings"
      isDirty={isDirty}
      confirmDiscardMessage="You have unsaved changes to this student. Are you sure you want to discard them?"
      maxWidthClass="max-w-lg"
      testId="student-settings-modal"
    >
      {({ requestDismiss }) => (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center space-x-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Student Photo Management */}
          <div className="flex items-center space-x-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
            <div className="relative group shrink-0">
              {safePhotoSource(photoUrl) ? (
                <img
                  src={safePhotoSource(photoUrl)}
                  alt={`${firstName} ${lastName}`}
                  className="w-16 h-16 rounded-2xl object-cover border-2 border-white shadow-sm ring-1 ring-slate-200"
                />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white text-xl font-black shadow-sm ring-1 ring-slate-200">
                  {firstName[0] || '?'}{lastName[0] || ''}
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold text-slate-900 mb-1">Student Photo</h4>
              <p className="text-[11px] text-slate-500 mb-2">
                Upload a local JPG, PNG, or WebP. Auto-resized to 256x256 with EXIF metadata stripped.
              </p>
              <div className="flex items-center space-x-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handlePhotoUpload}
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  data-testid="student-photo-file-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg shadow-sm transition active:scale-95"
                  data-testid="upload-photo-btn"
                >
                  <Camera className="w-3.5 h-3.5 text-slate-500" />
                  <span>{photoUrl ? 'Replace Photo' : 'Upload Photo'}</span>
                </button>
                {photoUrl && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-red-600 hover:bg-red-50 text-xs font-medium rounded-lg transition active:scale-95"
                    data-testid="remove-photo-btn"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Names */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={firstName}
                onChange={e => {
                  setFirstName(e.target.value);
                  setIsDirty(true);
                }}
                data-testid="student-first-name-input"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={lastName}
                onChange={e => {
                  setLastName(e.target.value);
                  setIsDirty(true);
                }}
                data-testid="student-last-name-input"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Preferred Name & Pronouns */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Preferred Name <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                maxLength={100}
                value={preferredName}
                placeholder="e.g. Alex"
                onChange={e => {
                  setPreferredName(e.target.value);
                  setIsDirty(true);
                }}
                data-testid="student-preferred-name-input"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Pronouns <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                maxLength={50}
                value={pronouns}
                placeholder="e.g. they/them, she/her"
                onChange={e => {
                  setPronouns(e.target.value);
                  setIsDirty(true);
                }}
                data-testid="student-pronouns-input"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-500 space-y-0.5">
            <div><strong>Local Student ID:</strong> {student.localStudentNumber}</div>
            <div><strong>Version:</strong> v{student.version}</div>
          </div>

          {/* Footer Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={requestDismiss}
              data-testid="cancel-student-settings-btn"
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 text-xs font-semibold rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              data-testid="save-student-settings-btn"
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm hover:shadow transition active:scale-95 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
};
