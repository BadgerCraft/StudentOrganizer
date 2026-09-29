import React, { useState } from 'react';
import {
  X,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  FileText,
  Clock,
  Calendar,
  Eye
} from 'lucide-react';
import type {
  AchievementCategoryCode,
  AchievementLevel,
  ClassEnrollment,
  Student,
  ParticipationEventType,
  UUID
} from '../types/schema';
import { getSchoolLocalDate } from '../utils/dateUtils';

interface ParticipationDockProps {
  selectedEnrollments: { enrollment: ClassEnrollment; student: Student }[];
  eventTypes: ParticipationEventType[];
  selectedSchoolDate: string;
  historicalLocalTime?: string;
  onHistoricalTimeChange?: (time: string) => void;
  onRecordEvent: (params: {
    eventTypeId: UUID;
    achievementLevel?: AchievementLevel;
    categoryOverride?: AchievementCategoryCode | null | 'DEFAULT';
    note?: string | null;
  }) => void;
  onClearSelection: () => void;
  lastBatchUndo: {
    batchId: UUID;
    eventName: string;
    studentCount: number;
  } | null;
  onUndo: (batchId: UUID) => void;
}

export const ParticipationDock: React.FC<ParticipationDockProps> = ({
  selectedEnrollments,
  eventTypes,
  selectedSchoolDate,
  historicalLocalTime = '09:00',
  onHistoricalTimeChange,
  onRecordEvent,
  onClearSelection,
  lastBatchUndo,
  onUndo
}) => {
  const [categoryOverride, setCategoryOverride] = useState<AchievementCategoryCode | null | 'DEFAULT'>('DEFAULT');
  const [note, setNote] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [pendingLevelEventType, setPendingLevelEventType] = useState<ParticipationEventType | null>(null);

  const today = getSchoolLocalDate();
  const isHistorical = selectedSchoolDate !== today;

  // Filter and sort active event types by classification and sortOrder
  const positiveEvents = eventTypes
    .filter(e => e.classification === 'positive' && !e.isArchived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const neutralEvents = eventTypes
    .filter(e => e.classification === 'neutral' && !e.isArchived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const needsFollowupEvents = eventTypes
    .filter(e => e.classification === 'needs_followup' && !e.isArchived)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const handleEventClick = (et: ParticipationEventType) => {
    if (et.recordingMode === 'level_1_4') {
      // Level 1-4 requires selecting a level first; 0 writes before level chosen
      setPendingLevelEventType(et);
      return;
    }

    // Quick-Tally mode records immediately
    onRecordEvent({
      eventTypeId: et.id,
      categoryOverride,
      note: note.trim() || null
    });
    setNote('');
    setShowNoteInput(false);
  };

  const handleSelectLevel = (level: AchievementLevel) => {
    if (!pendingLevelEventType) return;
    onRecordEvent({
      eventTypeId: pendingLevelEventType.id,
      achievementLevel: level,
      categoryOverride,
      note: note.trim() || null
    });
    setPendingLevelEventType(null);
    setNote('');
    setShowNoteInput(false);
  };

  const handleCancelLevel = () => {
    setPendingLevelEventType(null);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex flex-col items-center pb-4 px-4">
      {/* Non-Blocking Undo Toast Banner */}
      {lastBatchUndo && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto mb-3 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-2xl flex items-center space-x-3 border border-slate-700 transition"
        >
          <span className="text-xs">
            Logged <strong>{lastBatchUndo.eventName}</strong> for {lastBatchUndo.studentCount} student(s).
          </span>
          <button
            data-testid="undo-toast-btn"
            aria-label="Undo last participation record"
            onClick={() => onUndo(lastBatchUndo.batchId)}
            className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-2.5 py-1 rounded-lg transition active:scale-95 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>
        </div>
      )}

      {/* Main Participation Control Dock (Visible when students selected) */}
      {selectedEnrollments.length > 0 && (
        <div className="pointer-events-auto bg-white border border-slate-300/80 rounded-2xl shadow-2xl p-4 max-w-5xl w-full mx-auto animate-in slide-in-from-bottom-5 duration-150">
          {/* Historical Date Notice Banner */}
          {isHistorical && (
            <div
              data-testid="historical-date-warning"
              className="mb-3 px-3 py-1.5 bg-amber-50 border border-amber-300/80 rounded-xl flex items-center justify-between text-xs text-amber-900"
            >
              <div className="flex items-center space-x-2 font-bold">
                <Calendar className="w-4 h-4 text-amber-600" />
                <span>Recording for {selectedSchoolDate} (Historical)</span>
              </div>
              <div className="flex items-center space-x-1.5 font-medium">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <label htmlFor="historical-time-input" className="text-[11px] text-amber-800">
                  Observation Time (Toronto):
                </label>
                <input
                  id="historical-time-input"
                  data-testid="historical-time-input"
                  type="time"
                  value={historicalLocalTime}
                  onChange={e => onHistoricalTimeChange?.(e.target.value)}
                  className="px-2 py-0.5 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold"
                />
              </div>
            </div>
          )}

          {/* Top Bar: Target students & quick actions */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                {selectedEnrollments.length === 1 ? '1' : selectedEnrollments.length}
              </div>
              <div>
                <span className="font-bold text-slate-900 text-sm">
                  {selectedEnrollments.length === 1
                    ? `${selectedEnrollments[0].student.preferredName || selectedEnrollments[0].student.firstName} ${selectedEnrollments[0].student.lastName}`
                    : `${selectedEnrollments.length} Students Selected`}
                </span>
                <span className="text-xs text-slate-500 ml-2">
                  (Choose an observation or quick-tally button below)
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {/* Category Override Selector */}
              <div className="flex items-center space-x-1 bg-slate-50 p-0.5 rounded-lg border border-slate-200 text-[11px] font-semibold">
                <span className="text-slate-600 px-1.5">Category:</span>
                <button
                  onClick={() => setCategoryOverride('DEFAULT')}
                  className={`px-2 py-0.5 rounded transition ${
                    categoryOverride === 'DEFAULT'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-600 hover:bg-slate-200'
                  }`}
                  title="Use button's default category"
                >
                  Default
                </button>
                <button
                  onClick={() => setCategoryOverride(null)}
                  className={`px-2 py-0.5 rounded transition ${
                    categoryOverride === null
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-600 hover:bg-slate-200'
                  }`}
                  title="Force no category"
                >
                  None
                </button>
                {(['K', 'T', 'C', 'A'] as AchievementCategoryCode[]).map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCategoryOverride(cat)}
                    className={`px-2 py-0.5 rounded transition ${
                      categoryOverride === cat
                        ? cat === 'K' ? 'bg-blue-600 text-white' :
                          cat === 'T' ? 'bg-purple-600 text-white' :
                          cat === 'C' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
                        : 'text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Visible "Add note" button */}
              <button
                data-testid="toggle-note-btn"
                onClick={() => setShowNoteInput(!showNoteInput)}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg border text-xs font-bold transition ${
                  showNoteInput || note.trim()
                    ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-sm'
                    : 'text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
                title="Add or edit observation note"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{note.trim() ? 'Note Attached' : 'Add Note'}</span>
              </button>

              {/* Close / Deselect */}
              <button
                onClick={onClearSelection}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                title="Close"
                aria-label="Close dock"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Level 1-4 Selection Overlay / Tray */}
          {pendingLevelEventType && (
            <div
              data-testid="level-selector-tray"
              className="mb-3 p-4 bg-indigo-50 border-2 border-indigo-300 rounded-xl animate-in zoom-in-95 duration-150"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-sm font-bold text-indigo-950 flex items-center space-x-1.5">
                    <span>Select Ontario Achievement Level:</span>
                    <span className="underline decoration-indigo-400">{pendingLevelEventType.name}</span>
                  </h4>
                  <p className="text-[11px] text-indigo-700">
                    Observational evidence only &bull; 0 formal mark impact &bull; 0 tally points recorded
                  </p>
                </div>
                <button
                  data-testid="cancel-level-btn"
                  onClick={handleCancelLevel}
                  className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2 pt-1">
                <button
                  data-testid="level-1-btn"
                  onClick={() => handleSelectLevel(1)}
                  className="flex flex-col items-center justify-center p-2.5 bg-white hover:bg-amber-50 border-2 border-amber-300 hover:border-amber-500 rounded-xl transition shadow-sm group active:scale-95"
                >
                  <span className="text-base font-black text-amber-900 group-hover:scale-110 transition">Level 1</span>
                  <span className="text-[10px] text-amber-700 font-medium">50–59% &bull; Limited</span>
                </button>
                <button
                  data-testid="level-2-btn"
                  onClick={() => handleSelectLevel(2)}
                  className="flex flex-col items-center justify-center p-2.5 bg-white hover:bg-sky-50 border-2 border-sky-300 hover:border-sky-500 rounded-xl transition shadow-sm group active:scale-95"
                >
                  <span className="text-base font-black text-sky-900 group-hover:scale-110 transition">Level 2</span>
                  <span className="text-[10px] text-sky-700 font-medium">60–69% &bull; Some</span>
                </button>
                <button
                  data-testid="level-3-btn"
                  onClick={() => handleSelectLevel(3)}
                  className="flex flex-col items-center justify-center p-2.5 bg-white hover:bg-emerald-50 border-2 border-emerald-400 hover:border-emerald-600 rounded-xl transition shadow-sm group active:scale-95"
                >
                  <span className="text-base font-black text-emerald-950 group-hover:scale-110 transition">Level 3</span>
                  <span className="text-[10px] text-emerald-800 font-medium">70–79% &bull; Standard</span>
                </button>
                <button
                  data-testid="level-4-btn"
                  onClick={() => handleSelectLevel(4)}
                  className="flex flex-col items-center justify-center p-2.5 bg-white hover:bg-purple-50 border-2 border-purple-400 hover:border-purple-600 rounded-xl transition shadow-sm group active:scale-95"
                >
                  <span className="text-base font-black text-purple-950 group-hover:scale-110 transition">Level 4</span>
                  <span className="text-[10px] text-purple-800 font-medium">80–100% &bull; Thorough</span>
                </button>
              </div>
            </div>
          )}

          {/* Observation Note Input */}
          {showNoteInput && (
            <div className="mb-3 bg-slate-50 p-3 rounded-xl border border-slate-200 animate-in fade-in duration-100">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="observation-note-input" className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span>Observation Note (attaches to the event recorded next)</span>
                </label>
                <span className="text-[10px] text-slate-500">Optional &bull; Max 1,000 characters</span>
              </div>
              <input
                id="observation-note-input"
                data-testid="observation-note-input"
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={1000}
                placeholder="e.g., Demonstrated thorough understanding during discussion..."
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                autoFocus
              />
              <p className="text-[11px] text-slate-500 mt-1.5">
                {selectedEnrollments.length === 1 ? (
                  <span>
                    Note will attach to <strong>{selectedEnrollments[0].student.preferredName || selectedEnrollments[0].student.firstName} {selectedEnrollments[0].student.lastName}</strong>'s observation.
                  </span>
                ) : (
                  <span className="text-amber-700 font-medium">
                    ⚠️ Multi-student selection: This identical note will be attached to each of the <strong>{selectedEnrollments.length}</strong> selected students.
                  </span>
                )}
              </p>
            </div>
          )}

          {/* Event Buttons: Positive, Neutral, and Needs Follow-up Groups */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Positive Events */}
            <div>
              <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center space-x-1 mb-1.5">
                <Sparkles className="w-3 h-3 text-emerald-600" />
                <span>Positive Contribution</span>
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {positiveEvents.map(et => (
                  <button
                    key={et.id}
                    data-testid="participation-event-btn"
                    aria-label={`Record ${et.name}`}
                    onClick={() => handleEventClick(et)}
                    className="flex flex-col justify-between bg-emerald-50 hover:bg-emerald-100 text-emerald-950 border border-emerald-200/80 p-2 rounded-xl text-xs font-semibold transition text-left active:scale-95 shadow-sm min-h-[52px]"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      <span className="truncate font-bold">{et.name}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-emerald-700 font-mono mt-1">
                      <span>{et.recordingMode === 'level_1_4' ? '1–4 Level' : `+${et.defaultPoints} pt`}</span>
                      {et.defaultCategoryCode && (
                        <span className="bg-emerald-200/70 text-emerald-800 px-1 rounded text-[9px] font-bold font-sans">
                          {et.defaultCategoryCode}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Neutral / Observation Events */}
            <div>
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-1 mb-1.5">
                <Eye className="w-3 h-3 text-slate-600" />
                <span>Observation / Neutral</span>
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {neutralEvents.map(et => (
                  <button
                    key={et.id}
                    data-testid="participation-event-btn"
                    aria-label={`Record ${et.name}`}
                    onClick={() => handleEventClick(et)}
                    className="flex flex-col justify-between bg-slate-50 hover:bg-slate-100 text-slate-900 border border-slate-200 p-2 rounded-xl text-xs font-semibold transition text-left active:scale-95 shadow-sm min-h-[52px]"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                      <span className="truncate font-bold">{et.name}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-600 font-mono mt-1">
                      <span>{et.recordingMode === 'level_1_4' ? '1–4 Level' : `${et.defaultPoints} pt`}</span>
                      {et.defaultCategoryCode && (
                        <span className="bg-slate-200 text-slate-700 px-1 rounded text-[9px] font-bold font-sans">
                          {et.defaultCategoryCode}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
                {neutralEvents.length === 0 && (
                  <div className="col-span-2 text-center text-[11px] text-slate-400 py-3 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                    No neutral buttons
                  </div>
                )}
              </div>
            </div>

            {/* Needs Follow-up Events */}
            <div>
              <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider flex items-center space-x-1 mb-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-700" />
                <span>Needs Follow-up</span>
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {needsFollowupEvents.map(et => (
                  <button
                    key={et.id}
                    data-testid="participation-event-btn"
                    aria-label={`Record ${et.name}`}
                    onClick={() => handleEventClick(et)}
                    className="flex flex-col justify-between bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-200/80 p-2 rounded-xl text-xs font-semibold transition text-left active:scale-95 shadow-sm min-h-[52px]"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                      <span className="truncate font-bold">{et.name}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-amber-800 font-mono mt-1">
                      <span>{et.recordingMode === 'level_1_4' ? '1–4 Level' : `${et.defaultPoints} pt`}</span>
                      {et.defaultCategoryCode && (
                        <span className="bg-amber-200/70 text-amber-900 px-1 rounded text-[9px] font-bold font-sans">
                          {et.defaultCategoryCode}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
