import type { Page } from 'playwright';

type TestFile = { name: string; mimeType: string; buffer: Buffer };
export async function revealRubricPaste(page: Page) {
  const field = page.getByTestId('marking-rubric-paste');
  if (!await field.isVisible()) await page.locator('summary').filter({ hasText: /^Paste rubric text or table$/ }).click();
}
export async function chooseOfficialLevel(page: Page, category: string, level: string) {
  const group = page.getByRole('group', { name: `${category} category judgment`, exact: true });
  await group.getByRole('button', { name: /^(✓ )?Level$/ }).click();
  await group.getByRole('group', { name: `Official ${category} level`, exact: true }).getByRole('button', { name: new RegExp(`^(✓ )?${level.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).click();
}
/** Exercise actual guided UI; default distinct students, optionally multiple files for one. */
export async function importDocumentsForStudents(page: Page, files: TestFile[], single = false) {
  const wizard = page.getByRole('region', { name: 'Add student work', exact: true });
  // Component uses section aria-label; scope by its visible heading if no region name was supplied.
  const scope = await wizard.count() ? wizard : page.locator('[aria-label="Prepare student work"]');
  const root = await scope.count() ? scope : page;
  await root.getByLabel('Upload a text/document file', { exact: true }).check();
  await root.getByRole('button', { name: 'Continue', exact: true }).click();
  await root.getByLabel('Choose text/document files', { exact: true }).setInputFiles(files);
  await root.getByRole('button', { name: 'Add work and select students', exact: true }).click();
  const students = page.getByRole('group', { name: 'Class students', exact: true });
  await students.waitFor();
  const ids = await page.evaluate(() => new Promise<{value:string;label:string}[]>((resolve,reject)=>{
    const r=indexedDB.open('OntarioTeacherAssessmentDB'); r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result; const tx=db.transaction(['classEnrollments','students'],'readonly');const a=tx.objectStore('classEnrollments').getAll(),b=tx.objectStore('students').getAll();tx.oncomplete=()=>{resolve(a.result.filter(e=>e.deletedAt===null&&e.enrollmentStatus==='active').map(e=>{const s=b.result.find(s=>s.id===e.studentId);return {value:e.id,label:`${s.firstName} ${s.lastName} (${s.localStudentNumber})`};}));db.close();};};
  }));
  const available: typeof ids = [];
  for (const item of ids) if(await students.getByLabel(item.label,{exact:true}).count()) available.push(item);
  if (single || files.length===1) {
    await students.getByLabel(available[0].label,{exact:true}).check();
    await root.getByRole('button',{name:'Confirm student and review work',exact:true}).click();
  } else {
    await root.getByLabel('Several students',{exact:true}).check();
    for (let i=0;i<files.length;i++) await students.getByLabel(available[i].label,{exact:true}).check();
    await root.getByRole('button',{name:'Continue to matching',exact:true}).click();
    for(let i=0;i<files.length;i++) {
      await root.getByRole('group',{name:/^Work items/}).getByLabel(files[i].name,{exact:true}).check();
      await root.getByRole('group',{name:/^Students ·/}).getByRole('radio',{name:new RegExp(available[i].label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).check();
      await root.getByRole('button',{name:'Confirm match',exact:true}).click();
    }
    await root.getByRole('button',{name:'Review matches',exact:true}).click();
  }
  await root.getByRole('button',{name:'Confirm and start marking',exact:true}).click();
  await page.getByRole('region',{name:'Marking session',exact:true}).waitFor();
  return available;
}
