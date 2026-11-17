import { ensureCollaboration, hashText, isCollaborationArtifactFresh, type CollaborationState } from './collaboration';
import { goalDependencySource, goalDeliveryReadiness, latestGoalPlan, type DeliverySlot, type GoalPlanVersion, type GoalTaskBinding } from './goalDelivery';
import type { Snapshot } from './types';
import { receiptForSlot, defaultDeliveryContract } from './deliveryContract';

const terminalRun = new Set(['succeeded', 'failed', 'cancelled', 'lost']);
const activePlans = (s: Snapshot) => Object.values(s.collaboration?.goalPlans ?? {}).flatMap(v => v.at(-1) ? [v.at(-1)!] : []);
const event = (c: CollaborationState, type: string, key: string | undefined, detail: unknown, at: string) => c.events.push({ id: `assembly-event-${globalThis.crypto.randomUUID()}`, sequence: ++c.sequence, type, taskKey: key, actor: 'service', at, detail: JSON.stringify(detail) });
const assemblyKey = (planId: string, slot: DeliverySlot) => `assembly-${hashText(`${planId}:${slot.definitionId ?? slot.id}`).slice(0,24)}`;
const contributionPlanId = (planId: string, taskKey: string) => `contributions-${hashText(`${planId}:${taskKey}`).slice(0,24)}`;
const definition = (slot: DeliverySlot) => JSON.stringify({ title: slot.title, description: slot.description, contract: slot.contract, contributions: slot.contributionIds, retired: slot.retired });

/** No shadow runtime: these are ordinary ledger tasks with a system-created responsibility. */
export function reconcileProjectAssembly(snapshot: Snapshot, planId: string, options: { inPlace?: boolean; at?: string } = {}) {
  const current = latestGoalPlan(snapshot, planId);
  if (!current || current.scope !== 'project' || current.contractSchema !== 1) return false;
  const direction=snapshot.ideaPlans?.[planId];
  if(!options.inPlace&&(!direction||direction.draftVersion!==current.draftVersion||direction.adopted?.draftVersion!==current.draftVersion))return false;
  const c = ensureCollaboration(snapshot), at = options.at ?? new Date().toISOString();
  const next = structuredClone(current), generated = new Map<string, { binding: GoalTaskBinding; slots: DeliverySlot[] }>();
  let changed = false;
  const allSlots = new Map(activePlans(snapshot).flatMap(p => p.slots).map(s => [s.id,s]));
  for (const slot of next.slots.filter(s => !s.retired)) {
    if (!slot.contract) throw Error('项目交付件缺少正式契约，不能生成整合任务');
    const key = assemblyKey(planId, slot), existing = current.tasks.find(b => b.assembly?.slotId === slot.id);
    const assignedSource = next.tasks.find(b => b.key === slot.taskKey && !b.assembly);
    let contributionIds = slot.contributionIds ?? (!assignedSource || existing?.assembly?.sourceTaskKeys.includes(assignedSource.key) ? existing?.assembly?.contributionIds : undefined);
    if (!contributionIds?.length) {
      const source = next.tasks.find(b => b.key === slot.taskKey && !b.assembly);
      if (!source) throw Error('项目交付件缺少明确的任务贡献，不能自行猜测整合来源');
      const sourcePlanId = contributionPlanId(planId, source.key);
      const id = `contribution-${hashText(`${planId}:${slot.definitionId ?? slot.id}:${source.key}`).slice(0,24)}`;
      const contribution: DeliverySlot = {
        ...slot, id, definitionId: id, planId: sourcePlanId, parentId: undefined,
        title: `${slot.title} · 任务交付`, contributionIds: undefined,
        contract: { ...slot.contract, purpose: 'deliverable' }, taskKey: source.key, taskId: source.taskId, workItemId: source.workItemId,
      };
      const group = generated.get(source.key) ?? { binding: structuredClone(source), slots: [] };
      group.slots.push(contribution); generated.set(source.key, group); allSlots.set(id, contribution);
      contributionIds = [id];
    }
    const contributions = contributionIds.map(id => allSlots.get(id));
    if (contributions.some(s => !s || s.retired)) throw Error('整合来源交付件不存在或已移除');
    const sourceTaskKeys = [...new Set(contributions.map(s => s!.taskKey))];
    if (!sourceTaskKeys.length || sourceTaskKeys.includes(key) || sourceTaskKeys.some(k => !c.tasks[k] || c.tasks[k].archived)) throw Error('整合来源任务无效或包含自身');
    // A contributor may not depend on this final output, even through a parent or another branch.
    const reaches = (from: string, target: string, seen = new Set<string>()): boolean => from === target || !seen.has(from) && (seen.add(from), (c.tasks[from]?.dependencies ?? []).some(k => reaches(k,target,seen)));
    if (sourceTaskKeys.some(source => reaches(source, key))) throw Error('整合任务与贡献任务之间存在循环依赖');
    if (!snapshot.tasks[key]) {
      snapshot.tasks[key] = { id: key, title: `整合：${slot.title}`, createdAt: at, owner: 'agent', sessionIds: [], completion: null, manualLock: true };
      snapshot.journal.blocks.push({ id: `block-${key}`, kind: 'task', taskId: key });
      ensureCollaboration(snapshot); changed = true;
      event(c, 'assembly_task_created', key, { planId, slotId: slot.id, contributionIds, sourceTaskKeys }, at);
    }
    const task = c.tasks[key];
    let binding = next.tasks.find(b => b.key === key);
    if (!binding) {
      binding = { key, taskId: key, draftKey: `system-${key}`, specRevision: task.specRevision };
      next.tasks.push(binding); changed = true;
    }
    const previousAssembly = binding.assembly;
    const metadata = { slotId: slot.id, contributionIds: [...contributionIds], sourceTaskKeys,
      revision: previousAssembly?.revision ?? 1,
      ...(previousAssembly?.inputFingerprint ? { inputFingerprint: previousAssembly.inputFingerprint, inputArtifactIds: previousAssembly.inputArtifactIds } : {}) };
    if (JSON.stringify(binding.assembly) !== JSON.stringify(metadata)) { binding.assembly = metadata; changed = true; }
    if (JSON.stringify(task.dependencies) !== JSON.stringify(sourceTaskKeys)) { task.dependencies = sourceTaskKeys; task.version++; changed = true; }
    if (slot.taskKey !== key || JSON.stringify(slot.contributionIds) !== JSON.stringify(contributionIds)) {
      Object.assign(slot, { taskKey: key, taskId: key, workItemId: undefined, contributionIds: [...contributionIds] }); changed = true;
    }
    const spec = c.specs.find(s => s.key === key && s.revision === task.specRevision)!;
    if (!task.latestSubmissionId && !task.activeRunId && !previousAssembly?.inputFingerprint) {
      const goal = `根据固定的任务贡献整合交付「${slot.title}」。${slot.description ?? ''}`;
      const criteria = [...slot.contract.criteria, '仅使用本次固定来源，缺失或过期资料不得冒充已完成。'];
      // Only the newly generated initial requirement is initialized; published revisions are never edited.
      if (spec.reason === 'task-created') { spec.goal = goal; spec.criteria = criteria; spec.reason = 'system-assembly-contract'; }
    }
  }
  // Every executable task has its own delivery contract, even when it contributes through
  // its parent instead of occupying a project-final position directly.
  for(const binding of next.tasks.filter(b=>!b.assembly)){
    const own=activePlans(snapshot).some(p=>p.scope==='task'&&p.slots.some(s=>s.taskKey===binding.key));
    if(generated.has(binding.key)||own)continue;
    const id=`task-delivery-${hashText(`${planId}:${binding.key}`).slice(0,24)}`, task=c.tasks[binding.key];
    const spec=c.specs.find(s=>s.key===binding.key&&s.revision===task.specRevision)!;
    generated.set(binding.key,{binding:structuredClone(binding),slots:[{id,definitionId:id,planId:contributionPlanId(planId,binding.key),taskKey:binding.key,taskId:binding.taskId,workItemId:binding.workItemId,title:task.title,description:spec.goal,contract:defaultDeliveryContract(spec.goal)}]});
  }
  const liveContributions=new Set(next.slots.filter(s=>!s.retired).flatMap(s=>s.contributionIds??[]));
  for(const binding of [...next.tasks].filter(b=>b.assembly&&!next.slots.some(s=>s.id===b.assembly!.slotId&&!s.retired))){
    next.tasks=next.tasks.filter(b=>b.key!==binding.key);
    const task=c.tasks[binding.key];if(task&&!task.archived){task.archived=true;task.status='cancelled';task.claimEpoch++;task.version++;event(c,'assembly_responsibility_retired',task.key,{slotId:binding.assembly!.slotId},at);}
    changed=true;
  }
  for (const [sourceKey, group] of generated) {
    const id = contributionPlanId(planId, sourceKey), versions = (c.goalPlans ??= {})[id] ??= [], prior = versions.at(-1);
    const sourceSlots = prior?.slots.filter(s => !group.slots.some(next => next.id === s.id)).map(s=>!s.retired&&s.id.startsWith('contribution-')&&!liveContributions.has(s.id)?{...s,retired:{reason:'项目输出已移除或贡献关系已变更',at,replacementIds:[]}}:s) ?? [];
    const slots = [...sourceSlots, ...group.slots];
    const same = prior && prior.draftVersion === next.draftVersion && prior.tasks[0]?.specRevision === group.binding.specRevision && JSON.stringify(prior.slots) === JSON.stringify(slots);
    if (!same) {
      versions.push({ id, title: `${c.tasks[sourceKey].title} · 交付地图`, scope: 'task', taskId: group.binding.taskId,
        version: (prior?.version ?? 0) + 1, draftVersion: next.draftVersion, at, tasks: [group.binding], slots,
        contractSchema: 1, assemblySourcePlanId: planId });
      changed = true;
    }
  }
  // Keep existing generated contribution plans bound to the confirmed project direction/spec.
  for (const plan of activePlans(snapshot).filter(p => p.assemblySourcePlanId === planId)) {
    const binding = next.tasks.find(t => t.key === plan.tasks[0]?.key);
    if (!binding || generated.has(binding.key)) continue;
    const slots=plan.slots.map(s=>!s.retired&&s.id.startsWith('contribution-')&&!liveContributions.has(s.id)?{...s,retired:{reason:'项目输出已移除或贡献关系已变更',at,replacementIds:[]}}:s);
    if (plan.draftVersion !== next.draftVersion || plan.tasks[0]?.specRevision !== binding.specRevision || JSON.stringify(slots)!==JSON.stringify(plan.slots)) {
      c.goalPlans![plan.id].push({ ...structuredClone(plan), version: plan.version + 1, draftVersion: next.draftVersion, at, tasks: [structuredClone(binding)],slots }); changed = true;
    }
  }
  if (!changed) return false;
  if (options.inPlace) Object.assign(current, next);
  else appendRevision(snapshot, current, next, at, 'assembly_responsibilities_reconciled');
  return true;
}

function appendRevision(snapshot: Snapshot, current: GoalPlanVersion, next: GoalPlanVersion, at: string, reason: string) {
  const c = snapshot.collaboration!;
  next.version = current.version + 1; next.at = at;
  c.goalPlans![current.id].push(next);
  const authorization = c.goalAutomation?.[current.id];
  if (authorization?.planVersion === current.version && authorization.draftVersion === current.draftVersion) authorization.planVersion = next.version;
  event(c, reason, undefined, { planId: current.id, previousVersion: current.version, version: next.version }, at);
}

function currentInputs(snapshot: Snapshot, plan: GoalPlanVersion, binding: GoalTaskBinding) {
  const assembly = binding.assembly!, c = snapshot.collaboration!,direction=snapshot.ideaPlans?.[plan.id];
  if(direction?.draftVersion!==plan.draftVersion||direction.adopted?.draftVersion!==plan.draftVersion||c.tasks[binding.key]?.specRevision!==binding.specRevision)return {sources:[],issue:'项目方向或整合要求已变化'};
  const slots = new Map(activePlans(snapshot).flatMap(p => p.slots).map(s => [s.id,s]));
  const sources: { slotId: string; contractRevision: number; artifactId: string; hash: string; contentHash:string; attachmentId?:string }[] = [];
  for (const id of assembly.contributionIds) {
    const slot = slots.get(id);
    if (!slot || slot.retired || slot.taskKey === binding.key) return { sources, issue: '整合贡献已移除或关系无效' };
    const sourceTask=c.tasks[slot.taskKey],accepted=sourceTask?.status==='done'&&!sourceTask.requiresRevalidation&&goalDeliveryReadiness(snapshot,slot.taskKey).complete?c.artifacts.find(a=>a.id===sourceTask.acceptedArtifactId):undefined;
    const artifact = goalDependencySource(snapshot, binding.key, slot.taskKey,false)??accepted;
    const receipt = receiptForSlot(artifact,slot);
    if (!artifact || !receipt || !isCollaborationArtifactFresh(snapshot, artifact.id)) return { sources, issue: `等待有效任务交付：${slot.title}` };
    sources.push({ slotId: id, contractRevision: slot.contract!.revision, artifactId: artifact.id, hash: artifact.hash,contentHash:receipt.contentHash,...(receipt.attachmentId?{attachmentId:receipt.attachmentId}:{}) });
  }
  const output = plan.slots.find(s => s.id === assembly.slotId && !s.retired);
  if (!output || !sources.length) return { sources, issue: '整合交付件已移除或尚无贡献' };
  return { sources, fingerprint: hashText(JSON.stringify({ output: definition(output), sources })) };
}

/** Actual provider stop evidence, not a local cancelled/archived label, is needed before a replacement run. */
function safeToReplace(snapshot: Snapshot, key: string) {
  const c = snapshot.collaboration!, task = c.tasks[key];
  const sessions = Object.values(snapshot.sessions).filter(s => s.runtime?.collaboration && s.runtime.collaboration.taskId === task.taskId && s.runtime.collaboration.workItemId === task.workItemId);
  if (sessions.some(s => s.dispatchPhase !== 'rejected' && s.runtime?.stoppedConfirmed !== true)) return false;
  const run = task.activeRunId && c.runs[task.activeRunId];
  return !run || terminalRun.has(run.status) || sessions.some(s => s.runtime?.collaboration?.runId === run.id && s.runtime.stoppedConfirmed === true);
}
function invalidateAssembly(c: CollaborationState, key: string) {
  const ids = new Set(c.artifacts.filter(a => a.key === key).map(a => a.id));
  let more = true;
  while (more) { more = false; for (const artifact of c.artifacts) if (!ids.has(artifact.id) && artifact.sourceIds.some(id => ids.has(id))) { ids.add(artifact.id); more = true; } }
  for (const id of ids) c.freshness[id] = 'stale';
}

/** Re-arm changed contribution requirements only after every old source actually stopped. */
function refreshPendingTaskRevisions(snapshot: Snapshot, keys: string[], at: string) {
  const c = snapshot.collaboration!, allowed = new Set(keys), prepared = new Set<string>();
  const pending = new Map(activePlans(snapshot).flatMap(p => p.pendingTaskRevisions ?? []).map(value => [value.key, value]));
  for (const change of pending.values()) {
    const task = c.tasks[change.key];
    if (!allowed.has(change.key) || !task || task.archived) continue;
    const uncertain = Object.values(c.goalAutomation ?? {}).some(a => ['reserved', 'unknown'].includes(a.attempts[task.key]?.state));
    const external = Object.values(c.externalActions).some(action => action.key === task.key && ['dispatched', 'unknown'].includes(action.status));
    if (uncertain || external || !safeToReplace(snapshot, task.key)) continue;
    const previous = c.specs.find(s => s.key === task.key && s.revision === task.specRevision)!;
    const oldRun = task.activeRunId ? c.runs[task.activeRunId] : undefined;
    if (oldRun && !terminalRun.has(oldRun.status)) { oldRun.status = 'cancelled'; oldRun.error = '来源停止已确认，任务交付要求改版'; }
    invalidateAssembly(c, task.key);
    task.specRevision++; task.version++; task.claimEpoch++; task.status = 'ready'; task.legacyCompletion = false;
    delete task.activeRunId; delete task.requiresRevalidation; delete task.blockReason;
    c.specs.push({ ...previous, id: `delivery-spec-${globalThis.crypto.randomUUID()}`, revision: task.specRevision,
      criteria: [...previous.criteria], at, reason: `交付契约变更：${change.reason}` });
    // Archive only local presentation of sources with an actual stop receipt. This
    // does not send another provider command or erase old attempts/context/results.
    for (const session of Object.values(snapshot.sessions)) {
      const binding = session.runtime?.collaboration;
      if (binding?.taskId === task.taskId && binding.workItemId === task.workItemId && session.runtime?.stoppedConfirmed === true) {
        session.status = 'archived'; session.endedAt ??= at;
      }
    }
    for (const authorization of Object.values(c.goalAutomation ?? {})) delete authorization.attempts[task.key];
    prepared.add(task.key);
    event(c, 'delivery_execution_revision_prepared', task.key, { previousSpecRevision: previous.revision, specRevision: task.specRevision, reason: change.reason }, at);
  }
  if (!prepared.size) return false;
  for (const plan of activePlans(snapshot)) {
    if (!plan.tasks.some(b => prepared.has(b.key)) && !plan.pendingTaskRevisions?.some(p => prepared.has(p.key))) continue;
    const next = structuredClone(plan);
    for (const binding of next.tasks) if (prepared.has(binding.key)) binding.specRevision = c.tasks[binding.key].specRevision;
    next.pendingTaskRevisions = next.pendingTaskRevisions?.filter(p => !prepared.has(p.key));
    if (!next.pendingTaskRevisions?.length) delete next.pendingTaskRevisions;
    appendRevision(snapshot, plan, next, at, 'delivery_execution_revision');
  }
  return true;
}

/** Reconcile only opted-in, already authorized plans; historical projects are never bulk-dispatched. */
export function refreshProjectAssemblyInputs(snapshot: Snapshot, planId: string, at = new Date().toISOString(), manualTaskKey?:string) {
  let current = latestGoalPlan(snapshot, planId);
  const c = snapshot.collaboration, authorization = c?.goalAutomation?.[planId];
  if (!c || !current || current.scope !== 'project' || current.contractSchema !== 1 || (!manualTaskKey&&(!authorization?.enabled || authorization.planVersion !== current.version))) return false;
  const direction = snapshot.ideaPlans?.[planId];
  if (direction?.draftVersion !== current.draftVersion || direction.adopted?.draftVersion !== current.draftVersion) return false;
  const revisedContributions = refreshPendingTaskRevisions(snapshot, current.tasks.filter(b => !b.assembly && (!manualTaskKey || b.key === manualTaskKey)).map(b => b.key), at);
  current = latestGoalPlan(snapshot, planId)!;
  const next = structuredClone(current); let changed = false;
  for (const binding of next.tasks.filter(b => b.assembly&&(!manualTaskKey||b.key===manualTaskKey))) {
    const task = c.tasks[binding.key], assembly = binding.assembly!, inputs = currentInputs(snapshot, current, binding);
    if (!task || task.archived) continue;
    if (inputs.issue) {
      if (assembly.inputFingerprint && !task.requiresRevalidation) {
        task.requiresRevalidation = true; task.version++; invalidateAssembly(c, task.key);
        event(c, 'assembly_inputs_invalidated', task.key, { reason: inputs.issue, inputArtifactIds: assembly.inputArtifactIds }, at);
        changed = true;
      }
      continue;
    }
    if (inputs.fingerprint === assembly.inputFingerprint && !task.requiresRevalidation) continue;
    const attempt = authorization?.attempts[binding.key];
    if (attempt?.state === 'reserved' || attempt?.state === 'unknown' || !safeToReplace(snapshot, binding.key)) {
      if (assembly.inputFingerprint && !task.requiresRevalidation) { task.requiresRevalidation = true; task.version++; invalidateAssembly(c,task.key); changed = true; }
      continue;
    }
    if (assembly.inputFingerprint) {
      invalidateAssembly(c,task.key); task.specRevision++; task.version++; task.claimEpoch++;
      task.status = 'ready'; task.legacyCompletion = false; delete task.blockReason; delete task.activeRunId; delete task.requiresRevalidation;
      const prior = [...c.specs].reverse().find(s => s.key === task.key)!;
      const output = next.slots.find(s => s.id === assembly.slotId)!;
      c.specs.push({ ...prior, id: `assembly-spec-${globalThis.crypto.randomUUID()}`, revision: task.specRevision, goal: `整合交付「${output.title}」。${output.description ?? ''}`, criteria: [...output.contract!.criteria, '仅使用本次固定来源，缺失或过期资料不得冒充已完成。'], at, reason: '固定整合输入或交付契约变化' });
      binding.specRevision = task.specRevision; assembly.revision++;
      if(authorization)delete authorization.attempts[binding.key];
    }
    assembly.inputFingerprint = inputs.fingerprint;
    assembly.inputArtifactIds = [...new Set(inputs.sources.map(s => s.artifactId))];
    event(c,'assembly_inputs_pinned',task.key,{ planId, revision: assembly.revision, fingerprint: inputs.fingerprint, sources: inputs.sources },at);
    changed = true;
  }
  if (changed) appendRevision(snapshot,current,next,at,'assembly_input_revision');
  return changed || revisedContributions;
}

/** Submission sources come from fixed backend inputs, never an Agent-authored completion assertion. */
export function assemblySubmissionInputs(snapshot: Snapshot, key: string): { sourceIds: string[]; issue?: string } {
  const plan = activePlans(snapshot).find(p => p.scope === 'project' && p.contractSchema === 1 && p.tasks.some(b => b.key === key && b.assembly));
  if (!plan) return { sourceIds: [] };
  const binding = plan.tasks.find(b => b.key === key)!, inputs = currentInputs(snapshot,plan,binding);
  if (inputs.issue || !binding.assembly!.inputFingerprint || inputs.fingerprint !== binding.assembly!.inputFingerprint)
    return { sourceIds: [], issue: inputs.issue ?? '整合固定来源已变化，需要重新固定输入并执行' };
  return { sourceIds: [...new Set(inputs.sources.map(s => s.artifactId))] };
}

/** Explicit single-task dispatch may pin accepted sources without enabling project automation. */
export function prepareAssemblyForDispatch(snapshot:Snapshot,key:string){
  const changed = snapshot.collaboration ? refreshPendingTaskRevisions(snapshot, [key], new Date().toISOString()) : false;
  const plan=activePlans(snapshot).find(p=>p.scope==='project'&&p.contractSchema===1&&p.tasks.some(b=>b.key===key&&b.assembly));
  return (plan?refreshProjectAssemblyInputs(snapshot,plan.id,new Date().toISOString(),key):false) || changed;
}
