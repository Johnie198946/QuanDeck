import { useEffect, useRef, useState, type RefObject } from 'react';
import { applyTableSize, maxCellSize, measureColumnWidths, minCellWidth, minRowHeight, readTableSize, resizeCell, type TableAxis } from './noteTableLayout';
import { Icon } from '../ui/Icon';

type Cell = HTMLTableCellElement;
function currentCell(target: EventTarget | Node | null, root: HTMLElement) {
  const cell = (target instanceof Element ? target : target instanceof Node ? target.parentElement : null)?.closest('th,td');
  return cell instanceof HTMLTableCellElement && root.contains(cell) ? cell : null;
}
function edge(event: PointerEvent, cell: Cell) {
  const box = cell.getBoundingClientRect();
  const dx = Math.abs(box.right - event.clientX), dy = Math.abs(box.bottom - event.clientY);
  const hit = event.pointerType === 'touch' ? 9 : 6;
  return Math.min(dx, dy) <= hit ? (dx <= dy ? 'width' : 'height') : undefined;
}

export function NoteTableTools({root, disabled, save}: {root:RefObject<HTMLDivElement | null>; disabled:boolean; save:()=>void}) {
  const [cell, setCell] = useState<Cell | null>(null);
  const [dimensions, setDimensions] = useState({width:'', height:''});
  const controls = useRef<HTMLDivElement>(null);
  const commit = useRef(save);
  commit.current = save;
  function measure(cell: Cell) {
    const rect = cell.getBoundingClientRect();
    setDimensions({width:String(Math.round(rect.width)),height:String(Math.round(rect.height))});
  }

  useEffect(() => {
    const el = root.current;
    if (!el || disabled) return;
    let highlighted: Cell | null = null;
    let drag: { id:number; cell:Cell; move:(e:PointerEvent)=>void; cancel:()=>void } | undefined;
    function clearEdge() {
      if (highlighted) delete highlighted.dataset.noteEdge;
      highlighted = null;
    }
    function move(e:PointerEvent) {
      if (drag) { if (e.pointerId === drag.id) drag.move(e); return; }
      clearEdge();
      const cell = currentCell(e.target, el!);
      const axis = cell && edge(e,cell);
      if (axis && cell) { cell.dataset.noteEdge = axis; highlighted = cell; }
    }
    function down(e:PointerEvent) {
      if (e.button !== 0 || drag || controls.current?.contains(e.target as Node)) return;
      const cell = currentCell(e.target, el!);
      setCell(cell);
      if (!cell) return;
      measure(cell);
      const axis = edge(e,cell);
      const table = cell.closest('table');
      if (!axis || !table) return;
      e.preventDefault();
      const before = readTableSize(table), widths = measureColumnWidths(table);
      const start = axis === 'width' ? e.clientX : e.clientY;
      const initial = axis === 'width' ? widths[cell.cellIndex] : cell.getBoundingClientRect().height;
      cell.dataset.noteEdge = axis;
      highlighted = cell;
      el!.setPointerCapture(e.pointerId);
      drag = {id:e.pointerId,cell,cancel:()=>applyTableSize(table,before),move:event=>{
        const end = axis === 'width' ? event.clientX : event.clientY;
        resizeCell(cell,axis,initial + end - start,before,widths);
        measure(cell);
      }};
    }
    function finish(cancel:boolean, id?:number) {
      if (!drag || (id !== undefined && id !== drag.id)) return;
      const active = drag; drag = undefined;
      if (cancel) active.cancel(); else commit.current();
      if (el!.hasPointerCapture(active.id)) el!.releasePointerCapture(active.id);
      clearEdge();
      measure(active.cell);
    }
    const up = (e:PointerEvent) => finish(false,e.pointerId);
    const cancel = (e:PointerEvent) => finish(true,e.pointerId);
    const leave = () => { if (!drag) clearEdge(); };
    const escape = (e:KeyboardEvent) => { if (drag && e.key === 'Escape') { e.preventDefault(); finish(true); } };
    const selection = () => {
      if (drag || controls.current?.contains(document.activeElement)) return;
      const caret = window.getSelection();
      const active = caret?.isCollapsed ? currentCell(caret.anchorNode, el!) : null;
      setCell(active);
      if (active) measure(active);
    };
    document.addEventListener('pointerdown',down,true);
    document.addEventListener('selectionchange',selection);
    document.addEventListener('keydown',escape);
    el.addEventListener('pointermove',move); el.addEventListener('pointerup',up);
    el.addEventListener('pointercancel',cancel); el.addEventListener('lostpointercapture',cancel); el.addEventListener('pointerleave',leave);
    return () => {
      drag?.cancel(); clearEdge();
      document.removeEventListener('pointerdown',down,true); document.removeEventListener('selectionchange',selection);
      document.removeEventListener('keydown',escape);
      el.removeEventListener('pointermove',move); el.removeEventListener('pointerup',up);
      el.removeEventListener('pointercancel',cancel); el.removeEventListener('lostpointercapture',cancel); el.removeEventListener('pointerleave',leave);
    };
  }, [root,disabled]);

  if (!cell?.isConnected || disabled) return null;
  function setSize(axis:TableAxis, field:HTMLInputElement) {
    const table = cell?.closest('table');
    if (!cell || !table) return;
    if (field.value && field.validity.valid) {
      resizeCell(cell,axis,field.valueAsNumber,readTableSize(table),measureColumnWidths(table));
      save();
    }
    measure(cell);
  }
  return <div className="qd-writer-tools qn-table-sizes" ref={controls} role="group" aria-label="表格尺寸">
    {(['width','height'] as const).map((axis,i) => <label key={axis}>{i ? '行高' : '列宽'}
      <input type="number" aria-label={i ? '行高（像素）' : '列宽（像素）'} min={i ? minRowHeight : minCellWidth} max={maxCellSize}
        value={dimensions[axis]} onChange={e=>setDimensions({...dimensions,[axis]:e.target.value})}
        onBlur={e=>setSize(axis,e.currentTarget)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/>
    </label>)}
    <button type="button" aria-label="恢复表格默认尺寸" title="恢复表格默认尺寸" onClick={()=>{
      const table = cell.closest('table'); if(table){applyTableSize(table);save();measure(cell);}
    }}><Icon name="refresh" size={14}/></button>
  </div>;
}
