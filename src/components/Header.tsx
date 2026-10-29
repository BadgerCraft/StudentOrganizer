import React from 'react';
import { LayoutGrid, Table as TableIcon, BookOpen, History, Settings, ChevronDown, UserCheck, MessageSquareWarning, School } from 'lucide-react';
import type { ClassSection, Course, User } from '../types/schema';

type View = 'dashboard' | 'seating' | 'markbook' | 'assessments' | 'participation' | 'settings' | 'portability';
interface HeaderProps {
  currentView: View;
  onViewChange: (view: View) => void;
  activeClass: { section: ClassSection; course: Course } | null;
  allClasses: { section: ClassSection; course: Course }[];
  onSelectClass: (sectionId: string) => void;
  currentUser?: User | null;
  onOpenTeacherSelector?: () => void;
  onReportProblem?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentView, onViewChange, activeClass, allClasses, onSelectClass, currentUser, onOpenTeacherSelector, onReportProblem }) => {
  const navigation = [
    { view: 'dashboard' as const, label: 'Classes', icon: School, testId: 'nav-dashboard-btn' },
    { view: 'seating' as const, label: 'Class View', icon: LayoutGrid, testId: 'nav-seating-btn' },
    { view: 'assessments' as const, label: 'Markbook', icon: BookOpen, testId: 'nav-markbook-btn' },
    { view: 'markbook' as const, label: 'List View (Markbook)', icon: TableIcon, testId: 'nav-grade-grid-btn' },
    { view: 'participation' as const, label: 'Participation', icon: History, testId: 'nav-participation-btn' },
    { view: 'settings' as const, label: 'Settings', icon: Settings, testId: 'nav-settings-btn' },
  ];
  return <>
    <aside className="app-navigation" aria-label="Main navigation">
      <div className="app-brand"><span aria-hidden="true" className="app-brand-mark">SO</span><span>Student<br />Organizer</span></div>
      <nav className="app-navigation-links">
        {navigation.filter(item => activeClass || item.view === 'dashboard' || item.view === 'settings').map(item => <button
          type="button" key={item.view} data-testid={item.testId} title={item.view === 'assessments' ? 'Manage Assessments & Rubrics' : item.view === 'settings' ? 'Grading Policies & Scale Presets' : undefined}
          aria-current={(currentView === item.view || (currentView === 'portability' && item.view === 'settings')) ? 'page' : undefined}
          onClick={() => onViewChange(item.view)} className="app-nav-button">
          <item.icon size={19} aria-hidden="true" /><span>{item.label}</span>
        </button>)}
      </nav>
      <button type="button" onClick={onReportProblem} aria-label="Report a problem" data-testid="report-problem-btn" className="app-nav-button mt-auto"><MessageSquareWarning size={18} aria-hidden="true" /><span>Report a problem</span></button>
      <span className="text-xs text-slate-500 px-3 py-3">Works offline · Local records</span>
    </aside>
    <header className="app-context-header">
      {activeClass ? <label className="app-class-switcher">
        <span className="sr-only">Select active class</span>
        <select data-testid="header-class-select" aria-label="Select active class" value={activeClass.section.id} onChange={event => onSelectClass(event.target.value)}>
          {allClasses.map(({ section, course }) => <option key={section.id} value={section.id}>{course.code} · {course.title} ({section.sectionNumber})</option>)}
        </select><ChevronDown size={18} aria-hidden="true" />
      </label> : <span className="font-semibold">Your classes</span>}
      <button type="button" onClick={onOpenTeacherSelector} data-testid={currentUser ? 'header-teacher-btn' : 'header-select-teacher-btn'} className="app-teacher-button" title="Acting teacher for this session — click to switch">
        <UserCheck size={18} aria-hidden="true" /><span>{currentUser?.name || 'Select Teacher'}</span><ChevronDown size={15} aria-hidden="true" />
      </button>
    </header>
    {import.meta.env.VITE_BUILD_SHA && <div className="bg-amber-50 px-4 py-1 text-xs text-amber-900" data-testid="platform-build-id">Platform test build · {import.meta.env.VITE_BUILD_SHA.slice(0, 12)} · local records</div>}
  </>;
};
