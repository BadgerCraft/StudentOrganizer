import '/workspace/StudentOrganizer/node_modules/fake-indexeddb/auto/index.mjs';
import { OntarioTeacherDB } from '/workspace/StudentOrganizer/src/db/database.ts';
import { seedDatabase } from '/workspace/StudentOrganizer/src/db/seeds.ts';
import { PortabilityService } from '/workspace/StudentOrganizer/src/services/portabilityService.ts';
import { listAccessibleClassSections, assertClassSectionWriteAccess } from '/workspace/StudentOrganizer/src/services/authHelper.ts';
import { selectActingTeacher, clearActiveTeacherId } from '/workspace/StudentOrganizer/src/services/identityService.ts';
const db=new OntarioTeacherDB('review-fictional-'+crypto.randomUUID());
try{
 await seedDatabase(db);const p=new PortabilityService(db); const original=await p.createFullBackupJSON();
 const a=JSON.parse(original); const sa=a.tables.studentAssessments[0]; const wrong=a.tables.classEnrollments.find(e=>e.classSectionId!==sa.classSectionId); sa.classEnrollmentId=wrong.id;
 try {await p.restoreFromJSON(JSON.stringify(a));console.log('CROSS_CLASS_RESTORE_ACCEPTED',JSON.stringify({studentAssessment:await db.studentAssessments.get(sa.id),enrollment:await db.classEnrollments.get(wrong.id)}));}catch(e){console.log('CROSS_CLASS_REJECTED',e.message)}
 await p.restoreFromJSON(original);
 const b=JSON.parse(original); const course=b.tables.courses[0];course.organizationId=' '+course.organizationId+' ';
 try{await p.restoreFromJSON(JSON.stringify(b)); console.log('WHITESPACE_REF_RESTORE_ACCEPTED',{missingExactParent:!await db.organizations.get(course.organizationId),accessible:(await listAccessibleClassSections(db,'user-tyler')).length})}catch(e){console.log('WHITESPACE_REF_REJECTED',e.message)}
 await p.restoreFromJSON(original);const section=(await db.classSections.toArray())[0];const realCourse=await db.courses.get(section.courseId);
 await db.organizations.update(realCourse.organizationId,{deletedAt:new Date().toISOString()});
 try{await assertClassSectionWriteAccess(db,'user-tyler',section.id);console.log('DELETED_ORG_WRITE_AUTH_ACCEPTED')}catch(e){console.log('DELETED_ORG_REJECTED',e.message)}
 await p.restoreFromJSON(original); const identity=await selectActingTeacher(db,'user-tyler');clearActiveTeacherId();
 const result=await p.importRosterCSV({classSectionId:section.id,csvText:'Student ID,Last Name,First Name\nREVIEWNEW,Fictional,Avery',userId:identity.userId,deviceId:identity.deviceId}); console.log('REVOKED_ACTOR_IMPORT',result);
}finally{await db.delete()}
