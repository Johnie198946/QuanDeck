import type { IdeaPlan, Snapshot, TaskDraft } from './types';

/** Scope and requirements are projections of existing task/spec facts, not new plan truth. */
export function discussionScope(snapshot: Snapshot, plan: IdeaPlan, scope = 'root') {
  const kind = scope !== 'root' ? 'section' : plan.scope === 'project' ? 'project' : plan.itemId ? 'subtask' : 'task';
  const key = plan.itemId ? `${plan.taskId}::${plan.itemId}` : plan.taskId;
  const task = snapshot.collaboration?.tasks[key];
  const spec = snapshot.collaboration?.specs.find(value => value.key === key && value.revision === task?.specRevision);
  const item = plan.itemId ? snapshot.orchestrations?.[plan.taskId]?.items[plan.itemId] : undefined;
  const section = scope === 'root' ? undefined : plan.draft.sections.find(value => value.id === scope);
  const goal = plan.scope === 'project' ? snapshot.project.description || plan.title : spec?.goal || item?.expected || task?.title || snapshot.tasks[plan.taskId]?.title || plan.title;
  const criteria = spec?.criteria ?? (item?.expected ? [item.expected] : []);
  const children = Object.values(snapshot.orchestrations?.[plan.taskId]?.items ?? {}).filter(value => value.parentTaskId === (plan.itemId ?? plan.taskId) && value.status !== 'cancelled');
  return { kind, key, goal, criteria, specRevision: spec?.revision, section, children };
}

/** Short requests for a proposal refer to the open section or task. An explicit
 * question can switch topics without dragging the original goal into retrieval. */
export function discussionLessonTopic(scope: ReturnType<typeof discussionScope>, question?: string) {
  const text = question?.trim() ?? '';
  const asksForPlan = /^(?:请问)?(?:你的?|AI的)?(?:有什么|有哪些)?(?:方案|建议|想法)(?:是什么|有哪些|呢|如何)?[？?。！!]*$/iu;
  if (text && !asksForPlan.test(text)) return text;
  if (scope.section?.lines.some(line => line.text.trim())) {
    return [scope.section.title, ...scope.section.lines.map(line => line.text)].join(' ');
  }
  return scope.kind === 'project' || scope.section ? scope.goal : undefined;
}

export function discussionScopeBrief(snapshot: Snapshot, plan: IdeaPlan, scope: string) {
  const value = discussionScope(snapshot, plan, scope);
  return [
    `本次范围类型：${({ project: '项目方向', task: '任务方向', subtask: '子任务方向', section: '所选章节' })[value.kind]}。${value.section ? `仅限「${value.section.title}」。` : ''}`,
    `当前任务目标${value.specRevision ? `（台帐要求 v${value.specRevision}）` : ''}：${value.goal}`,
    value.criteria.length ? '当前验收标准：\n' + value.criteria.map(text => `- ${text}`).join('\n') : '',
    value.kind === 'project' ? '围绕整个项目确定方向与独立业务任务。' : '项目与上级内容仅作约束背景；本次只细化当前范围，不重建项目、祖先任务或兄弟任务。无需为了形式再次拆分已经具体的子任务。',
    value.children.length ? '当前已有下级任务（沿用这些分工，不重复创建）：\n' + value.children.map(child => `- ${child.title}：${child.expected ?? ''}`).join('\n') : '',
    '已有明确目标和验收标准时直接给出本范围的执行方法、大纲和内容，只询问真正阻塞的缺失条件，不强制多轮澄清。',
  ].filter(Boolean).join('\n\n');
}

export function scopedBreakdownInstructions(snapshot: Snapshot, plan: IdeaPlan, scope: string, projectInstructions: string) {
  const value = discussionScope(snapshot, plan, scope);
  if (value.kind === 'project') return projectInstructions + '\n省略 tasks 表示沿用前轮拆分；tasks:[] 明确撤回未生成的拆分草稿，不删除已有台帐任务。';
  return [
    discussionScopeBrief(snapshot, plan, scope),
    '提供 outline:[{id,title,kind:"body",lines:[{id,text,state:"tentative"}]}] 保存当前范围可读的大纲、执行方法和内容；不要只返回任务标题。',
    value.kind === 'section' ? '这是局部章节讨论，不创建任务或改写其他章节：省略 tasks 和 deliverables；如要撤回本范围之前的拆分草稿，使用 tasks:[]。' : '当前工作可直接完成时，省略 tasks 和 deliverables；无需再拆。只有确实存在独立可验收的下级工作才提供 tasks，每项只能属于当前任务内部；不得返回当前任务自身、祖先、兄弟或整个项目的任务清单。',
    '必要的下级 tasks 格式为 [{key,title,expected,owner:"agent",phase:"执行",deps:[],parentKey?}]；parentKey/deps 只引用本次新增子图的 key，无循环。不得将当前工作包装为新的总项目。deliverables 只能引用该子图，不能重复其他项目章节。',
    '省略 tasks/outline/deliverables 表示本轮未修改该字段；tasks:[] 只撤回该范围尚未生成的拆分草稿，不删除已进入台帐的任务。已确认目标无需再次确认；只说明新差异和真正的阻塞。',
  ].join('\n');
}

/** Backfill only missing inherited fields; never overwrite user content or an adopted direction. */
export function seedTaskDirection(snapshot: Snapshot, plan: IdeaPlan): boolean {
  if (plan.scope === 'project' || plan.adopted || plan.demo) return false;
  const value = discussionScope(snapshot, plan);
  if (!snapshot.tasks[plan.taskId]) return false;
  let changed = false;
  let goal = plan.draft.sections.find(section => section.id === 's-goal');
  if (!goal) { goal = { id: 's-goal', title: '目标', kind: 'key', lines: [] }; plan.draft.sections.unshift(goal); }
  if (!goal.lines.length) { goal.lines.push({ id: `${plan.id}-task-goal`, text: value.goal, state: 'fixed' }); changed = true; }
  if (value.criteria.length && !plan.draft.sections.some(section => section.id === 's-acceptance')) {
    plan.draft.sections.splice(1, 0, { id: 's-acceptance', title: '验收标准', kind: 'key', lines: value.criteria.map((text, index) => ({ id: `${plan.id}-criterion-${index}`, text, state: 'fixed' })) }); changed = true;
  }
  return changed;
}

/** Reject exact cross-scope task identities; do not infer scope from free-form prose. */
export function scopedBreakdownIssue(snapshot: Snapshot, plan: IdeaPlan, scope: string, tasks?: TaskDraft[]): string | undefined {
  if (!tasks?.length || plan.scope === 'project' && scope === 'root') return;
  if (scope !== 'root') return '章节讨论只修改当前正文；未采用其中的任务拆分，请回到所属任务方向安排工作。';
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').trim();
  const forbidden = new Set(Object.values(snapshot.tasks).filter(task => !task.id.startsWith('planning:')).map(task => normalize(task.title)));
  const items = snapshot.orchestrations?.[plan.taskId]?.items ?? {};
  const descendants = new Set<string>([plan.itemId ?? plan.taskId]);
  let changed = true;
  while (changed) { changed = false; for (const item of Object.values(items)) if (descendants.has(item.parentTaskId) && !descendants.has(item.id)) { descendants.add(item.id); changed = true; } }
  for (const item of Object.values(items)) {
    if (!descendants.has(item.id) || item.id === plan.itemId) forbidden.add(normalize(item.title));
  }
  const repeated = tasks.filter(task => forbidden.has(normalize(task.title)));
  return repeated.length ? `未采用越界拆分：${repeated.map(task => task.title).join('、')}。只细化当前范围，不重建已存在的项目、祖先或兄弟任务。` : undefined;
}
