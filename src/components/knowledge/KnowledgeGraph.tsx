import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraphEdge } from '../../data/knowledgeIndex';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { Icon } from '../ui/Icon';

const nodeHeight = 62;
const rowGap = 32;
const columnGap = 30;
const padding = 28;
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
        const next = edge.from === id ? edge.to : edge.from;
        const neighbour = remaining.get(next);
        if (!neighbour) continue;
        remaining.delete(next);
        group.push(neighbour);
      }
    }
    if (group.length > 1) groups.push(group);
    else remaining.set(note.id, note);
  }
  return { groups, isolated: [...remaining.values()] };
}

function layoutGraph({ groups, isolated }: ReturnType<typeof clusterNotes>, width: number) {
  const columns = Math.max(1, Math.floor((width - padding * 2 + columnGap) / (148 + columnGap)));
  const nodeWidth = Math.min(208, (width - padding * 2 - (columns - 1) * columnGap) / columns);
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
    const across = Math.min(columns, Math.max(2, Math.ceil(Math.sqrt(group.length))));
    place(group, across, group.length > 2);
  }
  const isolatedLabel = groups.length && isolated.length ? top - 6 : undefined;
  if (isolatedLabel !== undefined) top += 25;
  if (isolated.length) place(isolated, Math.min(columns, isolated.length), false);
  return { positions, nodeWidth, isolatedLabel, height: Math.max(156, top - rowGap + padding) };
}

function connect(context: CanvasRenderingContext2D, a: Position, b: Position, nodeWidth: number) {
  const dx = b.x - a.x, dy = b.y - a.y;
  context.beginPath();
  if (dx === 0) {
    const direction = Math.sign(dy);
    const start = a.y + (direction > 0 ? nodeHeight : 0);
    const end = b.y + (direction < 0 ? nodeHeight : 0);
    const x = a.x + Math.min(30, nodeWidth * .25), bend = a.x - 18;
    context.moveTo(x, start);
    context.bezierCurveTo(bend, start + 20 * direction, bend, end - 20 * direction, x, end);
  } else {
    const start = a.x + (dx > 0 ? nodeWidth : 0), end = b.x + (dx > 0 ? 0 : nodeWidth);
    const bow = (start + end) / 2;
    context.moveTo(start, a.y + nodeHeight / 2);
    context.bezierCurveTo(bow, a.y + nodeHeight / 2, bow, b.y + nodeHeight / 2, end, b.y + nodeHeight / 2);
  }
  context.stroke();
}

export function KnowledgeGraph({ notes, edges, adjacency, selected, onSelect }: {
  notes: KnowledgeNote[];
  edges: KnowledgeGraphEdge[];
  adjacency: ReadonlyMap<string, readonly KnowledgeGraphEdge[]>;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const clusters = useMemo(() => clusterNotes(notes, adjacency), [notes, adjacency]);
  const ordered = useMemo(() => [...clusters.groups.flat(), ...clusters.isolated], [clusters]);
  const width = size.width || 640;
  const { positions, nodeWidth, height, isolatedLabel } = useMemo(() => layoutGraph(clusters, width), [clusters, width]);

  useEffect(() => {
    const view = scroll.current;
    if (!view) return;
    const resize = () => setSize({ width: view.clientWidth, height: view.clientHeight });
    const observer = new ResizeObserver(resize);
    observer.observe(view);
    resize();
    return () => observer.disconnect();
  }, []);

  const graphLines = useMemo(() => edges.length <= 220 ? edges : [...new Set([
    ...[...adjacency.values()].flatMap(nearby => nearby.slice(0, 3)),
    ...(selected ? adjacency.get(selected) ?? [] : []),
  ])], [edges, adjacency, selected]);

  useEffect(() => {
    const view = scroll.current, surface = canvas.current;
    const context = surface?.getContext('2d');
    if (!view || !surface || !context || !size.width || !size.height) return;
    const density = Math.min(devicePixelRatio || 1, 2);
    surface.width = size.width * density;
    surface.height = size.height * density;
    let paint = 0;
    const draw = () => {
      const top = view.scrollTop;
      context.setTransform(density, 0, 0, density, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      context.translate(0, -top);
      for (const edge of graphLines) {
        const a = positions.get(edge.from), b = positions.get(edge.to);
        if (!a || !b || Math.min(a.y, b.y) > top + size.height || Math.max(a.y, b.y) + nodeHeight < top) continue;
        const focus = selected === edge.from || selected === edge.to;
        context.strokeStyle = edge.relation.kind === '冲突' ? (focus ? '#a45a18' : '#bf8c60')
          : (focus ? '#315de7' : '#a0adc2');
        context.globalAlpha = selected && !focus ? .45 : 1;
        context.setLineDash(edge.relation.kind === '冲突' ? [4, 4] : []);
        context.lineWidth = focus ? 1.8 : 1.2;
        connect(context, a, b, nodeWidth);
      }
    };
    const scrollDraw = () => { cancelAnimationFrame(paint); paint = requestAnimationFrame(draw); };
    view.addEventListener('scroll', scrollDraw, { passive: true });
    draw();
    return () => { cancelAnimationFrame(paint); view.removeEventListener('scroll', scrollDraw); };
  }, [graphLines, positions, nodeWidth, selected, size]);

  return <div className="qd-library-graph">
    <canvas ref={canvas} className="qd-library-wires" aria-hidden="true" />
    <div ref={scroll} className="qd-library-map-scroll" role="region" aria-label="图谱笔记" tabIndex={0} style={{ height }}>
      <div className="qd-library-map-stage" style={{ height }}>
        {isolatedLabel !== undefined && <p className="qd-library-isolated" style={{ top: isolatedLabel }}>暂无连线的笔记</p>}
        {ordered.map(note => {
          const count = adjacency.get(note.id)?.length ?? 0;
          const position = positions.get(note.id)!;
          return <button key={note.id} type="button" className="qd-library-node" aria-pressed={selected === note.id}
            title={note.title} onClick={() => onSelect(note.id)} data-note-id={note.id}
            style={{ top: position.y, left: position.x, width: nodeWidth, height: nodeHeight }}>
            <Icon name="pencil" size={16} />
            <strong>{note.title}</strong>
            <small>{count ? `${count} 条连线` : '暂无连线'}</small>
          </button>;
        })}
      </div>
    </div>
  </div>;
}
