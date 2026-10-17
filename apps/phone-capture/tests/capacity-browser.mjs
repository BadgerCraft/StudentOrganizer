import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.goto(process.env.CAPTURE_TEST_URL??'http://127.0.0.1:4173');
 page.on('console',message=>{if(message.type()==='log')console.log(message.text());});
 const download=page.waitForEvent('download',{timeout:600000});
 const result=await page.evaluate(async()=>{
  const s=await import('/src/store.ts');const start=performance.now();
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1600;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,1600);ctx.fillStyle='#234';ctx.font='32px sans-serif';for(let i=0;i<35;i++)ctx.fillText(`Fictional class capacity worksheet line ${i+1}`,35,50+i*42);
  const photo=await s.readPhoto(new File([await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85))],'fictional-capacity.jpg'));
  let batch={...s.emptyBatch(),assignment:'Fictional forty-student capacity'};
  const db=new s.CaptureDB(`fictional-capacity-browser-${crypto.randomUUID()}`);
  try {
    const saves=[];
    for(let student=0;student<40;student++){
      for(let index=0;index<10;index++){
        const began=performance.now();
        batch=await s.save(db,s.appendPages(batch,[{...photo,id:crypto.randomUUID(),bytes:photo.bytes.slice()}]));
        saves.push(Math.round(performance.now()-began));
      }
      batch=await s.save(db,s.saveGroup({...batch,stage:'preview',draftLabel:`Fictional student ${student+1}`}));
      if((student+1)%10===0)console.log(JSON.stringify({savedStudents:student+1,elapsedMs:Math.round(performance.now()-start),lastPhotoSaveMs:saves.at(-1)}));
    }
    const capturedMs=Math.round(performance.now()-start);
    // The UI validates the completed package before freezing; exercise that path too.
    const completed=s.completeBatch(batch);await s.exportBatch({...completed,revision:completed.revision+1});
    batch=await s.save(db,completed);
    db.close();await db.open();
    const bytes=await s.exportSavedBatch(db,batch);
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));const link=document.createElement('a');link.href=url;link.download='fictional-class-capacity.zip';link.click();
    return {students:batch.groups.length,pages:400,totalPixels:1200*1600*400,photoBytes:photo.bytes.length,archiveBytes:bytes.length,incrementalSaves:441,capturedMs,firstPhotoSaveMs:saves[0],lastPhotoSaveMs:saves.at(-1),maxPhotoSaveMs:Math.max(...saves),elapsedMs:Math.round(performance.now()-start)};
  } finally {await db.delete();}

 });
 await (await download).saveAs('/tmp/capture-class-capacity.zip');
 assert.equal(result.students,40);assert.equal(result.pages,400);assert.ok(result.archiveBytes>1_000_000);console.log('PASS incremental whole-class persistence, preflight, restart and export workload',JSON.stringify(result),'Desktop Chromium only; real phone memory/latency remains unverified.');
}finally{await browser.close();}
