/** Quoted CSV/TSV cells, including embedded newlines; never discard a nonempty cell. */
export function parseDelimitedText(input: string, delimiter: '\t' | ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, afterQuote = false;
  const finishCell = () => { row.push(cell); cell = ''; afterQuote = false; };
  const finishRow = () => { finishCell(); if (row.some(value => value.trim())) rows.push(row); row = []; };
  for (let at = 0; at < input.length; at++) {
    const character = input[at];
    if (quoted) {
      if (character === '"' && input[at + 1] === '"') { cell += '"'; at++; }
      else if (character === '"') { quoted = false; afterQuote = true; }
      else cell += character;
    } else if (character === '"' && !cell && !afterQuote) quoted = true;
    else if (character === delimiter) finishCell();
    else if (character === '\n') finishRow();
    else if (afterQuote) {
      if (!/\s/.test(character)) throw new Error('Unexpected text after a quoted cell.');
    } else cell += character;
  }
  if (quoted) throw new Error('A quoted cell is unfinished.');
  if (cell || row.length || afterQuote) finishRow();
  return rows;
}
export function encodeTsv(rows: string[][]): string {
  return rows.map(row => row.map(value => /[\t\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value).join('\t')).join('\n');
}
