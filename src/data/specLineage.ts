import type { Snapshot } from './types';
import type { CollaborationContext } from './collaboration';

/** A role on an existing immutable integration version, never a parallel spec document. */
export interface ProjectSpecPin { bundleId: string; versionId: string; version: number; hash: string }
export function projectSpecBundle(snapshot: Snapshot) {
  return Object.values(snapshot.integration?.bundles ?? {}).find(bundle => bundle.purpose === 'project_spec');
}
export function currentProjectSpec(snapshot: Snapshot) {
  const bundle = projectSpecBundle(snapshot);
  return snapshot.integration?.versions.find(v => v.id === bundle?.publishedVersionId && v.bundleId === bundle.id && v.purpose === 'project_spec');
}
export function projectSpecPin(snapshot: Snapshot): ProjectSpecPin | undefined {
  const version = currentProjectSpec(snapshot);
  return version ? { bundleId: version.bundleId, versionId: version.id, version: version.version, hash: version.hash } : undefined;
}
export function projectSpecContextCurrent(snapshot: Snapshot, context: CollaborationContext): boolean {
  const current = projectSpecPin(snapshot), pinned = context.projectSpec;
  return current?.versionId === pinned?.versionId && current?.hash === pinned?.hash;
}
/** The evidence that created a normative version must not invalidate itself on publication. */
function specBasis(snapshot: Snapshot): Set<string> {
  const ids = new Set<string>();
  const add = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    snapshot.collaboration?.artifacts.find(a => a.id === id)?.sourceIds.forEach(add);
  };
  currentProjectSpec(snapshot)?.sourcePins.forEach(pin => add(pin.artifactId));
  return ids;
}
export function projectSpecArtifactStale(snapshot: Snapshot, artifactId: string, seen = new Set<string>()): boolean {
  if (seen.has(artifactId) || specBasis(snapshot).has(artifactId)) return false;
  seen.add(artifactId);
  const c = snapshot.collaboration, artifact = c?.artifacts.find(a => a.id === artifactId);
  if (!artifact) return false;
  const run = artifact.runId ? c?.runs[artifact.runId] : undefined;
  const context = run ? c?.contextPackages.find(p => p.id === run.contextPackageId) : undefined;
  return (!!context && !projectSpecContextCurrent(snapshot, context)) || artifact.sourceIds.some(id => projectSpecArtifactStale(snapshot, id, seen));
}
export function deriveSpecLineage(snapshot: Snapshot, key: string) {
  const c = snapshot.collaboration, task = c?.tasks[key];
  const directions = Object.values(c?.goalPlans ?? {}).flatMap(versions => {
    const plan = versions.at(-1), direction = plan && snapshot.ideaPlans?.[plan.id];
    return plan?.tasks.some(t => t.key === key) ? [{ planId: plan.id, title: plan.title, scope: plan.scope, version: plan.version, draftVersion: plan.draftVersion, confirmed: direction?.adopted?.draftVersion === plan.draftVersion }] : [];
  });
  const run = task?.activeRunId ? c?.runs[task.activeRunId] : undefined;
  const context = run ? c?.contextPackages.find(p => p.id === run.contextPackageId) : undefined;
  const artifact = c?.artifacts.find(a => a.id === c.submissions.find(s => s.id === task?.latestSubmissionId)?.artifactId);
  const stale = artifact ? projectSpecArtifactStale(snapshot, artifact.id) : !!context && !projectSpecContextCurrent(snapshot, context);
  return { directions, taskSpecRevision: task?.specRevision, projectSpec: projectSpecPin(snapshot), pinnedProjectSpec: context?.projectSpec, stale, artifactId: artifact?.id, artifactAuthority: artifact && task?.acceptedArtifactId === artifact.id ? 'accepted' : 'candidate' };
}
