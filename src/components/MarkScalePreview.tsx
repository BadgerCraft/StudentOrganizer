import { useLiveQuery } from 'dexie-react-hooks';
import { db, type OntarioTeacherDB } from '../db/database';
import type { MarkScaleEntry, MarkScaleFamily, MarkScaleVersion, UUID } from '../types/schema';

export interface ScalePreviewData {
  version: MarkScaleVersion | null;
  family: MarkScaleFamily | null;
  entries: MarkScaleEntry[];
}

/** Read exactly the version the class uses, never substitute another scale's entries. */
export async function loadScalePreview(database: OntarioTeacherDB, versionId: UUID): Promise<ScalePreviewData> {
  return database.transaction('r', database.markScaleVersions, database.markScaleFamilies,
    database.markScaleEntries, async () => {
      const version = await database.markScaleVersions.get(versionId);
      if (!version || version.deletedAt !== null) return { version: null, family: null, entries: [] };
      const family = await database.markScaleFamilies.get(version.markScaleFamilyId);
      const entries = await database.markScaleEntries.where('markScaleVersionId').equals(version.id).sortBy('sortOrder');
      return { version, family: family?.deletedAt === null ? family : null, entries };
    });
}

export function MarkScalePreviewContent({ data }: { data: ScalePreviewData | undefined }) {
  return (
    <section data-testid="mark-scale-preview" className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
      <h2 className="text-base font-bold text-slate-900 pb-2 border-b border-slate-100">
        {data?.family?.name || 'Achievement-Level Teacher Conversion Preset'}
        {data?.version && <span className="block text-sm font-medium mt-1">Class version {data.version.revision} · Effective {data.version.effectiveFrom}{data.version.retiredAt ? ` · Retired ${data.version.retiredAt}` : ''}</span>}
      </h2>
      <p className="text-xs text-slate-600">The selected class uses these teacher preset values to convert achievement levels to percentages. Direct percentage marks stay direct. Participation observations do not affect formal grades.</p>
      {!data ? <p role="status" className="text-sm text-slate-600">Loading the class conversion preset…</p> :
        !data.version ? <p role="status" className="text-sm text-amber-800">The class conversion version is unavailable. No percentage conversions are shown; restore a complete backup or check the class configuration.</p> :
          data.entries.length === 0 ? <p role="status" className="text-sm text-amber-800">This class version has no conversion entries. No default percentages have been substituted.</p> :
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {data.entries.map(entry => (
                <div key={entry.id} data-testid="mark-scale-entry" className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                  <span className="font-extrabold text-sm text-blue-700 block">{entry.code}</span>
                  <span className="text-[11px] text-slate-600">{entry.label}</span>
                  <div className="mt-2 text-[11px] text-slate-600">{entry.isNumeric ? <>
                    Converts to <strong className="text-slate-800">{entry.benchmarkPercentage}%</strong><br />
                    Range: {entry.minimumPercentage}–{entry.maximumPercentage}%
                  </> : 'No numeric conversion'}</div>
                  <p className="mt-2 text-[11px] text-slate-600">{entry.description}</p>
                </div>
              ))}
            </div>}
    </section>
  );
}

export function MarkScalePreview({ versionId }: { versionId: UUID | null }) {
  const data = useLiveQuery(() => versionId ? loadScalePreview(db, versionId) :
    Promise.resolve({ version: null, family: null, entries: [] }), [versionId]);
  return <MarkScalePreviewContent data={data} />;
}
