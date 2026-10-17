import { displayToOriginal, originalToDisplay } from '../../../src/marking/imageGeometry';
import { drawCapturePreview } from '../../../shared/capturePreview';
import type { Page } from './store';

/** Edits original-coordinate metadata only. Preview bytes are never overwritten. */
export function createCropEditor(page: Page, apply: (crop: Page['edits']['crop']) => void): HTMLElement {
  let crop = { ...page.edits.crop };
  const fullView = { rotation: page.edits.rotation, crop: { x: 0, y: 0, width: 1, height: 1 } };
  const section = document.createElement('section'); section.className = 'touch-crop';
  const help = document.createElement('p'); help.textContent = 'Drag the four corners to crop. Then choose Apply crop. Originals stay unchanged. Arrow keys also move a focused corner.';
  const surface = document.createElement('div'); surface.className = 'crop-surface';
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'Full photo for cropping');
  const frame = document.createElement('div'); frame.className = 'crop-frame'; frame.setAttribute('aria-hidden','true');
  const handles: HTMLButtonElement[] = [];
  surface.append(canvas, frame); section.append(help, surface);
  void drawCapturePreview(canvas, page.bytes, page.mime, fullView).catch(() => { help.textContent = 'Crop preview unavailable. Original and saved crop remain unchanged.'; for (const handle of handles) handle.disabled = true; });
  const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
  // Corner names refer to the visible (rotated) photograph, never raw sensor axes.
  const displayBounds = () => {
    const points = [{ x: crop.x, y: crop.y }, { x: crop.x + crop.width, y: crop.y + crop.height }].map(p => originalToDisplay(p, fullView));
    return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
  };
  const paint = () => {
    const b = displayBounds();
    Object.assign(frame.style, { left: `${b.left*100}%`, top: `${b.top*100}%`, width: `${(b.right-b.left)*100}%`, height: `${(b.bottom-b.top)*100}%` });
    handles.forEach((handle, i) => Object.assign(handle.style, { left: `${(i===0||i===3?b.left:b.right)*100}%`, top: `${(i<2?b.top:b.bottom)*100}%` }));
  };
  const move = (index: number, x: number, y: number) => {
    const b = displayBounds(), min = .05;
    const left = index===0||index===3;
    const top = index<2;
    x = left ? Math.max(0, Math.min(b.right-min,x)) : Math.min(1, Math.max(b.left+min,x));
    y = top ? Math.max(0, Math.min(b.bottom-min,y)) : Math.min(1, Math.max(b.top+min,y));
    const a = displayToOriginal({ x, y }, fullView);
    const z = displayToOriginal({ x: left?b.right:b.left, y: top?b.bottom:b.top }, fullView);
    crop = { x: Math.min(a.x,z.x), y: Math.min(a.y,z.y), width: Math.abs(a.x-z.x), height: Math.abs(a.y-z.y) };
    paint();
  };
  corners.forEach((corner,index) => {
    const handle = document.createElement('button'); handle.type='button'; handle.className='crop-handle';
    handle.setAttribute('aria-label', `Crop ${corner} corner`); handle.dataset.corner=corner; handle.textContent='↔';
    let pointer: number | null = null;
    const stop = () => { const id=pointer; pointer=null; if(id!==null&&handle.hasPointerCapture(id))handle.releasePointerCapture(id); };
    handle.onpointerdown = event => { if (pointer!==null || (event.pointerType==='mouse'&&event.button!==0))return; event.preventDefault(); event.stopPropagation();pointer=event.pointerId;handle.setPointerCapture(event.pointerId); };
    handle.onpointermove = event => {
      if (pointer!==event.pointerId) return;
      if(event.pointerType==='mouse'&&event.buttons!==1){stop();return;}
      const box=surface.getBoundingClientRect(); if(box.width&&box.height)move(index,(event.clientX-box.left)/box.width,(event.clientY-box.top)/box.height);
    };
    handle.onpointerup=stop; handle.onpointercancel=stop; handle.onlostpointercapture=()=>{pointer=null;}; handle.onblur=stop;
    handle.onkeydown=event=>{const dx=event.key==='ArrowLeft'?-.01:event.key==='ArrowRight'?.01:0,dy=event.key==='ArrowUp'?-.01:event.key==='ArrowDown'?.01:0;if(!dx&&!dy)return;event.preventDefault();const b=displayBounds();move(index,(index===0||index===3?b.left:b.right)+dx,(index<2?b.top:b.bottom)+dy);};
    handles.push(handle); surface.append(handle);
  });
  const button=document.createElement('button');button.type='button';button.textContent='Apply crop';button.onclick=()=>apply(crop);section.append(button);paint();return section;
}
