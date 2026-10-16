import React from 'react';
import { CLASSROOM_LEVELS } from '../services/classroomLevels';

interface LevelPickerProps {
  value: string;
  onChange: (level: string) => void;
  label?: string;
  disabled?: boolean;
}

/** Shared visible classroom choices. Selection never assigns an official mark implicitly. */
export function LevelPicker({ value, onChange, label = 'Level', disabled = false }: LevelPickerProps) {
  return <fieldset disabled={disabled} className="space-y-2">
    <legend className="text-sm font-semibold">{label}</legend>
    <div className="flex flex-wrap gap-2">{CLASSROOM_LEVELS.map(level => <button key={level.label} type="button"
      aria-pressed={value === level.label} onClick={() => onChange(level.label)}
      className={`rounded-lg border-2 px-3 py-2 font-semibold ${value === level.label ? 'border-blue-800 bg-blue-100 text-blue-950' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'}`}>
      {value === level.label && <span aria-hidden="true">✓ </span>}{level.label}
    </button>)}</div>
  </fieldset>;
}
