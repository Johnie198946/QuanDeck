import type { Snapshot } from "../src/data/types";
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
