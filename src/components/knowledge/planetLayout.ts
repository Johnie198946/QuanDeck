export interface Point { x: number; y: number }
export interface CanvasNode { id: string; title: string; content?: boolean }
export interface CanvasEdge { members: string[]; key: string; label: string; conflict?: boolean; content?: boolean }
export interface Planet extends Point, CanvasNode { radius: number; links: number; neighbors: Set<string> }
export interface Orbit { edge: CanvasEdge; ends: string[]; bend: number }
export interface GraphPhysics { repulsion: number; elasticity: number }
export const DEFAULT_GRAPH_PHYSICS: GraphPhysics = { repulsion: 100, elasticity: 100 };

/** Deterministic initial placement. The actual edges, including self-links and multi-note evidence, determine the neighborhoods. */
export function planetLayout(notes: CanvasNode[], edges: CanvasEdge[], physics: GraphPhysics = DEFAULT_GRAPH_PHYSICS, rootId?: string) {
  const repulsion = physics.repulsion / 100;
  const elasticity = physics.elasticity / 100;
  const gapX = 153 * Math.sqrt(repulsion), gapY = 91 * Math.sqrt(repulsion);
  const nodes = new Map<string, Planet>(notes.map(note => [note.id, {
    id: note.id, title: note.title, content: note.content, radius: 12, links: 0, neighbors: new Set(), x: 0, y: 0,
  }]));
  const pairs = new Map<string, number>();
  const orbits: Orbit[] = [];
  for (const edge of edges) {
    const ends = edge.members.filter(id => nodes.has(id));
    if (!ends.length) continue;
    const key = JSON.stringify([...ends].sort());
    const n = pairs.get(key) ?? 0;
    pairs.set(key, n + 1);
    // Parallel findings get separate arcs. Canonical endpoint order preserves the bend across reversed findings.
    const bend = (n % 2 ? -1 : 1) * Math.ceil(n / 2) * 48 * (ends[0] > (ends[1] || '') ? -1 : 1);
    orbits.push({ edge, ends, bend });
    const origin = nodes.get(ends[0])!;
    for (const id of ends) {
      const node = nodes.get(id)!;
      node.links++;
      if (origin !== node) { origin.neighbors.add(id); node.neighbors.add(origin.id); }
    }
  }
  const planets = [...nodes.values()].sort((a, b) => Number(b.id === rootId) - Number(a.id === rootId) || b.links - a.links || a.id.localeCompare(b.id));
  // Seed each connected component together, including wholly disconnected notes.
  const order: Planet[] = [];
  const seen = new Set<string>();
  for (const planet of planets) {
    if (seen.has(planet.id)) continue;
    const todo = [planet];
    seen.add(planet.id);
    for (let i = 0; i < todo.length; i++) {
      const member = todo[i];
      order.push(member);
      for (const id of member.neighbors) if (!seen.has(id)) { seen.add(id); todo.push(nodes.get(id)!); }
    }
  }
  const homes = order.map((p, i) => {
    const distance = 103 * Math.sqrt(i);
    p.radius = p.content ? 8 : p.links ? Math.min(27, 13 + Math.sqrt(p.links) * 3.5) : 11;
    p.x = distance * Math.cos(i * 2.39996) * 1.32;
    p.y = distance * Math.sin(i * 2.39996) * .85;
    return { x: p.x, y: p.y };
  });
  // Nearby labels need more space horizontally than vertically. Grid bins avoid a quadratic pair pass.
  // Keep relaxation bounded on dense graphs; the complete relation list remains available for inspection.
  const springs = new Map(order.map(p=>[p.id,[...p.neighbors].slice(0,12)]));
  for (let pass = 0; pass < 50; pass++) {
    const bins = new Map<string, Planet[]>();
    for (const [i, p] of order.entries()) {
      p.x += (homes[i].x - p.x) * .045;
      p.y += (homes[i].y - p.y) * .045;
      for (const id of springs.get(p.id)!) {
        if (id <= p.id) continue;
        const q = nodes.get(id)!;
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const pull = Math.max(-.015, (d - 164) / d * .048) * elasticity / Math.sqrt(Math.max(p.neighbors.size, q.neighbors.size));
        p.x += dx * pull; p.y += dy * pull;
        q.x -= dx * pull; q.y -= dy * pull;
      }
      const col = Math.floor(p.x / gapX), row = Math.floor(p.y / gapY);
      for (let x = col - 1; x <= col + 1; x++) for (let y = row - 1; y <= row + 1; y++) {
        for (const q of bins.get(x + ',' + y) ?? []) {
          const dx = q.x - p.x || .01, dy = q.y - p.y || .01;
          const d = Math.hypot(dx / gapX, dy / gapY);
          if (d >= 1) continue;
          const push = Math.min(.6, (1 - d) * .42 * repulsion / d);
          p.x -= dx * push; p.y -= dy * push;
          q.x += dx * push; q.y += dy * push;
        }
      }
      const key = col + ',' + row;
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key)!.push(p);
    }
  }
  const root = rootId && nodes.get(rootId);
  if (root) {
    const halfWidth = Math.max(...order.map(p => Math.abs(p.x - root.x))) + 95;
    const halfHeight = Math.max(...order.map(p => Math.abs(p.y - root.y))) + 77;
    return { nodes, order, orbits, bounds: {width:2*halfWidth, height:2*halfHeight, x:root.x, y:root.y} };
  }
  const minX = Math.min(0,...order.map(p=>p.x)) - 95, maxX = Math.max(0,...order.map(p=>p.x)) + 95;
  const minY = Math.min(0,...order.map(p=>p.y)) - 61, maxY = Math.max(0,...order.map(p=>p.y)) + 77;
  return { nodes, order, orbits, bounds: { width: maxX-minX, height: maxY-minY, x: (minX+maxX)/2, y: (minY+maxY)/2 } };
}

export function orbitPath(a: Point, b: Point, bend: number, radius: number, self: boolean) {
  if (self) {
    const r = radius + 36 + Math.abs(bend) * .35;
    return { d: `M${a.x-radius*.65} ${a.y} C${a.x-r*1.35} ${a.y-r*1.35} ${a.x+r*1.35} ${a.y-r*1.35} ${a.x+radius*.65} ${a.y}`,
      x: a.x, y: a.y-r };
  }
  const dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy)||1;
  const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  const c={x:mid.x-dy/d*bend, y:mid.y+dx/d*bend};
  return { d:`M${a.x} ${a.y} Q${c.x} ${c.y} ${b.x} ${b.y}`, x:(mid.x+c.x)/2,y:(mid.y+c.y)/2 };
}
