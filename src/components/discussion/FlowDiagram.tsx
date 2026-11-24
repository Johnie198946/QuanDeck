import { memo, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { flowLines, type FlowDiagram as FlowData } from '../../data/flowDiagram';
import './flow-diagram.css';

interface Props { graph: FlowData; title: string; states?: Record<string, string>; onNode?: (id: string) => void }
const FlowSvg = memo(function FlowSvg({ graph, title, states, onNode }: Props) {
  const marker = `flow-arrow-${useId().replace(/:/g, '')}`;
  const nodeData = new Map(graph.nodes.map(n => [n.id, n]));
  return <svg className="qd-flow-svg" viewBox={`0 0 ${graph.layout.width} ${graph.layout.height}`} width={graph.layout.width} height={graph.layout.height} role="img" aria-label={title}>
    <title>{title}</title><desc>箭头表示有向关系，虚线表示返回或循环。下方提供相同的文字节点与连接关系。</desc>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
    {graph.layout.edges.map(e => <g className={`qd-flow-edge${e.returnEdge ? ' is-return' : ''}`} key={e.index}>
      <path d={e.path} markerEnd={`url(#${marker})`} />
      {graph.edges[e.index].label && <text x={e.x} y={e.y} textAnchor="middle">{flowLines(graph.edges[e.index].label!).map((line, i, lines) => <tspan key={i} x={e.x} dy={i ? 16 : -(lines.length-1)*8}>{line}</tspan>)}</text>}
    </g>)}
    {graph.layout.nodes.map(box => {
      const n = nodeData.get(box.id)!;
      const action = onNode ? () => onNode(n.id) : undefined;
      return <g key={n.id} className={`qd-flow-node kind-${n.kind}${onNode ? ' is-action' : ''}`} role={onNode ? 'button' : undefined} tabIndex={onNode ? 0 : undefined} aria-label={`${n.label}${states?.[n.id] ? ` · ${states[n.id]}` : ''}${onNode ? '，打开任务' : ''}`} onClick={action} onKeyDown={onNode ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action?.(); } } : undefined}>
        <title>{n.label}{n.detail ? `：${n.detail}` : ''}</title>
        <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={n.kind === 'start' || n.kind === 'end' ? 32 : 8} />
        {n.kind === 'decision' && <path className="qd-flow-decision" d={`M ${box.x+14} ${box.y+16} l 6 -6 l 6 6 l -6 6 z`} />}
        <text x={box.x+box.width/2} y={box.y+26} textAnchor="middle">{box.lines.map((line, index) => <tspan key={index} x={box.x+box.width/2} dy={index ? 22 : 0}>{line}</tspan>)}</text>
        {states?.[n.id] && <text className="qd-flow-state" x={box.x+box.width/2} y={box.y+box.height-10} textAnchor="middle">{states[n.id]}</text>}
      </g>;
    })}
  </svg>;
});

function FlowText({ graph, onNode, states }: Props) {
  return <details className="qd-flow-text"><summary>文字步骤与连接关系</summary><ol>{graph.nodes.map(n => <li key={n.id}>{onNode ? <button type="button" className="qd-link" onClick={() => onNode(n.id)}>{n.label}</button> : <strong>{n.label}</strong>}{states?.[n.id] && <span> · {states[n.id]}</span>}{n.detail && <p>{n.detail}</p>}<ul>{graph.edges.filter(e => e.from === n.id).map((e, i) => <li key={i}>{e.label ? `${e.label} → ` : '下一步 → '}{graph.nodes.find(target => target.id === e.to)?.label}</li>)}</ul></li>)}</ol></details>;
}

function FlowViewport(props: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const entry = props.graph.layout.nodes[0];
  useEffect(() => {
    const el = viewport.current;
    if (!el || !entry) return;
    // Keep the entry step readable on a narrow screen; the user can pan to branches.
    const center = () => { el.scrollLeft = Math.max(0, entry.x + entry.width / 2 - el.clientWidth / 2); };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(el);
    return () => observer.disconnect();
  }, [entry?.x, entry?.width]);
  return <div className="qd-flow-scroll" ref={viewport} tabIndex={0} aria-label="流程图，可横向和纵向滚动"><FlowSvg {...props} /></div>;
}

function ExpandedFlow(props: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal(); return () => { dialog.current?.close(); if (previous instanceof HTMLElement) previous.focus(); }; }, []);
  return createPortal(<dialog className="qd-flow-dialog" ref={dialog} aria-label={`${props.title} · 放大流程图`} onCancel={event => { event.preventDefault(); props.onClose(); }}>
    <header><h2>{props.title}</h2><button autoFocus type="button" className="qd-btn ghost small" onClick={props.onClose}>关闭</button></header>
    <FlowViewport {...props} /><FlowText {...props} />
  </dialog>, document.body);
}

/** Use the compact route only when it expresses every node and edge of the source. */
function shortRoute(graph: FlowData) {
  if (graph.nodes.length < 2 || graph.nodes.length > 4 || graph.edges.length !== graph.nodes.length - 1 || graph.edges.some(edge => edge.label) || graph.nodes.some(node => node.kind === 'decision')) return;
  const first = graph.nodes.find(node => graph.edges.every(edge => edge.to !== node.id));
  if (!first) return;
  const steps = [first];
  while (steps.length < graph.nodes.length) {
    const outgoing = graph.edges.filter(edge => edge.from === steps.at(-1)!.id);
    const next = outgoing.length === 1 && graph.nodes.find(node => node.id === outgoing[0].to);
    if (!next || steps.includes(next)) return;
    steps.push(next);
  }
  return steps;
}

/** Rendering is declarative; no remote fonts, scripts, arbitrary HTML or model-generated SVG. */
export const FlowDiagram = memo(function FlowDiagram(props: Props) {
  const [expanded, setExpanded] = useState(false);
  const steps = !props.onNode && !props.states ? shortRoute(props.graph) : undefined;
  if (steps) return <div className="qd-flow is-route" data-flow-diagram="1">
    <ol className="qd-flow-route" aria-label={props.title}>{steps.map((node, index) => <li key={node.id}>
      <span aria-hidden="true" className="qd-route-dot">{index + 1}</span>
      <strong>{node.label}</strong>{node.detail && <p>{node.detail}</p>}
    </li>)}</ol>
  </div>;
  return <div className="qd-flow" data-flow-diagram="1">
    <div className="qd-flow-toolbar"><span>{props.graph.nodes.length} 个步骤</span><button type="button" className="qd-btn ghost small" onClick={() => setExpanded(true)}>放大流程图</button></div>
    <FlowViewport {...props} />
    {props.graph.layout.edges.some(edge => edge.returnEdge) && <p className="qd-flow-legend">虚线箭头指向需要返回的步骤。</p>}
    <FlowText {...props} />{expanded && <ExpandedFlow {...props} onClose={() => setExpanded(false)} />}
  </div>;
});
