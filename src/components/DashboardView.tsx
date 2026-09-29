import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Plus,
  Users,
  Clock,
  Copy,
  Archive,
  FolderOpen,
  Calendar,
  Layers,
  Sliders
} from 'lucide-react';
import type { ClassSection, Course, ClassEnrollment, Term, ChicletDisplaySettings } from '../types/schema';
import { DEFAULT_CHICLET_DISPLAY, formatChicletTitle } from '../types/schema';
import { db } from '../db/database';
import { ModalDialog } from './ModalDialog';
import { ClassDomainService } from '../services/classService';
import { getAppIdentity } from '../services/identityService';
import { AuthorizationError } from '../services/authHelper';

interface DashboardViewProps {
  classes: {
    section: ClassSection;
    course: Course;
    enrollments: ClassEnrollment[];
    term: Term | undefined;
  }[];
  userId?: string;
  deviceId?: string;
  onOpenClass: (sectionId: string) => void;
  onRefresh: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  classes,
  userId,
  deviceId,
  onOpenClass,
  onRefresh
}) => {
  const userPref = useLiveQuery(() => db.userPreferences.toCollection().first());

  const displaySettings: ChicletDisplaySettings = {
    ...DEFAULT_CHICLET_DISPLAY,
    ...(userPref?.chicletDisplay || {})
  };

  // Card Display Settings Modal State
  const [showDisplaySettingsModal, setShowDisplaySettingsModal] = useState(false);
  const [tempDisplaySettings, setTempDisplaySettings] = useState<ChicletDisplaySettings>(DEFAULT_CHICLET_DISPLAY);
  const [isDisplaySettingsDirty, setIsDisplaySettingsDirty] = useState(false);

  useEffect(() => {
    if (showDisplaySettingsModal) {
      setTempDisplaySettings({
        ...DEFAULT_CHICLET_DISPLAY,
        ...(userPref?.chicletDisplay || {})
      });
      setIsDisplaySettingsDirty(false);
    }
  }, [showDisplaySettingsModal, userPref]);

  // Create Class Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCourseCode, setNewCourseCode] = useState('ENG4U');
  const [newCourseTitle, setNewCourseTitle] = useState('Grade 12 English');
  const [newSectionNum, setNewSectionNum] = useState('02');
  const [newPeriod, setNewPeriod] = useState('Period 4');
  const [newRoom, setNewRoom] = useState('Room 214');
  const [newColor, setNewColor] = useState('#2563eb');
  const [isCreateDirty, setIsCreateDirty] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const classService = new ClassDomainService(db);

  const resetCreateForm = () => {
    setNewCourseCode('ENG4U');
    setNewCourseTitle('Grade 12 English');
    setNewSectionNum('02');
    setNewPeriod('Period 4');
    setNewRoom('Room 214');
    setNewColor('#2563eb');
    setIsCreateDirty(false);
    setCreateError(null);
    setShowCreateModal(false);
  };

  const handleSaveDisplaySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();

    if (userPref) {
      await db.userPreferences.update(userPref.id, {
        chicletDisplay: {
          ...DEFAULT_CHICLET_DISPLAY,
          ...(userPref.chicletDisplay || {}),
          ...tempDisplaySettings
        },
        updatedAt: now
      });
    } else {
      const currentIdentity = await getAppIdentity(db);
      if (userId && userId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher has changed.');
      }
      await db.userPreferences.add({
        id: crypto.randomUUID(),
        userId: currentIdentity.userId,
        theme: 'light',
        lastOpenedClassSectionId: null,
        markbookDensity: 'comfortable',
        seatingShowPhotos: true,
        chicletDisplay: {
          ...DEFAULT_CHICLET_DISPLAY,
          ...tempDisplaySettings
        },
        createdAt: now,
        updatedAt: now,
        version: 1
      });
    }

    setIsDisplaySettingsDirty(false);
    setShowDisplaySettingsModal(false);
    onRefresh();
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    try {
      const currentIdentity = await getAppIdentity(db);
      if (userId && userId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher has changed.');
      }
      const newSection = await classService.createClassSection({
        courseCode: newCourseCode,
        courseTitle: newCourseTitle,
        sectionNumber: newSectionNum,
        period: newPeriod,
        roomNumber: newRoom,
        colorToken: newColor,
        userId: currentIdentity.userId,
        deviceId: currentIdentity.deviceId
      });

      setIsCreateDirty(false);
      setShowCreateModal(false);
      onRefresh();
      onOpenClass(newSection.id);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create class section.');
    }
  };

  const handleDuplicateClass = async (section: ClassSection, _course: Course) => {
    try {
      const currentIdentity = await getAppIdentity(db);
      if (userId && userId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher has changed.');
      }
      await classService.duplicateClassSection({
        sourceSectionId: section.id,
        userId: currentIdentity.userId,
        deviceId: currentIdentity.deviceId
      });
      onRefresh();
    } catch (err: any) {
      alert(`Could not duplicate class: ${err?.message || err}`);
    }
  };

  const handleArchiveClass = async (sectionId: string) => {
    if (!confirm('Are you sure you want to archive this class?')) return;
    await db.classSections.update(sectionId, {
      deletedAt: new Date().toISOString()
    });
    onRefresh();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-200 mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Teacher Dashboard & Class Sets
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage your Ontario secondary classes, achievement chart weightings, and real-time workspaces.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            type="button"
            data-testid="card-display-settings-btn"
            onClick={() => setShowDisplaySettingsModal(true)}
            className="inline-flex items-center space-x-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-sm font-semibold px-4 py-2.5 rounded-xl shadow-xs hover:shadow transition active:scale-95"
          >
            <Sliders className="w-4 h-4 text-slate-500" />
            <span>Card Display</span>
          </button>

          <button
            type="button"
            data-testid="create-class-open-btn"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm hover:shadow transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Create Class</span>
          </button>
        </div>
      </div>

      {/* Class Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {classes.map(({ section, course, enrollments, term }) => {
          const activeStudents = enrollments.filter(e => e.deletedAt === null && e.enrollmentStatus === 'active');
          const primaryTitle = formatChicletTitle(course, section, displaySettings.primaryTitleFormat);

          let badgeText: string | null = null;
          if (displaySettings.primaryTitleFormat === 'title_only') {
            badgeText = `${course.code} • Sec ${section.sectionNumber}`;
          } else if (displaySettings.primaryTitleFormat === 'code_only') {
            badgeText = course.title;
          }

          return (
            <div
              key={section.id}
              data-testid="classroom-chiclet"
              className="relative bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:border-blue-300 hover:shadow-lg hover:-translate-y-0.5 transition-all flex flex-col justify-between overflow-hidden group"
            >
              {/* Full-card native overlay button for opening workspace */}
              <button
                type="button"
                data-testid="chiclet-open-overlay-btn"
                onClick={() => onOpenClass(section.id)}
                aria-label={`Open workspace for ${primaryTitle}`}
                className="absolute inset-0 w-full h-full text-left z-0 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset rounded-2xl cursor-pointer"
              />

              {/* Color Header Bar */}
              <div
                className="h-2.5 w-full relative z-10 pointer-events-none"
                style={{ backgroundColor: section.colorToken || '#2563eb' }}
              />

              <div className="p-6 relative z-10 pointer-events-none">
                <div className="flex justify-between items-start">
                  <div>
                    {badgeText && (
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-700 mb-2">
                        {badgeText}
                      </span>
                    )}
                    <h2 className="text-lg font-bold text-slate-900 leading-snug group-hover:text-blue-600 transition">
                      {primaryTitle}
                    </h2>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  {(displaySettings.showTerm || displaySettings.showPeriod) && (
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {displaySettings.showTerm && (term ? term.name : 'Semester 1')}
                        {displaySettings.showTerm && displaySettings.showPeriod && ' • '}
                        {displaySettings.showPeriod && section.period}
                      </span>
                    </div>
                  )}
                  {(displaySettings.showStudentCount || displaySettings.showRoom) && (
                    <div className="flex items-center space-x-2">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      {displaySettings.showStudentCount && (
                        <span className="font-semibold text-slate-800">
                          {activeStudents.length} Active Students
                        </span>
                      )}
                      {displaySettings.showRoom && (
                        <span className="text-slate-400">({section.roomNumber})</span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Recent activity: Today</span>
                  </div>
                </div>
              </div>

              {/* Card Footer Actions - isolated at z-20 */}
              <div className="relative z-20 bg-slate-50/80 px-6 py-3.5 border-t border-slate-100 flex items-center justify-between pointer-events-auto">
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    data-testid="duplicate-class-btn"
                    onClick={e => {
                      e.stopPropagation();
                      handleDuplicateClass(section, course);
                    }}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition"
                    title="Duplicate Class"
                    aria-label={`Duplicate class ${course.code}`}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      handleArchiveClass(section.id);
                    }}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Archive Class"
                    aria-label={`Archive class ${course.code}`}
                  >
                    <Archive className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="open-class-btn"
                  onClick={e => {
                    e.stopPropagation();
                    onOpenClass(section.id);
                  }}
                  className="inline-flex items-center space-x-1.5 bg-white hover:bg-blue-50 text-blue-700 border border-slate-200 hover:border-blue-200 text-xs font-bold px-3.5 py-1.5 rounded-lg shadow-sm transition active:scale-95"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Open Workspace</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Card Display Settings Modal */}
      <ModalDialog
        isOpen={showDisplaySettingsModal}
        onClose={() => {
          setShowDisplaySettingsModal(false);
          setIsDisplaySettingsDirty(false);
        }}
        title="Classroom Card Display Settings"
        isDirty={isDisplaySettingsDirty}
        confirmDiscardMessage="You have unsaved display settings. Are you sure you want to discard them?"
        testId="card-display-settings-modal"
      >
        {({ requestDismiss }) => (
          <form onSubmit={handleSaveDisplaySettings} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Primary Title Format
              </label>
              <div className="space-y-2">
                <label className="flex items-center space-x-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="radio"
                    name="titleFormat"
                    value="title_only"
                    checked={tempDisplaySettings.primaryTitleFormat === 'title_only'}
                    onChange={() => {
                      setTempDisplaySettings(prev => ({ ...prev, primaryTitleFormat: 'title_only' }));
                      setIsDisplaySettingsDirty(true);
                    }}
                    data-testid="title-format-title-only"
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-900">Course Title (Default)</div>
                    <div className="text-[11px] text-slate-500">e.g. &ldquo;Grade 12 English&rdquo;</div>
                  </div>
                </label>

                <label className="flex items-center space-x-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="radio"
                    name="titleFormat"
                    value="code_only"
                    checked={tempDisplaySettings.primaryTitleFormat === 'code_only'}
                    onChange={() => {
                      setTempDisplaySettings(prev => ({ ...prev, primaryTitleFormat: 'code_only' }));
                      setIsDisplaySettingsDirty(true);
                    }}
                    data-testid="title-format-code-only"
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-900">Course Code &amp; Section</div>
                    <div className="text-[11px] text-slate-500">e.g. &ldquo;ENG4U - Sec 01&rdquo;</div>
                  </div>
                </label>

                <label className="flex items-center space-x-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="radio"
                    name="titleFormat"
                    value="code_and_title"
                    checked={tempDisplaySettings.primaryTitleFormat === 'code_and_title'}
                    onChange={() => {
                      setTempDisplaySettings(prev => ({ ...prev, primaryTitleFormat: 'code_and_title' }));
                      setIsDisplaySettingsDirty(true);
                    }}
                    data-testid="title-format-code-and-title"
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-900">Full Code &amp; Title</div>
                    <div className="text-[11px] text-slate-500">e.g. &ldquo;ENG4U - Sec 01: Grade 12 English&rdquo;</div>
                  </div>
                </label>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100">
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Chiclet Detail Badges
              </label>
              <div className="space-y-2">
                <label className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <span className="text-xs text-slate-800">Show Academic Term</span>
                  <input
                    type="checkbox"
                    checked={tempDisplaySettings.showTerm}
                    onChange={e => {
                      setTempDisplaySettings(prev => ({ ...prev, showTerm: e.target.checked }));
                      setIsDisplaySettingsDirty(true);
                    }}
                    data-testid="toggle-show-term"
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <span className="text-xs text-slate-800">Show Class Period</span>
                  <input
                    type="checkbox"
                    checked={tempDisplaySettings.showPeriod}
                    onChange={e => {
                      setTempDisplaySettings(prev => ({ ...prev, showPeriod: e.target.checked }));
                      setIsDisplaySettingsDirty(true);
                    }}
                    data-testid="toggle-show-period"
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <span className="text-xs text-slate-800">Show Room Number</span>
                  <input
                    type="checkbox"
                    checked={tempDisplaySettings.showRoom}
                    onChange={e => {
                      setTempDisplaySettings(prev => ({ ...prev, showRoom: e.target.checked }));
                      setIsDisplaySettingsDirty(true);
                    }}
                    data-testid="toggle-show-room"
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <span className="text-xs text-slate-800">Show Active Student Count</span>
                  <input
                    type="checkbox"
                    checked={tempDisplaySettings.showStudentCount}
                    onChange={e => {
                      setTempDisplaySettings(prev => ({ ...prev, showStudentCount: e.target.checked }));
                      setIsDisplaySettingsDirty(true);
                    }}
                    data-testid="toggle-show-students"
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={requestDismiss}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 text-xs font-semibold rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="save-card-display-btn"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm hover:shadow transition active:scale-95"
              >
                Save Preferences
              </button>
            </div>
          </form>
        )}
      </ModalDialog>

      {/* Create Class Modal */}
      <ModalDialog
        isOpen={showCreateModal}
        onClose={resetCreateForm}
        title="Create New Class Set"
        isDirty={isCreateDirty}
        confirmDiscardMessage="You have unsaved changes to this new class set. Are you sure you want to discard them?"
        testId="create-class-modal"
      >
        {({ requestDismiss }) => (
          <form onSubmit={handleCreateClass} className="space-y-4">
            {createError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                {createError}
              </div>
            )}
            <div>
              <label htmlFor="course-code-input" className="block text-xs font-semibold text-slate-700 mb-1">
                Course Code
              </label>
              <input
                id="course-code-input"
                data-testid="new-course-code-input"
                type="text"
                required
                value={newCourseCode}
                onChange={e => {
                  setNewCourseCode(e.target.value);
                  setIsCreateDirty(true);
                }}
                placeholder="e.g. ENG4U, SCH3U"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Course Title
              </label>
              <input
                type="text"
                required
                value={newCourseTitle}
                onChange={e => {
                  setNewCourseTitle(e.target.value);
                  setIsCreateDirty(true);
                }}
                placeholder="e.g. Grade 12 English"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Section
                </label>
                <input
                  type="text"
                  required
                  value={newSectionNum}
                  onChange={e => {
                    setNewSectionNum(e.target.value);
                    setIsCreateDirty(true);
                  }}
                  placeholder="01"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Period
                </label>
                <input
                  type="text"
                  required
                  value={newPeriod}
                  onChange={e => {
                    setNewPeriod(e.target.value);
                    setIsCreateDirty(true);
                  }}
                  placeholder="Period 2"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Room Number
                </label>
                <input
                  type="text"
                  required
                  value={newRoom}
                  onChange={e => {
                    setNewRoom(e.target.value);
                    setIsCreateDirty(true);
                  }}
                  placeholder="Room 214"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Colour Identifier
                </label>
                <div className="flex items-center space-x-2 mt-1">
                  <input
                    type="color"
                    value={newColor}
                    onChange={e => {
                      setNewColor(e.target.value);
                      setIsCreateDirty(true);
                    }}
                    className="w-8 h-8 rounded border border-slate-300 cursor-pointer"
                  />
                  <span className="text-xs text-slate-500 font-mono">{newColor}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={requestDismiss}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition"
              >
                Create &amp; Open
              </button>
            </div>
          </form>
        )}
      </ModalDialog>
    </div>
  );
};
