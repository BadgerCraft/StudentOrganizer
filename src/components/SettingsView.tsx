import React, { useState } from 'react';
import {
  Settings,
  Sliders,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import type { GradingPolicy, MarkScaleEntry } from '../types/schema';
import { db } from '../db/database';

interface SettingsViewProps {
  policy: GradingPolicy | null;
  scaleEntries: MarkScaleEntry[];
  onRefresh: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  policy,
  scaleEntries,
  onRefresh
}) => {
  const [weightK, setWeightK] = useState(policy?.weightK ?? 25);
  const [weightT, setWeightT] = useState(policy?.weightT ?? 25);
  const [weightC, setWeightC] = useState(policy?.weightC ?? 25);
  const [weightA, setWeightA] = useState(policy?.weightA ?? 25);
  const [excludeFormative, setExcludeFormative] = useState(policy?.excludeFormative ?? true);
  const [missingPolicy, setMissingPolicy] = useState(policy?.missingWorkPolicy ?? 'exclude');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const totalWeight = weightK + weightT + weightC + weightA;
  const isWeightValid = Math.abs(totalWeight - 100) < 0.001;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policy) return;
    if (!isWeightValid) {
      alert('Category weights must sum to exactly 100%.');
      return;
    }

    await db.gradingPolicies.update(policy.id, {
      weightK,
      weightT,
      weightC,
      weightA,
      excludeFormative,
      missingWorkPolicy: missingPolicy,
      updatedAt: new Date().toISOString()
    });

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
    onRefresh();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
          <Sliders className="w-6 h-6 text-blue-600" />
          <span>Grading Policies &amp; Mark Scales</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure Ontario Achievement Chart category weights, missing work rules, and inspect versioned mark scales.
        </p>
      </div>

      {savedSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold p-3 rounded-xl flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>Grading policy updated successfully!</span>
        </div>
      )}

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
    </div>
  );
};
