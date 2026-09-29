import React, { useState, useRef } from 'react';
import {
  DownloadCloud,
  Upload,
  FileSpreadsheet,
  Database,
  CheckCircle2,
  AlertCircle,
  FileText,
  AlertTriangle,
  ArrowRight,
  Edit3,
  Users
} from 'lucide-react';
import type { ClassSection, Course, UUID } from '../types/schema';
import {
  PortabilityService,
  type CandidateStudentRow,
  type ImportRosterResult,
  type BackupMetadata
} from '../services/portabilityService';
import { parseRosterText } from '../services/rosterParser';
import { getAppIdentity } from '../services/identityService';
import { AuthorizationError } from '../services/authHelper';
import { db } from '../db/database';

interface ImportExportModalProps {
  classSection: ClassSection | null;
  course?: Course | null;
  userId?: UUID;
  deviceId?: UUID;
  onRefresh: () => void;
}

export const ImportExportModal: React.FC<ImportExportModalProps> = ({
  classSection,
  course,
  userId: propUserId,
  deviceId: propDeviceId,
  onRefresh
}) => {
  // Add Students workflow state: 'input' | 'preview' | 'success'
  const [importStep, setImportStep] = useState<'input' | 'preview' | 'success'>('input');
  const [rosterText, setRosterText] = useState('');
  const [candidateRows, setCandidateRows] = useState<CandidateStudentRow[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importResult, setImportResult] = useState<ImportRosterResult | null>(null);

  // Backup & Restore state
  const [backupDownloadStatus, setBackupDownloadStatus] = useState<string | null>(null);
  const [pendingBackupContent, setPendingBackupContent] = useState<string | null>(null);
  const [pendingBackupMetadata, setPendingBackupMetadata] = useState<BackupMetadata | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  const portability = new PortabilityService(db);

  // Section 1: Roster Preview Handler
  const handlePreviewStudents = async () => {
    if (!classSection || !rosterText.trim()) return;
    setPreviewError(null);
    setIsProcessing(true);

    try {
      // 1. Parse raw text (tabs or commas, combined or separate names)
      const parseResult = parseRosterText(rosterText);
      if (parseResult.rows.length === 0) {
        setPreviewError('No student rows could be parsed from the provided input.');
        setIsProcessing(false);
        return;
      }

      // 2. Validate against live database records
      const candidates = await portability.validateRosterCandidates(
        classSection.id,
        parseResult.rows
      );

      setCandidateRows(candidates);
      setImportStep('preview');
    } catch (err: any) {
      setPreviewError(err.message || 'Failed to parse class list.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Section 1: Confirmed Transactional Import Handler
  const handleConfirmImport = async () => {
    if (!classSection || candidateRows.length === 0) return;
    setIsProcessing(true);
    setPreviewError(null);

    try {
      const currentIdentity = await getAppIdentity(db);
      if (propUserId && propUserId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher has changed since opening this dialog. Please reopen the dialog.');
      }

      const res = await portability.importRosterBatch({
        classSectionId: classSection.id,
        rows: candidateRows,
        userId: currentIdentity.userId,
        deviceId: currentIdentity.deviceId
      });

      setImportResult(res);
      setImportStep('success');
      onRefresh();
    } catch (err: any) {
      setPreviewError(err.message || 'Import failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Section 1: File upload helper for roster (.csv, .tsv, .txt)
  const handleRosterFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      const text = evt.target?.result;
      if (typeof text === 'string') {
        setRosterText(text);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Section 2: CSV Exporters
  const handleExportMarkbook = async () => {
    if (!classSection) return;
    try {
      const csv = await portability.exportClassMarkbookCSV(classSection.id, null);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Markbook-${classSection.sectionNumber}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleExportParticipation = async () => {
    if (!classSection) return;
    try {
      const csv = await portability.exportParticipationEventsCSV(classSection.id);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Participation-Evidence-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Section 3: Backup Download
  const handleCreateBackup = async () => {
    try {
      const json = await portability.createFullBackupJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `OntarioTeacherApp-Backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupDownloadStatus('Application backup downloaded successfully!');
      setTimeout(() => setBackupDownloadStatus(null), 5000);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Section 3: Backup File Selection & Pre-Validation
  const handleBackupFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRestoreError(null);
    setRestoreSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      const content = evt.target?.result;
      if (typeof content !== 'string') {
        setRestoreError('Failed to read selected backup file.');
        return;
      }

      try {
        const metadata = portability.validateBackupJSON(content);
        setPendingBackupContent(content);
        setPendingBackupMetadata(metadata);
      } catch (err: any) {
        setPendingBackupContent(null);
        setPendingBackupMetadata(null);
        setRestoreError(err.message || 'Invalid backup file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Section 3: Confirmed Backup Restore Execution
  const handleConfirmRestore = async () => {
    if (!pendingBackupContent) return;
    setIsProcessing(true);
    setRestoreError(null);
    try {
      const res = await portability.restoreFromJSON(pendingBackupContent);
      setRestoreSuccess(
        `Database successfully restored (${res.totalRecords} records across ${res.restoredTables} collections).`
      );
      setPendingBackupContent(null);
      setPendingBackupMetadata(null);
      onRefresh();
    } catch (err: any) {
      setRestoreError(err.message || 'Restore failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const hasBlockingErrors = candidateRows.some(r => r.status === 'error' || r.error !== null);
  const errorCount = candidateRows.filter(r => r.status === 'error' || r.error !== null).length;
  const newCount = candidateRows.filter(r => r.status === 'new').length;
  const existingEnrollingCount = candidateRows.filter(r => r.status === 'existing_enrolling').length;
  const alreadyEnrolledCount = candidateRows.filter(r => r.status === 'already_enrolled').length;

  const classTitleString = course
    ? `${course.code} - Sec ${classSection?.sectionNumber || '01'}: ${course.title}`
    : `Class Section: ${classSection?.sectionNumber || 'Active Class'}`;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          Class Roster, Records &amp; Backup
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Add students from your spreadsheet, export Ontario markbook records, and manage offline data backups.
        </p>
      </div>

      {/* SECTION 1: Add students to this class */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-2">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Add Students to this Class</h2>
              <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full inline-block mt-0.5">
                {classTitleString}
              </span>
            </div>
          </div>
          <span className="text-xs text-slate-400 font-medium">Step 1 of 2: Paste or Upload</span>
        </div>

        {importStep === 'input' && (
          <div className="space-y-5">
            {/* Spreadsheet Instructions & Visual Example */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-3">
              <p className="text-slate-700 leading-relaxed font-medium">
                Copy two columns directly from your school spreadsheet (Excel or Google Sheets) and paste them below:
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left font-mono text-[11px] bg-white rounded-xl border border-slate-200 shadow-xs">
                  <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                    <tr>
                      <th className="py-1.5 px-3">Student Name</th>
                      <th className="py-1.5 px-3">Student Number</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-600">
                    <tr>
                      <td className="py-1 px-3">Smith, Jordan</td>
                      <td className="py-1 px-3">0010981</td>
                    </tr>
                    <tr>
                      <td className="py-1 px-3">Chen, Alex</td>
                      <td className="py-1 px-3">0010982</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">
                You can include or omit the header row. Existing CSV files with separate First Name and Last Name columns are also supported.
              </p>
            </div>

            {/* Paste Box */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Paste Class List
              </label>
              <textarea
                rows={6}
                data-testid="roster-csv-textarea"
                value={rosterText}
                onChange={e => {
                  setRosterText(e.target.value);
                  setPreviewError(null);
                }}
                placeholder="Smith, Jordan	0010981&#10;Chen, Alex	0010982"
                className="w-full px-3.5 py-2.5 text-xs font-mono border border-slate-300 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:outline-none leading-relaxed"
              />
            </div>

            {previewError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{previewError}</span>
              </div>
            )}

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleRosterFileUpload}
                  accept=".csv,.tsv,.txt"
                  className="hidden"
                  data-testid="roster-file-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Choose CSV or Text File</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handlePreviewStudents}
                disabled={!classSection || !rosterText.trim() || isProcessing}
                data-testid="preview-roster-btn"
                className="inline-flex items-center space-x-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm hover:shadow transition disabled:opacity-50"
              >
                <span>{isProcessing ? 'Validating...' : 'Preview Students'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Preview & Confirmation Table */}
        {importStep === 'preview' && (
          <div className="space-y-5" data-testid="roster-preview-step">
            {/* Summary Bar */}
            <div className="flex flex-wrap items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs gap-3">
              <div className="flex items-center space-x-3">
                <span className="font-bold text-slate-800">
                  Total Rows: {candidateRows.length}
                </span>
                <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-semibold">
                  {newCount} New
                </span>
                <span className="text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md font-semibold">
                  {existingEnrollingCount} Existing
                </span>
                {alreadyEnrolledCount > 0 && (
                  <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md font-semibold">
                    {alreadyEnrolledCount} Already Enrolled
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="text-red-700 bg-red-100 px-2 py-0.5 rounded-md font-bold">
                    {errorCount} Error{errorCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              <div className="text-[11px] text-slate-500 font-medium">
                Target: <strong>{classTitleString}</strong>
              </div>
            </div>

            {hasBlockingErrors && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 flex items-start space-x-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <div>
                  <div className="font-bold">Blocking errors detected</div>
                  <p className="mt-0.5 text-red-700">
                    Please correct the highlighted issues below before importing. Click &ldquo;Edit pasted list&rdquo; to modify your records.
                  </p>
                </div>
              </div>
            )}

            {previewError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                {previewError}
              </div>
            )}

            {/* Candidate Table */}
            <div className="overflow-x-auto max-h-80 border border-slate-200 rounded-2xl shadow-xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 w-14">#</th>
                    <th className="py-2.5 px-3">Last Name</th>
                    <th className="py-2.5 px-3">First Name</th>
                    <th className="py-2.5 px-3">Student Number</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Notes &amp; Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {candidateRows.map(row => (
                    <tr
                      key={row.rowNumber}
                      data-testid="preview-student-row"
                      className={
                        row.status === 'error'
                          ? 'bg-red-50/50'
                          : row.status === 'already_enrolled'
                          ? 'bg-amber-50/30'
                          : ''
                      }
                    >
                      <td className="py-2 px-3 font-mono text-slate-400">{row.rowNumber}</td>
                      <td className="py-2 px-3 font-semibold text-slate-900">{row.lastName || '—'}</td>
                      <td className="py-2 px-3 font-semibold text-slate-900">{row.firstName || '—'}</td>
                      <td className="py-2 px-3 font-mono font-bold text-slate-800">{row.studentNumber || '—'}</td>
                      <td className="py-2 px-3">
                        {row.status === 'new' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            New Student
                          </span>
                        )}
                        {row.status === 'existing_enrolling' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                            Existing Student
                          </span>
                        )}
                        {row.status === 'already_enrolled' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            Already in Class
                          </span>
                        )}
                        {row.status === 'error' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">
                            Needs Correction
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-[11px]">
                        {row.error ? (
                          <span className="text-red-700 font-medium">{row.error}</span>
                        ) : row.warning ? (
                          <span className="text-amber-700">{row.warning}</span>
                        ) : (
                          <span className="text-slate-400">Ready to import</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setImportStep('input')}
                data-testid="edit-pasted-list-btn"
                className="inline-flex items-center space-x-1.5 px-4 py-2 text-slate-700 hover:bg-slate-100 text-xs font-semibold rounded-xl transition"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Pasted List</span>
              </button>

              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setImportStep('input');
                    setRosterText('');
                    setCandidateRows([]);
                  }}
                  className="px-4 py-2 text-slate-500 hover:bg-slate-100 text-xs font-semibold rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={hasBlockingErrors || isProcessing}
                  data-testid="import-roster-btn"
                  className="inline-flex items-center space-x-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm hover:shadow transition disabled:opacity-50 active:scale-95"
                >
                  <span>{isProcessing ? 'Importing...' : 'Import Students'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Success Confirmation Card */}
        {importStep === 'success' && importResult && (
          <div className="p-6 bg-emerald-50/60 border border-emerald-200 rounded-3xl space-y-4" data-testid="roster-import-success">
            <div className="flex items-center space-x-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
              <div>
                <h3 className="text-base font-extrabold text-emerald-950">
                  Roster Imported Successfully
                </h3>
                <p className="text-xs text-emerald-800">
                  Students have been enrolled into <strong>{classTitleString}</strong>.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
              <div className="bg-white p-3 rounded-2xl border border-emerald-100 text-center shadow-xs">
                <div className="text-lg font-black text-slate-900">{importResult.newStudentsCount}</div>
                <div className="text-[11px] text-slate-500">New Students</div>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-emerald-100 text-center shadow-xs">
                <div className="text-lg font-black text-slate-900">{importResult.existingLinkedCount}</div>
                <div className="text-[11px] text-slate-500">Existing Enrolled</div>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-emerald-100 text-center shadow-xs">
                <div className="text-lg font-black text-slate-900">{importResult.skippedDuplicates}</div>
                <div className="text-[11px] text-slate-500">Duplicates Skipped</div>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-emerald-100 text-center shadow-xs">
                <div className="text-lg font-black text-slate-900">{importResult.rejectedCount}</div>
                <div className="text-[11px] text-slate-500">Rejected Rows</div>
              </div>
            </div>

            <div className="flex justify-end pt-3">
              <button
                type="button"
                onClick={() => {
                  setImportStep('input');
                  setRosterText('');
                  setCandidateRows([]);
                  setImportResult(null);
                }}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition"
              >
                Done / Add More Students
              </button>
            </div>
          </div>
        )}
      </section>

      {/* SECTION 2: Download class records */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="pb-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Download Class Records</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Export Ontario-standard spreadsheets for student records and achievement analytics.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 1. Markbook CSV */}
          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-blue-600">
                <FileSpreadsheet className="w-5 h-5" />
                <h3 className="text-sm font-bold text-slate-900">Class Markbook Spreadsheet</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Contains alphabetical student rosters, overall course percentages, and separate achievement subcolumns for Knowledge, Thinking, Communication, and Application criteria.
              </p>
            </div>
            <div className="pt-4">
              <button
                type="button"
                onClick={handleExportMarkbook}
                disabled={!classSection}
                data-testid="export-markbook-btn"
                className="w-full inline-flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-xs transition disabled:opacity-50"
              >
                <DownloadCloud className="w-4 h-4" />
                <span>Download Markbook CSV</span>
              </button>
            </div>
          </div>

          {/* 2. Participation Evidence CSV */}
          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-emerald-600">
                <FileText className="w-5 h-5" />
                <h3 className="text-sm font-bold text-slate-900">Participation Evidence Log</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Contains complete observational logs including local school dates, Toronto timestamps, student names, classification, points, and teacher observation notes.
              </p>
            </div>
            <div className="pt-4">
              <button
                type="button"
                onClick={handleExportParticipation}
                disabled={!classSection}
                data-testid="export-participation-btn"
                className="w-full inline-flex items-center justify-center space-x-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-xs transition disabled:opacity-50"
              >
                <DownloadCloud className="w-4 h-4" />
                <span>Download Participation CSV</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: Back up or restore the application */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-slate-700" />
            <h2 className="text-lg font-bold text-slate-900">Back Up or Restore the Application</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Download full local application snapshots or restore your workspace from a backup file.
          </p>
        </div>

        {/* Privacy Advisory */}
        <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-1">
          <div className="font-bold flex items-center space-x-1.5 text-amber-950">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>Confidentiality Notice</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            Backup files contain confidential student marks, notes, and records. Store backup files securely in accordance with school board privacy policies.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Download Backup */}
          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Download Full Application Backup</h3>
              <p className="text-xs text-slate-600 mt-1">
                Generates a secure offline snapshot of all your classes, students, marks, and settings.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={handleCreateBackup}
                data-testid="create-backup-btn"
                className="w-full inline-flex items-center justify-center space-x-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-xs transition"
              >
                <DownloadCloud className="w-4 h-4" />
                <span>Download Full Backup</span>
              </button>
              {backupDownloadStatus && (
                <div className="mt-2 text-xs font-semibold text-emerald-700 text-center">
                  {backupDownloadStatus}
                </div>
              )}
            </div>
          </div>

          {/* Restore from File */}
          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Restore from Backup File</h3>
              <p className="text-xs text-slate-600 mt-1">
                Select a previously saved backup file from your computer.
              </p>
            </div>

            <div>
              <input
                type="file"
                ref={backupFileInputRef}
                onChange={handleBackupFileSelect}
                accept=".json,application/json"
                className="hidden"
                data-testid="restore-file-input"
              />
              <button
                type="button"
                onClick={() => backupFileInputRef.current?.click()}
                data-testid="choose-backup-file-btn"
                className="w-full inline-flex items-center justify-center space-x-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold px-4 py-2.5 rounded-xl shadow-xs transition"
              >
                <Upload className="w-4 h-4 text-slate-500" />
                <span>Select Backup File...</span>
              </button>
            </div>
          </div>
        </div>

        {/* Restore Error Message */}
        {restoreError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 space-y-1">
            <div className="font-bold flex items-center space-x-1.5">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <span>Restore Rejected: Database Left Intact</span>
            </div>
            <p className="text-red-700">{restoreError}</p>
          </div>
        )}

        {/* Restore Success Message */}
        {restoreSuccess && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{restoreSuccess}</span>
          </div>
        )}

        {/* Pre-Validation Confirmation Card */}
        {pendingBackupMetadata && (
          <div className="p-5 bg-red-50/60 border border-red-200 rounded-2xl space-y-4" data-testid="restore-confirm-dialog">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-extrabold text-red-950">
                  Confirm Database Replacement
                </h4>
                <p className="text-xs text-red-800 mt-0.5">
                  Restoring will completely replace your current local database with the contents of this backup file. All current data will be overwritten.
                </p>
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-red-200 text-xs space-y-1.5 font-medium text-slate-700">
              <div><strong>Backup Created:</strong> {new Date(pendingBackupMetadata.exportedAt).toLocaleString()}</div>
              <div><strong>Total Records to Recover:</strong> {pendingBackupMetadata.totalRecords}</div>
              <div><strong>Collections:</strong> {pendingBackupMetadata.tableCount} record groups</div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setPendingBackupContent(null);
                  setPendingBackupMetadata(null);
                }}
                className="px-4 py-2 text-slate-600 hover:bg-white text-xs font-semibold rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={isProcessing}
                data-testid="confirm-restore-btn"
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-xs transition disabled:opacity-50"
              >
                <span>{isProcessing ? 'Restoring...' : 'Confirm & Replace Database'}</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
