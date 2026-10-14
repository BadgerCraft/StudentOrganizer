import { safePhotoSource } from '../utils/localPhoto';
import React, { useState, useEffect, useRef } from 'react';
import { Camera, Trash2, AlertCircle, Save } from 'lucide-react';
import type { Student } from '../types/schema';
import { ModalDialog } from './ModalDialog';
import { StudentDomainService } from '../services/studentService';
import { getAppIdentity, getIdentityEpoch, subscribeIdentityChange } from '../services/identityService';
import { AuthorizationError } from '../services/authHelper';
import { db } from '../db/database';
import { readLocalPhotoFile } from '../utils/photoCrop';
import { PhotoCropEditor } from './PhotoCropEditor';

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
  const [isReadingPhoto, setIsReadingPhoto] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const uploadEpoch = useRef(0);
  const formIdentityEpoch = useRef(getIdentityEpoch());

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (student && isOpen) {
      formIdentityEpoch.current = getIdentityEpoch();
      setFirstName(student.firstName || '');
      setLastName(student.lastName || '');
      setPreferredName(student.preferredName || '');
      setPronouns(student.pronouns || '');
      setPhotoUrl(student.photoUrl || null);
      setIsDirty(false);
      setError(null);
      setIsSaving(false);
      setIsReadingPhoto(false);
      setCropSource(null);
      uploadEpoch.current++;
    }
    return () => { uploadEpoch.current++; };
  }, [student, isOpen, userId, deviceId]);

  useEffect(() => subscribeIdentityChange(() => {
    uploadEpoch.current++;
    setCropSource(null);
    setIsReadingPhoto(false);
    setIsSaving(false);
    setPhotoUrl(student?.photoUrl || null);
    setError('Acting teacher has changed. Please reopen settings.');
  }), [student]);

  if (!isOpen || !student) return null;

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isSaving) return;
    const currentUpload = ++uploadEpoch.current;
    setIsReadingPhoto(true);
    try {
      const source = await readLocalPhotoFile(file);
      if (currentUpload !== uploadEpoch.current) return;
      setCropSource(source);
      setError(null);
    } catch (err) {
      if (currentUpload === uploadEpoch.current) setError(err instanceof Error ? err.message : 'Failed to read image file.');
    } finally {
      if (currentUpload === uploadEpoch.current) setIsReadingPhoto(false);
    }
  };

  const handleRemovePhoto = () => {
    uploadEpoch.current++;
    setIsReadingPhoto(false);
    setCropSource(null);
    setPhotoUrl(null);
    setIsDirty(true);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isReadingPhoto) return;
    if (cropSource) { setError('Apply or cancel the photo crop before saving.'); return; }
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

    const saveEpoch = formIdentityEpoch.current;
    const saveUpload = ++uploadEpoch.current;
    setIsSaving(true);
    try {
      const studentService = new StudentDomainService(db);
      const currentIdentity = await getAppIdentity(db);
      if (saveEpoch !== getIdentityEpoch() || saveUpload !== uploadEpoch.current || userId !== currentIdentity.userId || deviceId !== currentIdentity.deviceId) {
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
        deviceId: currentIdentity.deviceId,
        identityEpoch: saveEpoch
      });

      if (saveEpoch !== getIdentityEpoch() || saveUpload !== uploadEpoch.current) return;
      setIsDirty(false);
      onSaveSuccess(updated);
      onClose();
    } catch (err: any) {
      if (saveUpload === uploadEpoch.current) setError(err?.message || 'Failed to update student profile.');
    } finally {
      if (saveUpload === uploadEpoch.current) setIsSaving(false);
    }
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Student Settings"
      isDirty={isDirty || cropSource !== null || isReadingPhoto}
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
                Choose a local JPG, PNG, or WebP, then crop and preview it. Saved photos stay on this device.
              </p>
              <div className="flex items-center space-x-2">
                <input
                  type="file"
                  disabled={isSaving}
                  ref={fileInputRef}
                  onChange={handlePhotoUpload}
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  data-testid="student-photo-file-input"
                />
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg shadow-sm transition active:scale-95"
                  data-testid="upload-photo-btn"
                >
                  <Camera className="w-3.5 h-3.5 text-slate-500" />
                  <span>{photoUrl ? 'Replace Photo' : 'Upload Photo'}</span>
                </button>
                {safePhotoSource(photoUrl) && <button type="button" data-testid="edit-photo-crop-btn" disabled={isSaving} onClick={() => { uploadEpoch.current++; setIsReadingPhoto(false); setCropSource(photoUrl); }} className="px-2.5 py-1.5 text-blue-700 text-xs font-medium rounded-lg hover:bg-blue-50">Edit Crop</button>}
                {photoUrl && (
                  <button
                    type="button"
                    disabled={isSaving}
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

          {cropSource && <PhotoCropEditor key={cropSource} source={cropSource} onCancel={() => { uploadEpoch.current++; setIsReadingPhoto(false); setCropSource(null); }} onApply={photo => {
            uploadEpoch.current++; setIsReadingPhoto(false); setPhotoUrl(photo); setIsDirty(true); setCropSource(null); setError(null);
          }} />}

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
              disabled={isSaving || isReadingPhoto || cropSource !== null}
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
