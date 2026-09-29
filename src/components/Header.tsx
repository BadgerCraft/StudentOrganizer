import React from 'react';
import {
  LayoutGrid,
  Table as TableIcon,
  BookOpen,
  History,
  Settings,
  DownloadCloud,
  CheckCircle2,
  ChevronDown,
  UserCheck
} from 'lucide-react';
import type { ClassSection, Course, User } from '../types/schema';

interface HeaderProps {
  currentView: 'dashboard' | 'seating' | 'markbook' | 'assessments' | 'participation' | 'settings' | 'portability';
  onViewChange: (view: 'dashboard' | 'seating' | 'markbook' | 'assessments' | 'participation' | 'settings' | 'portability') => void;
  activeClass: { section: ClassSection; course: Course } | null;
  allClasses: { section: ClassSection; course: Course }[];
  onSelectClass: (sectionId: string) => void;
  currentUser?: User | null;
  onOpenTeacherSelector?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  onViewChange,
  activeClass,
  allClasses,
  onSelectClass,
  currentUser,
  onOpenTeacherSelector
}) => {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left: Brand & Class Selector */}
          <div className="flex items-center space-x-4">
            <button
              onClick={() => onViewChange('dashboard')}
              data-testid="nav-dashboard-btn"
              className="flex items-center space-x-2.5 hover:opacity-80 transition"
            >
              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                ON
              </div>
              <div className="text-left">
                <span className="font-bold text-slate-900 tracking-tight text-base block leading-tight">
                  Ontario Markbook
                </span>
                <span className="text-[11px] font-medium text-slate-600 block uppercase tracking-wider">
                  Secondary K / T / C / A
                </span>
              </div>
            </button>

            {/* Current Class Switcher */}
            {activeClass && (
              <div className="relative group pl-3 border-l border-slate-200">
                <div className="flex items-center space-x-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg cursor-pointer transition">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: activeClass.section.colorToken }}
                  />
                  <div>
                    <span className="font-semibold text-xs text-slate-800">
                      {activeClass.course.code}
                    </span>
                    <span className="text-xs text-slate-600 ml-1.5">
                      ({activeClass.section.sectionNumber})
                    </span>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <select
                  data-testid="header-class-select"
                  aria-label="Select active class"
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  value={activeClass.section.id}
                  onChange={(e) => onSelectClass(e.target.value)}
                >
                  {allClasses.map(({ section, course }) => (
                    <option key={section.id} value={section.id}>
                      {course.code} - {course.title} ({section.sectionNumber})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Center: Class View / List View Primary Toggle (when a class is active) */}
          {activeClass && (
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner">
              <button
                onClick={() => onViewChange('seating')}
                data-testid="nav-seating-btn"
                className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition ${
                  currentView === 'seating'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                <span>Class View (Seating)</span>
              </button>
              <button
                onClick={() => onViewChange('markbook')}
                className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition ${
                  currentView === 'markbook'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TableIcon className="w-4 h-4" />
                <span>List View (Markbook)</span>
              </button>
            </div>
          )}

          {/* Right: Quick Tools & Autosave Badge */}
          <div className="flex items-center space-x-2">
            {activeClass && (
              <>
                <button
                  onClick={() => onViewChange('assessments')}
                  className={`p-2 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition ${
                    currentView === 'assessments'
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                  title="Manage Assessments & Rubrics"
                >
                  <BookOpen className="w-4 h-4" />
                  <span className="hidden md:inline">Assessments</span>
                </button>

                <button
                  onClick={() => onViewChange('participation')}
                  className={`p-2 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition ${
                    currentView === 'participation'
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                  title="Participation Ledger & Analytics"
                >
                  <History className="w-4 h-4" />
                  <span className="hidden md:inline">Participation</span>
                </button>
              </>
            )}

            <button
              onClick={() => onViewChange('portability')}
              data-testid="nav-portability-btn"
              className={`p-2 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition ${
                currentView === 'portability'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
              title="CSV Import/Export & JSON Backup"
            >
              <DownloadCloud className="w-4 h-4" />
              <span className="hidden lg:inline">Import/Export</span>
            </button>

            <button
              onClick={() => onViewChange('settings')}
              className={`p-2 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition ${
                currentView === 'settings'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
              title="Grading Policies & Scale Presets"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden lg:inline">Settings</span>
            </button>

            {/* Acting Teacher Attribution Badge */}
            <div className="flex items-center pl-3 border-l border-slate-200">
              {currentUser ? (
                <button
                  type="button"
                  onClick={onOpenTeacherSelector}
                  data-testid="header-teacher-btn"
                  className="flex items-center space-x-1.5 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg text-xs transition"
                  title="Acting Teacher for this session (Click to switch)"
                >
                  <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px]">
                    {currentUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <span className="font-semibold text-slate-800 hidden sm:inline max-w-[120px] truncate">
                    {currentUser.name}
                  </span>
                  <span className="text-[10px] text-blue-600 font-medium bg-blue-50 px-1 py-0.5 rounded">
                    Switch
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onOpenTeacherSelector}
                  data-testid="header-select-teacher-btn"
                  className="flex items-center space-x-1.5 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-800 rounded-lg text-xs font-semibold transition animate-pulse"
                  title="No acting teacher selected. Click to select."
                >
                  <UserCheck className="w-4 h-4 text-amber-600" />
                  <span>Select Teacher</span>
                </button>
              )}
            </div>

            {/* Autosave Status Badge */}
            <div className="flex items-center space-x-1.5 pl-3 border-l border-slate-200 text-emerald-600 text-xs font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="hidden xl:inline">Saved locally</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
