// Preserve numeric values; treat formula-leading text as spreadsheet text.
function spreadsheetText(value: unknown): string {
  const text = String(value);
  return typeof value !== 'number' && (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text))
    ? "'" + text : text;
}

/**
 * RFC 4180-compliant CSV escaping utility.
 * Escapes cell values containing commas, double quotes, carriage returns, or line feeds.
 */
export function escapeCSVCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '""';
  }
  const str = spreadsheetText(value);
  if (
    str.includes('"') ||
    str.includes(',') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Escapes a cell without quotes if alphanumeric and clean, or wraps in quotes if needed.
 */
export function formatCSVCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = spreadsheetText(value);
  if (
    str.includes('"') ||
    str.includes(',') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
