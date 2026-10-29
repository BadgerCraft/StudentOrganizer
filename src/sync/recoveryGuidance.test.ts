import { describe,it,expect } from 'vitest';
import { RecoveryActionError,recoveryGuidance } from './recoveryGuidance';
describe('recovery explanations and safe action stages',()=>{
 it('never displays raw provider, credential or record-bearing errors',()=>{
  const secret='access_token=fictional-secret student-private-body';
  for(const action of ['connect','refresh','preview','publish','apply','restore','backup'] as const){
   const shown=JSON.stringify(recoveryGuidance(action,new Error(secret)));
   expect(shown).not.toContain(secret);expect(shown).not.toContain('work is safe');expect(shown).toContain('next');
  }
 });
 it('distinguishes untouched records, completed merge, verified upload and completed restore',()=>{
  expect(recoveryGuidance('restore',new RecoveryActionError('invalid','invalid','unchanged')).state).toContain('did not replace local records');
  expect(recoveryGuidance('apply',new RecoveryActionError('offline','network','merged')).state).toContain('merge was applied');
  expect(recoveryGuidance('apply',new RecoveryActionError('checkpoint','storage','merged-uploaded')).state).toContain('new Drive version was verified');
  expect(recoveryGuidance('publish',new RecoveryActionError('refresh','network','published')).state).toContain('checkpoint saved');
  expect(recoveryGuidance('restore',new RecoveryActionError('checkpoint','storage','unchanged')).next).toContain('Confirm restore again');
 });
 it.each(['setup','auth','permission','network','uncertain','invalid','stale','conflict','storage'] as const)('provides bounded next steps for %s',code=>{
  const result=recoveryGuidance('preview',new RecoveryActionError('not displayed',code));expect(result.code).toBe(code);expect(result.next.length).toBeGreaterThan(40);expect(JSON.stringify(result)).not.toContain('not displayed');
 });
 it('does not tell teachers to widen permission or blindly retry an upload',()=>{
  expect(recoveryGuidance('publish',new RecoveryActionError('','uncertain')).next).toContain('No upload is retried automatically');
  expect(recoveryGuidance('preview',new RecoveryActionError('','permission')).next).toContain('Do not broaden permissions');
 });
});
