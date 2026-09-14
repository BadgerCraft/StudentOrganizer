import React, { useState, useMemo } from 'react';
import {
  History,
  Calendar,
  Filter,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  BookOpen
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

interface ParticipationLedgerViewProps {
  classSection: ClassSection;
  enrollments: ClassEnrollment[];
  students: Student[];
  events: ParticipationEvent[];
  eventTypes: ParticipationEventType[];
  onRefresh: () => void;
}

export const ParticipationLedgerView: React.FC<ParticipationLedgerViewProps> = ({
  classSection,
  enrollments,
  students,
  events,
  eventTypes,
  onRefresh
}) => {
  const [filterCategory, setFilterCategory] = useState<'all' | AchievementCategoryCode>('all');
  const [filterClassification, setFilterClassification] = useState<'all' | 'positive' | 'needs_followup'>('all');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('all');

  const studentMap = new Map<UUID, Student>();
  students.forEach(s => studentMap.set(s.id, s));

  const enrollmentMap = new Map<UUID, ClassEnrollment>();
  enrollments.forEach(e => enrollmentMap.set(e.id, e));

  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (e.classSectionId !== classSection.id || e.deletedAt !== null) return false;
      if (filterCategory !== 'all' && e.categoryCode !== filterCategory) return false;
      if (filterClassification !== 'all' && e.snapshottedClassification !== filterClassification) return false;
      if (selectedStudentId !== 'all') {
        const enr = enrollmentMap.get(e.classEnrollmentId);
        if (!enr || enr.studentId !== selectedStudentId) return false;
      }
      return true;
    });
  }, [events, classSection.id, filterCategory, filterClassification, selectedStudentId, enrollmentMap]);

  // Summaries
  const positiveCount = filteredEvents.filter(e => e.snapshottedClassification === 'positive').length;
  const needsFollowupCount = filteredEvents.filter(e => e.snapshottedClassification === 'needs_followup').length;
  const totalPoints = filteredEvents.reduce((acc, e) => acc + e.snapshottedPoints, 0);

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
            Raw observational data preserved chronologically. Not automatically averaged into formal grades unless converted to evidence.
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg">
            {filteredEvents.length}
          </div>
          <div>
            <span className="text-xs font-bold text-slate-900">Total Observations</span>
            <span className="text-[11px] text-slate-500 block">Filtered in current view</span>
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
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
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
              className={`px-3 py-1 rounded-lg font-medium transition ${
                filterClassification === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              All Types
            </button>
            <button
              onClick={() => setFilterClassification('positive')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                filterClassification === 'positive' ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-600'
              }`}
            >
              Positive
            </button>
            <button
              onClick={() => setFilterClassification('needs_followup')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                filterClassification === 'needs_followup' ? 'bg-white text-amber-800 shadow-sm' : 'text-slate-600'
              }`}
            >
              Follow-up
            </button>
          </div>

          {/* Category Filter */}
          <div className="flex items-center space-x-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs">
            {(['all', 'K', 'T', 'C', 'A'] as const).map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  filterCategory === cat ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'
                }`}
              >
                {cat === 'all' ? 'All Cats' : cat}
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
              <th className="py-3 px-4">Category</th>
              <th className="py-3 px-4">Date &amp; Time</th>
              <th className="py-3 px-4">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredEvents.map(ev => {
              const enr = enrollmentMap.get(ev.classEnrollmentId);
              const std = enr ? studentMap.get(enr.studentId) : null;

              return (
                <tr key={ev.id} className="hover:bg-slate-50/70 transition">
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
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {ev.snapshottedClassification}
                    </span>
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
                  <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                    {ev.localSchoolDate} {ev.occurredAt.slice(11, 16)} UTC
                  </td>
                  <td className="py-3 px-4 text-slate-600 italic">
                    {ev.note || '--'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
