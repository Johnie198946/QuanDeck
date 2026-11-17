import { retainMaterializedGoalPlan } from "./retainedGoalPlan";
import { canExecutePlanTaskDirectly, isDirectTaskPlan, materializeDirectTaskPlan } from './directTaskPlan';
import { ensureCollaboration, hashText, taskKey } from "./collaboration";
import { addDraftsIn } from "./ideaEngine";
import type { GoalTaskBinding } from "./goalDelivery";
import type { DiscussionConclusion, IdeaPlan, Snapshot, TaskDraft } from './types';

/** Candidate task graphs are data, not commands. Validate the entire graph before adoption. */
export function readPlanTasks(value: unknown): TaskDraft[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) throw new Error('任务拆解需要 0–100 项任务');
  const tasks: TaskDraft[] = value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('任务拆解格式无效');
    const x = entry as Record<string, unknown>;
    const string = (v: unknown, name: string, limit = 2000) => {
      if (typeof v !== 'string' || !v.trim() || v.length > limit) throw new Error(`${name}不能为空或过长`);
      return v.trim();
    };
    const key = string(x.key, '任务键', 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('任务键无效');
    if (!Array.isArray(x.deps) || !x.deps.every(d => typeof d === 'string')) throw new Error('任务依赖格式无效');
    if (x.owner !== undefined && !['me', 'agent', 'unassigned'].includes(String(x.owner))) throw new Error('负责人无效');
    return { key, title: string(x.title, '任务标题', 200), expected: string(x.expected, '交付标准'), deps: [...new Set(x.deps as string[])], owner: (x.owner ?? 'agent') as TaskDraft['owner'], parentKey: x.parentKey == null ? undefined : string(x.parentKey, '父任务键', 100), phase: typeof x.phase === 'string' && x.phase.trim() ? x.phase.trim().slice(0, 100) : '执行', lineIds: [], include: true };
  });
  const byKey = new Map(tasks.map(t => [t.key, t]));
  if (byKey.size !== tasks.length) throw new Error('任务键重复');
  for (const task of tasks) {
    for (const key of [...task.deps, ...(task.parentKey ? [task.parentKey] : [])]) if (!byKey.has(key) || key === task.key) throw new Error('任务引用无效');
  }
  // Parent completion waits for its children. Combine these edges with explicit dependencies
  // to reject a child depending on its parent, including indirect deadlocks.
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) throw new Error('任务层级或依赖存在循环');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of [...byKey.get(key)!.deps, ...tasks.filter(t => t.parentKey === key).map(t => t.key)]) visit(dependency);
    visiting.delete(key); visited.add(key);
  };
  tasks.forEach(task => visit(task.key));
  // Parent-first ordering makes the existing task-map importer preserve arbitrary depth.
  const ordered: TaskDraft[] = [];
  const append = (parent?: string) => tasks.filter(t => t.parentKey === parent).forEach(t => { ordered.push(t); append(t.key); });
  append();
  return ordered;
}

export function planIsApproved(plan: IdeaPlan): boolean {
  return !!plan.adopted && plan.adopted.draftVersion === plan.draftVersion;
}

export function conclusionProposals(conclusion: DiscussionConclusion): string[] {
  return conclusion.proposed ?? [...conclusion.confirmed, ...conclusion.open.filter(s => s.startsWith('Agent 提议，待用户确认：')).map(s => s.slice('Agent 提议，待用户确认：'.length))];
}

/** A delta reply may omit unchanged structured fields. Explicit [] clears a field. */
export function inheritedConclusionField<K extends 'outline'|'deliverables'>(plan:IdeaPlan,field:K,through?:DiscussionConclusion):DiscussionConclusion[K] {
  const history=plan.discussion?.conclusions??[];
  const index=through?history.findIndex(c=>c.id===through.id):history.length-1;
  const scope=through?.scopeId??'root';
  return [...history.slice(0,index+1)].reverse().find(c=>c.scopeId===scope&&c[field]!==undefined)?.[field];
}

/** Approval has one persisted source: adopted plan + human decisions in the ledger bridge. */
export function approveDirection(snapshot: Snapshot, plan: IdeaPlan, conclusion?: DiscussionConclusion) {
  if (conclusion?.adopted && planIsApproved(plan)) return false;
  if (!conclusion && planIsApproved(plan)) return false;
  if (conclusion) {
    const outline=inheritedConclusionField(plan,'outline',conclusion);
    if(outline){
      for(const proposed of outline){
        const section=plan.draft.sections.find(s=>s.id===proposed.id);
        if(!section){plan.draft.sections.push(structuredClone(proposed));continue;}
        for(const line of proposed.lines){const old=section.lines.find(l=>l.id===line.id);if(!old)section.lines.push({...line});else if(!old.userEdited)Object.assign(old,line);}
      }
    }
    const previousLines = plan.draft.sections.flatMap(section => section.lines);
    const normalized = new Set(previousLines.filter(line => line.state === 'fixed' || line.userEdited).map(line => line.text.trim()));
    // A round summary describes the discussion, including temporary phase notes.
    // It remains in conclusion history; approving direction must not turn it into
    // an immutable user constraint for all later execution tasks.
    const content = conclusionProposals(conclusion).filter(text => text.trim());
    let section = plan.draft.sections.find(s => s.id === 's-direction');
    content.forEach((text, i) => {
      const pending = previousLines.find(line => !line.userEdited && line.state !== 'fixed' && (line.text.trim() === text.trim() || line.text.trim() === 'Agent 提议，待用户确认：' + text.trim()));
      if (pending) { pending.text = text; pending.state = 'fixed'; pending.userEdited = true; normalized.add(text.trim()); }
      if (!normalized.has(text.trim())) {
        if (!section) plan.draft.sections.push(section = { id: 's-direction', title: '已确认方向', kind: 'key', lines: [] });
        section.lines.push({ id: `${conclusion.id}-direction-${i}`, text, state: 'fixed', userEdited: true }); normalized.add(text.trim());
      }
    });
    // Unknown questions are retained as open; approval is never an invented answer.
    plan.draftVersion++;
    conclusion.adopted = true; conclusion.adoptedAt = snapshot.now; conclusion.adoptedDraftVersion = plan.draftVersion;
  }
  plan.adopted = { version: (plan.adopted?.version ?? 0) + 1, doc: structuredClone(plan.draft), at: snapshot.now, draftVersion: plan.draftVersion, conclusionIds: [...new Set([...(plan.adopted?.conclusionIds ?? []), ...(conclusion ? [conclusion.id] : [])])] };
  return true;
}

/** Derive phase from existing plan/task ledger only; never persist another workflow state. */
export function projectWorkflow(snapshot: Snapshot, taskId: string) {
  const plan = Object.values(snapshot.ideaPlans ?? {}).find(p => p.taskId === taskId && !p.itemId);
  const tasks = Object.values(snapshot.collaboration?.tasks ?? {}).filter(t => t.taskId === taskId && t.workItemId && !t.archived);
  const completed = tasks.filter(t => t.status === 'done').length;
  const phase = snapshot.tasks[taskId]?.completion ? 'complete' : tasks.length ? tasks.every(t => ['done', 'cancelled'].includes(t.status)) ? 'integrate' : 'execute' : plan && planIsApproved(plan) ? canExecutePlanTaskDirectly(snapshot,plan) ? 'execute' : 'decompose' : plan ? 'direction' : 'execute';
  return { phase, planId: plan?.id, approved: !!plan && planIsApproved(plan), taskCount: tasks.length, completed };
}

/** Synthetic planning executions remain auditable in the ledger, not business task totals. */
export function isBusinessTask(snapshot: Snapshot, taskId: string): boolean {
  if (taskId.startsWith('planning:')) return false;
  const sessions = Object.values(snapshot.sessions).filter(s => s.runtime?.taskId === taskId);
  return !sessions.length || !sessions.every(s => s.runtime?.purpose === 'discussion' && s.runtime.planId && snapshot.ideaPlans?.[s.runtime.planId]?.taskId !== taskId);
}

/** Materialize the approved graph once. Project directions have no synthetic business root. */
export function materializeGoalPlan(snapshot: Snapshot, plan: IdeaPlan): number {
  const c=ensureCollaboration(snapshot),versions=(c.goalPlans??={})[plan.id]??=[];
  if(versions.some(v=>v.draftVersion===plan.draftVersion))return 0;
  const previous=versions.at(-1),existingTaskKeys=new Set(Object.keys(c.tasks));
  const drafts=plan.drafts.filter(t=>t.include||previous?.tasks.some(b=>b.draftKey===t.key)||plan.scope!=='project'&&Object.values(snapshot.orchestrations?.[plan.taskId]?.items??{}).some(w=>w.draftKey===t.key));
  if(!drafts.length){if(!retainMaterializedGoalPlan(snapshot,plan)&&isDirectTaskPlan(previous,plan))materializeDirectTaskPlan(snapshot,plan);return 0;}
  const version=(versions.at(-1)?.version??0)+1;
  const bindings:GoalTaskBinding[]=[];
  if(plan.scope==='project'){
    const byKey=new Map(drafts.map(t=>[t.key,t]));
    const rootOf=(key:string):string=>{const x=byKey.get(key);if(!x)throw Error('任务依赖不在本次方向中');return x.parentKey?rootOf(x.parentKey):key;};
    const rootIds=new Map(drafts.filter(t=>!t.parentKey).map(t=>[t.key,previous?.tasks.find(b=>b.draftKey===t.key&&!b.workItemId)?.taskId??`goal-${hashText(`${plan.id}:${version}:${t.key}`).slice(0,20)}`]));
    snapshot.orchestrations??={};
    for(const draft of drafts){
      const taskId=rootIds.get(rootOf(draft.key))!,workItemId=draft.parentKey?`goal-item-${hashText(draft.key).slice(0,20)}`:undefined;
      bindings.push({key:taskKey(taskId,workItemId),taskId,workItemId,draftKey:draft.key,specRevision:1});
      if(!workItemId&&snapshot.tasks[taskId]){snapshot.tasks[taskId].title=draft.title;}else if(!workItemId){
        snapshot.tasks[taskId]={id:taskId,title:draft.title,createdAt:new Date().toISOString(),owner:draft.owner==='unassigned'?undefined:draft.owner,sessionIds:[],completion:null,manualLock:true};
        snapshot.journal.blocks.push({id:`block-${taskId}`,kind:'task',taskId});
        snapshot.orchestrations[taskId]={taskId,label:draft.title,startedAt:snapshot.now,syncedAt:snapshot.now,coordinationTokens:null,phases:[],executors:{},items:{},itemOrder:[],attempts:{},capabilities:{subAgents:true,steps:true,tokens:false,permissionEvents:true}};
      }else{
        const o=snapshot.orchestrations[taskId],parent=bindings.find(b=>b.draftKey===draft.parentKey);
        if(!parent)throw Error('任务树父节点不存在');
        const existing=o.items[workItemId];
        if(existing){Object.assign(existing,{title:draft.title,expected:draft.expected,parentTaskId:parent.workItemId??taskId});continue;}
        o.items[workItemId]={id:workItemId,rootTaskId:taskId,parentTaskId:parent.workItemId??taskId,title:draft.title,phase:draft.phase,owner:draft.owner,expected:draft.expected,dependsOnTaskIds:[],status:'not_started',attemptIds:[],source:{planId:plan.id,version,lineIds:draft.lineIds},draftKey:draft.key};o.itemOrder.push(workItemId);if(!o.phases.includes(draft.phase))o.phases.push(draft.phase);
      }
    }
  }else{
    addDraftsIn(snapshot,plan.id);
    for(const draft of drafts){const item=Object.values(snapshot.orchestrations?.[plan.taskId]?.items??{}).find(w=>w.draftKey===draft.key);if(item)bindings.push({key:taskKey(plan.taskId,item.id),taskId:plan.taskId,workItemId:item.id,draftKey:draft.key,specRevision:1});}
  }
  ensureCollaboration(snapshot);
  for(const binding of bindings){
    const draft=drafts.find(d=>d.key===binding.draftKey)!,task=c.tasks[binding.key];
    if(binding.workItemId)Object.assign(snapshot.orchestrations![binding.taskId].items[binding.workItemId],{title:draft.title,expected:draft.expected});
    const parent=bindings.find(b=>b.draftKey===draft.parentKey);binding.parentKey=parent?.key??(plan.itemId?taskKey(plan.taskId,plan.itemId):undefined);binding.specRevision=task.specRevision;
    const required=[...draft.deps,...drafts.filter(d=>d.parentKey===draft.key).map(d=>d.key)];
    task.dependencies=[...new Set(required.map(key=>{const dep=bindings.find(b=>b.draftKey===key);if(!dep)throw Error('依赖任务未被采用');return dep.key;}))];
    const spec=c.specs.find(s=>s.key===binding.key&&s.revision===task.specRevision)!;
    if(existingTaskKeys.has(binding.key)){
      if(spec.goal!==draft.expected){task.specRevision++;task.version++;task.status='ready';c.specs.push({...spec,id:`goal-spec-${hashText(`${plan.id}:${version}:${binding.key}`).slice(0,24)}`,revision:task.specRevision,goal:draft.expected,criteria:[draft.expected],at:new Date().toISOString(),reason:'采用新的任务交付要求'});}
    }else{spec.goal=draft.expected;spec.criteria=[draft.expected];}
    binding.specRevision=task.specRevision;
    if(binding.workItemId)snapshot.orchestrations![binding.taskId].items[binding.workItemId].dependsOnTaskIds=task.dependencies.flatMap(key=>{const dep=bindings.find(b=>b.key===key);return dep?.taskId===binding.taskId&&dep.workItemId?[dep.workItemId]:[];});
  }
  const explicit=inheritedConclusionField(plan,'deliverables');
  const slotDrafts:import("./goalDelivery").DeliverySlotDraft[]=explicit!==undefined?explicit:drafts.filter(d=>!d.parentKey).map(d=>({id:hashText(d.key).slice(0,20),title:d.title,taskKey:d.key,description:d.expected}));
  const slots=slotDrafts.map(slot=>{
    const binding=bindings.find(b=>b.draftKey===slot.taskKey||b.draftKey===`plan-${plan.id}-${slot.taskKey}`);if(!binding)throw Error('交付槽引用了未采用的任务');
    return {...slot,id:`slot-${hashText(`${plan.id}:${version}:${slot.id}`).slice(0,24)}`,parentId:slot.parentId?`slot-${hashText(`${plan.id}:${version}:${slot.parentId}`).slice(0,24)}`:undefined,planId:plan.id,taskKey:binding.key,taskId:binding.taskId,workItemId:binding.workItemId};
  });
  for(const old of previous?.tasks??[]){if(bindings.some(b=>b.key===old.key)||isDirectTaskPlan(previous,plan)&&old.key===taskKey(plan.taskId,plan.itemId))continue;const task=c.tasks[old.key];if(task){task.status='cancelled';task.version++;task.archived=true;}if(old.workItemId&&snapshot.orchestrations?.[old.taskId]?.items[old.workItemId])snapshot.orchestrations[old.taskId].items[old.workItemId].status='cancelled';}
  versions.push({id:plan.id,title:plan.title,scope:plan.scope??'task',taskId:plan.taskId,version,draftVersion:plan.draftVersion,at:new Date().toISOString(),tasks:bindings,slots});
  for(const draft of drafts)draft.include=false;
  c.events.push({id:`goal-plan:${plan.id}:${version}`,sequence:++c.sequence,type:'goal_plan_materialized',actor:'human',at:new Date().toISOString(),detail:JSON.stringify({planId:plan.id,version,taskKeys:bindings.map(b=>b.key),slotIds:slots.map(s=>s.id)})});
  return bindings.filter(b=>!previous?.tasks.some(old=>old.key===b.key)).length;
}

/** Repair the v0.11 delta-reply loss without rewriting an immutable plan or rebinding results. */
export function repairInheritedDeliverySlots(snapshot:Snapshot):number {
  const c=snapshot.collaboration;if(!c)return 0;let repaired=0;
  for(const [planId,versions]of Object.entries(c.goalPlans??{})){
    const previous=versions.at(-1),plan=snapshot.ideaPlans?.[planId];
    if(!previous||!plan||!planIsApproved(plan)||previous.draftVersion!==plan.draftVersion)continue;
    const latest=[...(plan.discussion?.conclusions??[])].reverse().find(x=>x.scopeId==='root'&&x.tasks!==undefined);
    if(!latest||latest.deliverables!==undefined)continue;
    const declared=inheritedConclusionField(plan,'deliverables',latest);
    if(!declared?.length||previous.tasks.some(b=>c.tasks[b.key]?.latestSubmissionId||c.tasks[b.key]?.specRevision!==b.specRevision))continue;
    const fallback=previous.tasks.filter(b=>!b.parentKey).map(b=>`slot-${hashText(`${planId}:${previous.version}:${hashText(b.draftKey).slice(0,20)}`).slice(0,24)}`);
    if(previous.slots.length!==fallback.length||previous.slots.some(slot=>!fallback.includes(slot.id)))continue;
    const binding=(key:string)=>previous.tasks.find(b=>b.draftKey===key||b.draftKey===`plan-${planId}-${key}`);
    if(declared.some(slot=>!binding(slot.taskKey)))continue;
    const version=previous.version+1;
    const slots=declared.map(slot=>{const target=binding(slot.taskKey)!;return {...slot,id:`slot-${hashText(`${planId}:${version}:${slot.id}`).slice(0,24)}`,parentId:slot.parentId?`slot-${hashText(`${planId}:${version}:${slot.parentId}`).slice(0,24)}`:undefined,planId,taskKey:target.key,taskId:target.taskId,workItemId:target.workItemId};});
    versions.push({...structuredClone(previous),version,at:new Date().toISOString(),slots});
    const automation=c.goalAutomation?.[planId];if(automation?.planVersion===previous.version&&automation.draftVersion===plan.draftVersion)automation.planVersion=version;
    c.events.push({id:`goal-slot-repair:${planId}:${version}`,sequence:++c.sequence,type:'goal_delivery_structure_recovered',actor:'service',at:new Date().toISOString(),detail:JSON.stringify({planId,previousVersion:previous.version,version,sourceConclusionId:latest.id,slotIds:slots.map(s=>s.id)})});repaired++;
  }
  return repaired;
}
