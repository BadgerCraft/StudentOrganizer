import { ClassSettingsService } from '../services/classSettingsService';
import { getAppIdentity, getActiveTeacherId, getIdentityEpoch, subscribeIdentityChange } from '../services/identityService';
import { AuthorizationError } from '../services/authHelper';
import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Calendar,
  Archive,
  Copy,
  CheckCircle
} from 'lucide-react';
import type {
  Assessment,
  AssessmentCategory,
  ClassSection,
  Unit,
  ClassEnrollment,
  Student,
  UUID
} from '../types/schema';
import { db } from '../db/database';
import { UnitService } from '../services/unitService';
import { sortCategoriesForDisplay } from '../utils/categoryDisplay';
import { ModalDialog } from './ModalDialog';

interface AssessmentHubViewProps {
  classSection: ClassSection;
  assessments: Assessment[];
  categories: AssessmentCategory[];
  units: Unit[];
  enrollments: ClassEnrollment[];
  students: Student[];
  userId?: UUID;
  onOpenMarking?: (assessmentId: string) => void;
  onRefresh: () => void;
}

export const AssessmentHubView: React.FC<AssessmentHubViewProps> = ({
  classSection,
  assessments,
  categories,
  units,
  enrollments,
  students,
  userId,
  onRefresh,
  onOpenMarking
}) => {
  const [actionError, setActionError] = useState<string | null>(null);
  const service = new ClassSettingsService(db);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const context = useRef({ classSectionId: classSection.id, userId });
  context.current = { classSectionId: classSection.id, userId };
  const actor = async (epoch = getIdentityEpoch()) => {
    const sectionId = classSection.id;
    const current = () => mounted.current && !!userId && context.current.userId === userId &&
      context.current.classSectionId === sectionId && getActiveTeacherId() === userId && getIdentityEpoch() === epoch;
    if (!current()) throw new AuthorizationError('Acting teacher or class changed. Please reopen the editor.');
    const identity = await getAppIdentity(db);
    if (!current() || identity.userId !== userId) throw new AuthorizationError('Acting teacher or class changed. Please reopen the editor.');
    return { ...identity, identityEpoch: epoch };
  };
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'summative' | 'formative'>('all');
  const [filterUnit, setFilterUnit] = useState<string>('all');
  const [showUnits, setShowUnits] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [unitCode, setUnitCode] = useState('');
  const [unitTitle, setUnitTitle] = useState('');
  const [unitOrder, setUnitOrder] = useState(0);
  const [unitStartsOn, setUnitStartsOn] = useState('');
  const [unitEndsOn, setUnitEndsOn] = useState('');
  const [unitSaving, setUnitSaving] = useState(false);
  const [unitBaseline, setUnitBaseline] = useState('');
  const unitEpoch = useRef(getIdentityEpoch());
  const assessmentEpoch = useRef(getIdentityEpoch());
  useEffect(() => {
    setShowUnitForm(false);
    setShowCreateModal(false);
    setFilterUnit('all');
    setActionError(null);
  }, [classSection.id, userId]);
  useEffect(() => subscribeIdentityChange(() => {
    setShowUnitForm(false);
    setShowCreateModal(false);
  }), []);
  const unitDraft = JSON.stringify({ code: unitCode, title: unitTitle, sortOrder: unitOrder,
    startsOn: unitStartsOn, endsOn: unitEndsOn });
  const activeUnits = units.filter(u => u.deletedAt === null && u.classSectionId === classSection.id)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

  const openUnitForm = (unit: Unit | null) => {
    const order = unit?.sortOrder ?? Math.max(0, ...activeUnits.map(u => u.sortOrder)) + 1;
    unitEpoch.current = getIdentityEpoch();
    setEditingUnit(unit);
    setUnitCode(unit?.code ?? '');
    setUnitTitle(unit?.title ?? '');
    setUnitOrder(order);
    setUnitStartsOn(unit?.startsOn ?? '');
    setUnitEndsOn(unit?.endsOn ?? '');
    setUnitBaseline(JSON.stringify({ code: unit?.code ?? '', title: unit?.title ?? '',
      sortOrder: order, startsOn: unit?.startsOn ?? '', endsOn: unit?.endsOn ?? '' }));
    setActionError(null);
    setShowUnitForm(true);
  };

  const saveUnit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (unitSaving) return;
    setUnitSaving(true);
    setActionError(null);
    try {
      const details = { code: unitCode, title: unitTitle, sortOrder: unitOrder,
        startsOn: unitStartsOn || null, endsOn: unitEndsOn || null };
      const unitService = new UnitService(db);
      if (editingUnit) await unitService.updateUnit(editingUnit.id, editingUnit.version, details, await actor(unitEpoch.current));
      else {
        const unit = await unitService.createUnit(classSection.id, details, await actor(unitEpoch.current));
        setSelectedUnitId(unit.id);
      }
      setShowUnitForm(false);
      onRefresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unit could not be saved.'); }
    finally { setUnitSaving(false); }
  };

  // New assessment form state
  const [title, setTitle] = useState('');
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
    setActionError(null);
    try {
      const categories: { categoryCode: AssessmentCategory['categoryCode']; maxScore: number; evidenceWeight: number }[] = [];
      if (kChecked) categories.push({ categoryCode: 'K', maxScore: kMax, evidenceWeight: kWeight });
      if (tChecked) categories.push({ categoryCode: 'T', maxScore: tMax, evidenceWeight: tWeight });
      if (cChecked) categories.push({ categoryCode: 'C', maxScore: cMax, evidenceWeight: cWeight });
      if (aChecked) categories.push({ categoryCode: 'A', maxScore: aMax, evidenceWeight: aWeight });
      await service.createAssessment({ classSectionId: classSection.id, unitId: selectedUnitId,
        title, assessmentType, dueAt: dueDate, categories, ...await actor(assessmentEpoch.current) });
      setShowCreateModal(false);
      setTitle('');
      onRefresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Assessment could not be saved.'); }
  };

  const handleArchive = async (assessId: UUID) => {
    if (!confirm('Archive this assessment?')) return;
    setActionError(null);
    try {
      const assessment = assessments.find(a => a.id === assessId);
      if (!assessment) throw new Error('Assessment is unavailable.');
      await service.archiveAssessment(assessId, assessment.version, await actor());
      onRefresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Assessment could not be archived.'); }
  };

  const handleDuplicate = async (a: Assessment) => {
    setActionError(null);
    try {
      await service.duplicateAssessment(a.id, a.version, await actor());
      onRefresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Assessment could not be duplicated.'); }
  };
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {actionError && <p role="alert" className="text-red-700 mb-4">{actionError}</p>}
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
          onClick={() => { assessmentEpoch.current = getIdentityEpoch(); setSelectedUnitId(activeUnits.find(u => u.id === selectedUnitId)?.id ?? activeUnits[0]?.id ?? ''); setShowCreateModal(true); }}
          className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>New Assessment</span>
        </button>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 p-4 mb-6" aria-label="Units and assessment filters">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-bold">Assessment type <select aria-label="Assessment type filter" value={filterType} onChange={e => setFilterType(e.target.value as typeof filterType)} className="ml-2 border rounded-lg p-2"><option value="all">All types</option><option value="summative">Summative</option><option value="formative">Formative</option></select></label>
          <label className="text-xs font-bold">Unit <select aria-label="Unit filter" value={filterUnit} onChange={e => setFilterUnit(e.target.value)} className="ml-2 border rounded-lg p-2"><option value="all">All units</option>{activeUnits.map(u => <option key={u.id} value={u.id}>{u.code}: {u.title}</option>)}</select></label>
          <button type="button" onClick={() => setShowUnits(!showUnits)} aria-expanded={showUnits} className="text-blue-700 font-bold text-xs p-2">{showUnits ? 'Hide units' : 'Manage units'}</button>
          <button type="button" disabled={!userId} onClick={() => { setShowUnits(true); openUnitForm(null); }} className="bg-blue-50 text-blue-700 font-bold text-xs rounded-lg p-2">New unit</button>
        </div>
        {showUnits && <div className="mt-4 space-y-2">
          <p className="text-xs text-slate-600">Name, rename and schedule units here. Existing assessments keep their unit links.</p>
          {activeUnits.map(unit => <div key={unit.id} className="flex items-center justify-between gap-3 border-t pt-2 text-sm"><span><strong>{unit.code}: {unit.title}</strong><span className="block text-xs text-slate-500">Order {unit.sortOrder}{unit.startsOn ? ` · ${unit.startsOn}` : ''}{unit.endsOn ? ` to ${unit.endsOn}` : ''}</span></span><button type="button" disabled={!userId} onClick={() => openUnitForm(unit)} aria-label={`Edit unit ${unit.code}`} className="text-blue-700 underline p-2">Edit unit</button></div>)}
          {!activeUnits.length && <p className="text-sm text-slate-600">No units yet. Create a unit before an assessment.</p>}
        </div>}
      </section>

      {/* Assessment List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredAssessments.map(a => {
          const cats = sortCategoriesForDisplay(categories.filter(c => c.assessmentId === a.id && c.deletedAt === null));
          const unit = units.find(u => u.id === a.unitId);

          return (
            <div key={a.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow transition flex flex-col justify-between">
              <button type="button" disabled={!userId} onClick={() => onOpenMarking?.(a.id)} className="mb-3 text-blue-700 underline text-left" data-testid={`open-marking-${a.id}`}>Rubric &amp; marking</button>
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                      {unit ? `${unit.code}: ${unit.title}` : 'Unit'}
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
              {actionError && <p role="alert" className="text-red-700">{actionError}</p>}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Type</label>
                <select aria-label="Assessment type" value={assessmentType} onChange={e => setAssessmentType(e.target.value as 'summative' | 'formative')} className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-white">
                  <option value="summative">Summative</option>
                  <option value="formative">Formative</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Title</label>
                <input type="text" required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Comparative Synthesis Essay" className="w-full px-2.5 py-1.5 text-xs border rounded-lg" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Unit</label>
                  <select aria-label="Assessment unit" value={selectedUnitId} onChange={e => setSelectedUnitId(e.target.value)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-white">
                    {activeUnits.map(u => (
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
                <button type="submit" disabled={!activeUnits.length || !userId} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 rounded-lg shadow-sm disabled:opacity-50">Create Assessment</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ModalDialog isOpen={showUnitForm} onClose={() => { if (!unitSaving) setShowUnitForm(false); }} title={editingUnit ? 'Edit unit' : 'Create unit'} maxWidthClass="max-w-lg" isDirty={!unitSaving && unitDraft !== unitBaseline} confirmDiscardMessage="Discard your unsaved unit changes?" testId="unit-editor-modal">
        {({ requestDismiss }) => <form onSubmit={saveUnit} className="space-y-4"><fieldset disabled={unitSaving} className="space-y-4">
        {actionError && <p role="alert" className="text-red-700">{actionError}</p>}
        <label className="block text-sm">Unit code<input aria-label="Unit code" autoFocus required maxLength={30} value={unitCode} onChange={e => setUnitCode(e.target.value)} className="block border rounded-lg p-2 w-full" placeholder="e.g. U2" /></label>
        <label className="block text-sm">Unit name<input aria-label="Unit name" required maxLength={200} value={unitTitle} onChange={e => setUnitTitle(e.target.value)} className="block border rounded-lg p-2 w-full" /></label>
        <label className="block text-sm">Display order<input aria-label="Unit display order" required type="number" min={0} step={1} value={unitOrder} onChange={e => setUnitOrder(e.target.valueAsNumber)} className="block border rounded-lg p-2 w-full" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">Starts on<input aria-label="Unit starts on" type="date" value={unitStartsOn} onChange={e => setUnitStartsOn(e.target.value)} className="block border rounded-lg p-2 w-full" /></label><label className="text-sm">Ends on<input aria-label="Unit ends on" type="date" value={unitEndsOn} onChange={e => setUnitEndsOn(e.target.value)} className="block border rounded-lg p-2 w-full" /></label></div>
        <div className="flex justify-end gap-3"><button type="button" disabled={unitSaving} onClick={requestDismiss} className="min-h-[44px] px-3">Cancel</button><button type="submit" disabled={unitSaving || !userId} className="bg-blue-600 text-white rounded-lg px-4 py-2 min-h-[44px] disabled:opacity-50">{unitSaving ? 'Saving…' : 'Save unit'}</button></div>
        </fieldset></form>}
      </ModalDialog>
    </div>
  );
};
