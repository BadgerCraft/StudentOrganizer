import type { OntarioTeacherDB } from '../db/database';
import { recoveryStore, saveBackup, type RecoveryStore } from './backupStore';
let error:string|null=null;
const listeners=new Set<()=>void>();
export const automaticBackupStatus={
 getSnapshot:()=>error,
 subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};}
};
export async function runAutomaticBackup(database:OntarioTeacherDB,userId:string,store:RecoveryStore=recoveryStore):Promise<void> {
 let next:string|null=null;
 try{await saveBackup(database,userId,'automatic',store);}catch(e){next=e instanceof Error?e.message:'Automatic backup failed.';}
 if(error!==next){error=next;for(const listener of listeners)listener();}
}
