import type { KnowledgeGraphEdge, KnowledgeSource } from './knowledgeIndex';

type Graph = {
  sources: ReadonlyMap<string, KnowledgeSource>;
  adjacency: ReadonlyMap<string, KnowledgeGraphEdge[]>;
};

/** Distances count edges. Stable neighbor order chooses one shortest path when several tie. */
export function exploreNoteLayers(graph: Graph, rootId: string, depth: number) {
  const paths = new Map<string, string[]>();
  const layerCounts: [number, number, number] = [0, 0, 0];
  const ids = new Set<string>();
  const limit = Math.max(1, Math.min(3, Math.trunc(depth) || 1));
  if (graph.sources.has(rootId)) {
    paths.set(rootId, [rootId]);
    ids.add(rootId);
  }
  let frontier = [...ids];
  const visited = new Set(frontier);
  for (let step = 1; step <= 3 && frontier.length; step++) {
    const next: string[] = [];
    for (const id of frontier) {
      const neighbors = new Set((graph.adjacency.get(id) ?? []).flatMap(edge => edge.members));
      for (const neighbor of [...neighbors].sort()) {
        if (visited.has(neighbor) || !graph.sources.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
        if (step <= limit) {
          ids.add(neighbor);
          paths.set(neighbor, [...paths.get(id)!, neighbor]);
        }
      }
    }
    layerCounts[step - 1] = next.length;
    frontier = next;
  }
  return { ids, paths, layerCounts, nextCount: limit < 3 ? layerCounts[limit] : 0 };
}
