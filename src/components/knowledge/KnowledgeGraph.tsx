import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from '../ui/Icon';
import { DEFAULT_GRAPH_PHYSICS, orbitPath, planetLayout, type CanvasNode, type CanvasEdge, type GraphPhysics, type Point } from './planetLayout';

const zero = { x:0, y:0 };
type Gesture = { id: number; node?: string; start: Point; origin: Point; moved: boolean };
type Spring = Point & { vx: number; vy: number; goal: Point };
const round = (s: string, limit: number) => [...s].length > limit ? [...s].slice(0,limit).join('') + '…' : s;
const kinds = [
  { key:'core', label:'多关联笔记', colors:['#d7c5ed','#9270b9','#7654a8'] },
  { key:'linked', label:'关联笔记', colors:['#a8d6ca','#43917e','#247a66'] },
  { key:'single', label:'独立笔记', colors:['#bcd1e7','#6b95c0','#386eaa'] },
];

export function KnowledgeGraph({ rootId, selectedPath, notes, edges, selected, activeEdge, labels = true, degrees, physics = DEFAULT_GRAPH_PHYSICS, onSelect, onLocal, onSelectEdge, onDismiss }: {
  rootId?: string; selectedPath?: string[]; notes: CanvasNode[]; edges: CanvasEdge[]; selected?: string; activeEdge?: string;
  physics?: GraphPhysics; degrees?: ReadonlyMap<string, number>; labels?: boolean; onLocal: (id: string) => void; onSelect: (id: string) => void; onSelectEdge: (edge: CanvasEdge) => void; onDismiss: () => void;
}) {
  const field = useRef<HTMLDivElement>(null);
  const canvas = useRef<SVGSVGElement>(null);
  const keyboardNode = useRef('');
  const prefix = useId().replace(/[^\w-]/g,'');
  const graph = useMemo(() => planetLayout(notes, edges, physics, rootId), [notes,edges,rootId,physics.repulsion,physics.elasticity]);
  const springStrength = .14 * physics.elasticity / 100 / Math.sqrt(physics.repulsion / 100);
  const neighborPull = .19 * physics.elasticity / 100 / Math.sqrt(physics.repulsion / 100);
  const [size, setSize] = useState({ width: 700, height: 510 });
  const [manualZoom, setZoom] = useState<number>();
  const [pan, setPan] = useState<Point>(zero);
  const [hover, setHover] = useState('');
  const [dragging, setDragging] = useState(false);
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pausedRef = useRef(paused);
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; zoom: number; center: Point; pan: Point } | null>(null);
  const gesture = useRef<Gesture>(null);
  const captureTarget = useRef<Element | null>(null);
  const springs = useRef(new Map<string, Spring>());
  const frame = useRef(0);
  const [, paint] = useState(0);
  const ignoreClick = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const naturalFit = Math.min(1.35, size.width / graph.bounds.width, size.height / graph.bounds.height);
  const mobileFocus = !!selected && size.width <= 600 && size.height < 300;
  const fit = mobileFocus ? Math.max(.6,naturalFit) : naturalFit;
  const zoom = manualZoom ?? 1;
  const scale = fit * zoom;
  const resizeZoom = (value: number) => setZoom(n => Math.max(.4, Math.min(Math.max(4,2/fit), (n ?? zoom) * value)));
  const reset = () => { setZoom(1); setPan(zero); };
  useEffect(() => {
    pausedRef.current = paused;
    if (paused) { cancelAnimationFrame(frame.current); frame.current = 0; }
    else if (springs.current.size) animate();
  }, [paused]);
  useEffect(() => {
    const el = field.current!;
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('svg.qd-planet-svg')) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * .0015);
      const next = Math.max(.4, Math.min(Math.max(4, 2 / fit), zoom * factor));
      const x = event.clientX - rect.left - size.width / 2;
      const y = event.clientY - rect.top - size.height / 2;
      setPan(current => ({x:x-(x-current.x)*next/zoom,y:y-(y-current.y)*next/zoom}));
      setZoom(next);
    };
    el.addEventListener('wheel', wheel, {passive:false});
    return () => el.removeEventListener('wheel', wheel);
  }, [fit, zoom, size]);
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
    if (!graph.nodes.has(keyboardNode.current)) keyboardNode.current = '';
    setZoom(undefined); setPan(zero); setHover(''); springs.current.clear(); setDragging(false); gesture.current = null; touches.current.clear(); pinch.current = null;
    return () => { cancelAnimationFrame(frame.current); frame.current = 0; clearTimeout(clickTimer.current); };
  }, [graph]);
  useEffect(() => {
    const p = selected && graph.nodes.get(selected);
    if (!p) return;
    const x=(p.x-graph.bounds.x)*scale, y=(p.y-graph.bounds.y)*scale;
    setPan(current=>mobileFocus || Math.abs(x+current.x)>size.width/2-25 || Math.abs(y+current.y)>size.height/2-45 ? {x:-x,y:-y} : current);
  },[selected,graph,scale,size.width,size.height,mobileFocus]);
  function animate() {
    if (frame.current || pausedRef.current) return;
    const step = () => {
      let moving = false;
      for (const [id, s] of springs.current) {
        const fixed = gesture.current?.moved && gesture.current.node === id;
        if (fixed) continue;
        s.vx = (s.vx + (s.goal.x - s.x) * springStrength) * .76;
        s.vy = (s.vy + (s.goal.y - s.y) * springStrength) * .76;
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
    clearTimeout(clickTimer.current);
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if (touches.current.size === 2) {
        e.currentTarget.setPointerCapture(e.pointerId);
        const [a,b] = [...touches.current.values()];
        pinch.current = {distance:Math.hypot(a.x-b.x,a.y-b.y),zoom,center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},pan:{...pan}};
        gesture.current = null;
        setDragging(false);
        if (reduced()) { springs.current.clear(); paint(n=>n+1); }
        for (const spring of springs.current.values()) spring.goal = zero;
        animate();
        ignoreClick.current = true;
        return;
      }
    }
    if (!e.isPrimary || e.button !== 0) return;
    ignoreClick.current = false;
    const target = e.target as Element;
    const id = target.closest('[data-graph-node-id]')?.getAttribute('data-graph-node-id') || undefined;
    if (!id && target.closest('[data-edge-key]')) return;
    const capture = target.closest('[data-graph-node-id]') ?? e.currentTarget;
    capture.setPointerCapture(e.pointerId);
    captureTarget.current = capture;
    gesture.current = { id: e.pointerId, node:id, start:{x:e.clientX,y:e.clientY}, origin:id ? {...(springs.current.get(id) ?? zero)} : {...pan}, moved:false };
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if (pinch.current && touches.current.size >= 2) {
      const [a,b] = [...touches.current.values()], origin = pinch.current;
      const next = Math.max(.4,Math.min(Math.max(4,2/fit),origin.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,origin.distance)));
      const rect = field.current!.getBoundingClientRect();
      const x = origin.center.x - rect.left - size.width/2, y = origin.center.y - rect.top - size.height/2;
      setZoom(next);
      setPan({x:x-(x-origin.pan.x)*next/origin.zoom+(a.x+b.x)/2-origin.center.x,y:y-(y-origin.pan.y)*next/origin.zoom+(a.y+b.y)/2-origin.center.y});
      ignoreClick.current = true;
      return;
    }
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
      spring.goal={x:x*neighborPull,y:y*neighborPull};
      springs.current.set(id,spring);
    }
    paint(n=>n+1);
    animate();
  }
  function finish(e: PointerEvent<SVGSVGElement>) {
    touches.current.delete(e.pointerId);
    if (pinch.current) {
      if (touches.current.size < 2) pinch.current = null;
      gesture.current = null;
      ignoreClick.current = true;
      return;
    }
    const drag = gesture.current;
    if (!drag || drag.id !== e.pointerId) return;
    gesture.current = null;
    if (captureTarget.current?.hasPointerCapture(e.pointerId)) captureTarget.current.releasePointerCapture(e.pointerId);
    captureTarget.current = null;
    setDragging(false);
    if (!drag.moved || !drag.node) return;
    for (const spring of springs.current.values()) spring.goal = zero;
    if (reduced()) { springs.current.clear(); paint(n=>n+1); }
    else animate();
  }
  function activate(e: KeyboardEvent<SVGGElement>, action:()=>void) {
    if (e.key === 'Enter' || e.key === ' ') {e.preventDefault();clearTimeout(clickTimer.current);action();}
  }
  function location(id:string) {
    const p=graph.nodes.get(id)!, shift=springs.current.get(id) ?? zero;
    return { x:p.x+shift.x, y:p.y+shift.y };
  }
  function canvasKey(event: KeyboardEvent<SVGSVGElement>) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    const nodeId = (event.target as Element).closest('[data-graph-node-id]')?.getAttribute('data-graph-node-id');
    if (event.target !== event.currentTarget && !nodeId) return;
    const directions: Record<string,Point> = {ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1}};
    const direction = directions[event.key];
    if (!direction && !(event.key === 'Enter' && event.target === event.currentTarget)) return;
    const origin = graph.nodes.get(nodeId ?? keyboardNode.current) ?? graph.nodes.get(selected ?? '') ?? graph.order[0];
    if (!origin) return;
    event.preventDefault();
    clearTimeout(clickTimer.current);
    if (!direction) { onSelect(origin.id); return; }
    const at = location(origin.id);
    const candidates = graph.order.filter(p => p.id !== origin.id).map(p => {
      const point = location(p.id), dx = point.x-at.x, dy = point.y-at.y;
      const forward = dx*direction.x+dy*direction.y;
      const across = Math.abs(dx*direction.y-dy*direction.x);
      return {id:p.id,forward,score:Math.hypot(dx,dy)+across*2};
    }).filter(p => p.forward > 0).sort((a,b) => a.score-b.score);
    // At the edge, wrap through the existing node order so every arrow remains useful.
    const step = direction.x+direction.y < 0 ? -1 : 1;
    const fallback = graph.order[(graph.order.indexOf(origin)+step+graph.order.length)%graph.order.length];
    const id = candidates[0]?.id ?? fallback.id;
    keyboardNode.current = id;
    canvas.current?.querySelector<SVGGElement>(`[data-graph-node-id="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
    const point = location(id);
    const x = (point.x-graph.bounds.x)*scale, y = (point.y-graph.bounds.y)*scale;
    setPan(current => Math.abs(x+current.x)>size.width/2-30 || Math.abs(y+current.y)>size.height/2-45 ? {x:-x,y:-y} : current);
  }
  const shown = useMemo(() => {
    if (graph.orbits.length <= 240) return graph.orbits;
    const near = new Map<string,number>();
    return graph.orbits.filter(orbit => {
      const keep = orbit.ends.some(id=>(near.get(id)??0)<3) || orbit.ends.includes(selected??'') || orbit.edge.key===activeEdge;
      if (keep) for (const id of orbit.ends) near.set(id,(near.get(id)??0)+1);
      return keep;
    });
  },[graph,selected,activeEdge]);
  const focus=hover || selected;
  const path = useMemo(() => new Map(selectedPath?.map((id, index) => [id, index])), [selectedPath]);
  const focusedMembers = new Set([focus,...shown.filter(orbit => orbit.ends.includes(focus ?? '')).flatMap(orbit => orbit.ends)]);
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
    <svg ref={canvas} tabIndex={0} role="group" aria-describedby={prefix+'-keyboard'} onKeyDown={canvasKey} className="qd-planet-svg" data-dragging={dragging} data-labels={labels} viewBox={`0 0 ${size.width} ${size.height}`}
      aria-label="笔记之间的连线与节点" onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
      onLostPointerCapture={finish}
      onClick={e=>{ if (!ignoreClick.current && !(e.target as Element).closest('[role=button]')) onDismiss(); }}>
      <defs>{kinds.map(kind=><radialGradient id={prefix+kind.key} key={kind.key} cx=".3" cy=".22" r=".95">
        <stop stopColor={kind.colors[0]}/><stop offset=".62" stopColor={kind.colors[1]}/><stop offset="1" stopColor={kind.colors[2]}/>
      </radialGradient>)}</defs>
      <g transform={`translate(${size.width/2+pan.x} ${size.height/2+pan.y}) scale(${scale}) translate(${-graph.bounds.x} ${-graph.bounds.y})`}>
        {shown.map(({edge,ends,bend})=>{
          const key=edge.key, from=location(ends[0]), targets=ends.length===1?ends:ends.slice(1);
          const paths=targets.map(id=>orbitPath(from,location(id),bend,graph.nodes.get(id)!.radius,id===ends[0]));
          const label=edge.label, name=ends.map(id=>graph.nodes.get(id)!.title).join(' · ');
          const near=!!focus && ends.includes(focus), active=activeEdge===key;
          const [start, end] = ends.map(id => path.get(id));
          const onPath = start !== undefined && end !== undefined && Math.abs(start - end) === 1;
          const annotate=active || (near && shown.length<20) || (edge.conflict === true && shown.length<=8);
          const tagY=annotate ? labelPosition(paths[0],label) : undefined;
          return <g className="qd-idea-wire"  key={key} data-edge-key={key} data-on-path={onPath || undefined} data-content-edge={edge.content || undefined} data-conflict={edge.conflict === true} data-near={near} data-muted={!!focus && !near && !active && !onPath}
            aria-label={name+' · '+label} aria-pressed={active} role="button" tabIndex={0}
            onKeyDown={e=>activate(e,()=>onSelectEdge(edge))} onClick={()=>{if(!ignoreClick.current)onSelectEdge(edge);}}>
            <title>{name} · {label}</title><path className="qd-idea-wire-line" d={paths.map(p=>p.d).join(' ')}/>
            <path className="qd-idea-wire-hit" d={paths.map(p=>p.d).join(' ')}/>
            {tagY!==undefined && <text className="qd-planet-wire-label" x={paths[0].x} y={tagY} textAnchor="middle">{round(label,10)}</text>}
          </g>;
        })}
        {graph.order.map(p=>{
          const {x,y}=location(p.id), degree=degrees?.get(p.id) ?? p.links, kind=degree>1?'core':degree?'linked':'single', active=p.id===selected;
          const caption = p.content ? '笔记原文' : rootId ? degree+' 条手动关联' : p.links ? p.links+' 条连线' : '暂无连线';
          return <g role="button" tabIndex={0} key={p.id} data-graph-node-id={p.id} data-root={p.id===rootId || undefined} data-note-id={p.content ? undefined : p.id} data-content-id={p.content ? p.id : undefined} data-isolated={!p.links} data-muted={!!focus && !focusedMembers.has(p.id) && !path.has(p.id)}
            className="qd-library-node qd-planet-node" transform={`translate(${x} ${y})`} aria-label={p.title+' · '+caption} aria-pressed={active}
            onClick={event => {
              if (ignoreClick.current) return;
              clearTimeout(clickTimer.current);
              // Wait briefly so a double click can enter the local graph before the drawer resizes the canvas.
              if (event.detail <= 1) clickTimer.current = setTimeout(() => onSelect(p.id),220);
            }} onDoubleClick={() => {clearTimeout(clickTimer.current);if(!ignoreClick.current)onLocal(p.id);}} onKeyDown={e=>activate(e,()=>onSelect(p.id))}
            onPointerEnter={()=>setHover(p.id)} onPointerLeave={()=>setHover('')} onFocus={()=>{keyboardNode.current=p.id;setHover(p.id);}} onBlur={()=>setHover('')}>
            <title>{p.title} · {caption}</title>
            <circle className="qd-planet-hit" r={Math.max(22/scale,p.radius+6)}/><circle className="qd-planet-ring" r={p.radius+4}/>
            <circle r={p.radius} fill={p.content ? '#f0eafa' : 'url(#'+prefix+kind+')'} stroke={p.content ? '#a089bf' : undefined}/>
            <text style={{display:labels ? undefined : 'none',fontSize:11/scale}} y={p.radius+20} textAnchor="middle">{round(p.title,13)}</text>
          </g>;
        })}
      </g>
    </svg>
    <p id={prefix+'-keyboard'} className="sr-only">方向键切换笔记，Enter 打开详情。Tab 可继续浏览连线和节点。</p>
    <div className="qd-graph-live"><i/>{rootId ? '小圆点是正文要点，一条跨笔记连线算一步' : paused ? '图谱运动已暂停' : '让想法自然连接'}</div>
    <div className="qd-planet-controls" role="group" aria-label="图谱缩放">
      <button type="button" aria-label={paused ? '恢复图谱运动' : '暂停图谱运动'} aria-pressed={paused} onClick={() => setPaused(!paused)}><Icon name={paused ? 'play' : 'pause'} size={14}/></button>
      <button type="button" aria-label="缩小图谱" disabled={zoom<=.4} onClick={()=>resizeZoom(.8)}>−</button>
      <output>{Math.round(zoom*100)}%</output><button type="button" aria-label="放大图谱" onClick={()=>resizeZoom(1.25)}>+</button>
      <button type="button" aria-label="适应画布" title="适应画布" onClick={reset}><Icon name="expand" size={15}/></button>
    </div>
    <div className="qd-planet-legend" aria-label="节点图例">{kinds.map(k=><span key={k.key}><i style={{background:k.colors[1]}}/>{k.label}</span>)}</div>
  </div>;
}
