import type { DiscussionConclusion, IdeaPlan, Snapshot, TaskDraft } from './types';

/** Candidate task graphs are data, not commands. Validate the entire graph before adoption. */
export function readPlanTasks(value: unknown): TaskDraft[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('任务拆解需要 1–100 项任务');
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

/** Approval has one persisted source: adopted plan + human decisions in the ledger bridge. */
export function approveDirection(snapshot: Snapshot, plan: IdeaPlan, conclusion?: DiscussionConclusion) {
  if (conclusion?.adopted && planIsApproved(plan)) return false;
  if (!conclusion && planIsApproved(plan)) return false;
  if (conclusion) {
    const previousLines = plan.draft.sections.flatMap(section => section.lines);
    const normalized = new Set(previousLines.map(line => line.text.trim()));
    const content = [conclusion.summary, ...conclusionProposals(conclusion)].filter(text => text.trim());
    let section = plan.draft.sections.find(s => s.id === 's-direction');
    if (!section) plan.draft.sections.push(section = { id: 's-direction', title: '已确认方向', kind: 'key', lines: [] });
    content.forEach((text, i) => {
      if (!normalized.has(text.trim())) { section!.lines.push({ id: `${conclusion.id}-direction-${i}`, text, state: 'fixed', userEdited: true }); normalized.add(text.trim()); }
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
  const phase = snapshot.tasks[taskId]?.completion ? 'complete' : tasks.length ? tasks.every(t => ['done', 'cancelled'].includes(t.status)) ? 'integrate' : 'execute' : plan && planIsApproved(plan) ? 'decompose' : plan ? 'direction' : 'execute';
  return { phase, planId: plan?.id, approved: !!plan && planIsApproved(plan), taskCount: tasks.length, completed };
}

/** Synthetic planning executions remain auditable in the ledger, not business task totals. */
export function isBusinessTask(snapshot: Snapshot, taskId: string): boolean {
  if (taskId.startsWith('planning:')) return false;
  const sessions = Object.values(snapshot.sessions).filter(s => s.runtime?.taskId === taskId);
  return !sessions.length || !sessions.every(s => s.runtime?.purpose === 'discussion' && s.runtime.planId && snapshot.ideaPlans?.[s.runtime.planId]?.taskId !== taskId);
}
