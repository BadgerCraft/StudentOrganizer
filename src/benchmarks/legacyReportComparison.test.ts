import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderMarkingReport } from '../marking/report';
vi.mock('../services/nativeFiles', () => ({ usesNativeFiles: () => false }));
import { canonicalLegacyReport } from './legacyReportComparison';

const header = '<h2>Category judgments</h2><table><thead><tr><th>Category</th><th>Teacher judgment</th><th>Feedback</th></tr></thead><tbody>';
const rows = ['Knowledge / Understanding', 'Thinking', 'Communication', 'Application'].map((name, index) => `<tr><th>${name}</th><td>${index === 1 ? '3+ (scale code)' : 'Not assessed'}</td><td>Feedback ${name}</td></tr>`);
const report = (order: number[]) => `<html><body><h1>Fictional assessment</h1>${header}${order.map(i => rows[i]).join('')}</tbody></table><p>Fictional summary &lt;script&gt;literal text&lt;/script&gt;</p><footer>Saved commit fictional-id</footer></body></html>`;

describe('cross-version legacy report evidence', () => {
  it('preserves complete historical report content with absent Archive fields', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/legacy-b9a8790-report.json', import.meta.url), 'utf8'));
    const before = structuredClone(fixture.input);
    const current = renderMarkingReport(fixture.input);
    expect(current).not.toBe(fixture.html);
    expect(canonicalLegacyReport(current)).toBe(canonicalLegacyReport(fixture.html.replace('Criterion / KTAC', 'Criterion / KTCA')));
    expect(fixture.input).toEqual(before);
    expect(fixture.input.attempt).not.toHaveProperty('archivedAt');
    expect(current).not.toContain('<h2>Archived assessment</h2>');
  });
  it('allows only the historical-to-KTCA category display reorder', () => {
    expect(canonicalLegacyReport(report([0, 3, 2, 1]))).toBe(canonicalLegacyReport(report([0, 1, 2, 3])));
  });
  it.each(['3+', 'Feedback Thinking', 'Fictional summary', 'fictional-id'])('detects changed %s despite row reordering', value => {
    expect(canonicalLegacyReport(report([0, 3, 2, 1]).replace(value, 'changed'))).not.toBe(canonicalLegacyReport(report([0, 1, 2, 3])));
  });
  it.each([[0, 1, 2], [0, 1, 2, 2]])('rejects missing or duplicate category rows %j', (...order) => {
    expect(() => canonicalLegacyReport(report(order))).toThrow();
  });
  it('rejects missing table structure', () => {
    expect(() => canonicalLegacyReport('<html>broken report</html>')).toThrow();
  });
});
