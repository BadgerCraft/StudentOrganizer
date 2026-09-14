import React, { useState } from 'react';
import {
  DownloadCloud,
  Upload,
  FileSpreadsheet,
  Database,
  CheckCircle2,
  AlertCircle,
  FileText
} from 'lucide-react';
import type { ClassSection, UUID } from '../types/schema';
import { PortabilityService } from '../services/portabilityService';
import { db } from '../db/database';

interface ImportExportModalProps {
  classSection: ClassSection | null;
  onRefresh: () => void;
}

export const ImportExportModal: React.FC<ImportExportModalProps> = ({
  classSection,
  onRefresh
}) => {
  const [csvText, setCsvText] = useState('');
  const [parseStatus, setParseStatus] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [restoreText, setRestoreText] = useState('');

  const portability = new PortabilityService(db);

  const handleExportMarkbook = async () => {
    if (!classSection) return;
    try {
      const csv = await portability.exportClassMarkbookCSV(classSection.id, null);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Markbook-${classSection.sectionNumber}-${new Date().toISOString().slice(0,10)}.csv`;
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
      a.download = `Participation-Events-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCreateBackup = async () => {
    try {
      const json = await portability.createFullBackupJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `OntarioTeacherApp-FullBackup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupStatus('Backup successfully generated and downloaded!');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRestoreBackup = async () => {
    if (!restoreText.trim()) return;
    if (!confirm('Restoring will replace current local data with the backup. Continue?')) return;
    try {
      const res = await portability.restoreFromJSON(restoreText);
      alert(`Restored ${res.restoredTables} tables and ${res.totalRecords} records!`);
      setRestoreText('');
      onRefresh();
    } catch (err: any) {
      alert('Restore failed: ' + err.message);
    }
  };

  const handleImportRoster = async () => {
    if (!classSection || !csvText.trim()) return;
    try {
      const lines = csvText.trim().split(/\r?\n/);
      if (lines.length < 2) {
        setParseStatus('CSV must have header and at least one student row.');
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
      const numIdx = headers.findIndex(h => h.includes('id') || h.includes('number'));
      const lastIdx = headers.findIndex(h => h.includes('last'));
      const firstIdx = headers.findIndex(h => h.includes('first'));

      if (lastIdx === -1 || firstIdx === -1) {
        setParseStatus('CSV must include "First Name" and "Last Name" columns.');
        return;
      }

      const org = await db.organizations.where('organizationType').equals('school').first();
      const now = new Date().toISOString();
      let importedCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(p => p.trim().replace(/^"|"$/g, ''));
        if (parts.length < 2) continue;

        const first = parts[firstIdx];
        const last = parts[lastIdx];
        const num = numIdx !== -1 && parts[numIdx] ? parts[numIdx] : `S${Date.now().toString().slice(-5)}${i}`;

        if (!first || !last) continue;

        const studentId = crypto.randomUUID();
        const enrId = crypto.randomUUID();

        await db.students.add({
          id: studentId,
          organizationId: org ? org.id : 'org-school-port-credit',
          localStudentNumber: num,
          oenEncrypted: null,
          firstName: first,
          lastName: last,
          preferredName: null,
          pronouns: null,
          photoUrl: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        });

        await db.classEnrollments.add({
          id: enrId,
          classSectionId: classSection.id,
          studentId,
          enrollmentStatus: 'active',
          enrolledDate: now.slice(0, 10),
          droppedDate: null,
          customDisplayOrder: i,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        });

        importedCount++;
      }

      setParseStatus(`Successfully imported ${importedCount} student(s) to this class!`);
      setCsvText('');
      onRefresh();
    } catch (err: any) {
      setParseStatus('Import error: ' + err.message);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          Data Portability, CSV Exports &amp; System Backups
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Export Ontario-standard gradebook sheets, raw participation observation logs, and manage full offline JSON backups.
        </p>
      </div>

      {/* Grid of Action Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Class Exports */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 text-blue-600 mb-2">
              <FileSpreadsheet className="w-5 h-5" />
              <h2 className="text-base font-bold text-slate-900">Ontario Markbook CSV Export</h2>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Exports a spreadsheet containing alphabetical students, overall percentages, and separate category subcolumns for every assessed K, T, C, and A criteria.
            </p>
          </div>
          <button
            onClick={handleExportMarkbook}
            disabled={!classSection}
            className="w-full inline-flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm transition disabled:opacity-50"
          >
            <DownloadCloud className="w-4 h-4" />
            <span>Download Class Markbook CSV</span>
          </button>
        </div>

        {/* 2. Participation Exports */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 text-emerald-600 mb-2">
              <FileText className="w-5 h-5" />
              <h2 className="text-base font-bold text-slate-900">Raw Participation Log CSV</h2>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Exports the complete raw evidence ledger including exact UTC timestamps, local dates, student names, classification, points, and pedagogical notes.
            </p>
          </div>
          <button
            onClick={handleExportParticipation}
            disabled={!classSection}
            className="w-full inline-flex items-center justify-center space-x-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm transition disabled:opacity-50"
          >
            <DownloadCloud className="w-4 h-4" />
            <span>Download Participation Events CSV</span>
          </button>
        </div>

        {/* 3. CSV Roster Import */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm md:col-span-2 space-y-4">
          <div className="flex items-center space-x-2 text-purple-600">
            <Upload className="w-5 h-5" />
            <h2 className="text-base font-bold text-slate-900">Import Student Roster from CSV</h2>
          </div>
          <p className="text-xs text-slate-600">
            Paste CSV text with columns: <code>Student ID, Last Name, First Name</code>.
          </p>

          <textarea
            rows={4}
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            placeholder="Student ID, Last Name, First Name&#10;S10981, Smith, Jordan&#10;S10982, Chen, Alex"
            className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />

          {parseStatus && (
            <div className="text-xs font-semibold text-blue-700 bg-blue-50 p-3 rounded-xl border border-blue-200">
              {parseStatus}
            </div>
          )}

          <button
            onClick={handleImportRoster}
            disabled={!classSection || !csvText.trim()}
            className="inline-flex items-center space-x-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-sm transition disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            <span>Import Roster into Active Class</span>
          </button>
        </div>

        {/* 4. Full System Backup & Restore */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm md:col-span-2 space-y-4">
          <div className="flex items-center space-x-2 text-slate-800">
            <Database className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">Complete Offline JSON Backup &amp; Restore</h2>
          </div>
          <p className="text-xs text-slate-600">
            Back up all 34 tables including seating layouts, rubrics, category results, audit trails, and participation records to an offline JSON snapshot.
          </p>

          <div className="flex flex-wrap gap-4 pt-2">
            <button
              onClick={handleCreateBackup}
              className="inline-flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm transition"
            >
              <DownloadCloud className="w-4 h-4" />
              <span>Create Full JSON Backup</span>
            </button>
          </div>

          {backupStatus && (
            <div className="text-xs text-emerald-700 font-semibold bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
              {backupStatus}
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 space-y-2">
            <label className="block text-xs font-bold text-slate-700">Restore from JSON Backup</label>
            <textarea
              rows={3}
              value={restoreText}
              onChange={e => setRestoreText(e.target.value)}
              placeholder="Paste JSON backup contents here to restore..."
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-xl"
            />
            <button
              onClick={handleRestoreBackup}
              disabled={!restoreText.trim()}
              className="inline-flex items-center space-x-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-sm transition disabled:opacity-50"
            >
              <span>Restore Database</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
