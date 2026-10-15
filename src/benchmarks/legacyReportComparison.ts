import assert from 'node:assert/strict';

/** The pinned legacy renderer predates KTCA display ordering. Normalize only
 * that table's row order; every score, comment and all remaining HTML stay exact. */
export function canonicalLegacyReport(html: string): string {
  const marker = '<h2>Category judgments</h2><table><thead><tr><th>Category</th><th>Teacher judgment</th><th>Feedback</th></tr></thead><tbody>';
  const start = html.indexOf(marker);
  assert.ok(start >= 0 && html.indexOf(marker, start + marker.length) === -1, 'Exactly one category judgment table required');
  const bodyStart = start + marker.length;
  const bodyEnd = html.indexOf('</tbody>', bodyStart);
  assert.ok(bodyEnd >= bodyStart, 'Category judgment table must be complete');
  const body = html.slice(bodyStart, bodyEnd);
  const rows = body.match(/<tr><th>[^<]+<\/th><td>[\s\S]*?<\/td><td>[\s\S]*?<\/td><\/tr>/g) ?? [];
  assert.equal(rows.join(''), body, 'Category rows must retain the generated report structure');
  const names = rows.map(row => row.slice('<tr><th>'.length, row.indexOf('</th>')));
  assert.equal(new Set(names).size, names.length, 'Category judgments must not be duplicated');
  assert.equal(rows.length, 4, 'Legacy fixture must retain all four category judgments');
  assert.deepEqual([...names].sort(), ['Application', 'Communication', 'Knowledge / Understanding', 'Thinking']);
  return html.slice(0, bodyStart) + rows.sort().join('') + html.slice(bodyEnd);
}
