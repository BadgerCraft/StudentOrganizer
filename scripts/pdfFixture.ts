/** Tiny reproducible PDF with visible yellow highlighting/red grading, no private data. */
export function fictionalMarkedPdf(options: { pages?: number; script?: boolean; form?: boolean; width?: number; scan?: boolean; annotations?: boolean; rotate?: number } = {}): Uint8Array {
  const pages = options.pages ?? 2, objects: string[] = [];
  const pageIds = Array.from({ length: pages }, (_, i) => 4 + i * 2);
  objects.push(`<< /Type /Catalog /Pages 2 0 R ${options.script ? '/Names << /JavaScript << /Names [(Open) << /S /JavaScript /JS (app.alert\\(1\\)) >>] >> >>' : ''} ${options.form ? '/AcroForm << /Fields [<< /FT /Tx /T (Grade) /V (3) >>] >>' : ''} >>`);
  objects.push(`<< /Type /Pages /Count ${pages} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const extraId = 4 + pages * 2;
  for (const [i, id] of pageIds.entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${options.width ?? 400} 500] /Rotate ${options.rotate ?? 0} /Resources << /Font << /F1 3 0 R >> ${options.scan ? `/XObject << /Im1 ${extraId} 0 R >>` : ''} >> ${options.annotations ? `/Annots [${extraId} 0 R ${extraId + 2} 0 R]` : ''} /Contents ${id + 1} 0 R >>`);
    const content = options.scan ? 'q 330 0 0 70 30 370 cm /Im1 Do Q\n' : options.annotations ? '' : `1 1 0 rg 30 370 330 70 re f\n1 0 0 RG 2 w 20 350 360 110 re S\n1 0 0 rg BT /F1 20 Tf 40 410 Td (Fictional rubric - page ${i + 1}) Tj 0 -30 Td (Knowledge: 3+) Tj ET\n`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  }
  if (options.scan) {
    const image = 'FFFF00FFFF00FFFF00FFFF00>'; // 2x2 RGB yellow scanned pixels
    objects.push(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${image.length} >>\nstream\n${image}\nendstream`);
  }
  if (options.annotations) {
    objects.push(`<< /Type /Annot /Subtype /Highlight /Rect [30 370 360 440] /QuadPoints [30 440 360 440 30 370 360 370] /C [1 1 0] /F 4 /AP << /N ${extraId + 1} 0 R >> >>`);
    const yellow = '1 1 0 rg 0 0 330 70 re f';
    objects.push(`<< /Type /XObject /Subtype /Form /BBox [0 0 330 70] /Length ${yellow.length} >>\nstream\n${yellow}\nendstream`);
    objects.push(`<< /Type /Annot /Subtype /Ink /Rect [30 280 200 330] /InkList [[30 280 200 330]] /C [1 0 0] /F 4 /AP << /N ${extraId + 3} 0 R >> >>`);
    const ink = '1 0 0 RG 4 w 0 0 m 170 50 l S';
    objects.push(`<< /Type /XObject /Subtype /Form /BBox [0 0 170 50] /Length ${ink.length} >>\nstream\n${ink}\nendstream`);
  }
  let pdf = '%PDF-1.7\n'; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
