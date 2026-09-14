import React, { useState } from 'react';
import {
  X,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  Users,
  Check,
  Tag,
  FileText
} from 'lucide-react';
import type {
  AchievementCategoryCode,
  ClassEnrollment,
  Student,
  ParticipationEventType,
  EventClassification,
  UUID
} from '../types/schema';

interface ParticipationDockProps {
  selectedEnrollments: { enrollment: ClassEnrollment; student: Student }[];
  eventTypes: ParticipationEventType[];
  onRecordEvent: (params: {
    eventTypeId: UUID;
    name: string;
    classification: EventClassification;
    points: number;
    categoryCode?: AchievementCategoryCode | null;
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
  onRecordEvent,
  onClearSelection,
  lastBatchUndo,
  onUndo
}) => {
  const [selectedCategory, setSelectedCategory] = useState<AchievementCategoryCode | null>(null);
  const [note, setNote] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);

  const positiveEvents = eventTypes.filter(e => e.classification === 'positive' && !e.isArchived);
  const needsFollowupEvents = eventTypes.filter(e => e.classification === 'needs_followup' && !e.isArchived);

  const handleEventClick = (et: ParticipationEventType) => {
    onRecordEvent({
      eventTypeId: et.id,
      name: et.name,
      classification: et.classification,
      points: et.defaultPoints,
      categoryCode: selectedCategory,
      note: note.trim() || null
    });
    setNote('');
    setShowNoteInput(false);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex flex-col items-center pb-4 px-4">
      {/* Non-Blocking Undo Toast Banner */}
      {lastBatchUndo && (
        <div className="pointer-events-auto mb-3 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center space-x-3 border border-slate-700 animate-bounce transition">
          <span className="text-xs">
            Logged <strong>{lastBatchUndo.eventName}</strong> for {lastBatchUndo.studentCount} student(s).
          </span>
          <button
            onClick={() => onUndo(lastBatchUndo.batchId)}
            className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-2.5 py-1 rounded-lg transition active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>
        </div>
      )}

      {/* Main Participation Control Dock (Visible when students selected) */}
      {selectedEnrollments.length > 0 && (
        <div className="pointer-events-auto bg-white border border-slate-300/80 rounded-2xl shadow-2xl p-4 max-w-4xl w-full mx-auto animate-in slide-in-from-bottom-5 duration-150">
          {/* Top Bar: Target students & quick category tag */}
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
                  (Click any event below to record instantly)
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {/* Optional Category Tag Selector */}
              <div className="flex items-center space-x-1 bg-slate-50 p-0.5 rounded-lg border border-slate-200 text-[11px] font-semibold">
                <span className="text-slate-600 px-1.5">Tag Category:</span>
                {(['K', 'T', 'C', 'A'] as AchievementCategoryCode[]).map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                    className={`px-2 py-0.5 rounded transition ${
                      selectedCategory === cat
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

              {/* Toggle Note Input */}
              <button
                onClick={() => setShowNoteInput(!showNoteInput)}
                className={`p-1.5 rounded-lg border text-xs transition ${
                  showNoteInput || note ? 'bg-blue-50 border-blue-200 text-blue-700' : 'text-slate-500 border-slate-200 hover:bg-slate-50'
                }`}
                title="Add observation note"
              >
                <FileText className="w-4 h-4" />
              </button>

              {/* Close / Deselect */}
              <button
                onClick={onClearSelection}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Optional Note Row */}
          {showNoteInput && (
            <div className="mb-3">
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Optional observation note (e.g. 'Synthesized perspective effectively')..."
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
          )}

          {/* Event Buttons Grid: Positive and Needs Follow-up */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                    onClick={() => handleEventClick(et)}
                    className="flex items-center space-x-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200/80 px-3 py-2 rounded-xl text-xs font-semibold transition text-left active:scale-95 shadow-sm"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="truncate">{et.name}</span>
                  </button>
                ))}
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
                    onClick={() => handleEventClick(et)}
                    className="flex items-center space-x-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200/80 px-3 py-2 rounded-xl text-xs font-semibold transition text-left active:scale-95 shadow-sm"
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <span className="truncate">{et.name}</span>
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
