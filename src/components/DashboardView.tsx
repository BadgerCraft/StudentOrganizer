import React, { useState } from 'react';
import {
  Plus,
  Users,
  Clock,
  Copy,
  Archive,
  FolderOpen,
  Upload,
  Calendar,
  Layers
} from 'lucide-react';
import type { ClassSection, Course, ClassEnrollment, Term } from '../types/schema';
import { db } from '../db/database';

interface DashboardViewProps {
  classes: {
    section: ClassSection;
    course: Course;
    enrollments: ClassEnrollment[];
    term: Term | undefined;
  }[];
  onOpenClass: (sectionId: string) => void;
  onRefresh: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  classes,
  onOpenClass,
  onRefresh
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCourseCode, setNewCourseCode] = useState('ENG4U');
  const [newCourseTitle, setNewCourseTitle] = useState('Grade 12 English');
  const [newSectionNum, setNewSectionNum] = useState('02');
  const [newPeriod, setNewPeriod] = useState('Period 4');
  const [newRoom, setNewRoom] = useState('Room 214');
  const [newColor, setNewColor] = useState('#2563eb');

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    const courseId = `course-${Date.now()}`;
    const sectionId = `class-${Date.now()}`;

    const term = await db.terms.toCollection().first();
    const org = await db.organizations.where('organizationType').equals('school').first();

    if (!term || !org) return;

    await db.courses.add({
      id: courseId,
      organizationId: org.id,
      code: newCourseCode.trim().toUpperCase(),
      title: newCourseTitle.trim(),
      department: 'English',
      gradeLevel: 12,
      creditValue: 1.0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    await db.classSections.add({
      id: sectionId,
      courseId: courseId,
      termId: term.id,
      sectionNumber: newSectionNum.trim(),
      period: newPeriod.trim(),
      roomNumber: newRoom.trim(),
      colorToken: newColor,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    const markScaleVersion = await db.markScaleVersions.toCollection().first();

    await db.gradingPolicies.add({
      id: `policy-${sectionId}`,
      classSectionId: sectionId,
      reportingPeriodId: null,
      scopeKey: 'DEFAULT',
      weightK: 25,
      weightT: 25,
      weightC: 25,
      weightA: 25,
      excludeFormative: true,
      missingWorkPolicy: 'exclude',
      defaultMarkScaleVersionId: markScaleVersion ? markScaleVersion.id : 'scale-ver-ont-levels-v1',
      decimalPrecision: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    await db.seatingLayouts.add({
      id: `layout-${sectionId}`,
      classSectionId: sectionId,
      name: 'Standard Classroom 4x5',
      rows: 4,
      cols: 5,
      isLocked: false,
      cardSize: 'standard',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    setShowCreateModal(false);
    onRefresh();
    onOpenClass(sectionId);
  };

  const handleDuplicateClass = async (section: ClassSection, course: Course) => {
    const now = new Date().toISOString();
    const newSectionId = `class-${Date.now()}`;

    await db.classSections.add({
      ...section,
      id: newSectionId,
      sectionNumber: `${section.sectionNumber}-COPY`,
      createdAt: now,
      updatedAt: now,
      version: 1
    });

    await db.seatingLayouts.add({
      id: `layout-${newSectionId}`,
      classSectionId: newSectionId,
      name: 'Classroom Grid',
      rows: 4,
      cols: 5,
      isLocked: false,
      cardSize: 'standard',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    onRefresh();
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

          return (
            <div
              key={section.id}
              className="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex flex-col justify-between overflow-hidden group"
            >
              {/* Color Header Bar */}
              <div
                className="h-2.5 w-full"
                style={{ backgroundColor: section.colorToken || '#2563eb' }}
              />

              <div className="p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-700 mb-2">
                      {course.code} &bull; Sec {section.sectionNumber}
                    </span>
                    <h2 className="text-lg font-bold text-slate-900 leading-snug group-hover:text-blue-600 transition">
                      {course.title}
                    </h2>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  <div className="flex items-center space-x-2">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>{term ? term.name : 'Semester 1'} &bull; {section.period}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-semibold text-slate-800">
                      {activeStudents.length} Active Students
                    </span>
                    <span className="text-slate-400">({section.roomNumber})</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Recent activity: Today</span>
                  </div>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="bg-slate-50/80 px-6 py-3.5 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => handleDuplicateClass(section, course)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition"
                    title="Duplicate Class"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleArchiveClass(section.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Archive Class"
                  >
                    <Archive className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={() => onOpenClass(section.id)}
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

      {/* Create Class Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center space-x-2">
              <Layers className="w-5 h-5 text-blue-600" />
              <span>Create New Class Set</span>
            </h3>

            <form onSubmit={handleCreateClass} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Course Code
                </label>
                <input
                  type="text"
                  required
                  value={newCourseCode}
                  onChange={e => setNewCourseCode(e.target.value)}
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
                  onChange={e => setNewCourseTitle(e.target.value)}
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
                    onChange={e => setNewSectionNum(e.target.value)}
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
                    onChange={e => setNewPeriod(e.target.value)}
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
                    onChange={e => setNewRoom(e.target.value)}
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
                      onChange={e => setNewColor(e.target.value)}
                      className="w-8 h-8 rounded border border-slate-300 cursor-pointer"
                    />
                    <span className="text-xs text-slate-500 font-mono">{newColor}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition"
                >
                  Create & Open
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
