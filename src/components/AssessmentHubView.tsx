import React, { useState } from 'react';
import {
  Plus,
  BookOpen,
  Calendar,
  Layers,
  Archive,
  Copy,
  CheckCircle,
  FileSpreadsheet,
  X
} from 'lucide-react';
import type {
  Assessment,
  AssessmentCategory,
  ClassSection,
  Unit,
  ClassEnrollment,
  Student,
  AchievementCategoryCode,
  UUID
} from '../types/schema';
import { db } from '../db/database';

interface AssessmentHubViewProps {
  classSection: ClassSection;
  assessments: Assessment[];
  categories: AssessmentCategory[];
  units: Unit[];
  enrollments: ClassEnrollment[];
  students: Student[];
  onRefresh: () => void;
}

export const AssessmentHubView: React.FC<AssessmentHubViewProps> = ({
  classSection,
  assessments,
  categories,
  units,
  enrollments,
  students,
  onRefresh
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'summative' | 'formative'>('all');
  const [filterUnit, setFilterUnit] = useState<string>('all');

  // New assessment form state
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState(units[0]?.id || 'unit-default');
  const [assessmentType, setAssessmentType] = useState<'summative' | 'formative'>('summative');
  const [dueDate, setDueDate] = useState('2026-10-15T23:59:00Z');

  // Category selections
  const [kChecked, setKChecked] = useState(true);
  const [kMax, setKMax] = useState(100);
  const [kWeight, setKWeight] = useState(1.0);

  const [tChecked, setTChecked] = useState(true);
  const [tMax, setTMax] = useState(100);
  const [tWeight, setTWeight] = useState(1.0);

  const [cChecked, setCChecked] = useState(true);
  const [cMax, setCMax] = useState(100);
  const [cWeight, setCWeight] = useState(1.0);

  const [aChecked, setAChecked] = useState(true);
  const [aMax, setAMax] = useState(100);
  const [aWeight, setAWeight] = useState(1.0);

  const filteredAssessments = assessments.filter(a => {
    if (a.deletedAt !== null) return false;
    if (filterType !== 'all' && a.assessmentType !== filterType) return false;
    if (filterUnit !== 'all' && a.unitId !== filterUnit) return false;
    return true;
  });

  const handleCreateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    const assessId = crypto.randomUUID();

    const policy = await db.gradingPolicies.where('classSectionId').equals(classSection.id).first();

    await db.transaction('rw', [db.assessments, db.assessmentCategories, db.studentAssessments], async () => {
      await db.assessments.add({
        id: assessId,
        classSectionId: classSection.id,
        unitId: selectedUnitId,
        reportingPeriodId: policy?.reportingPeriodId || 'rp-midterm',
        code: code.trim().toUpperCase(),
        title: title.trim(),
        assessmentType,
        assignedAt: now,
        dueAt: dueDate,
        isLocked: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1
      });

      const catsToAdd: AssessmentCategory[] = [];
      if (kChecked) catsToAdd.push({ id: crypto.randomUUID(), assessmentId: assessId, categoryCode: 'K', maxScore: kMax, evidenceWeight: kWeight, markScaleVersionId: policy?.defaultMarkScaleVersionId || null, createdAt: now, updatedAt: now, deletedAt: null, version: 1 });
      if (tChecked) catsToAdd.push({ id: crypto.randomUUID(), assessmentId: assessId, categoryCode: 'T', maxScore: tMax, evidenceWeight: tWeight, markScaleVersionId: policy?.defaultMarkScaleVersionId || null, createdAt: now, updatedAt: now, deletedAt: null, version: 1 });
      if (cChecked) catsToAdd.push({ id: crypto.randomUUID(), assessmentId: assessId, categoryCode: 'C', maxScore: cMax, evidenceWeight: cWeight, markScaleVersionId: policy?.defaultMarkScaleVersionId || null, createdAt: now, updatedAt: now, deletedAt: null, version: 1 });
      if (aChecked) catsToAdd.push({ id: crypto.randomUUID(), assessmentId: assessId, categoryCode: 'A', maxScore: aMax, evidenceWeight: aWeight, markScaleVersionId: policy?.defaultMarkScaleVersionId || null, createdAt: now, updatedAt: now, deletedAt: null, version: 1 });

      await db.assessmentCategories.bulkAdd(catsToAdd);

      // Assign to all active enrollments by default
      const activeEnrollments = enrollments.filter(enr => enr.deletedAt === null && enr.enrollmentStatus === 'active');
      const sas = activeEnrollments.map(enr => ({
        id: crypto.randomUUID(),
        assessmentId: assessId,
        classEnrollmentId: enr.id,
        workflowStatus: 'assigned' as const,
        completionStatus: 'incomplete' as const,
        isLate: false,
        assignedAt: now,
        dueAt: dueDate,
        submittedAt: null,
        assessedAt: null,
        returnedAt: null,
        overallFeedback: null,
        privateNotes: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1
      }));
      await db.studentAssessments.bulkAdd(sas);
    });

    setShowCreateModal(false);
    setTitle('');
    setCode('');
    onRefresh();
  };

  const handleArchive = async (assessId: UUID) => {
    if (!confirm('Archive this assessment?')) return;
    await db.assessments.update(assessId, { deletedAt: new Date().toISOString() });
    onRefresh();
  };

  const handleDuplicate = async (a: Assessment) => {
    const now = new Date().toISOString();
    const newId = crypto.randomUUID();

    const oldCats = categories.filter(c => c.assessmentId === a.id && c.deletedAt === null);

    await db.transaction('rw', [db.assessments, db.assessmentCategories], async () => {
      await db.assessments.add({
        ...a,
        id: newId,
        code: `${a.code}-COPY`,
        title: `${a.title} (Copy)`,
        createdAt: now,
        updatedAt: now,
        version: 1
      });

      const newCats = oldCats.map(c => ({
        ...c,
        id: crypto.randomUUID(),
        assessmentId: newId,
        createdAt: now,
        updatedAt: now,
        version: 1
      }));
      await db.assessmentCategories.bulkAdd(newCats);
    });

    onRefresh();
  };
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-200 mb-6 gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
            Central Assessment Hub &amp; Rubrics
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Create, configure, and weight evaluations using Ontario achievement chart criteria (K, T, C, A).
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>New Assessment</span>
        </button>
      </div>

      {/* Assessment List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredAssessments.map(a => {
          const cats = categories.filter(c => c.assessmentId === a.id && c.deletedAt === null);
          const unit = units.find(u => u.id === a.unitId);

          return (
            <div key={a.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow transition flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                      {a.code} &bull; {unit ? unit.code : 'Unit'}
                    </span>
                    <h3 className="font-bold text-slate-900 text-sm mt-1">{a.title}</h3>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    a.assessmentType === 'summative' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {a.assessmentType}
                  </span>
                </div>

                {/* Categories Pill Bar */}
                <div className="flex items-center space-x-1.5 mt-4">
                  <span className="text-[11px] text-slate-400 font-medium">Assesses:</span>
                  {cats.map(c => (
                    <span key={c.id} className={`w-5 h-5 rounded text-[10px] font-extrabold flex items-center justify-center text-white ${
                      c.categoryCode === 'K' ? 'bg-blue-600' :
                      c.categoryCode === 'T' ? 'bg-purple-600' :
                      c.categoryCode === 'C' ? 'bg-emerald-600' : 'bg-amber-600'
                    }`}>
                      {c.categoryCode}
                    </span>
                  ))}
                </div>

                <div className="mt-3 text-[11px] text-slate-500 flex items-center space-x-2">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Due: {a.dueAt.slice(0, 10)}</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-1">
                  <button onClick={() => handleDuplicate(a)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg" title="Duplicate">
                    <Copy className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleArchive(a.id)} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg" title="Archive">
                    <Archive className="w-4 h-4" />
                  </button>
                </div>
                <span className="text-[11px] text-emerald-600 font-bold flex items-center space-x-1">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Active</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-3">Create New Assessment</h3>
            <form onSubmit={handleCreateAssessment} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Code</label>
                  <input type="text" required value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. U2-ESSAY" className="w-full px-2.5 py-1.5 text-xs border rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Type</label>
                  <select value={assessmentType} onChange={e => setAssessmentType(e.target.value as any)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-white">
                    <option value="summative">Summative</option>
                    <option value="formative">Formative</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Title</label>
                <input type="text" required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Comparative Synthesis Essay" className="w-full px-2.5 py-1.5 text-xs border rounded-lg" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Unit</label>
                  <select value={selectedUnitId} onChange={e => setSelectedUnitId(e.target.value)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-white">
                    {units.map(u => (
                      <option key={u.id} value={u.id}>{u.code} - {u.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Due Date</label>
                  <input type="date" value={dueDate.slice(0, 10)} onChange={e => setDueDate(`${e.target.value}T23:59:00Z`)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-white" />
                </div>
              </div>

              {/* Categories Checklist */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">Categories Assessed</label>
                <div className="space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between text-xs">
                    <label className="flex items-center space-x-2 font-bold text-blue-700">
                      <input type="checkbox" checked={kChecked} onChange={e => setKChecked(e.target.checked)} />
                      <span>K (Knowledge &amp; Understanding)</span>
                    </label>
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] text-slate-400">Max:</span>
                      <input type="number" value={kMax} onChange={e => setKMax(parseInt(e.target.value))} className="w-14 px-1 py-0.5 text-xs border rounded" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <label className="flex items-center space-x-2 font-bold text-purple-700">
                      <input type="checkbox" checked={tChecked} onChange={e => setTChecked(e.target.checked)} />
                      <span>T (Thinking &amp; Inquiry)</span>
                    </label>
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] text-slate-400">Max:</span>
                      <input type="number" value={tMax} onChange={e => setTMax(parseInt(e.target.value))} className="w-14 px-1 py-0.5 text-xs border rounded" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <label className="flex items-center space-x-2 font-bold text-emerald-700">
                      <input type="checkbox" checked={cChecked} onChange={e => setCChecked(e.target.checked)} />
                      <span>C (Communication)</span>
                    </label>
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] text-slate-400">Max:</span>
                      <input type="number" value={cMax} onChange={e => setCMax(parseInt(e.target.value))} className="w-14 px-1 py-0.5 text-xs border rounded" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <label className="flex items-center space-x-2 font-bold text-amber-700">
                      <input type="checkbox" checked={aChecked} onChange={e => setAChecked(e.target.checked)} />
                      <span>A (Application)</span>
                    </label>
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] text-slate-400">Max:</span>
                      <input type="number" value={aMax} onChange={e => setAMax(parseInt(e.target.value))} className="w-14 px-1 py-0.5 text-xs border rounded" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t">
                <button type="button" onClick={() => setShowCreateModal(false)} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
                <button type="submit" className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 rounded-lg shadow-sm">Create Assessment</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
