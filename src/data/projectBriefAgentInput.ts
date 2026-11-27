import { homeBoardCards } from '../components/homepage/homeBoardData';
import { buildProjectBriefs } from '../components/homepage/projectBriefs';
import type { KnowledgeNote } from './knowledgeNotes';
import { legacyNoteSources } from './noteTaskSource';
import { briefInsightInput } from './projectBriefInsight';
import type { Snapshot } from './types';

/** Rebuild the visible project from saved records. The renderer only sends its project and revision. */
export function savedProjectBriefInput(snapshot: Snapshot, notes: KnowledgeNote[]) {
  const now = Date.now();
  const projectId = snapshot.project.id;
  const legacy = legacyNoteSources([snapshot], notes);
  const referenced = new Set([...legacy.values()].map(source => source.noteId));
  for (const task of Object.values(snapshot.tasks)) {
    for (const input of task.inputs ?? []) if (input.noteSource) referenced.add(input.noteSource.noteId);
  }
  const linked = notes.filter(note => referenced.has(note.id) || note.projectQuotes?.some(quote => quote.projectId === projectId));
  const cards = homeBoardCards([snapshot], linked, legacy, now);
  const brief = buildProjectBriefs([snapshot], cards, linked, now).briefs.find(row => row.id === projectId);
  return briefInsightInput(projectId, brief?.evidence ?? []);
}
