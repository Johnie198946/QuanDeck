import type { Snapshot } from './types';
import type { CollaborationContext } from './collaboration';
import { currentDeliverySlots, receiptForSlot } from './deliveryContract';

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
/** Initial publication establishes a baseline; it does not revoke earlier real acceptances.
 * This is evidence validation, not a `done`-flag exemption. Ordinary freshness checks
 * still reject withdrawn, replaced, expired, or explicitly invalidated sources.
 */
export function acceptedBeforeInitialProjectSpec(snapshot: Snapshot, artifactId: string): boolean {
  const published = currentProjectSpec(snapshot), c = snapshot.collaboration;
  if (!published || published.version !== 1 || published.parentVersionId || !c) return false;
  const cutoff = Date.parse(published.at), artifact = c.artifacts.find(a => a.id === artifactId);
  const task = artifact && c.tasks[artifact.key];
  if (!Number.isFinite(cutoff) || !artifact || artifact.legacy || !task || task.archived || task.legacyCompletion || task.status !== 'done' || task.acceptedArtifactId !== artifactId) return false;
  const submission = c.submissions.find(s => s.id === task.latestSubmissionId && s.artifactId === artifactId && s.key === task.key);
  const review = submission && [...c.reviews].reverse().find(r => r.submissionId === submission.id && r.key === task.key);
  const spec = c.specs.find(s => s.key === task.key && s.revision === task.specRevision);
  if (!submission || submission.specRevision !== task.specRevision || submission.unresolved.length || !review || review.verdict !== 'accepted' || !spec) return false;
  const acceptedAt = Date.parse(review.at), submittedAt = Date.parse(submission.at);
  if (!Number.isFinite(acceptedAt) || !Number.isFinite(submittedAt) || submittedAt > acceptedAt || acceptedAt > cutoff || review.criteria.length !== spec.criteria.length || review.criteria.some((criterion, index) => !criterion.passed || criterion.text !== spec.criteria[index])) return false;
  for (const slot of currentDeliverySlots(snapshot, task.key).filter(s => s.contract)) {
    const receipt = receiptForSlot(artifact, slot);
    if (!receipt && !slot.contract!.required) continue;
    const check = review.deliveryChecks?.find(item => item.slotId === slot.id && item.contractRevision === slot.contract!.revision);
    if (!receipt || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(receipt.contentHash) || !Number.isFinite(Date.parse(receipt.verifiedAt)) || Date.parse(receipt.verifiedAt) > acceptedAt || !check || check.criteria.length !== slot.contract!.criteria.length || check.criteria.some((criterion, index) => !criterion.passed || criterion.text !== slot.contract!.criteria[index])) return false;
    if (receipt.kind === 'file' && !artifact.attachments?.some(file => file.id === receipt.attachmentId)) return false;
  }
  return true;
}
export function projectSpecArtifactStale(snapshot: Snapshot, artifactId: string, seen = new Set<string>()): boolean {
  if (seen.has(artifactId) || specBasis(snapshot).has(artifactId)) return false;
  seen.add(artifactId);
  const c = snapshot.collaboration, artifact = c?.artifacts.find(a => a.id === artifactId);
  if (!artifact) return false;
  const run = artifact.runId ? c?.runs[artifact.runId] : undefined;
  const context = run ? c?.contextPackages.find(p => p.id === run.contextPackageId) : undefined;
  // Human submissions have no provider run, but new backend handoffs pin the same
  // normative version. Historical artifacts without a recorded pin remain unknown.
  const handoff = !artifact.runId ? c?.handoffs?.find(item => item.artifactId === artifact.id) : undefined;
  const current = projectSpecPin(snapshot);
  const handoffChanged = !!handoff && (handoff.projectSpec?.versionId !== current?.versionId || handoff.projectSpec?.hash !== current?.hash);
  const initialBaseline = acceptedBeforeInitialProjectSpec(snapshot, artifactId);
  return (!initialBaseline && ((!!context && !projectSpecContextCurrent(snapshot, context)) || handoffChanged)) || artifact.sourceIds.some(id => projectSpecArtifactStale(snapshot, id, seen));
}
export function deriveSpecLineage(snapshot: Snapshot, key: string, selectedArtifactId?: string) {
  const c = snapshot.collaboration, task = c?.tasks[key];
  const directions = Object.values(c?.goalPlans ?? {}).flatMap(versions => {
    const plan = versions.at(-1), direction = plan && snapshot.ideaPlans?.[plan.id];
    return plan?.tasks.some(t => t.key === key) ? [{ planId: plan.id, title: plan.title, scope: plan.scope, version: plan.version, draftVersion: plan.draftVersion, confirmed: direction?.adopted?.draftVersion === plan.draftVersion }] : [];
  });
  const artifactId = selectedArtifactId ?? c?.submissions.find(s => s.id === task?.latestSubmissionId)?.artifactId ?? task?.acceptedArtifactId;
  const artifact = c?.artifacts.find(a => a.id === artifactId && a.key === key);
  // Acceptance ends the active claim, not the immutable result's provenance.
  // A selected result must keep its own run even while another run is active.
  const runId = artifact ? artifact.runId : selectedArtifactId ? undefined : task?.activeRunId;
  const run = runId ? c?.runs[runId] : undefined;
  const context = run ? c?.contextPackages.find(p => p.id === run.contextPackageId) : undefined;
  const handoff = artifact ? c?.handoffs?.find(item => item.artifactId === artifact.id && item.key === key) : undefined;
  const stale = artifact ? projectSpecArtifactStale(snapshot, artifact.id) : !!context && !projectSpecContextCurrent(snapshot, context);
  return { directions, taskSpecRevision: task?.specRevision, projectSpec: projectSpecPin(snapshot), pinnedProjectSpec: context ? context.projectSpec : handoff?.projectSpec, projectSpecSource: context ? 'run-context' as const : handoff ? 'task-handoff' as const : artifact ? 'legacy-unknown' as const : 'none' as const, stale, artifactId: artifact?.id, artifactAuthority: artifact && task?.acceptedArtifactId === artifact.id ? 'accepted' : 'candidate' };
}
