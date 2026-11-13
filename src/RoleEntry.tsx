import React, { lazy, Suspense, useState } from 'react';
import { EncryptedBootstrap } from './security/EncryptedBootstrap';
const ControlPanel = lazy(() => import('../apps/control-panel/src/ControlPanel').then(module => ({ default: module.ControlPanel })));

/** Workspace navigation only. This deliberately grants no identity or permissions. */
export function RoleEntry() {
  const [role, setRole] = useState<'administrator' | 'teacher' | null>(null);
  if (role === 'teacher') return <EncryptedBootstrap />;
  if (role === 'administrator') return <Suspense fallback={<p role="status" className="p-8">Opening Control Panel…</p>}><ControlPanel onBack={() => setRole(null)} /></Suspense>;
  return <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center p-6">
    <section className="w-full max-w-3xl" aria-labelledby="role-title">
      <p className="text-sm font-medium mb-3">Student Organizer</p>
      <h1 id="role-title" className="text-3xl font-bold mb-3">Choose your role</h1>
      <p className="mb-8">Choose the workspace you want to open. Roles do not restrict access on this device.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <button className="rounded-xl border border-slate-400 p-6 text-left hover:bg-slate-100 focus-visible:outline focus-visible:outline-4 focus-visible:outline-blue-600" onClick={() => setRole('administrator')}><span className="block text-xl font-semibold">Administrator</span><span className="block mt-2 text-sm">Open Control Panel</span></button>
        <button className="rounded-xl border border-slate-400 p-6 text-left hover:bg-slate-100 focus-visible:outline focus-visible:outline-4 focus-visible:outline-blue-600" onClick={() => setRole('teacher')}><span className="block text-xl font-semibold">Teacher</span><span className="block mt-2 text-sm">Open your classroom workspace</span></button>
        <button disabled aria-describedby="student-unavailable" className="rounded-xl border border-slate-300 bg-slate-100 text-slate-500 p-6 text-left cursor-not-allowed"><span className="block text-xl font-semibold">Student</span><span id="student-unavailable" className="block mt-2 text-sm">Currently unavailable</span></button>
      </div>
    </section>
  </main>;
}
