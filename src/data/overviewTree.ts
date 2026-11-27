import { deriveProjectActivity, needsAttention } from './projectActivity';
import { workItemPresentation } from './workItemPresentation';
import { taskExecutionPresentation } from './taskExecutionPresentation';
import { dashboardOverview, OVERVIEW_LABELS, type OverviewBucket } from './dashboard';
import { latestAttempt, whoLabel } from './orchestration';
import { taskMapItems } from './taskMap';
import { executionProgress, sessionProgress, type ExecutionProgress } from './executionProgress';
import { projectWorkflow } from './projectWorkflow';
import type { Snapshot, WorkItem } from './types';

export type OverviewFilter = 'all' | 'running' | 'attention' | 'done';
export interface OverviewNode {
  key: string;
  kind: 'project' | 'task' | 'work';
  projectId: string;
  taskId?: string;
  itemId?: string;
  title: string;
  description?: string;
  detail?: string;
  state: string;
  bucket: OverviewBucket;
  phase?: string;
  owner?: string;
  agentId?: string;
  progress?: { done: number; total: number; label: string };
  execution?: ExecutionProgress | null;
  detached?: boolean;
  awaitingReview?: boolean;
  children: OverviewNode[];
}
export const overviewNodeKey = (projectId: string, taskId?: string, itemId?: string) => JSON.stringify([projectId, taskId ?? null, itemId ?? null]);
const PHASES: Record<string, string> = { direction: '讨论方向', decompose: '拆分任务', execute: '任务执行', integrate: '汇总成果', complete: '已完成' };
const workBucket = (status: WorkItem['status']): OverviewBucket => status === 'done' ? 'done' : status === 'cancelled' ? 'cancelled' :
  ['waiting_reply', 'waiting_permission', 'failed', 'review'].includes(status) ? 'attention' : status === 'running' ? 'running' : 'pending';

/** A read-only view of the shared snapshot. No completion, owner or task is stored here. */
export function overviewProject(snapshot: Snapshot): OverviewNode {
  const projectId = snapshot.project.id;
  const { rows } = dashboardOverview(snapshot);
  const activity = deriveProjectActivity(snapshot).entries;
  const children = rows.map(row => {
    const task = row.task;
    const orchestration = snapshot.orchestrations?.[task.id];
    const items = orchestration ? taskMapItems(orchestration) : [];
    const seen = new Set<string>();
    const direct = (parentId: string) => items.filter(item => item.parentTaskId === parentId && item.id !== parentId);
    const progress = (parentId: string) => {
      const list = direct(parentId);
      return list.length ? { done: list.filter(item => item.status === 'done').length, total: list.length, label: '直属子任务' } : undefined;
    };
    const build = (item: WorkItem, detached = false): OverviewNode => {
      seen.add(item.id);
      const display = workItemPresentation(snapshot, orchestration!, item, activity);
      const attempt = latestAttempt(orchestration!, item);
      const session = attempt?.sessionId ? snapshot.sessions[attempt.sessionId] : undefined;
      const agentId = (attempt && orchestration!.executors[attempt.executorId]?.agentId) || (item.executorId && orchestration!.executors[item.executorId]?.agentId) || undefined;
      const execution = display.delivery ? null : display.progress ?? (item.status === 'done' || item.status === 'cancelled' ? null : session ? sessionProgress(session) : attempt ? executionProgress(
        item.status === 'running' ? 'running' : item.status === 'queued' ? 'queued' : item.status === 'waiting_reply' ? 'waiting_reply' :
          item.status === 'waiting_permission' ? 'waiting_permission' : item.status === 'failed' ? 'failed' : 'paused', attempt.step,
      ) : null);
      return { key: overviewNodeKey(projectId, task.id, item.id), kind: 'work', projectId, taskId: task.id, itemId: item.id,
        title: item.title, description: item.expected, detail: display.detail || item.reviewNote,
        state: display.label, bucket: display.awaitingCompletion ? 'attention' : workBucket(display.state), phase: item.phase, awaitingReview: !!display.delivery && !display.delivery.accepted,
        owner: whoLabel(orchestration!, item, id => snapshot.agents.find(agent => agent.id === id)?.name), agentId, execution, progress: progress(item.id), detached,
        children: direct(item.id).filter(child => !seen.has(child.id)).map(child => build(child)),
      };
    };
    const nested = direct(task.id).filter(item => !seen.has(item.id)).map(item => build(item));
    // Keep malformed imported history reachable, without claiming a valid parent relation.
    for (const item of items) if (!seen.has(item.id)) nested.push(build(item, true));
    const workflow = projectWorkflow(snapshot, task.id);
    const executionView = taskExecutionPresentation(snapshot, task.id);
    const attention = executionView.attention;
    const pending = activity.find(entry => entry.taskId === task.id && needsAttention(entry));
    const current = pending ? executionView.rows.find(value => value.entry?.id === pending.id) : executionView.rows.find(value => value.sessionId === executionView.primarySession?.id);
    const currentAgentId = current?.agentId ?? row.session?.agentId;
    const incomplete = orchestration ? Object.values(orchestration.items).filter(item=>workItemPresentation(snapshot,orchestration,item,activity).awaitingCompletion).length : 0;
    const reviewCount = executionView.deliveries.filter(delivery => !delivery.accepted).length;
    const awaitingReview = reviewCount > 0 && !executionView.rows.length && !incomplete;
    const bucket = attention.length || incomplete || awaitingReview ? 'attention' : row.bucket;
    return { key: overviewNodeKey(projectId, task.id), kind: 'task' as const, projectId, taskId: task.id,
      title: task.title, description: task.originalTitle || undefined, state: attention.length ? attention.map(item => item.label).join(" · ") + (incomplete ? ` · ${incomplete} 项待补齐` : "") : incomplete ? `${incomplete} 项待补齐` : awaitingReview ? `${reviewCount} 项待验收` : OVERVIEW_LABELS[row.bucket], bucket, awaitingReview,
      phase: PHASES[workflow.phase], detail: pending?.detail ?? (awaitingReview ? '完整候选成果已保存，等待验收。' : row.waiting ? row.question : undefined),
      owner: currentAgentId ? snapshot.agents.find(agent => agent.id === currentAgentId)?.name : task.owner === 'me' ? '我' : task.owner === 'agent' ? 'Agent · 待委派' : undefined,
      agentId: currentAgentId, progress: progress(task.id), execution: current?.progress ?? (executionView.hasChildActivity || executionView.deliveries.length ? null : row.status !== 'done' && row.status !== 'cancelled' && row.session ? sessionProgress(row.session) : null), children: nested,
    };
  });
  const bucket: OverviewBucket = children.some(node => node.bucket === 'attention') ? 'attention' : children.some(node => node.bucket === 'running') ? 'running' : children.length && children.every(node => node.bucket === 'done') ? 'done' : 'pending';
  return { key: overviewNodeKey(projectId), kind: 'project', projectId, title: snapshot.project.name,
    description: snapshot.project.description, state: children.length ? OVERVIEW_LABELS[bucket] : '待开始', bucket,
    progress: children.length ? { done: children.filter(node => node.bucket === "done").length, total: children.length, label: '主任务' } : undefined, children };
}

export function overviewForest(snapshots: Snapshot[]) {
  const unique = new Map(snapshots.filter(snapshot => snapshot.project.id).map(snapshot => [snapshot.project.id, snapshot]));
  return [...unique.values()].map(overviewProject);
}

/** Match descendants while retaining the project and task path; progress keeps its full scope. */
export function filterOverview(nodes: OverviewNode[], query: string, filter: OverviewFilter): OverviewNode[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visit = (node: OverviewNode, inheritedMatch = false): OverviewNode | null => {
    const haystack = `${node.title} ${node.description ?? ''}`.toLocaleLowerCase();
    const textMatch = inheritedMatch || words.every(word => haystack.includes(word));
    const matches = textMatch && (filter === 'all' || node.bucket === filter);
    const children = node.children.map(child => visit(child, words.length > 0 && textMatch)).filter((child): child is OverviewNode => child !== null);
    return matches || children.length ? { ...node, children } : null;
  };
  return nodes.map(node => visit(node)).filter((node): node is OverviewNode => node !== null);
}
export function flattenOverview<T extends {children: T[]}>(nodes: T[]): T[] {
  return nodes.flatMap(node => [node, ...flattenOverview(node.children)]);
}

/** Renderer-only selector for immutable snapshot references. Keep this scoped to
 * a mounted view; domain commands mutate drafts and must call overviewProject directly. */
export function createOverviewForestSelector() {
  const cache = new WeakMap<Snapshot, OverviewNode>();
  return (snapshots: Snapshot[]) => {
    const unique = new Map(snapshots.filter(snapshot => snapshot.project.id).map(snapshot => [snapshot.project.id, snapshot]));
    return [...unique.values()].map(snapshot => {
      let node = cache.get(snapshot);
      if (!node) { node = overviewProject(snapshot); cache.set(snapshot, node); }
      return node;
    });
  };
}
