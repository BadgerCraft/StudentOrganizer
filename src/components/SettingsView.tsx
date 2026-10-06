import { ManualWindowsUpdate } from './ManualWindowsUpdate';
import { ClassSettingsService } from '../services/classSettingsService';
import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Settings,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Plus,
  ChevronUp,
  ChevronDown,
  Archive,
  RotateCcw,
  Edit2,
  X,
  Sparkles,
  Eye,
  AlertTriangle,
  Lock
} from 'lucide-react';
import type {
  GradingPolicy,
  MarkScaleEntry,
  ParticipationEventType,
  EventClassification,
  ParticipationRecordingMode,
  AchievementCategoryCode,
  UUID
} from '../types/schema';
import { db } from '../db/database';
import { ParticipationEventTypeService } from '../services/eventTypeService';
import { getAppIdentity } from '../services/identityService';
import { AuthorizationError } from '../services/authHelper';
import { ModalDialog } from './ModalDialog';

interface SettingsViewProps {
  policy: GradingPolicy | null;
  scaleEntries: MarkScaleEntry[];
  activeSectionId?: UUID | null;
  userId?: UUID;
  deviceId?: UUID;
  onRefresh: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  policy,
  scaleEntries,
  activeSectionId,
  userId,
  deviceId,
  onRefresh
}) => {
  const [weightK, setWeightK] = useState(policy?.weightK ?? 25);
  const [weightT, setWeightT] = useState(policy?.weightT ?? 25);
  const [weightC, setWeightC] = useState(policy?.weightC ?? 25);
  const [weightA, setWeightA] = useState(policy?.weightA ?? 25);
  const [excludeFormative, setExcludeFormative] = useState(policy?.excludeFormative ?? true);
  const [missingPolicy, setMissingPolicy] = useState(policy?.missingWorkPolicy ?? 'exclude');
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Event Type Management State
  const eventTypeService = useMemo(() => new ParticipationEventTypeService(db), []);
  const allEventTypes = useLiveQuery(
    () => eventTypeService.listEventTypesForSection(activeSectionId, true),
    [activeSectionId]
  ) || [];

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingType, setEditingType] = useState<ParticipationEventType | null>(null);
  const [eventTypeErrorMessage, setEventTypeErrorMessage] = useState<string | null>(null);
  const [eventTypeSuccessMessage, setEventTypeSuccessMessage] = useState<string | null>(null);
  const [confirmArchiveType, setConfirmArchiveType] = useState<ParticipationEventType | null>(null);

  // New Button Form State
  const [newName, setNewName] = useState('');
  const [newClassification, setNewClassification] = useState<EventClassification>('positive');
  const [newMode, setNewMode] = useState<ParticipationRecordingMode>('quick_tally');
  const [newPoints, setNewPoints] = useState(1);
  const [newCategory, setNewCategory] = useState<AchievementCategoryCode | 'NONE'>('NONE');

  // Edit Button Form State
  const [editName, setEditName] = useState('');
  const [editMode, setEditMode] = useState<ParticipationRecordingMode>('quick_tally');
  const [editPoints, setEditPoints] = useState(1);
  const [editCategory, setEditCategory] = useState<AchievementCategoryCode | 'NONE'>('NONE');

  const totalWeight = weightK + weightT + weightC + weightA;
  const isWeightValid = Math.abs(totalWeight - 100) < 0.001;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policy) return;
    if (!isWeightValid) {
      alert('Category weights must sum to exactly 100%.');
      return;
    }

    setEventTypeErrorMessage(null);
    try {
      const identity = await getIdentity();
      await new ClassSettingsService(db).updateGradingPolicy(policy.id, policy.version, {
        weightK, weightT, weightC, weightA, excludeFormative, missingWorkPolicy: missingPolicy
      }, identity);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
      onRefresh();
    } catch (error) {
      setSavedSuccess(false);
      setEventTypeErrorMessage(error instanceof Error ? error.message : 'Grading policy could not be saved.');
    }
  };

  const resetCreateForm = () => {
    setNewName('');
    setNewClassification('positive');
    setNewMode('quick_tally');
    setNewPoints(1);
    setNewCategory('NONE');
    setShowCreateModal(false);
    setEventTypeErrorMessage(null);
  };

  const getIdentity = async () => {
    const currentIdentity = await getAppIdentity(db);
    if (userId && userId !== currentIdentity.userId) {
      throw new AuthorizationError('Acting teacher has changed. Please refresh.');
    }
    return currentIdentity;
  };

  const handleCreateEventType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSectionId) {
      setEventTypeErrorMessage('Please select a class section first to configure custom buttons.');
      return;
    }
    setEventTypeErrorMessage(null);

    try {
      const id = await getIdentity();
      await eventTypeService.createEventType({
        classSectionId: activeSectionId,
        name: newName,
        classification: newClassification,
        recordingMode: newMode,
        defaultPoints: newMode === 'level_1_4' ? 0 : Number(newPoints),
        defaultCategoryCode: newCategory === 'NONE' ? null : newCategory,
        userId: id.userId,
        deviceId: id.deviceId
      });

      resetCreateForm();
      setEventTypeSuccessMessage(`Created button "${newName}" successfully.`);
      setTimeout(() => setEventTypeSuccessMessage(null), 3000);
    } catch (err: any) {
      setEventTypeErrorMessage(err.message || 'Failed to create button.');
    }
  };

  const handleOpenEdit = (et: ParticipationEventType) => {
    setEditingType(et);
    setEditName(et.name);
    setEditMode(et.recordingMode);
    setEditPoints(et.defaultPoints);
    setEditCategory(et.defaultCategoryCode || 'NONE');
    setEventTypeErrorMessage(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingType || !activeSectionId) return;
    setEventTypeErrorMessage(null);

    try {
      const id = await getIdentity();
      await eventTypeService.updateEventType({
        eventTypeId: editingType.id,
        expectedVersion: editingType.version,
        classSectionId: activeSectionId,
        name: editName,
        classification: editingType.classification,
        recordingMode: editMode,
        defaultPoints: editMode === 'level_1_4' ? 0 : Number(editPoints),
        defaultCategoryCode: editCategory === 'NONE' ? null : editCategory,
        userId: id.userId,
        deviceId: id.deviceId
      });

      setEditingType(null);
      setEventTypeSuccessMessage(`Updated button "${editName}". Historical events retain their original snapshot.`);
      setTimeout(() => setEventTypeSuccessMessage(null), 3000);
    } catch (err: any) {
      setEventTypeErrorMessage(err.message || 'Failed to update button.');
    }
  };

  const handleArchive = async (et: ParticipationEventType) => {
    if (!activeSectionId) return;
    try {
      const id = await getIdentity();
      await eventTypeService.archiveEventType({
        eventTypeId: et.id,
        expectedVersion: et.version,
        classSectionId: activeSectionId,
        userId: id.userId,
        deviceId: id.deviceId
      });
      setConfirmArchiveType(null);
      setEventTypeSuccessMessage(`Archived "${et.name}". Historical records remain intact.`);
      setTimeout(() => setEventTypeSuccessMessage(null), 3000);
    } catch (err: any) {
      setEventTypeErrorMessage(err.message || 'Failed to archive button.');
    }
  };

  const handleRestore = async (et: ParticipationEventType) => {
    if (!activeSectionId) return;
    try {
      const id = await getIdentity();
      await eventTypeService.restoreEventType({
        eventTypeId: et.id,
        expectedVersion: et.version,
        classSectionId: activeSectionId,
        userId: id.userId,
        deviceId: id.deviceId
      });
      setEventTypeSuccessMessage(`Restored "${et.name}" to the active observation dock.`);
      setTimeout(() => setEventTypeSuccessMessage(null), 3000);
    } catch (err: any) {
      setEventTypeErrorMessage(err.message || 'Failed to restore button.');
    }
  };

  const handleReorder = async (et: ParticipationEventType, direction: 'up' | 'down') => {
    if (!activeSectionId) return;
    try {
      const id = await getIdentity();
      await eventTypeService.moveEventType(activeSectionId, et.id, direction, id.userId, id.deviceId);
    } catch (err: any) {
      setEventTypeErrorMessage(err.message || 'Failed to reorder button.');
    }
  };

  const activeTypes = allEventTypes.filter(e => !e.isArchived);
  const archivedTypes = allEventTypes.filter(e => e.isArchived);

  const positiveTypes = activeTypes.filter(e => e.classification === 'positive');
  const neutralTypes = activeTypes.filter(e => e.classification === 'neutral');
  const needsFollowupTypes = activeTypes.filter(e => e.classification === 'needs_followup');

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
          <Sliders className="w-6 h-6 text-blue-600" />
          <span>Grading Policies &amp; Observation Settings</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure Ontario Achievement Chart weights, customize participation dock buttons, and inspect mark scale presets.
        </p>
      </div>

      {savedSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold p-3 rounded-xl flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>Grading policy updated successfully!</span>
        </div>
      )}

      {eventTypeSuccessMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold p-3 rounded-xl flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{eventTypeSuccessMessage}</span>
        </div>
      )}

      {eventTypeErrorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-xs font-bold p-3 rounded-xl flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{eventTypeErrorMessage}</span>
          </div>
          <button onClick={() => setEventTypeErrorMessage(null)} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Participation Buttons Configuration Section */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
              <Settings className="w-5 h-5 text-blue-600" />
              <span>Participation &amp; Observation Buttons</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure 1-click Quick-Tally and Level 1–4 observation buttons. Global presets are read-only.
            </p>
          </div>
          <button
            data-testid="create-event-type-btn"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-sm transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>New Button</span>
          </button>
        </div>

        {/* Groups: Positive, Neutral, Needs Follow-up */}
        <div className="space-y-6">
          {/* Positive Group */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center space-x-1.5 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>Positive Contribution Buttons ({positiveTypes.length})</span>
            </h3>
            <div className="space-y-1.5">
              {positiveTypes.map((et, idx) => {
                const isOrg = et.organizationId !== null;
                const orgTypesInGroup = positiveTypes.filter(t => t.organizationId !== null);
                const orgIdx = orgTypesInGroup.findIndex(t => t.id === et.id);

                return (
                  <div
                    key={et.id}
                    data-testid="event-type-row"
                    className="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-xl text-xs transition"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="font-bold text-slate-900 truncate">{et.name}</span>
                      {et.organizationId === null ? (
                        <span className="flex items-center space-x-1 text-[10px] font-semibold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                          <Lock className="w-2.5 h-2.5" />
                          <span>Preset</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                          Custom
                        </span>
                      )}
                      <span className="text-[11px] font-medium text-slate-600">
                        {et.recordingMode === 'level_1_4' ? (
                          <span className="text-indigo-700 font-bold bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                            Ontario Levels 1–4
                          </span>
                        ) : (
                          <span className="font-mono text-emerald-700 font-bold">
                            {et.defaultPoints > 0 ? `+${et.defaultPoints}` : et.defaultPoints} pt tally
                          </span>
                        )}
                      </span>
                      {et.defaultCategoryCode && (
                        <span className="text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded">
                          [{et.defaultCategoryCode}]
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-1 shrink-0 ml-2">
                      {isOrg && (
                        <>
                          <button
                            data-testid="move-up-event-type-btn"
                            disabled={orgIdx <= 0}
                            onClick={() => handleReorder(et, 'up')}
                            className="p-1 hover:bg-slate-200 rounded text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Move Up"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            data-testid="move-down-event-type-btn"
                            disabled={orgIdx >= orgTypesInGroup.length - 1}
                            onClick={() => handleReorder(et, 'down')}
                            className="p-1 hover:bg-slate-200 rounded text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Move Down"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            data-testid="edit-event-type-btn"
                            onClick={() => handleOpenEdit(et)}
                            className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Edit Button"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            data-testid="archive-event-type-btn"
                            onClick={() => setConfirmArchiveType(et)}
                            className="p-1 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Archive Button"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Neutral Group */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center space-x-1.5 mb-2">
              <Eye className="w-3.5 h-3.5 text-slate-600" />
              <span>Observation / Neutral Buttons ({neutralTypes.length})</span>
            </h3>
            <div className="space-y-1.5">
              {neutralTypes.length === 0 ? (
                <div className="p-3 bg-slate-50/60 rounded-xl text-center text-slate-400 text-xs italic border border-dashed border-slate-200">
                  No neutral observation buttons configured. Click &quot;New Button&quot; to create one.
                </div>
              ) : (
                neutralTypes.map(et => {
                  const isOrg = et.organizationId !== null;
                  const orgTypesInGroup = neutralTypes.filter(t => t.organizationId !== null);
                  const orgIdx = orgTypesInGroup.findIndex(t => t.id === et.id);

                  return (
                    <div
                      key={et.id}
                      data-testid="event-type-row"
                      className="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-xl text-xs transition"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
                        <span className="font-bold text-slate-900 truncate">{et.name}</span>
                        {et.organizationId === null ? (
                          <span className="flex items-center space-x-1 text-[10px] font-semibold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                            <Lock className="w-2.5 h-2.5" />
                            <span>Preset</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                            Custom
                          </span>
                        )}
                        <span className="text-[11px] font-medium text-slate-600">
                          {et.recordingMode === 'level_1_4' ? (
                            <span className="text-indigo-700 font-bold bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                              Ontario Levels 1–4
                            </span>
                          ) : (
                            <span className="font-mono text-slate-700 font-bold">
                              {et.defaultPoints} pt tally
                            </span>
                          )}
                        </span>
                        {et.defaultCategoryCode && (
                          <span className="text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded">
                            [{et.defaultCategoryCode}]
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-1 shrink-0 ml-2">
                        {isOrg && (
                          <>
                            <button
                              data-testid="move-up-event-type-btn"
                              disabled={orgIdx <= 0}
                              onClick={() => handleReorder(et, 'up')}
                              className="p-1 hover:bg-slate-200 rounded text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                              title="Move Up"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              data-testid="move-down-event-type-btn"
                              disabled={orgIdx >= orgTypesInGroup.length - 1}
                              onClick={() => handleReorder(et, 'down')}
                              className="p-1 hover:bg-slate-200 rounded text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                              title="Move Down"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              data-testid="edit-event-type-btn"
                              onClick={() => handleOpenEdit(et)}
                              className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                              title="Edit Button"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              data-testid="archive-event-type-btn"
                              onClick={() => setConfirmArchiveType(et)}
                              className="p-1 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Archive Button"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Needs Follow-up Group */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800 flex items-center space-x-1.5 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span>Needs Follow-up Buttons ({needsFollowupTypes.length})</span>
            </h3>
            <div className="space-y-1.5">
              {needsFollowupTypes.map(et => {
                const isOrg = et.organizationId !== null;
                const orgTypesInGroup = needsFollowupTypes.filter(t => t.organizationId !== null);
                const orgIdx = orgTypesInGroup.findIndex(t => t.id === et.id);

                return (
                  <div
                    key={et.id}
                    data-testid="event-type-row"
                    className="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-xl text-xs transition"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                      <span className="font-bold text-slate-900 truncate">{et.name}</span>
                      {et.organizationId === null ? (
                        <span className="flex items-center space-x-1 text-[10px] font-semibold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                          <Lock className="w-2.5 h-2.5" />
                          <span>Preset</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                          Custom
                        </span>
                      )}
                      <span className="text-[11px] font-medium text-slate-600">
                        {et.recordingMode === 'level_1_4' ? (
                          <span className="text-indigo-700 font-bold bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                            Ontario Levels 1–4
                          </span>
                        ) : (
                          <span className="font-mono text-amber-800 font-bold">
                            {et.defaultPoints} pt tally
                          </span>
                        )}
                      </span>
                      {et.defaultCategoryCode && (
                        <span className="text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded">
                          [{et.defaultCategoryCode}]
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-1 shrink-0 ml-2">
                      {isOrg && (
                        <>
                          <button
                            data-testid="move-up-event-type-btn"
                            disabled={orgIdx <= 0}
                            onClick={() => handleReorder(et, 'up')}
                            className="p-1 hover:bg-slate-200 rounded text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Move Up"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            data-testid="move-down-event-type-btn"
                            disabled={orgIdx >= orgTypesInGroup.length - 1}
                            onClick={() => handleReorder(et, 'down')}
                            className="p-1 hover:bg-slate-200 rounded text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Move Down"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            data-testid="edit-event-type-btn"
                            onClick={() => handleOpenEdit(et)}
                            className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Edit Button"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            data-testid="archive-event-type-btn"
                            onClick={() => setConfirmArchiveType(et)}
                            className="p-1 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Archive Button"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Archived Buttons Section */}
          {archivedTypes.length > 0 && (
            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1.5 mb-2">
                <Archive className="w-3.5 h-3.5 text-slate-400" />
                <span>Archived Buttons ({archivedTypes.length})</span>
              </h3>
              <p className="text-[11px] text-slate-400 mb-2">
                Archived buttons do not appear in the active observation dock, but historical event logs retain their exact snapshot.
              </p>
              <div className="space-y-1.5">
                {archivedTypes.map(et => (
                  <div
                    key={et.id}
                    className="flex items-center justify-between p-2.5 bg-slate-50/60 border border-dashed border-slate-200 rounded-xl text-xs"
                  >
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-slate-600 line-through">{et.name}</span>
                      <span className="text-[10px] text-slate-400 uppercase">({et.classification})</span>
                    </div>
                    <button
                      data-testid="restore-event-type-btn"
                      onClick={() => handleRestore(et)}
                      className="flex items-center space-x-1 px-2.5 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Restore</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Policy Form */}
      <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <h2 className="text-base font-bold text-slate-900 pb-2 border-b border-slate-100">
          Achievement Chart Category Weights (K / T / C / A)
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-200">
            <label className="block text-xs font-bold text-blue-800 mb-1">Knowledge (K) %</label>
            <input
              type="number"
              min="0"
              max="100"
              value={weightK}
              onChange={e => setWeightK(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm font-bold border rounded-lg"
            />
          </div>

          <div className="bg-purple-50/50 p-4 rounded-xl border border-purple-200">
            <label className="block text-xs font-bold text-purple-800 mb-1">Thinking (T) %</label>
            <input
              type="number"
              min="0"
              max="100"
              value={weightT}
              onChange={e => setWeightT(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm font-bold border rounded-lg"
            />
          </div>

          <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-200">
            <label className="block text-xs font-bold text-emerald-800 mb-1">Communication (C) %</label>
            <input
              type="number"
              min="0"
              max="100"
              value={weightC}
              onChange={e => setWeightC(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm font-bold border rounded-lg"
            />
          </div>

          <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200">
            <label className="block text-xs font-bold text-amber-800 mb-1">Application (A) %</label>
            <input
              type="number"
              min="0"
              max="100"
              value={weightA}
              onChange={e => setWeightA(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm font-bold border rounded-lg"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="text-xs font-bold">
            Total Weight: <span className={isWeightValid ? 'text-emerald-600' : 'text-red-600 font-extrabold'}>{totalWeight}%</span>
            {!isWeightValid && <span className="text-red-500 ml-2">(Must equal 100%)</span>}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 space-y-4">
          <label className="flex items-center space-x-2 text-xs font-bold text-slate-800">
            <input
              type="checkbox"
              checked={excludeFormative}
              onChange={e => setExcludeFormative(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600"
            />
            <span>Exclude Formative Evaluations from Final Calculation</span>
          </label>

          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">Missing Work Policy</label>
            <select
              value={missingPolicy}
              onChange={e => setMissingPolicy(e.target.value as any)}
              className="w-full max-w-sm px-3 py-2 text-xs border rounded-lg bg-white"
            >
              <option value="exclude">Exclude from average with visual warning banner</option>
              <option value="zero_with_warning">Include as 0% penalty with warning</option>
              <option value="floor_r">Include as Level R floor (35%)</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <button
            type="submit"
            disabled={!isWeightValid}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-sm transition disabled:opacity-50"
          >
            Save Policy Settings
          </button>
        </div>
      </form>

      {/* Versioned Mark Scale Preview */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-slate-900 pb-2 border-b border-slate-100">
          Ontario Achievement-Level Teacher Conversion Preset (Active Version 1)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {scaleEntries.map(entry => (
            <div key={entry.id} className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
              <span className="font-extrabold text-sm text-blue-700 block">{entry.code}</span>
              <span className="text-[11px] text-slate-600">{entry.label}</span>
              <div className="mt-2 text-[10px] text-slate-400">
                Benchmark: <strong className="text-slate-800">{entry.benchmarkPercentage}%</strong> ({entry.minimumPercentage}-{entry.maximumPercentage}%)
              </div>
            </div>
          ))}
        </div>
      </div>

      <ManualWindowsUpdate />

      {/* Create Button Modal */}
      <ModalDialog
        isOpen={showCreateModal}
        onClose={resetCreateForm}
        title="Create Participation Button"
        isDirty={newName.trim() !== '' || newPoints !== 1 || newCategory !== 'NONE' || newClassification !== 'positive' || newMode !== 'quick_tally'}
        confirmDiscardMessage="You have unsaved changes to this new button. Are you sure you want to discard them?"
        maxWidthClass="max-w-md"
        testId="create-event-type-modal"
      >
        {({ requestDismiss }) => (
          <form onSubmit={handleCreateEventType} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-slate-800 mb-1">Button Name</label>
              <input
                data-testid="event-type-name-input"
                type="text"
                required
                maxLength={100}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Collaborative Discussion"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-800 mb-1">Classification</label>
                <select
                  data-testid="event-type-classification-select"
                  value={newClassification}
                  onChange={e => {
                    const cls = e.target.value as EventClassification;
                    setNewClassification(cls);
                    if (cls === 'positive') setNewPoints(1);
                    else if (cls === 'neutral') setNewPoints(0);
                    else if (cls === 'needs_followup') setNewPoints(-1);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="positive">Positive (+)</option>
                  <option value="neutral">Observation / Neutral (~)</option>
                  <option value="needs_followup">Needs Follow-up (!)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Recording Mode</label>
                <select
                  data-testid="event-type-mode-select"
                  value={newMode}
                  onChange={e => setNewMode(e.target.value as ParticipationRecordingMode)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="quick_tally">Quick Tally (1-Click)</option>
                  <option value="level_1_4">Ontario Levels 1–4</option>
                </select>
              </div>
            </div>

            {newMode === 'quick_tally' ? (
              <div>
                <label className="block font-bold text-slate-800 mb-1">Tally Points</label>
                <input
                  data-testid="event-type-points-input"
                  type="number"
                  step="0.5"
                  min="-100"
                  max="100"
                  required
                  value={newPoints}
                  onChange={e => setNewPoints(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Points added or subtracted from daily participation tally.
                </span>
              </div>
            ) : (
              <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-900">
                <span className="font-bold block">Level 1–4 Observational Evidence</span>
                <span className="text-[11px] text-indigo-700">
                  Snapshots 0.0 participation points. Used exclusively for qualitative evidence and triangulated assessment; has 0 formal mark impact.
                </span>
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-800 mb-1">Default Achievement Category</label>
              <select
                data-testid="event-type-category-select"
                value={newCategory}
                onChange={e => setNewCategory(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="NONE">None (Untagged)</option>
                <option value="K">Knowledge &amp; Understanding (K)</option>
                <option value="T">Thinking &amp; Inquiry (T)</option>
                <option value="C">Communication (C)</option>
                <option value="A">Application (A)</option>
              </select>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={requestDismiss}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                data-testid="save-event-type-btn"
                type="submit"
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition"
              >
                Create Button
              </button>
            </div>
          </form>
        )}
      </ModalDialog>

      {/* Edit Button Modal */}
      <ModalDialog
        isOpen={editingType !== null}
        onClose={() => setEditingType(null)}
        title={`Edit Button: ${editingType?.name}`}
        isDirty={
          editingType !== null &&
          (editName !== editingType.name ||
            editMode !== editingType.recordingMode ||
            editPoints !== (editingType.defaultPoints || 0) ||
            editCategory !== (editingType.defaultCategoryCode || 'NONE'))
        }
        confirmDiscardMessage="You have unsaved changes to this button. Are you sure you want to discard them?"
        maxWidthClass="max-w-md"
        testId="edit-event-type-modal"
      >
        {({ requestDismiss }) => (
          <div>
            <p className="text-[11px] text-slate-500 mb-3">
              Editing this button will only affect future recordings. Existing historical participation events will preserve their original snapshot.
            </p>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-800 mb-1">Button Name</label>
                <input
                  data-testid="edit-event-type-name-input"
                  type="text"
                  required
                  maxLength={100}
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Recording Mode</label>
                <select
                  value={editMode}
                  onChange={e => setEditMode(e.target.value as ParticipationRecordingMode)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="quick_tally">Quick Tally (1-Click)</option>
                  <option value="level_1_4">Ontario Levels 1–4</option>
                </select>
              </div>

              {editMode === 'quick_tally' ? (
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Tally Points</label>
                  <input
                    type="number"
                    step="0.5"
                    min="-100"
                    max="100"
                    required
                    value={editPoints}
                    onChange={e => setEditPoints(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
                  />
                </div>
              ) : (
                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-900">
                  <span className="font-bold block">Level 1–4 Observational Evidence</span>
                  <span className="text-[11px] text-indigo-700">
                    Snapshots 0.0 points. Does not affect formal mark calculations.
                  </span>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-800 mb-1">Default Achievement Category</label>
                <select
                  value={editCategory}
                  onChange={e => setEditCategory(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="NONE">None (Untagged)</option>
                  <option value="K">Knowledge &amp; Understanding (K)</option>
                  <option value="T">Thinking &amp; Inquiry (T)</option>
                  <option value="C">Communication (C)</option>
                  <option value="A">Application (A)</option>
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={requestDismiss}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  data-testid="save-edit-event-type-btn"
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        )}
      </ModalDialog>

      {/* Archive Confirmation Dialog */}
      <ModalDialog
        isOpen={confirmArchiveType !== null}
        onClose={() => setConfirmArchiveType(null)}
        title={`Archive "${confirmArchiveType?.name}"?`}
        maxWidthClass="max-w-sm"
        testId="archive-confirmation-modal"
      >
        {({ requestDismiss }) => (
          <div>
            <p className="text-xs text-slate-600 mb-4">
              This button will be removed from the participation dock. All existing historical observations recorded with this button will retain their exact name, category, and points.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={requestDismiss}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-archive-btn"
                onClick={() => handleArchive(confirmArchiveType!)}
                className="px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition"
              >
                Confirm Archive
              </button>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
};
