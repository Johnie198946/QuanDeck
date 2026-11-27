import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { KnowledgeGraphEdge } from '../../data/knowledgeIndex';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { Icon } from '../ui/Icon';
import { relationLabel } from './IdeaEvidence';
import { orbitPath, planetLayout, type Point } from './planetLayout';

const zero = { x:0, y:0 };
type Gesture = { id: number; node?: string; start: Point; origin: Point; moved: boolean };
type Spring = Point & { vx: number; vy: number; goal: Point };
const round = (s: string, limit: number) => [...s].length > limit ? [...s].slice(0,limit).join('') + '…' : s;
const kinds = [
  { key:'core', label:'多关联笔记', colors:['#9abaff','#527dcc','#3652a3'] },
  { key:'linked', label:'关联笔记', colors:['#a3e7de','#52a99f','#337a79'] },
  { key:'single', label:'独立笔记', colors:['#dce4ee','#a2b2c6','#8497af'] },
];

export function KnowledgeGraph({ notes, edges, selected, activeEdge, onSelect, onSelectEdge, onDismiss }: {
  notes: KnowledgeNote[]; edges: KnowledgeGraphEdge[]; selected?: string; activeEdge?: string;
  onSelect: (id: string) => void; onSelectEdge: (edge: KnowledgeGraphEdge) => void; onDismiss: () => void;
}) {
  const field = useRef<HTMLDivElement>(null);
  const prefix = useId().replace(/[^\w-]/g,'');
  const graph = useMemo(() => planetLayout(notes, edges), [notes,edges]);
  const [size, setSize] = useState({ width: 700, height: 510 });
  const [manualZoom, setZoom] = useState<number>();
  const [pan, setPan] = useState<Point>(zero);
  const [hover, setHover] = useState('');
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture>(null);
  const springs = useRef(new Map<string, Spring>());
  const frame = useRef(0);
  const [, paint] = useState(0);
  const ignoreClick = useRef(false);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fit = Math.min(1.35, size.width / graph.bounds.width, size.height / graph.bounds.height);
  const zoom = manualZoom ?? Math.max(1,.86/fit);
  const scale = fit * zoom;
  const resizeZoom = (value: number) => setZoom(n => Math.max(.4, Math.min(Math.max(4,2/fit), (n ?? zoom) * value)));
  const reset = () => { setZoom(1); setPan(zero); };
  useEffect(() => {
    const fieldEl = field.current!;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    observer.observe(fieldEl);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setZoom(undefined); setPan(zero); setHover(''); springs.current.clear(); setDragging(false); gesture.current = null;
    return () => { cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [graph]);
  useEffect(() => {
    const p = selected && graph.nodes.get(selected);
    if (!p) return;
    const x=(p.x-graph.bounds.x)*scale, y=(p.y-graph.bounds.y)*scale;
    setPan(current=>Math.abs(x+current.x)>size.width/2-25 || Math.abs(y+current.y)>size.height/2-45 ? {x:-x,y:-y} : current);
  },[selected,graph,scale,size.width,size.height]);
  function animate() {
    if (frame.current) return;
    const step = () => {
      let moving = false;
      for (const [id, s] of springs.current) {
        const fixed = gesture.current?.moved && gesture.current.node === id;
        if (fixed) continue;
        s.vx = (s.vx + (s.goal.x - s.x) * .14) * .76;
        s.vy = (s.vy + (s.goal.y - s.y) * .14) * .76;
        s.x += s.vx; s.y += s.vy;
        if (Math.abs(s.goal.x - s.x) + Math.abs(s.goal.y - s.y) + Math.abs(s.vx) + Math.abs(s.vy) > .17) moving = true;
        else { s.x = s.goal.x; s.y = s.goal.y; s.vx = s.vy = 0; if (!s.x && !s.y) springs.current.delete(id); }
      }
      paint(n=>n+1);
      frame.current = moving ? requestAnimationFrame(step) : 0;
    };
    frame.current = requestAnimationFrame(step);
  }
  function begin(e: PointerEvent<SVGSVGElement>) {
    if (!e.isPrimary || e.button !== 0) return;
    ignoreClick.current = false;
    const target = e.target as Element;
    const id = target.closest('[data-note-id]')?.getAttribute('data-note-id') || undefined;
    if (!id && target.closest('[data-edge-key]')) return;
    (target.closest('[data-note-id]') ?? e.currentTarget).setPointerCapture(e.pointerId);
    gesture.current = { id: e.pointerId, node:id, start:{x:e.clientX,y:e.clientY}, origin:id ? {...(springs.current.get(id) ?? zero)} : {...pan}, moved:false };
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const drag = gesture.current;
    if (!drag || drag.id !== e.pointerId) return;
    if (!e.buttons && e.pointerType === 'mouse') { finish(e); return; }
    const dx=e.clientX-drag.start.x, dy=e.clientY-drag.start.y;
    if (!drag.moved && Math.hypot(dx,dy)<4) return;
    if (!drag.moved) { drag.moved=true; setDragging(true); }
    ignoreClick.current = true;
    if (!drag.node) { setPan({x:drag.origin.x+dx, y:drag.origin.y+dy}); return; }
    const x=drag.origin.x+dx/scale, y=drag.origin.y+dy/scale;
    springs.current.set(drag.node,{x,y,vx:0,vy:0,goal:{x,y}});
    if (!reduced()) for (const id of graph.nodes.get(drag.node)!.neighbors) {
      const spring = springs.current.get(id) ?? {...zero, vx:0,vy:0,goal:zero};
      spring.goal={x:x*.19,y:y*.19};
      springs.current.set(id,spring);
    }
    animate();
  }
  function finish(e: PointerEvent<SVGSVGElement>) {
    const drag = gesture.current;
    if (!drag || drag.id !== e.pointerId) return;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    if (!drag.moved || !drag.node) return;
    for (const spring of springs.current.values()) spring.goal = zero;
    if (reduced()) { springs.current.clear(); paint(n=>n+1); }
    else animate();
  }
  function activate(e: KeyboardEvent<SVGGElement>, action:()=>void) {
    if (e.key === 'Enter' || e.key === ' ') {e.preventDefault();action();}
  }
  function location(id:string) {
    const p=graph.nodes.get(id)!, shift=springs.current.get(id) ?? zero;
    return { x:p.x+shift.x, y:p.y+shift.y };
  }
  const shown = useMemo(() => {
    if (graph.orbits.length <= 240) return graph.orbits;
    const near = new Map<string,number>();
    return graph.orbits.filter(orbit => {
      const keep = orbit.ends.some(id=>(near.get(id)??0)<3) || orbit.ends.includes(selected??'') || orbit.edge.relation.evidenceKey===activeEdge;
      if (keep) for (const id of orbit.ends) near.set(id,(near.get(id)??0)+1);
      return keep;
    });
  },[graph,selected,activeEdge]);
  const focus=hover || selected;
  const occupied = graph.order.map(p=>{
    const {x,y}=location(p.id);
    return {x,y,halfW:Math.max(p.radius,Math.min([...p.title].length,14)*6),top:y-p.radius,bottom:y+p.radius+23};
  });
  function labelPosition(at:Point, label:string) {
    const halfW=Math.min([...label].length,11)*5.5;
    for (const delta of [-5,13,-23,31]) {
      const y=at.y+delta;
      if (occupied.some(r=>Math.abs(at.x-r.x)<halfW+r.halfW+2 && y>r.top-3 && y-11<r.bottom+3)) continue;
      occupied.push({x:at.x,y,halfW,top:y-11,bottom:y+2});
      return y;
    }
  }
  return <div ref={field} className="qd-planet-field" role="region" aria-label="图谱笔记">
    <svg className="qd-planet-svg" data-dragging={dragging} viewBox={`0 0 ${size.width} ${size.height}`}
      aria-label="笔记之间的连线与节点" onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
      onLostPointerCapture={finish}
      onClick={e=>{ if (!ignoreClick.current && !(e.target as Element).closest('[role=button]')) onDismiss(); }}>
      <defs>{kinds.map(kind=><radialGradient id={prefix+kind.key} key={kind.key} cx=".3" cy=".22" r=".95">
        <stop stopColor={kind.colors[0]}/><stop offset=".62" stopColor={kind.colors[1]}/><stop offset="1" stopColor={kind.colors[2]}/>
      </radialGradient>)}</defs>
      <g transform={`translate(${size.width/2+pan.x} ${size.height/2+pan.y}) scale(${scale}) translate(${-graph.bounds.x} ${-graph.bounds.y})`}>
        {shown.map(({edge,ends,bend})=>{
          const key=edge.relation.evidenceKey, from=location(ends[0]), targets=ends.length===1?ends:ends.slice(1);
          const paths=targets.map(id=>orbitPath(from,location(id),bend,graph.nodes.get(id)!.radius,id===ends[0]));
          const label=relationLabel(edge.relation), name=ends.map(id=>graph.nodes.get(id)!.title).join(' · ');
          const near=!!focus && ends.includes(focus), active=activeEdge===key;
          const annotate=active || (near && shown.length<20) || (edge.relation.kind==='冲突' && shown.length<=8);
          const tagY=annotate ? labelPosition(paths[0],label) : undefined;
          return <g className="qd-idea-wire"  key={key} data-edge-key={key} data-conflict={edge.relation.kind==='冲突'} data-near={near} data-muted={!!focus && !near && !active}
            aria-label={name+' · '+label} aria-pressed={active} role="button" tabIndex={0}
            onKeyDown={e=>activate(e,()=>onSelectEdge(edge))} onClick={()=>{if(!ignoreClick.current)onSelectEdge(edge);}}>
            <title>{name} · {label}</title><path className="qd-idea-wire-line" d={paths.map(p=>p.d).join(' ')}/>
            <path className="qd-idea-wire-hit" d={paths.map(p=>p.d).join(' ')}/>
            {tagY!==undefined && <text className="qd-planet-wire-label" x={paths[0].x} y={tagY} textAnchor="middle">{round(label,10)}</text>}
          </g>;
        })}
        {graph.order.map(p=>{
          const {x,y}=location(p.id), kind=p.links>1?'core':p.links?'linked':'single', active=p.id===selected;
          return <g role="button" tabIndex={0} key={p.id} data-note-id={p.id} data-isolated={!p.links}
            className="qd-library-node qd-planet-node" transform={`translate(${x} ${y})`} aria-label={p.title+' · '+(p.links?p.links+' 条连线':'暂无连线')} aria-pressed={active}
            onClick={()=>{if(!ignoreClick.current)onSelect(p.id);}} onKeyDown={e=>activate(e,()=>onSelect(p.id))}
            onPointerEnter={()=>setHover(p.id)} onPointerLeave={()=>setHover('')} onFocus={()=>setHover(p.id)} onBlur={()=>setHover('')}>
            <title>{p.title} · {p.links?p.links+' 条连线':'暂无连线'}</title>
            <circle className="qd-planet-hit" r={Math.max(24,p.radius+6)}/><circle className="qd-planet-ring" r={p.radius+4}/>
            <circle r={p.radius} fill={'url(#'+prefix+kind+')'}/>
            <text y={p.radius+20} textAnchor="middle">{round(p.title,13)}</text>
          </g>;
        })}
      </g>
    </svg>
    <div className="qd-planet-controls" role="group" aria-label="图谱缩放">
      <button type="button" aria-label="缩小图谱" disabled={zoom<=.4} onClick={()=>resizeZoom(.8)}>−</button>
      <output>{Math.round(zoom*100)}%</output><button type="button" aria-label="放大图谱" onClick={()=>resizeZoom(1.25)}>+</button>
      <button type="button" aria-label="适应画布" title="适应画布" onClick={reset}><Icon name="expand" size={15}/></button>
    </div>
    <div className="qd-planet-legend" aria-label="节点图例">{kinds.map(k=><span key={k.key}><i style={{background:k.colors[1]}}/>{k.label}</span>)}</div>
  </div>;
}
