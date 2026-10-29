import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImageMarkup } from './ImageMarkup';
import { RubricEvidenceEditor } from './ModeEvidence';
import type { MarkingRubric, MarkingImagePage, MarkingPageFeedback, MarkingVisualAnnotation } from '../types';

const rubric: MarkingRubric = {
  id:'rubric',assessmentId:'assignment',classSectionId:'class',createdBy:'teacher',createdAt:'2026-10-27',updatedAt:'2026-10-27',version:1,deletedAt:null,confirmed:true,
  title:'Fictional rubric',levels:['3'],criteria:[{id:'knowledge',name:'Knowledge evidence',categoryCode:'K',descriptors:{3:'Clear knowledge'}},{id:'thinking',name:'Thinking evidence',categoryCode:'T',descriptors:{3:'Clear thinking'}}]
};
const mark=(id:string,y:number):MarkingVisualAnnotation=>({id,kind:'highlight',points:[{x:.2,y}],color:'yellow',width:.01,text:id,criterionId:'thinking',level:'3+'});
describe('focused evidence display',()=>{
 it('retains all photo evidence in current page order and spatial reading order, independent of creation order',()=>{
  const pages:MarkingImagePage[]=['one','two'].map(id=>({id,name:id,mime:'image/png',base64:'',size:0,hash:id,width:600,height:800}));
  const feedback:MarkingPageFeedback[]=[{pageId:'two',rotation:0,crop:{x:0,y:0,width:1,height:1},annotations:[mark('later-on-page',.8),mark('earlier-on-page',.2)]},{pageId:'one',rotation:0,crop:{x:0,y:0,width:1,height:1},annotations:[mark('following-page',.1)]}];
  const html=renderToStaticMarkup(<ImageMarkup pages={pages} feedback={feedback} onChange={()=>{}} rubric={rubric} disabled={false}/>);
  const cards=html.slice(html.indexOf('aria-label="Saved photo evidence"'));
  expect(cards.indexOf('earlier-on-page')).toBeLessThan(cards.indexOf('later-on-page'));
  expect(cards.indexOf('later-on-page')).toBeLessThan(cards.indexOf('following-page'));
  expect(cards).toContain('3 marks');
  expect(cards).not.toContain('Official');expect(cards).not.toContain('normalizedPercentage');
 });
 it('shows only the selected final category evidence without changing the retained rubric',()=>{
  const before=structuredClone(rubric);
  const html=renderToStaticMarkup(<RubricEvidenceEditor rubric={rubric} categoryCode="T" value={[{criterionId:'knowledge',level:'2',feedback:'Retained knowledge'},{criterionId:'thinking',level:'3+',feedback:'Selected thinking'}]} disabled={false} onChange={()=>{}}/>);
  expect(html).toContain('Selected thinking');expect(html).not.toContain('Retained knowledge');expect(html).not.toContain('Clear knowledge');expect(html).toContain('Clear thinking');expect(rubric).toEqual(before);
 });
});
