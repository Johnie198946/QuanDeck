import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraphEdge } from '../../data/knowledgeIndex';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { relationLabel } from './IdeaEvidence';
import { NoteThumbnail } from './NoteThumbnail';

const nodeHeight = 68;
const rowGap = 58;
const columnGap = 76;
const padding = 18;
type Position = { x: number; y: number };

function clusterNotes(notes: readonly KnowledgeNote[], adjacency: ReadonlyMap<string, readonly KnowledgeGraphEdge[]>) {
  const remaining = new Map(notes.map(note => [note.id, note]));
  const groups: KnowledgeNote[][] = [];
  for (const note of notes) {
    if (!adjacency.has(note.id) || !remaining.has(note.id)) continue;
    const group = [note];
    remaining.delete(note.id);
    for (let index = 0; index < group.length; index++) {
      const { id } = group[index];
      for (const edge of adjacency.get(id) ?? []) {
        for (const member of edge.members) {
          const neighbour = remaining.get(member);
          if (!neighbour) continue;
          remaining.delete(member);
          group.push(neighbour);
        }
      }
    }
    if (group.length > 1 || adjacency.get(note.id)?.some(edge => edge.members.length === 1)) groups.push(group.sort((a, b) => (adjacency.get(b.id)?.length ?? 0) - (adjacency.get(a.id)?.length ?? 0)));
    else remaining.set(note.id, note);
  }
  return { groups, isolated: [...remaining.values()] };
}

function layoutGraph({ groups, isolated }: ReturnType<typeof clusterNotes>, width: number) {
  const columns = Math.max(1, Math.floor((width - padding * 2 + columnGap) / (132 + columnGap)));
  const nodeWidth = Math.min(176, (width - padding * 2 - (columns - 1) * columnGap) / columns);
  const positions = new Map<string, Position>();
  let top = padding;
  const place = (group: KnowledgeNote[], across: number, stagger: boolean) => {
    const occupied = across * nodeWidth + (across - 1) * columnGap;
    const step = nodeHeight + rowGap;
    for (const [index, note] of group.entries()) {
      const column = index % across;
      positions.set(note.id, {
        x: (width - occupied) / 2 + column * (nodeWidth + columnGap),
        y: top + Math.floor(index / across) * step + (stagger && column % 2 ? 17 : 0),
      });
    }
    top += Math.ceil(group.length / across) * step + (stagger && across > 1 ? 17 : 0);
  };
  for (const group of groups) {
    // In a small cluster the note with the most connections sits between its neighbours.
    if (columns >= 3 && group.length >= 3 && group.length <= 7) {
      const middleX = (width - nodeWidth) / 2;
      const rows = Math.ceil((group.length - 1) / 2);
      const step = nodeHeight + rowGap;
      positions.set(group[0].id, { x: middleX, y: top + Math.max(0.5, (rows - 1) / 2) * step });
      group.slice(1).forEach((note, index) => positions.set(note.id, {
        x: middleX + (index % 2 ? 1 : -1) * (nodeWidth + columnGap),
        y: top + Math.floor(index / 2) * step,
      }));
      top += Math.max(1.5, rows) * step;
      continue;
    }
    const across = Math.min(columns, group.length, Math.max(2, Math.ceil(Math.sqrt(group.length))));
    place(group, across, group.length > 2);
  }
  const isolatedLabel = groups.length && isolated.length ? top - 6 : undefined;
  if (isolatedLabel !== undefined) top += 25;
  if (isolated.length) place(isolated, Math.min(columns, isolated.length), false);
  return { positions, nodeWidth, isolatedLabel, height: Math.max(218, top - rowGap + padding) };
}

function wire(a: Position, b: Position, width: number) {
  let start: Position, end: Position, c1: Position, c2: Position;
  if (a === b) {
    // Two passages of the same note share a node. Draw the loop outside its card.
    start = { x: a.x + width, y: a.y + nodeHeight * .65 };
    end = { x: a.x + width * .7, y: a.y + nodeHeight };
    c1 = { x: start.x + padding, y: start.y + 30 };
    c2 = { x: end.x + 16, y: end.y + 34 };
  } else if (a.x === b.x) {
    const down = b.y > a.y;
    start = { x: a.x + width * .5, y: a.y + (down ? nodeHeight : 0) };
    end = { x: b.x + width * .5, y: b.y + (down ? 0 : nodeHeight) };
    const bend = Math.abs(b.y - a.y) > nodeHeight + rowGap + 1 ? a.x - 12 : start.x;
    c1 = { x: bend, y: (start.y + end.y) / 2 };
    c2 = { ...c1 };
  } else {
    start = { x: a.x + (b.x > a.x ? width : 0), y: a.y + nodeHeight / 2 };
    end = { x: b.x + (b.x > a.x ? 0 : width), y: b.y + nodeHeight / 2 };
    c1 = { x: (start.x + end.x) / 2, y: start.y };
    c2 = { x: c1.x, y: end.y };
  }
  return {
    d: `M${start.x} ${start.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`,
    at: (t: number) => {
      const point = (axis: keyof Position) => (1-t)**3 * start[axis] + 3*(1-t)**2*t*c1[axis] + 3*(1-t)*t*t*c2[axis] + t**3*end[axis];
      return { x: point('x'), y: point('y') };
    },
  };
}

export function KnowledgeGraph({ notes, edges, adjacency, selected, activeEdge, onSelect, onSelectEdge }: {
  notes: KnowledgeNote[]; edges: KnowledgeGraphEdge[];
  adjacency: ReadonlyMap<string, readonly KnowledgeGraphEdge[]>;
  selected?: string; activeEdge?: string;
  onSelect: (id: string) => void; onSelectEdge: (edge: KnowledgeGraphEdge) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(540);
  const clusters = useMemo(() => clusterNotes(notes, adjacency), [notes, adjacency]);
  const ordered = useMemo(() => [...clusters.groups.flat(), ...clusters.isolated], [clusters]);
  const titles = useMemo(() => new Map(notes.map(note => [note.id, note.title])), [notes]);
  const { positions, nodeWidth, height, isolatedLabel } = useMemo(() => layoutGraph(clusters, width), [clusters, width]);
  useEffect(() => {
    const view = scroll.current;
    if (!view) return;
    const resize = () => { if (view.clientWidth) setWidth(view.clientWidth); };
    const observer = new ResizeObserver(resize);
    observer.observe(view);
    resize();
    return () => observer.disconnect();
  }, []);
  const graphLines = useMemo(() => edges.length <= 220 ? edges : [...new Set([
    ...[...adjacency.values()].flatMap(nearby => nearby.slice(0, 3)),
    ...(selected ? adjacency.get(selected) ?? [] : []),
  ])], [edges, adjacency, selected]);
  const wires = useMemo(() => {
    const occupied = [...positions.values()].map(({ x, y }) => ({ x, y, w: nodeWidth, h: nodeHeight }));
    return [...graphLines].sort((a,b) => Number(b.relation.evidenceKey === activeEdge) - Number(a.relation.evidenceKey === activeEdge)).flatMap(edge => {
      const members = edge.members.filter(id => positions.has(id));
      if (members.length < Math.min(2, edge.members.length)) return [];
      const origin = positions.get(members[0])!;
      const targets = members.length > 1 ? members.slice(1) : members;
      const curves = targets.map(id => wire(origin, positions.get(id)!, nodeWidth));
      const curve = curves[0];
      const label = relationLabel(edge.relation);
      const short = label.length > 7 ? label.slice(0,6) + '…' : label;
      const labelWidth = short.length * 12 + 12;
      const active = edge.relation.evidenceKey === activeEdge;
      let tag: (Position & { offsetY: number }) | undefined;
      if (active || graphLines.length < 18 || (selected && members.includes(selected))) {
        for (const offsetY of [0, -26, 26, -48, 48]) {
          for (const t of [.5, .32, .68, .2, .8]) {
            const p = curve.at(t);
            const box = { x: p.x - labelWidth/2, y: p.y + offsetY - 10, w: labelWidth, h: 20 };
            if (box.x < 0 || box.x+box.w > width || box.y < 0 || box.y+box.h > height) continue;
            if (occupied.some(r => box.x < r.x+r.w+2 && box.x+box.w+2 > r.x && box.y < r.y+r.h+2 && box.y+box.h+2 > r.y)) continue;
            occupied.push(box);
            tag = { x: p.x, y: p.y + offsetY, offsetY };
            break;
          }
          if (tag) break;
        }
      }
      const names = members.map(id => titles.get(id));
      const description = members.length === 1 ? [names[0], '篇内关联', label] : [names[0], label, ...names.slice(1)];
      return [{ edge, d: curves.map(c => c.d).join(' '), tag, description: description.join(' · '), short, labelWidth, active }];
    });
  }, [graphLines, activeEdge, positions, nodeWidth, selected, width, height, titles]);
  return <div ref={scroll} className="qd-library-map-scroll" role="region" aria-label="图谱笔记" tabIndex={0}>
    <div className="qd-library-map-stage" style={{ height }}>
      <svg className="qd-library-wires" width={width} height={height} aria-label="笔记之间的连线">
        <defs><marker id="qd-idea-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="context-stroke"/></marker></defs>
        {wires.map(({ edge, d, tag, description, short, labelWidth, active }) => {
          return <g key={edge.relation.evidenceKey} role="button" tabIndex={0} data-edge-key={edge.relation.evidenceKey}
            aria-label={description}
            aria-pressed={active} className="qd-idea-wire" data-conflict={edge.relation.kind === '冲突'}
            onClick={() => onSelectEdge(edge)} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectEdge(edge); }
            }}>
            <path className="qd-idea-wire-line" d={d} markerEnd={edge.relation.agent && edge.members.length === 2 ? 'url(#qd-idea-arrow)' : undefined}/>
            <path className="qd-idea-wire-hit" d={d}/>
            {tag && <g transform={`translate(${tag.x} ${tag.y})`} className="qd-idea-wire-tag">
              {tag.offsetY !== 0 && <line x1={0} y1={-tag.offsetY} x2={0} y2={0} stroke="currentColor" opacity={.65}/>}
              <rect x={-labelWidth/2} y={-10} width={labelWidth} height={20} rx={5}/>
              <text textAnchor="middle" dominantBaseline="central">{short}</text>
            </g>}
          </g>;
        })}
      </svg>
      {isolatedLabel !== undefined && <p className="qd-library-isolated" style={{ top: isolatedLabel }}>暂无连线的笔记</p>}
      {ordered.map(note => {
        const links = adjacency.get(note.id) ?? [];
        const position = positions.get(note.id)!;
        return <button key={note.id} type="button" className="qd-library-node" aria-pressed={selected === note.id}
          title={note.title} onClick={() => onSelect(note.id)} data-note-id={note.id} data-isolated={!links.length}
          style={{ top: position.y, left: position.x, width: nodeWidth, height: nodeHeight }}>
          <NoteThumbnail note={note} icon={links.length ? 'bulb' : 'pencil'}/>
          <strong>{note.title}</strong><small>{links.length ? `${links.length} 条连线` : '暂无连线'}</small>
        </button>;
      })}
    </div>
  </div>;
}
