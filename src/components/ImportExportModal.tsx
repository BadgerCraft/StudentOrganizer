import { rendererStorageMode } from '../security/rendererStorageMode';
import { protectedStorageBoundary, lockEncryptedRuntime } from '../security/encryptedRuntime';
import { unwrapEncryption } from '../security/encryptionBridge';
import React, { useState, useRef, useEffect } from 'react';
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
import { clipboardRosterText, readRosterTable, mapRosterTable, mappingError, validateEditedRosterRow, MAX_ROSTER_CHARS, type RosterTable, type RosterMapping } from '../services/rosterTable';
import { getAppIdentity } from '../services/identityService';
import { AuthorizationError } from '../services/authHelper';
import { db } from '../db/database';
import { downloadFile } from '../utils/downloadFile';
import { usesNativeFiles, exportNativeBackup, selectNativeBackup } from '../services/nativeFiles';

interface ImportExportModalProps {
  classSection: ClassSection | null;
  course?: Course | null;
  userId?: UUID;
  deviceId?: UUID;
  onRefresh: () => void;
  onOpenSeating?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export const ImportExportModal: React.FC<ImportExportModalProps> = ({
  classSection,
  course,
  userId: propUserId,
  deviceId: propDeviceId,
  onRefresh,
  onOpenSeating, onBusyChange
}) => {
  // Add Students workflow state: 'input' | 'preview' | 'success'
  const [importStep, setImportStep] = useState<'input' | 'preview' | 'success'>('input');
  const [rosterText, setRosterText] = useState('');
  const [previewSectionId, setPreviewSectionId] = useState<UUID | null>(null);
  const [importTargetTitle, setImportTargetTitle] = useState('');
  const [sourceErrors, setSourceErrors] = useState<Record<number, string | null>>({});
  const [table, setTable] = useState<RosterTable | null>(null);
  const [mapping, setMapping] = useState<RosterMapping | null>(null);
  const [hasHeader, setHasHeader] = useState(false);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [previewDirty, setPreviewDirty] = useState(false);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [pasteNotice, setPasteNotice] = useState('');
  const [candidateRows, setCandidateRows] = useState<CandidateStudentRow[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const backupExportPending = useRef(false), backupPickerPending = useRef(false), restorePending = useRef(false);
  useEffect(() => { onBusyChange?.(isProcessing); return () => onBusyChange?.(false); }, [isProcessing, onBusyChange]);
  const [importResult, setImportResult] = useState<ImportRosterResult | null>(null);

  // Backup & Restore state
  const [backupDownloadStatus, setBackupDownloadStatus] = useState<string | null>(null);
  const [backupExportError, setBackupExportError] = useState('');
  const [pendingBackupContent, setPendingBackupContent] = useState<string | null>(null);
  const [pendingBackupMetadata, setPendingBackupMetadata] = useState<Pick<BackupMetadata, 'exportedAt' | 'totalRecords' | 'tableCount'> | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  const portability = new PortabilityService(db);
  const protectedMode = rendererStorageMode() !== 'legacy';
  const [protectedRestoreToken, setProtectedRestoreToken] = useState<string | null>(null);
  const backupPreviewGeneration = useRef(0);
  useEffect(() => () => { backupPreviewGeneration.current++; }, []);

  // Section 1: Roster Preview Handler
  const handlePreviewStudents = async () => {
    if (!classSection || !rosterText.trim()) return;
    setPreviewError(null);
    setIsProcessing(true);

    try {
      const nextTable = readRosterTable(rosterText);
      setTable(nextTable);
      setMapping(nextTable.mapping);
      setHasHeader(nextTable.hasHeader);
      setExcluded(new Set());
      setPreviewDirty(false);
      const needsMapping = !!mappingError(nextTable, nextTable.mapping);
      setMappingDirty(needsMapping);
      const rows = needsMapping ? [] : mapRosterTable(nextTable, nextTable.mapping, nextTable.hasHeader);
      setSourceErrors(Object.fromEntries(rows.map(row => [row.rowNumber, row.error])));
      setCandidateRows(await portability.validateRosterCandidates(classSection.id, rows));
      setPreviewSectionId(classSection.id);
      setImportStep('preview');
    } catch (err: any) {
      setPreviewError(err.message || 'Failed to parse class list.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Section 1: Confirmed Transactional Import Handler
  const handleConfirmImport = async () => {
    if (!classSection || previewSectionId !== classSection.id || !includedRows.length || mappingDirty || previewDirty || isProcessing) return;
    setIsProcessing(true);
    setPreviewError(null);

    try {
      setImportTargetTitle(classTitleString);
      const currentIdentity = await getAppIdentity(db);
      if (propUserId && propUserId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher has changed since opening this dialog. Please reopen the dialog.');
      }

      const res = await portability.importRosterBatch({
        classSectionId: classSection.id,
        rows: includedRows,
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

  const recheckPreview = async () => {
    if (!classSection || isProcessing) return;
    setIsProcessing(true);
    setPreviewError(null);
    try {
      const checked = await portability.validateRosterCandidates(classSection.id, candidateRows.filter(row => !excluded.has(row.rowNumber)).map(row => ({ ...row, error: sourceErrors[row.rowNumber] ?? null, warning: null })));
      setCandidateRows(candidateRows.map(row => checked.find(check => check.rowNumber === row.rowNumber) || row));
      setPreviewDirty(false);
      setPreviewSectionId(classSection.id);
    } catch (err: any) { setPreviewError(err.message || 'Could not validate preview.'); }
    finally { setIsProcessing(false); }
  };

  const applyMapping = async () => {
    if (!table || !mapping || !classSection || isProcessing) return;
    setIsProcessing(true);
    setPreviewError(null);
    try {
      const rows = mapRosterTable(table, mapping, hasHeader);
      setSourceErrors(Object.fromEntries(rows.map(row => [row.rowNumber, row.error])));
      setCandidateRows(await portability.validateRosterCandidates(classSection.id, rows));
      setExcluded(new Set());
      setMappingDirty(false);
      setPreviewDirty(false);
      setPreviewSectionId(classSection.id);
    } catch (err: any) { setPreviewError(err.message || 'Could not apply mapping.'); }
    finally { setIsProcessing(false); }
  };

  // Section 1: File upload helper for roster (.csv, .tsv, .txt)
  const handleRosterFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_ROSTER_CHARS) {
      setPreviewError('Class list file is too large. Limit: 1 MB.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = evt => {
      const text = evt.target?.result;
      if (typeof text === 'string') {
        setRosterText(text);
        setPasteNotice('Using local TSV/CSV text file.');
        setPreviewError(null);
      }
    };
    reader.onerror = () => alert('The selected file could not be read. Try a local copy in Files.');
    reader.readAsText(file);
    e.target.value = '';
  };

  // Section 2: CSV Exporters
  const handleExportMarkbook = async () => {
    if (!classSection) return;
    try {
      const csv = await portability.exportClassMarkbookCSV(classSection.id, null);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      downloadFile(blob, `Markbook-${classSection.sectionNumber}-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleExportParticipation = async () => {
    if (!classSection) return;
    try {
      const csv = await portability.exportParticipationEventsCSV(classSection.id);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      downloadFile(blob, `Participation-Evidence-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Section 3: Backup Download
  const handleCreateBackup = async () => {
    if (backupExportPending.current || isProcessing) return; backupExportPending.current = true; setIsProcessing(true); setBackupExportError(''); setBackupDownloadStatus(null);
    try {
      if (protectedMode) {
        const native = window.desktopEncryption; if (!native) throw Error('Protected backup export requires the native encryption connection.');
        const saved = await protectedStorageBoundary(async () => unwrapEncryption(await native.exportBackupFile()));
        setBackupDownloadStatus(saved.cancelled ? 'Encrypted backup export cancelled. No file was saved.' : 'Encrypted backup file saved. Keep the offline recovery code separately and verify this copy before relying on it.'); return;
      }
      const json = await portability.createFullBackupJSON();
      const filename = `OntarioTeacherApp-Backup-${new Date().toISOString().slice(0, 10)}.json`;
      if (usesNativeFiles()) {
        const saved = await exportNativeBackup(filename, json);
        setBackupDownloadStatus(saved ? 'Backup saved to Files. Verify this backup before renewing the installed app.' : 'Backup cancelled. No file was saved.');
      } else {
        downloadFile(new Blob([json], { type: 'application/json' }), filename);
        setBackupDownloadStatus('Backup download requested. Check Downloads or Files before leaving this device.');
      }
      setTimeout(() => setBackupDownloadStatus(null), 5000);
    } catch (err: any) {
      if (protectedMode) setBackupExportError('Encrypted backup export was not verified. Check the selected destination and available storage; keep your recovery code and use another verified backup.');
      else alert(err.message);
    } finally { backupExportPending.current = false; setIsProcessing(false); }
  };

  // Both pickers use the same validator and require explicit confirmation before restore.
  const previewBackup = async (content: string) => {
    const generation = ++backupPreviewGeneration.current; setProtectedRestoreToken(null);
    try {
      if (protectedMode) throw Error('Use the native encrypted backup file chooser.');
      const metadata = portability.validateBackupJSON(content);
      setPendingBackupContent(content);
      setPendingBackupMetadata(metadata);
    } catch (err: any) {
      setPendingBackupContent(null);
      setPendingBackupMetadata(null);
      if (generation === backupPreviewGeneration.current) setRestoreError(err.message || 'Invalid backup file.');
    }
  };

  const handleChooseBackup = async () => {
    if (backupPickerPending.current || isProcessing) return;
    if (protectedMode) {
      backupPickerPending.current = true; setIsProcessing(true); const generation = ++backupPreviewGeneration.current;
      setProtectedRestoreToken(null); setPendingBackupContent(null); setPendingBackupMetadata(null); setRestoreError(null); setRestoreSuccess(null);
      try {
        const native = window.desktopEncryption; if (!native) throw Error('Native encrypted recovery is unavailable.');
        const checked = await protectedStorageBoundary(async () => unwrapEncryption(await native.previewImportFile()));
        if (generation !== backupPreviewGeneration.current || checked.cancelled) return;
        setProtectedRestoreToken(checked.token); setPendingBackupMetadata(checked.metadata);
      } catch { if (generation === backupPreviewGeneration.current) setRestoreError('The encrypted backup file could not be verified. Keep the original source and choose an intact backup for this app and recovery enrollment.'); }
      finally { backupPickerPending.current = false; setIsProcessing(false); }
      return;
    }
    if (!usesNativeFiles()) {
      backupFileInputRef.current?.click();
      return;
    }
    setRestoreError(null);
    setRestoreSuccess(null);
    setPendingBackupContent(null);
    setPendingBackupMetadata(null);
    try {
      const content = await selectNativeBackup();
      if (content !== null) await previewBackup(content);
    } catch {
      setRestoreError('The selected backup could not be read. Existing records are unchanged. Try a local copy in Files.');
    }
  };

  const handleBackupFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (protectedMode) { e.target.value = ''; return; }
    setRestoreError(null);
    setRestoreSuccess(null);
    setPendingBackupContent(null);
    setPendingBackupMetadata(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      const content = evt.target?.result;
      if (typeof content === 'string') void previewBackup(content);
      else setRestoreError('Failed to read selected backup file.');
    };
    reader.onerror = () => setRestoreError('The selected backup could not be read. Existing records are unchanged. Try a local copy in Files.');
    reader.readAsText(file);
    e.target.value = '';
  };

  // Section 3: Confirmed Backup Restore Execution
  const handleConfirmRestore = async () => {
    if (isProcessing || restorePending.current || (!pendingBackupContent && !protectedRestoreToken)) return;
    restorePending.current = true; setIsProcessing(true);
    setRestoreError(null);
    try {
      if (protectedMode) {
        const native = window.desktopEncryption; if (!native || !protectedRestoreToken) throw Error('Choose and verify an encrypted backup first.');
        try { await protectedStorageBoundary(async () => unwrapEncryption(await native.applyImport(protectedRestoreToken))); } finally { lockEncryptedRuntime(); }
        return;
      }
      const res = await portability.restoreFromJSON(pendingBackupContent!);
      setRestoreSuccess(
        `Database successfully restored (${res.totalRecords} records across ${res.restoredTables} collections).`
      );
      setPendingBackupContent(null);
      setPendingBackupMetadata(null);
      onRefresh();
    } catch (err: any) {
      setRestoreError(err.message || 'Restore failed.');
    } finally {
      restorePending.current = false; setIsProcessing(false);
    }
  };

  const includedRows = candidateRows.filter(row => !excluded.has(row.rowNumber));
  const targetChanged = previewSectionId !== classSection?.id;
  const hasBlockingErrors = targetChanged || mappingDirty || previewDirty || !includedRows.length || includedRows.some(r => r.status === 'error' || r.error !== null);
  const errorCount = includedRows.filter(r => r.status === 'error' || r.error !== null).length;
  const newCount = includedRows.filter(r => r.status === 'new').length;
  const existingEnrollingCount = includedRows.filter(r => r.status === 'existing_enrolling').length;
  const alreadyEnrolledCount = includedRows.filter(r => r.status === 'already_enrolled').length;

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
          <span className="text-xs text-slate-400 font-medium">{importStep === 'input' ? 'Paste or Upload' : importStep === 'preview' ? 'Map, Review & Confirm' : 'Complete'}</span>
        </div>

        {importStep === 'input' && (
          <div className="space-y-5">
            {/* Spreadsheet Instructions & Visual Example */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-3">
              <p className="text-slate-700 leading-relaxed font-medium">
                Copy a table from your school spreadsheet or web page and paste it below. Extra columns and any column order are supported. Choose your name and student-number columns in the preview.
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
                You can include or omit the header row. Parsing stays on this device. CSV/TSV files still work; direct PDF, OCR and XLSX import are not supported.
              </p>
            </div>

            {/* Paste Box */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Paste Class List
              </label>
              <textarea
                disabled={isProcessing}
                onPaste={event => {
                  event.preventDefault();
                  try {
                    const pasted = clipboardRosterText(event.clipboardData.getData('text/html'), event.clipboardData.getData('text/plain'));
                    const target = event.currentTarget;
                    const nextText = rosterText.slice(0, target.selectionStart) + pasted.text + rosterText.slice(target.selectionEnd);
                    if (nextText.length > MAX_ROSTER_CHARS) throw new Error('Class list is too large. Limit: 1,000,000 characters.');
                    setRosterText(nextText);
                    setPasteNotice(pasted.notice);
                    setPreviewError(null);
                  } catch (err: any) { setPreviewError(err.message || 'Could not read copied table.'); }
                }}
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

            {pasteNotice && <p role="status" className="text-xs text-slate-600">{pasteNotice}</p>}
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
            {table && mapping && <fieldset disabled={isProcessing} className="space-y-3 border rounded-xl p-4" data-testid="roster-mapping">
              <legend className="font-bold text-sm">Column mapping</legend>
              <p className="text-xs">Check each suggestion. Unselected columns are ignored. Choose OEN or local student ID explicitly if both are present. Applying mapping replaces preview edits and exclusions.</p>
              <label className="block text-sm"><input type="checkbox" checked={hasHeader} onChange={e => { setHasHeader(e.target.checked); setMappingDirty(true); }} /> First nonblank row is a header (exclude it)</label>
              <label className="block text-sm">Name interpretation <select aria-label="Name interpretation" value={mapping.nameOrder} onChange={e => { setMapping({ ...mapping, nameOrder: e.target.value as RosterMapping['nameOrder'] }); setMappingDirty(true); }}>
                <option value="separate">Separate first and last name columns</option>
                <option value="last_comma_first">Combined: Last name, First name</option>
                <option value="first_last">Combined: First Last (exactly two parts; edit multipart names)</option>
              </select></label>
              <div className="flex flex-wrap gap-3">
                {(mapping.nameOrder === 'separate' ? ['first', 'last', 'number'] as const : ['name', 'number'] as const).map(field => <label key={field} className="text-sm">
                  {{ first: 'First name', last: 'Last name', name: 'Combined name', number: 'Student number' }[field]}
                  <select aria-label={`Column for ${field}`} value={mapping[field]} onChange={e => { setMapping({ ...mapping, [field]: Number(e.target.value) }); setMappingDirty(true); }} className="block border rounded p-1 max-w-64">
                    <option value={-1}>Choose column…</option>
                    {Array.from({ length: table.columnCount }, (_, index) => <option key={index} value={index}>Column {index + 1}: {table.rows[0]?.cells[index]?.slice(0, 60) || '(blank)'}</option>)}
                  </select>
                </label>)}
              </div>
              <div className="overflow-auto max-h-40 text-xs"><table><tbody>{table.rows.slice(0, 4).map(row => <tr key={row.rowNumber}>{row.cells.map((cell, index) => <td key={index} className="border p-1 whitespace-pre-wrap">{cell}</td>)}</tr>)}</tbody></table></div>
              {mappingDirty && <p role="status" className="text-amber-800 text-xs">Apply the mapping before importing. Review the header checkbox; no uncertain data row is automatically excluded.</p>}
              <button type="button" onClick={applyMapping} data-testid="apply-roster-mapping" className="px-3 py-2 border rounded">Apply mapping</button>
            </fieldset>}
            <p className="text-xs">Edit fields below, or explicitly exclude a row. Excluded rows stay visible and are never saved. Omitted students are not removed from this class. Same-name students with different IDs stay separate.</p>
            <p className="text-sm" data-testid="roster-exclusions">{excluded.size} explicitly excluded · {includedRows.length} included</p>
            {targetChanged && <p role="alert" className="text-amber-800 text-sm">The selected class changed. Recheck this preview against the selected class before saving. Your edits and exclusions are retained.</p>}
            {(previewDirty || targetChanged) && <button type="button" disabled={isProcessing || mappingDirty} onClick={recheckPreview} data-testid="recheck-roster-preview" className="border rounded px-3 py-2">Recheck edited preview</button>}
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
                  <div className="font-bold">Review required before import</div>
                  <p className="mt-0.5 text-red-700">
                    Correct or explicitly exclude affected rows, then recheck the preview. Apply any changed mapping before importing.
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
                    <th className="py-2.5 px-3">Include</th>
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
                      <td className="py-2 px-3"><input type="checkbox" aria-label={`Include row ${row.rowNumber}`} checked={!excluded.has(row.rowNumber)} disabled={isProcessing || mappingDirty} onChange={e => {
                        const next = new Set(excluded);
                        if (e.target.checked) next.delete(row.rowNumber); else next.add(row.rowNumber);
                        setExcluded(next); setPreviewDirty(true);
                      }} />{excluded.has(row.rowNumber) && <span>Excluded</span>}</td>
                      {(['lastName', 'firstName', 'studentNumber'] as const).map(field => <td key={field} className="py-2 px-3">
                        <input type="text" aria-label={`Row ${row.rowNumber} ${field}`} value={row[field]} disabled={isProcessing || mappingDirty || excluded.has(row.rowNumber)} className="border rounded p-1 w-36" onChange={e => {
                          setCandidateRows(candidateRows.map(current => current.rowNumber === row.rowNumber ? { ...validateEditedRosterRow({ ...current, [field]: e.target.value }), status: 'new' } : current));
                          setSourceErrors({ ...sourceErrors, [row.rowNumber]: validateEditedRosterRow({ ...row, [field]: e.target.value }).error });
                          setPreviewDirty(true);
                        }} />
                      </td>)}
                      <td className="py-2 px-3">
                        {excluded.has(row.rowNumber) && <span className="text-slate-500">Excluded</span>}
                        {row.status === 'new' && !excluded.has(row.rowNumber) && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            New Student
                          </span>
                        )}
                        {row.status === 'existing_enrolling' && !excluded.has(row.rowNumber) && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                            Existing Student
                          </span>
                        )}
                        {row.status === 'already_enrolled' && !excluded.has(row.rowNumber) && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            Already in Class
                          </span>
                        )}
                        {row.status === 'error' && !excluded.has(row.rowNumber) && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">
                            Needs Correction
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-[11px]">
                        <details><summary>Source row</summary><span className="whitespace-pre-wrap">{row.rawText}</span></details>
                        {excluded.has(row.rowNumber) ? <span>Explicitly excluded — will not be imported. {row.error}</span> : row.error ? (
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
                disabled={isProcessing}
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
                  disabled={isProcessing}
                  onClick={() => {
                    setImportStep('input');
                    setRosterText('');
                    setCandidateRows([]);
                    setExcluded(new Set());
                    setPasteNotice('');
                    setPreviewError(null);
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
                  Students have been enrolled into <strong>{importTargetTitle}</strong>.
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

            <p className="text-sm text-emerald-900">Next, open Class View and choose Populate seating to place unassigned students in empty desks. Existing assignments stay in place.</p>
            <div className="flex justify-end gap-2 pt-3">
              {onOpenSeating && <button type="button" onClick={onOpenSeating} className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl">Open Class View</button>}
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
                {protectedMode ? 'Creates an authenticated encrypted copy of the complete working bundle, including private feedback and recovery versions. Keep the recovery code separately.' : 'Generates an offline JSON snapshot of all your classes, students, marks, and settings. The file is not encrypted.'}
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={handleCreateBackup}
                data-testid="create-backup-btn"
                disabled={isProcessing}
                className="w-full inline-flex items-center justify-center space-x-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-xs transition"
              >
                <DownloadCloud className="w-4 h-4" />
                <span>{protectedMode ? 'Save Encrypted Backup File' : 'Download Full Backup'}</span>
              </button>
              {backupExportError && <p role="alert" className="mt-2 text-xs text-amber-800">{backupExportError}</p>}
              {backupDownloadStatus && (
                <div role="status" className="mt-2 text-xs font-semibold text-emerald-700 text-center">
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
                Select a previously saved backup file from this device or Files. Restoring replaces this device’s records; changes from different devices are not combined.
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
                disabled={protectedMode || isProcessing}
              />
              <button
                type="button"
                onClick={handleChooseBackup}
                data-testid="choose-backup-file-btn"
                disabled={isProcessing}
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
              <span>{protectedMode ? 'Protected restore needs attention' : 'Restore Rejected: Database Left Intact'}</span>
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
                  {protectedMode ? 'Restoring replaces the complete encrypted working bundle, including private feedback and recovery history. A verified encrypted safety version is kept first; secure startup reopens after success. The preserved original workspace is separate.' : 'Restoring will completely replace your current local database with the contents of this backup file. All current data will be overwritten.'}
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
                  if (isProcessing || restorePending.current) return;
                  backupPreviewGeneration.current++; setProtectedRestoreToken(null); setPendingBackupContent(null);
                  setPendingBackupMetadata(null);
                }}
                disabled={isProcessing}
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
