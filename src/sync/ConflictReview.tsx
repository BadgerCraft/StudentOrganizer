import { useState } from 'react';
import { canonical, type Conflict, type Row, type Snapshot } from './snapshot';
const labels:Record<string,string>={students:'Student details',studentAssessments:'Assignment progress',categoryResults:'Category grade',participationEvents:'Participation feedback',studentNotes:'Student note',assessments:'Assignment',assessmentCategories:'Assignment category',classSections:'Class',classEnrollments:'Class enrollment',attendanceRecords:'Attendance',markingSessions:'Marking feedback',markingAttempts:'Student submission',markingRubrics:'Rubric',captureAttachments:'Submission photos',seatingLayouts:'Seating layout',seatPositions:'Seat position',gradeOverrides:'Grade override'};
const fieldLabels:Record<string,string>={rawScore:'Grade entered',normalizedPercentage:'Stored percentage',firstName:'First name',lastName:'Last name',preferredName:'Preferred name',overallFeedback:'Overall feedback',privateNotes:'Private notes',workflowStatus:'Marking progress',completionStatus:'Completion',deletedAt:'Removed',localSchoolDate:'School date',snapshottedName:'Feedback choice',achievementLevel:'Achievement level',categoryCode:'Category',content:'Note',feedback:'Feedback',note:'Note',title:'Title',name:'Name',isLate:'Late submission',status:'Status'};
function friendly(key:string):string{return fieldLabels[key]??key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());}
function value(v:unknown,key:string):string {
 if(key==='deletedAt')return v?'Yes':'No';
 if(v===undefined||v===null||v==='')return 'Not set';if(typeof v==='boolean')return v?'Yes':'No';
 if(Array.isArray(v))return `${v.length} item${v.length===1?'':'s'} (see details)`;
 if(typeof v==='object')return 'Updated details (expand below)';
 const text=String(v);return text.length>180?text.slice(0,180)+'…':text;
}
export function describeConflict(conflict:Conflict,snapshot:Snapshot):string {
 if(conflict.table==='__workspace__')return 'Linked changes need one complete version';
 const row=conflict.local??conflict.remote;
 if(!row)return labels[conflict.table]??friendly(conflict.table);
 const find=(table:string,id:unknown)=>snapshot.tables[table]?.find(record=>record.id===id);
 const resultParent=find('studentAssessments',row.studentAssessmentId);
 const enrollment=find('classEnrollments',row.classEnrollmentId??resultParent?.classEnrollmentId);
 const student=conflict.table==='students'?row:find('students',row.studentId??enrollment?.studentId);
 const assignment=conflict.table==='assessments'?row:find('assessments',row.assessmentId??resultParent?.assessmentId);
 const category=find('assessmentCategories',row.assessmentCategoryId);
 const name=student?[student.preferredName??student.firstName,student.lastName].filter(Boolean).join(' '):null;
 return [labels[conflict.table]??friendly(conflict.table),name,assignment?.title,row.localSchoolDate,category?.categoryCode??row.categoryCode,(!name&&!assignment?row.title??row.name:null)].filter(Boolean).join(' · ');
}
export function ConflictReview({conflict,snapshot,choice,onChoose}:{conflict:Conflict;snapshot:Snapshot;choice?:'local'|'remote';onChoose:(choice:'local'|'remote')=>void}) {
 const [showDetails,setShowDetails]=useState(false);
 const whole=conflict.table==='__workspace__';
 const technical=(row:Row|undefined)=>JSON.stringify(whole?Object.fromEntries(Object.entries((row?.snapshot as Snapshot)?.tables??{}).map(([name,records])=>[name,records.length])):row??'Removed',(key,v)=>key==='base64'?'[embedded file data]':typeof v==='string'&&v.length>2000?v.slice(0,2000)+'… [truncated]':v,2);
 const fields=Array.from(new Set([...Object.keys(conflict.local??{}),...Object.keys(conflict.remote??{})])).filter(key=>!['id','createdAt','updatedAt','version'].includes(key)&&!key.endsWith('Id')&&canonical(conflict.local?.[key])!==canonical(conflict.remote?.[key]));
 const count=(row:Row|undefined)=>Object.values((row?.snapshot as Snapshot)?.tables??{}).reduce((total,records)=>total+records.length,0);
 return <fieldset className="rounded-lg border p-4 space-y-3"><legend className="font-semibold">{describeConflict(conflict,snapshot)}</legend>
 {whole?<p>These versions contain linked records that cannot safely be mixed, such as two independently created grades for the same student and assignment. Choose one complete workspace. This replaces the other version’s classroom records on this computer; its dated safety backup remains available. Your local device settings stay local.</p>:<p>Choose which version to keep. This choice does not average grades or erase saved backup versions.</p>}
 <div className="grid gap-3 md:grid-cols-2">{(['local','remote'] as const).map(side=><div key={side} className="rounded border p-3"><h5 className="font-semibold">{side==='local'?'This computer':'Drive version'}</h5>
 {whole?<p>{count(conflict[side])} stored records</p>:!conflict[side]?<p>Record removed in this version.</p>:<dl>{fields.length?fields.map(field=><div key={field} className="mb-2"><dt className="text-sm font-semibold">{friendly(field)}</dt><dd className="break-words">{value(conflict[side]?.[field],field)}</dd></div>):<p>Record details differ; expand technical details to inspect.</p>}</dl>}
 <label className="flex gap-2 items-center mt-3"><input type="radio" name={conflict.key} checked={choice===side} onChange={()=>onChoose(side)}/>{side==='local'?'Keep this computer':'Keep Drive version'}{whole?' — complete workspace':''}</label></div>)}</div>
 <details onToggle={event=>setShowDetails(event.currentTarget.open)}><summary>Technical record details</summary>{showDetails&&<div className="grid grid-cols-2 gap-2"><div><h5>This computer</h5><pre className="overflow-auto text-xs max-h-60">{technical(conflict.local)}</pre></div><div><h5>Drive version</h5><pre className="overflow-auto text-xs max-h-60">{technical(conflict.remote)}</pre></div></div>}</details>
 </fieldset>;
}
