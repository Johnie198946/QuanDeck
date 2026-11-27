import { hashText } from './contentHash';

export interface ProjectBriefSource {
  id: string;
  kind: string;
  projectId?: string;
  title: string;
  text: string;
  at: string;
}
export interface ProjectBriefInsight {
  provider: string;
  generatedAt: string;
  sourceCount: number;
  availableCount: number;
  points: {
    text: string;
    citations: { sourceId: string; quote: string }[];
  }[];
}
export interface StoredBriefInsight {
  evidenceKey: string;
  agentKey: string;
  insight: ProjectBriefInsight;
}

/** Give notes, decisions and returned work a voice even on a project with many tasks. */
export function briefInsightInput(projectId: string, sources: readonly ProjectBriefSource[]) {
  // Renderer and desktop can use different system locales. Cache keys must still agree.
  const compare = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;
  const eligible = sources.filter(source => source.projectId === projectId && (source.title.trim() || source.text.trim()))
    .sort((a, b) => compare(b.at, a.at) || compare(a.id, b.id));
  const selected = new Set<ProjectBriefSource>();
  for (const kind of ['decision', 'result', 'progress', 'source', 'note', 'task']) {
    for (const source of eligible.filter(row => row.kind === kind).slice(0, 3)) selected.add(source);
  }
  for (const source of eligible) {
    if (selected.size >= 24) break;
    selected.add(source);
  }
  const rows = Array.from(selected, source => ({
    id: source.id, kind: source.kind, at: source.at,
    title: source.title.trim().slice(0, 120), text: source.text.trim().slice(0, 550),
  }));
  const availableCount = eligible.length;
  return { rows, availableCount, evidenceKey: hashText(JSON.stringify([1, projectId, availableCount, rows])) };
}
