import type { SaveTaskOutputInput, Snapshot } from "../src/data/types";
import type { WorkdeckDataSource } from "../src/data/repository";
import { taskKey } from "../src/data/collaboration";

/** Test-only human action: read the exact current requirements, then check each one. */
export function checkedTaskAcceptance(
  snapshot: Snapshot,
  taskId: string,
  workItemId?: string | null,
) {
  const key = taskKey(taskId, workItemId);
  const task = snapshot.collaboration?.tasks[key];
  const spec = snapshot.collaboration?.specs.find(
    (value) => value.key === key && value.revision === task?.specRevision,
  );
  if (!spec) throw Error("Test task has no acceptance requirements");
  return { taskSpecRevision: spec.revision, taskChecks: spec.criteria.map(() => true) };
}

/** Exercise the two independent user actions against the saved candidate. */
export async function submitAndReviewOutput(api: Pick<WorkdeckDataSource, 'saveTaskOutput'|'load'|'collaborate'>, input: SaveTaskOutputInput) {
  const saved = await api.saveTaskOutput(input);
  if (!saved.ok) return saved;
  const snapshot = await api.load();
  const {taskId,workItemId} = input, key = taskKey(taskId,workItemId);
  const target = snapshot.collaboration!.tasks[key];
  const submission = snapshot.collaboration!.submissions.find(candidate => candidate.id === target.latestSubmissionId);
  const artifact = snapshot.collaboration!.artifacts.find(candidate => candidate.id === submission?.artifactId);
  if (!submission || artifact?.outputId !== saved.outputId) throw Error('Test candidate has changed');
  const review = await api.collaborate({projectId:snapshot.project.id,taskId,workItemId:workItemId ?? undefined,type:'review',
    expectedVersion:target.version,idempotencyKey:'checked:'+submission.id,payload:{submissionId:submission.id,verdict:'accepted',
      checks:checkedTaskAcceptance(snapshot,taskId,workItemId).taskChecks,note:'已核对刚提交的候选及全部验收条件',deliveryChecks:input.deliveryChecks}});
  return {...saved,ok:review.ok,message:review.message};
}
