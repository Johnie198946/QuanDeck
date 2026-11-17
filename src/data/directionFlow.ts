import type { IdeaPlan, Snapshot } from './types';
import { taskKey } from './collaboration';
import { FLOW_LIMITS, readFlowDiagram, type FlowDiagram } from './flowDiagram';

export interface DirectionFlow { graph?: FlowDiagram; notice?: string; targets: Record<string, { taskId: string; itemId?: string; state: string }> }
const states = { draft: '待细化', ready: '可开始', running: '执行中', blocked: '等待条件', paused: '已暂停', in_review: '候选待验收', done: '已验收', failed: '执行失败', cancelled: '已取消' };

/** Derive only known identities and dependency/parent facts. Never infer edges from prose. */
export function directionFlowInput(snapshot: Snapshot, plan: IdeaPlan) {
  const all = Object.values(snapshot.collaboration?.tasks ?? {}).filter(t => !t.archived && !t.key.startsWith('planning:') && !!snapshot.tasks[t.taskId] && (!t.workItemId || !!snapshot.orchestrations?.[t.taskId]?.items[t.workItemId]));
  const selected = new Set<string>();
  if (plan.scope === 'project') all.forEach(t => selected.add(t.key));
  else {
    const root = taskKey(plan.taskId, plan.itemId);
    selected.add(root);
    const isDescendant = (itemId: string) => {
      if (!plan.itemId) return true;
      const seen = new Set<string>(); let current: string | undefined = itemId;
      while (current && !seen.has(current)) { if (current === plan.itemId) return true; seen.add(current); current = snapshot.orchestrations?.[plan.taskId]?.items[current]?.parentTaskId; }
      return false;
    };
    all.filter(t => t.taskId === plan.taskId && t.workItemId && isDescendant(t.workItemId)).forEach(t => selected.add(t.key));
  }
  // Include immediate upstream boundary tasks so no visible dependency silently vanishes.
  const sources = all.filter(t => selected.has(t.key));
  sources.forEach(t => t.dependencies.forEach(key => selected.add(key)));
  const tasks = all.filter(t => selected.has(t.key));
  const allKeys = new Set(all.map(t => t.key));
  const missing = sources.some(t => t.dependencies.some(key => !allKeys.has(key)));
  // Oversized projections keep only the count; do not serialize thousands of tasks on refresh.
  const bounded = tasks.length > FLOW_LIMITS.nodes ? [] : tasks.sort((a, b) => a.key.localeCompare(b.key));
  return { tasks: bounded.map(t => ({ key: t.key, taskId: t.taskId, itemId: t.workItemId, title: t.title, state: t.requiresRevalidation ? '需重新核对' : states[t.status], dependencies: t.dependencies, parentId: t.workItemId ? snapshot.orchestrations?.[t.taskId]?.items[t.workItemId]?.parentTaskId : undefined })), missing, total: tasks.length };
}

export function buildDirectionFlow(input: Omit<ReturnType<typeof directionFlowInput>, 'total'> & { total?: number }): DirectionFlow {
  const targets: DirectionFlow['targets'] = {};
  const total = input.total ?? input.tasks.length;
  if (total > FLOW_LIMITS.nodes) return { targets, notice: `当前包含 ${total} 项任务，请进入单个任务查看局部流程（每图最多 ${FLOW_LIMITS.nodes} 项）。` };
  if (!input.tasks.length) return { targets, notice: '尚无已登记任务。确认任务拆分后，流程会自动绘制在这里。' };
  const ids = new Map(input.tasks.map((t, i) => [t.key, `task-${i + 1}`]));
  const edges: { from: string; to: string; label: string }[] = [];
  for (const t of input.tasks) {
    const id = ids.get(t.key)!;
    targets[id] = { taskId: t.taskId, ...(t.itemId ? { itemId: t.itemId } : {}), state: t.state };
    t.dependencies.forEach(key => { if (ids.has(key)) edges.push({ from: ids.get(key)!, to: id, label: '依赖' }); });
    if (t.itemId) {
      const parent = t.parentId && t.parentId !== t.taskId ? taskKey(t.taskId, t.parentId) : taskKey(t.taskId);
      if (ids.has(parent) && !edges.some(e => e.from === id && e.to === ids.get(parent))) edges.push({ from: id, to: ids.get(parent)!, label: '汇总' });
    }
  }
  // One explicit dependency also represents a child-to-parent merge; keep one edge per pair.
  const unique = [...new Map(edges.map(e => [`${e.from}:${e.to}`, e])).values()];
  if (unique.length > FLOW_LIMITS.edges) return { targets, notice: '依赖关系较多，请进入单个任务查看局部流程。' };
  const title = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() || '未命名任务';
  const graph = readFlowDiagram({ version: 1, nodes: input.tasks.map(t => ({ id: ids.get(t.key)!, label: Array.from(title(t.title)).slice(0, 96).join(''), kind: 'step', detail: Array.from(title(t.title)).slice(0, 600).join('') })), edges: unique });
  return { graph, targets, ...(input.missing ? { notice: '部分前置任务已归档或不可见，未绘制其连线；请在任务详情核对。' } : {}) };
}
