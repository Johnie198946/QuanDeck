import type { IdeaPlan, Snapshot } from "./types";
import { taskKey } from "./collaboration";
import { latestConclusion } from "./discussion";

/** A direction reads its own registered outputs, not the whole descendant result map. */
export function directionDeliverables(snapshot: Snapshot, direction: IdeaPlan) {
  const project = direction.scope === "project";
  const key = taskKey(direction.taskId, direction.itemId);
  const plans = Object.values(snapshot.collaboration?.goalPlans ?? {})
    .flatMap((versions) => (versions.length ? [versions.at(-1)!] : []))
    // System assembly owns a project-final slot; its task direction must see that exact slot too.
    .filter((plan) => !project || plan.scope === "project");
  const current = plans
    .flatMap((plan) => plan.slots)
    .filter((slot) => !slot.retired && (project || slot.taskKey === key));
  const conclusion = latestConclusion(direction, "root");
  // Explicit [] is a proposed removal; omitted deliverables do not erase the registered list.
  const proposed = conclusion && !conclusion.adopted ? conclusion.deliverables : undefined;
  return {
    current,
    proposed,
    scopeLabel: project ? "项目最终交付" : direction.itemId ? "本子任务自身交付" : "本任务自身交付",
  };
}
