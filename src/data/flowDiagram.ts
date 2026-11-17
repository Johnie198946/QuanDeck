/** Content-only graph protocol. Layout and SVG are program-owned, never model code. */
export interface FlowNode { id: string; label: string; kind: 'step' | 'decision' | 'start' | 'end'; detail?: string }
export interface FlowEdge { from: string; to: string; label?: string }
export interface FlowNodeLayout { id: string; x: number; y: number; width: number; height: number; lines: string[] }
export interface FlowEdgeLayout { index: number; path: string; x: number; y: number; returnEdge: boolean }
export interface FlowLayout { width: number; height: number; nodes: FlowNodeLayout[]; edges: FlowEdgeLayout[] }
export interface FlowDiagram { version: 1; nodes: FlowNode[]; edges: FlowEdge[]; layout: FlowLayout }
export const FLOW_LIMITS = { nodes: 40, edges: 80, label: 96, edgeLabel: 32, detail: 600 };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function label(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${name}必须是 1–${max} 字的纯文本`);
  return value.trim();
}
function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('流程图仅接受节点、连线和纯文本说明，不接受样式、脚本、链接或执行指令');
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error('流程节点标识须为 1–80 位字母、数字、横线或下划线');
  return value;
}
/** Chinese/Latin deterministic wrapping; no canvas measurements or font/network dependency. */
export function flowLines(text: string, maxWidth = 24): string[] {
  const lines: string[] = []; let line = '', width = 0;
  for (const char of Array.from(text)) {
    const units = /[\u0020-\u007e]/.test(char) ? 1 : 2;
    if (char === '\n' || width + units > maxWidth) { lines.push(line); line = ''; width = 0; }
    if (char !== '\n') { line += char; width += units; }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/** Bounded O(V+E) ranking. DFS return edges use external lanes, so cycles never hang. */
export function layoutFlow(nodes: FlowNode[], edges: FlowEdge[]): FlowLayout {
  const outgoing = new Map(nodes.map(n => [n.id, [] as number[]]));
  edges.forEach((e, i) => outgoing.get(e.from)!.push(i));
  const visiting = new Set<string>(), visited = new Set<string>(), returns = new Set<number>(), order: string[] = [];
  function visit(id: string) {
    visiting.add(id);
    for (const i of outgoing.get(id)!) {
      const to = edges[i].to;
      if (visiting.has(to)) returns.add(i);
      else if (!visited.has(to)) visit(to);
    }
    visiting.delete(id); visited.add(id); order.push(id);
  }
  nodes.forEach(n => { if (!visited.has(n.id)) visit(n.id); });
  const rank = new Map(nodes.map(n => [n.id, 0]));
  for (const id of order.reverse()) for (const i of outgoing.get(id)!) if (!returns.has(i)) rank.set(edges[i].to, Math.max(rank.get(edges[i].to)!, rank.get(id)! + 1));
  const layers = Array.from({ length: Math.max(...rank.values()) + 1 }, () => [] as FlowNode[]);
  nodes.forEach(n => layers[rank.get(n.id)!].push(n));
  const boxWidth = 232, gap = 48, margin = 32;
  const bodyWidth = Math.max(...layers.map(l => l.length * (boxWidth + gap) - gap));
  let y = margin;
  const boxes: FlowNodeLayout[] = [];
  const rowBottom = new Map<number, number>();
  for (const layer of layers) {
    const heights = layer.map(n => Math.max(88, flowLines(n.label).length * 22 + 40));
    const layerWidth = layer.length * (boxWidth + gap) - gap;
    layer.forEach((n, i) => boxes.push({ id: n.id, x: margin + (bodyWidth - layerWidth) / 2 + i * (boxWidth + gap), y, width: boxWidth, height: heights[i], lines: flowLines(n.label) }));
    rowBottom.set(y, y + Math.max(...heights));
    y += Math.max(...heights) + 104;
  }
  const byId = new Map(boxes.map(n => [n.id, n]));
  let lane = 0;
  const paths = edges.map((edge, index) => {
    const a = byId.get(edge.from)!, b = byId.get(edge.to)!;
    const ax = a.x + a.width / 2, ay = a.y + a.height, bx = b.x + b.width / 2, by = b.y;
    if (returns.has(index) || rank.get(edge.to)! > rank.get(edge.from)! + 1) {
      const x = margin + bodyWidth + 36 + lane++ * 32;
      // Route through row gutters, not horizontally through sibling nodes.
      const below = rowBottom.get(a.y)! + 24, above = b.y - 24;
      return { index, path: `M ${ax} ${ay} V ${below} H ${x} V ${above} H ${bx} V ${by}`, x: (ax+x)/2, y: below + 24, returnEdge: returns.has(index) };
    }
    const mid = ay + (by-ay)/2;
    return { index, path: `M ${ax} ${ay} V ${mid} H ${bx} V ${by}`, x: (ax+bx)/2, y: mid - 8, returnEdge: false };
  });
  return { width: margin * 2 + bodyWidth + (lane ? 64 + lane * 32 : 0), height: Math.max(y - 104 + margin, ...paths.map(p => p.y + 24)), nodes: boxes, edges: paths };
}

/** Called by the backend conclusion parser. Model-supplied positions, HTML, URLs and status are rejected. */
export function readFlowDiagram(value: unknown): FlowDiagram {
  if (!record(value) || value.version !== 1) throw new Error('流程图需要 version: 1');
  onlyKeys(value, ['version', 'nodes', 'edges']);
  if (!Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > FLOW_LIMITS.nodes) throw new Error(`流程图须有 1–${FLOW_LIMITS.nodes} 个节点，请按章节拆分`);
  if (!Array.isArray(value.edges) || value.edges.length > FLOW_LIMITS.edges) throw new Error(`流程图最多 ${FLOW_LIMITS.edges} 条连线，请按章节拆分`);
  const ids = new Set<string>();
  const nodes = value.nodes.map(v => {
    if (!record(v)) throw new Error('流程节点格式无效');
    onlyKeys(v, ['id', 'label', 'kind', 'detail']);
    const id = identifier(v.id); if (ids.has(id)) throw new Error(`流程节点标识重复：${id}`); ids.add(id);
    const kind = v.kind ?? 'step'; if (!['step', 'decision', 'start', 'end'].includes(String(kind))) throw new Error('流程节点类型无效');
    return { id, label: label(v.label, '节点标题', FLOW_LIMITS.label), kind: kind as FlowNode['kind'], ...(v.detail === undefined ? {} : { detail: label(v.detail, '节点说明', FLOW_LIMITS.detail) }) };
  });
  const edgeIds = new Set<string>();
  const edges = value.edges.map(v => {
    if (!record(v)) throw new Error('流程连线格式无效');
    onlyKeys(v, ['from', 'to', 'label']);
    const from = identifier(v.from), to = identifier(v.to);
    if (!ids.has(from) || !ids.has(to)) throw new Error('流程连线引用了不存在的节点');
    const text = v.label === undefined ? undefined : label(v.label, '连线文字', FLOW_LIMITS.edgeLabel);
    const key = JSON.stringify([from, to, text]); if (edgeIds.has(key)) throw new Error('流程连线重复'); edgeIds.add(key);
    return { from, to, ...(text ? { label: text } : {}) };
  });
  return { version: 1, nodes, edges, layout: layoutFlow(nodes, edges) };
}
