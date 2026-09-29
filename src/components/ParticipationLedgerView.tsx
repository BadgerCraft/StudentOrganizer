import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  History,
  Calendar,
  Trash2,
  Edit2,
  X
} from 'lucide-react';
import type {
  ClassSection,
  ClassEnrollment,
  Student,
  ParticipationEvent,
  ParticipationEventType,
  AchievementCategoryCode,
  UUID
} from '../types/schema';
import { db } from '../db/database';
import { ParticipationDomainService } from '../services/participationService';
import { getAppIdentity } from '../services/identityService';
import { AuthorizationError } from '../services/authHelper';
import { getSchoolLocalDate, shiftSchoolDate, formatTorontoDateTime } from '../utils/dateUtils';
import { ModalDialog } from './ModalDialog';

interface ParticipationLedgerViewProps {
  classSection: ClassSection;
  enrollments: ClassEnrollment[];
  students: Student[];
  eventTypes: ParticipationEventType[];
  userId?: UUID;
  deviceId?: UUID;
  onRefresh: () => void;
}

export const ParticipationLedgerView: React.FC<ParticipationLedgerViewProps> = ({
  classSection,
  enrollments,
  students,
  eventTypes,
  userId,
  deviceId,
  onRefresh
}) => {
  const today = getSchoolLocalDate();
  const [dateFilterMode, setDateFilterMode] = useState<'today' | 'last7' | 'last30' | 'all' | 'custom'>('last7');
  const [customStart, setCustomStart] = useState<string>(() => shiftSchoolDate(today, -6));
  const [customEnd, setCustomEnd] = useState<string>(today);

  const [filterCategory, setFilterCategory] = useState<'all' | AchievementCategoryCode>('all');
  const [filterClassification, setFilterClassification] = useState<'all' | 'positive' | 'neutral' | 'needs_followup'>('all');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('all');

  // Correction state
  const [editingEvent, setEditingEvent] = useState<ParticipationEvent | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [retractingEvent, setRetractingEvent] = useState<ParticipationEvent | null>(null);
  const [retractReason, setRetractReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const participationService = useMemo(() => new ParticipationDomainService(db), []);

  const studentMap = new Map<UUID, Student>();
  students.forEach(s => studentMap.set(s.id, s));

  const enrollmentMap = new Map<UUID, ClassEnrollment>();
  enrollments.forEach(e => enrollmentMap.set(e.id, e));

  // Determine date bounds
  const bounds = useMemo(() => {
    if (dateFilterMode === 'today') return { start: today, end: today };
    if (dateFilterMode === 'last7') return { start: shiftSchoolDate(today, -6), end: today };
    if (dateFilterMode === 'last30') return { start: shiftSchoolDate(today, -29), end: today };
    if (dateFilterMode === 'custom') return { start: customStart, end: customEnd };
    return null; // 'all'
  }, [dateFilterMode, today, customStart, customEnd]);

  // Indexed Live Query on compound index [classSectionId+localSchoolDate]
  const rawEvents = useLiveQuery(async () => {
    if (!classSection?.id) return [];

    let list: ParticipationEvent[];
    if (!bounds) {
      // All Dates for classSection
      list = await db.participationEvents
        .where('classSectionId')
        .equals(classSection.id)
        .filter(e => e.deletedAt === null)
        .toArray();
    } else {
      // Indexed range query on [classSectionId+localSchoolDate]
      list = await db.participationEvents
        .where('[classSectionId+localSchoolDate]')
        .between([classSection.id, bounds.start], [classSection.id, bounds.end], true, true)
        .filter(e => e.deletedAt === null)
        .toArray();
    }

    // Explicit deterministic sorting: newest occurredAt first, then id
    list.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
    return list;
  }, [classSection?.id, bounds]) || [];

  // Secondary in-memory filters (student, category, classification)
  const filteredEvents = useMemo(() => {
    return rawEvents.filter(e => {
      if (filterCategory !== 'all' && e.categoryCode !== filterCategory) return false;
      if (filterClassification !== 'all' && e.snapshottedClassification !== filterClassification) return false;
      if (selectedStudentId !== 'all') {
        const enr = enrollmentMap.get(e.classEnrollmentId);
        if (!enr || enr.studentId !== selectedStudentId) return false;
      }
      return true;
    });
  }, [rawEvents, filterCategory, filterClassification, selectedStudentId, enrollmentMap]);

  // Summaries
  const positiveCount = filteredEvents.filter(e => e.snapshottedClassification === 'positive').length;
  const neutralCount = filteredEvents.filter(e => e.snapshottedClassification === 'neutral').length;
  const needsFollowupCount = filteredEvents.filter(e => e.snapshottedClassification === 'needs_followup').length;
  const totalPoints = filteredEvents.reduce((acc, e) => acc + e.snapshottedPoints, 0);

  // Correction Handlers
  const handleOpenEditNote = (ev: ParticipationEvent) => {
    setEditingEvent(ev);
    setEditNoteText(ev.note || '');
    setActionError(null);
  };

  const getIdentity = async () => {
    const currentIdentity = await getAppIdentity(db);
    if (userId && userId !== currentIdentity.userId) {
      throw new AuthorizationError('Acting teacher has changed. Please refresh.');
    }
    return currentIdentity;
  };

  const handleSaveNote = async () => {
    if (!editingEvent) return;
    try {
      const id = await getIdentity();
      await participationService.updateEventNote(
        editingEvent.id,
        editingEvent.version,
        editNoteText,
        id.userId,
        id.deviceId
      );
      setEditingEvent(null);
      setActionError(null);
      onRefresh();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update observation note.');
    }
  };

  const handleOpenRetract = (ev: ParticipationEvent) => {
    setRetractingEvent(ev);
    setRetractReason('');
    setActionError(null);
  };

  const handleConfirmRetract = async () => {
    if (!retractingEvent) return;
    try {
      const id = await getIdentity();
      await participationService.retractEvent(
        retractingEvent.id,
        retractingEvent.version,
        id.userId,
        id.deviceId,
        retractReason
      );
      setRetractingEvent(null);
      setActionError(null);
      onRefresh();
    } catch (err: any) {
      setActionError(err.message || 'Failed to retract observation.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <History className="w-5 h-5 text-blue-600" />
            <span>Classroom Participation Ledger &amp; Observations</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Raw observational data indexed chronologically in America/Toronto local time. Audited and recoverable.
          </p>
        </div>
      </div>

      {/* Action Error Banner */}
      {actionError && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-2.5 rounded-xl text-xs flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg">
            {filteredEvents.length}
          </div>
          <div>
            <span className="text-xs font-bold text-slate-900">Total Observations</span>
            <span className="text-[11px] text-slate-500 block">Filtered in current date window</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-sm flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-lg">
            +{positiveCount}
          </div>
          <div>
            <span className="text-xs font-bold text-emerald-900">Positive Contributions</span>
            <span className="text-[11px] text-emerald-600 block">{totalPoints.toFixed(1)} cumulative points</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-lg">
            ~{neutralCount}
          </div>
          <div>
            <span className="text-xs font-bold text-slate-900">Neutral Observations</span>
            <span className="text-[11px] text-slate-500 block">Informational &amp; non-scoring</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold text-lg">
            !{needsFollowupCount}
          </div>
          <div>
            <span className="text-xs font-bold text-amber-900">Needs Follow-up</span>
            <span className="text-[11px] text-amber-700 block">Areas requiring pedagogical support</span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left: Date Range Preset Chips & Custom Range */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-700 flex items-center space-x-1 mr-1">
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            <span>Range:</span>
          </span>

          {[
            { id: 'today', label: 'Today' },
            { id: 'last7', label: 'Last 7 Days' },
            { id: 'last30', label: 'Last 30 Days' },
            { id: 'all', label: 'All Dates' },
            { id: 'custom', label: 'Custom Range' }
          ].map(preset => (
            <button
              key={preset.id}
              data-testid={`ledger-date-preset-${preset.id}`}
              onClick={() => setDateFilterMode(preset.id as any)}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition ${
                dateFilterMode === preset.id
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {preset.label}
            </button>
          ))}

          {dateFilterMode === 'custom' && (
            <div className="flex items-center space-x-1.5 ml-2">
              <input
                type="date"
                max={today}
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className="px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white font-mono"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                max={today}
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className="px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white font-mono"
              />
            </div>
          )}
        </div>

        {/* Right: Secondary Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Student Filter */}
          <select
            value={selectedStudentId}
            onChange={e => setSelectedStudentId(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 font-medium"
          >
            <option value="all">All Students ({students.length})</option>
            {students.map(s => (
              <option key={s.id} value={s.id}>
                {s.lastName}, {s.preferredName || s.firstName}
              </option>
            ))}
          </select>

          {/* Classification Filter */}
          <div className="flex items-center space-x-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs">
            <button
              onClick={() => setFilterClassification('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                filterClassification === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterClassification('positive')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                filterClassification === 'positive' ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-600'
              }`}
            >
              +
            </button>
            <button
              onClick={() => setFilterClassification('neutral')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                filterClassification === 'neutral' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600'
              }`}
            >
              ~
            </button>
            <button
              onClick={() => setFilterClassification('needs_followup')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                filterClassification === 'needs_followup' ? 'bg-white text-amber-800 shadow-sm' : 'text-slate-600'
              }`}
            >
              !
            </button>
          </div>

          {/* Category Filter */}
          <div className="flex items-center space-x-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs">
            {(['all', 'K', 'T', 'C', 'A'] as const).map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-2 py-1 rounded-lg font-bold transition ${
                  filterCategory === cat ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="py-3 px-4">Student</th>
              <th className="py-3 px-4">Observation</th>
              <th className="py-3 px-4">Classification</th>
              <th className="py-3 px-4">Mode</th>
              <th className="py-3 px-4">Level</th>
              <th className="py-3 px-4">Tally Pts</th>
              <th className="py-3 px-4">Category</th>
              <th className="py-3 px-4">Date &amp; Time (Toronto)</th>
              <th className="py-3 px-4">Note</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredEvents.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-400 italic">
                  No observation records match the current date window and filters.
                </td>
              </tr>
            ) : (
              filteredEvents.map(ev => {
                const enr = enrollmentMap.get(ev.classEnrollmentId);
                const std = enr ? studentMap.get(enr.studentId) : null;

                return (
                  <tr key={ev.id} data-testid="ledger-event-row" className="hover:bg-slate-50/70 transition">
                    <td className="py-3 px-4 font-bold text-slate-900">
                      {std ? `${std.lastName}, ${std.preferredName || std.firstName}` : 'Unknown'}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-800">
                      {ev.snapshottedName}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        ev.snapshottedClassification === 'positive'
                          ? 'bg-emerald-100 text-emerald-800'
                          : ev.snapshottedClassification === 'neutral'
                          ? 'bg-slate-100 text-slate-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {ev.snapshottedClassification}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {ev.snapshottedRecordingMode === 'level_1_4' ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Level Evidence
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-50 text-slate-700 border border-slate-200">
                          Quick Tally
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {ev.achievementLevel !== null && ev.achievementLevel !== undefined ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-900 border border-indigo-200">
                          Level {ev.achievementLevel}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] font-bold text-slate-700">
                      {ev.snapshottedPoints > 0 ? `+${ev.snapshottedPoints}` : ev.snapshottedPoints}
                    </td>
                    <td className="py-3 px-4">
                      {ev.categoryCode ? (
                        <span className="px-1.5 py-0.5 rounded font-extrabold text-[10px] bg-blue-100 text-blue-800">
                          {ev.categoryCode}
                        </span>
                      ) : (
                        <span className="text-slate-400">--</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                      {formatTorontoDateTime(ev.occurredAt)}
                    </td>
                    <td className="py-3 px-4 text-slate-700 max-w-xs">
                      {ev.note ? (
                        <span className="bg-slate-100 px-2 py-1 rounded text-slate-800 font-medium block truncate" title={ev.note}>
                          {ev.note}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">None</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end space-x-1">
                        <button
                          data-testid="edit-note-btn"
                          onClick={() => handleOpenEditNote(ev)}
                          className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                          title="Edit Note"
                          aria-label="Edit observation note"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          data-testid="retract-event-btn"
                          onClick={() => handleOpenRetract(ev)}
                          className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                          title="Retract Observation"
                          aria-label="Retract observation"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Note Modal */}
      <ModalDialog
        isOpen={editingEvent !== null}
        onClose={() => setEditingEvent(null)}
        title="Edit Observation Note"
        isDirty={editingEvent !== null && editNoteText !== (editingEvent.note || '')}
        confirmDiscardMessage="You have unsaved changes to this note. Discard them?"
        maxWidthClass="max-w-md"
        testId="edit-note-modal"
      >
        {({ requestDismiss }) => (
          <div>
            <p className="text-xs text-slate-500 mb-3">
              Modifies the note on <strong>{editingEvent?.snapshottedName}</strong>. Preserves audit history.
            </p>
            <textarea
              data-testid="edit-note-textarea"
              rows={3}
              value={editNoteText}
              onChange={e => setEditNoteText(e.target.value)}
              maxLength={1000}
              placeholder="Observation note..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              autoFocus
            />
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={requestDismiss}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="save-edit-note-btn"
                onClick={handleSaveNote}
                className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition shadow-sm"
              >
                Save Note
              </button>
            </div>
          </div>
        )}
      </ModalDialog>

      {/* Retract Confirmation Modal */}
      <ModalDialog
        isOpen={retractingEvent !== null}
        onClose={() => setRetractingEvent(null)}
        title="Retract Observation?"
        isDirty={retractReason.trim().length > 0}
        confirmDiscardMessage="You have entered a retraction reason. Discard it?"
        maxWidthClass="max-w-md"
        testId="retract-confirmation-modal"
      >
        {({ requestDismiss }) => (
          <div>
            <p className="text-xs text-slate-600 mb-3">
              This will soft-delete <strong>{retractingEvent?.snapshottedName}</strong> and recalculate daily points. Full audit history will be preserved.
            </p>
            <input
              data-testid="retract-reason-input"
              type="text"
              value={retractReason}
              onChange={e => setRetractReason(e.target.value)}
              maxLength={500}
              placeholder="Optional retraction reason (e.g. 'Accidental entry')..."
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
              autoFocus
            />
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={requestDismiss}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-retract-btn"
                onClick={handleConfirmRetract}
                className="px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition shadow-sm"
              >
                Confirm Retraction
              </button>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
};
