import type { Snapshot } from './types';
import { deriveLedger, taskDependencyReady, type LedgerRow } from './collaboration';
import { hashText, stableContent } from './contentHash';
import { currentProjectSpec, projectSpecPin } from './specLineage';
import { pinTaskHandoff, type HandoffContent } from './taskHandoff';
import { isGeneratedDiscussionSummary, isGeneratedDiscussionSummaryDecision } from './discussionAuthority';
import { specAttachmentContext } from './specAttachments';
import { leafTaskRows } from './taskMap';

const statusLabels: Record<string, string> = { draft: '待细化', ready: '可开始', running: '进行中', blocked: '阻塞', paused: '已暂停', in_review: '待验收', done: '已完成', failed: '需处理', cancelled: '已取消' };
const list = (items: string[]) => items.length ? items.map(item => '- ' + item).join('\n') : '尚无记录';

/** Workflow guidance is derived from current facts, never recorded as an Agent's handoff. */
function stateNextSteps(snapshot: Snapshot, row: LedgerRow, stale: boolean): string[] {
  if (stale) return ['先核对已变化的要求或前置成果，更新交付后重新验收。'];
  if (row.legacyCompletion) return ['该完成状态来自历史导入；先补齐可核对的成果与验收记录。'];
  if (row.status === 'in_review') return ['按本任务验收条件核对已提交候选，并记录验收结果。'];
  if (row.status === 'blocked') {
    if (row.blockReason) return ['先处理已记录的阻塞：' + row.blockReason];
    const waiting = row.dependencies.filter(key => !taskDependencyReady(snapshot, row.key, key));
    return [waiting.length ? '等待前置任务满足交付条件：' + waiting.map(key => snapshot.collaboration?.tasks[key]?.title ?? key).join('、') : '先核对并解除当前任务的阻塞条件。'];
  }
  if (row.status === 'ready') return ['按已确认的职责与验收条件推进，完成后提交候选成果。'];
  if (row.status === 'running') return ['等待当前执行提交进展或候选成果，再按验收条件核对。'];
  if (row.status === 'paused') return ['任务当前暂停；确认继续后恢复本任务。'];
  if (row.status === 'failed') return ['先核对本任务失败原因，再安排继续。'];
  if (row.status === 'done') return ['本任务已记录完成，按后续依赖交接；没有新的执行要求。'];
  if (row.status === 'cancelled') return ['本任务已取消，不安排继续执行。'];
  return ['先核对本任务职责与验收条件，再确定执行安排。'];
}

/** One project, one business-memory projection. Never spread raw records into this boundary. */
export function memoryTaskScope(snapshot: Snapshot, key: string): Set<string> {
  const scope = new Set<string>();
  const task = snapshot.collaboration?.tasks[key];
  if (!task) return scope;
  scope.add(key); scope.add(task.taskId);
  let itemId = task.workItemId;
  const items = snapshot.orchestrations?.[task.taskId]?.items;
  const seen = new Set<string>();
  while (itemId && items?.[itemId] && !seen.has(itemId)) {
    seen.add(itemId);
    const parent = items[itemId].parentTaskId;
    if (!parent || parent === task.taskId) break;
    const parentId = parent.startsWith(task.taskId + '::') ? parent.slice(task.taskId.length + 2) : parent;
    const parentKey = task.taskId + '::' + parentId;
    if (!snapshot.collaboration?.tasks[parentKey]) break;
    scope.add(parentKey); itemId = parentId;
  }
  return scope;
}

export function buildProjectMemory(snapshot: Snapshot, ledger: LedgerRow[] = deriveLedger(snapshot), options: { compact?: boolean; scopes?: Set<string> } = {}) {
  const c = snapshot.collaboration;
  const latest = new Map<string, NonNullable<typeof c>['decisions'][number]>();
  for (const decision of c?.decisions ?? []) latest.set(decision.decisionId, decision);
  const constraints = [...latest.values()].filter(decision => decision.authority === 'confirmed' && !isGeneratedDiscussionSummaryDecision(snapshot, decision) && (!options.scopes || !decision.taskKey || options.scopes.has(decision.taskKey)))
    .map(decision => ({ id: decision.id, revision: decision.revision, scope: decision.taskKey ?? 'project', kind: decision.kind, text: decision.text }));
  const normative = currentProjectSpec(snapshot);
  const directions = options.compact ? [] : Object.values(snapshot.ideaPlans ?? {}).filter(plan => plan.scope === 'project' && plan.adopted).map(plan => ({
    id: plan.id, version: plan.adopted!.version,
    sections: plan.adopted!.doc.sections.map(section => ({ title: section.title,
      lines: section.lines.filter(line => !isGeneratedDiscussionSummary(plan, line.id, line.text)).map(line => ({ id: line.id, text: line.text, state: line.state })),
    })).filter(section => section.lines.length),
  }));
  const liveRows = ledger.filter(row => !row.archived && !row.key.startsWith('planning:'));
  const leaves = new Set(leafTaskRows(snapshot, liveRows).map(row => row.key));
  const entries = liveRows.sort((a,b) => a.key.localeCompare(b.key)).map(row => {
    const memory = row.handoff;
    const valid = memory && !memory.stale && !row.requiresRevalidation && memory.current;
    const summary = memory?.record.content.summary ?? '尚未提交任务总结与交接';
    const handoff: HandoffContent | undefined = valid ? {
      summary: summary.slice(0, 500), completed: [...memory.record.content.completed], decisions: [...memory.record.content.decisions],
      remaining: [...memory.record.content.remaining], nextSteps: [...memory.record.content.nextSteps],
    } : undefined;
    const stale = !!row.requiresRevalidation || !!memory?.stale;
    const recordedNextSteps = handoff?.nextSteps ?? [];
    return {
      key: row.key, title: row.title, owner: row.owner, status: row.status,
      goal: row.spec.goal, criteria: [...row.spec.criteria], specId: row.spec.id, specRevision: row.specRevision,
      dependencies: [...row.dependencies],
      summary: valid ? summary.slice(0, 500) : memory ? '已有交接来源失效，需重新核对；不能作为当前结论' : summary,
      summaryTruncated: !!valid && summary.length > 500, summaryTotalChars: summary.length,
      contentOrigin: memory?.record.contentOrigin,
      ...(memory ? { handoff: pinTaskHandoff(memory) } : {}),
      ...(handoff ? { content: handoff } : {}), stale,
      nextSteps: recordedNextSteps.length ? recordedNextSteps : stateNextSteps(snapshot, row, stale),
      nextStepsSource: recordedNextSteps.length ? 'handoff' as const : 'current-state' as const,
      ...(row.blockReason ? { blocker: row.blockReason } : {}),
      successors: (memory?.successors ?? []).map(item => ({ key: item.key, title: item.title, status: item.status })),
      legacyCompletion: !!row.legacyCompletion,
    };
  });
  const facts = {
    schema: 'quandeck.project-memory.v1' as const,
    project: { id: snapshot.project.id, name: snapshot.project.name, background: snapshot.project.description?.trim() || '项目目标与背景尚未填写' },
    projectSpec: normative ? { ...projectSpecPin(snapshot)!, sections: options.compact ? [] : normative.sections.map(section => ({ title: section.title, body: section.body + specAttachmentContext(section.attachmentSources) })), sources: normative.sourcePins.map(pin => ({ artifactId: pin.artifactId, hash: pin.artifactHash })) } : undefined,
    directions, constraints, entries,
    progress: {
      leafCount: leaves.size,
      running: entries.filter(row => row.status === 'running').map(row => row.key),
      review: entries.filter(row => row.status === 'in_review').map(row => row.key),
      blocked: entries.filter(row => row.status === 'blocked' || row.stale).map(row => row.key),
      ready: entries.filter(row => row.status === 'ready' && !row.stale).map(row => row.key),
      completed: entries.filter(row => leaves.has(row.key) && row.status === 'done' && !row.stale && !row.legacyCompletion).map(row => row.key),
    },
  };
  // Audit sequence is provenance only; ordinary heartbeat/usage events do not change memory identity.
  return { ...facts, sourceSequence: c?.sequence ?? 0, hash: hashText(stableContent(facts)) };
}
export type ProjectMemory = ReturnType<typeof buildProjectMemory>;

/** The task packet carries only its own and explicitly required handoffs. No project-wide body. */
export function buildScopedProjectMemory(snapshot: Snapshot, keys: string[]): ProjectMemory {
  const scopes = new Set<string>();
  for (const key of keys) for (const scope of memoryTaskScope(snapshot, key)) scopes.add(scope);
  return buildProjectMemory(snapshot, deriveLedger(snapshot, keys), { compact: true, scopes });
}

const briefText = (value: string, max = 240) => value.length <= max ? value : value.slice(0, max) + '…（节选，完整内容按来源查看）';
const actionRank: Record<string, number> = { blocked: 0, in_review: 1, running: 2, ready: 3, failed: 4, paused: 5, draft: 6, done: 7, cancelled: 8 };

/** Human entrypoint is bounded. Complete requirements are read separately before execution. */
export function buildProjectBrief(snapshot: Snapshot) {
  const rows = deriveLedger(snapshot).filter(row => !row.archived && !row.key.startsWith('planning:'));
  const selected = [...rows].sort((a,b) => Number(!!b.requiresRevalidation) - Number(!!a.requiresRevalidation) || (actionRank[a.status] ?? 9) - (actionRank[b.status] ?? 9) || a.key.localeCompare(b.key)).slice(0, 8);
  const memory = buildProjectMemory(snapshot, selected, { compact: true, scopes: new Set() });
  const leaves = leafTaskRows(snapshot, rows);
  const counts = { total: rows.length, leafCount: leaves.length, completed: leaves.filter(row => row.status === 'done' && !row.requiresRevalidation && !row.legacyCompletion).length,
    running: rows.filter(row => row.status === 'running').length, review: rows.filter(row => row.status === 'in_review').length, blocked: rows.filter(row => row.status === 'blocked' || row.requiresRevalidation).length };
  const facts = { ...memory, project: { ...memory.project, background: briefText(memory.project.background, 800) },
    constraints: memory.constraints.slice(0, 8).map(item => ({ ...item, text: briefText(item.text) })),
    entries: memory.entries.map(row => ({ ...row, goal: briefText(row.goal), criteria: [],
      content: undefined, nextSteps: row.nextSteps.slice(0, 2).map(step => briefText(step)), summary: briefText(row.summary),
      dependencies: [], successors: [], blocker: row.blocker ? briefText(row.blocker) : undefined })),
    coverage: { taskTotal: rows.length, taskIncluded: selected.length, omittedTasks: Math.max(0, rows.length - selected.length), constraintTotal: memory.constraints.length }, counts };
  const { hash: _hash, sourceSequence: _sequence, ...content } = facts;
  return { ...facts, hash: hashText(stableContent(content)) };
}

export function renderProjectBriefDocument(memory: ReturnType<typeof buildProjectBrief>): string {
  return [
    '# ' + memory.project.name + ' · 项目记忆',
    '这是当前项目简报。完整要求、规范与交接按来源查看；候选不代表已验收。',
    '## 为什么做\n' + memory.project.background,
    '## 已经确定什么\n' + list(memory.constraints.map(item => `${item.text}（${item.kind} · v${item.revision} · 来源 ${item.id}）`)),
    '## 当前规范\n' + (memory.projectSpec ? `已发布 v${memory.projectSpec.version}；完整正文见项目成果地图中的规范。来源 ${memory.projectSpec.versionId}。` : '尚未发布项目规范，不能把候选当作正式要求。'),
    `## 现在到哪\n末级任务已完成：${memory.counts.completed}/${memory.counts.leafCount}\n进行中 ${memory.counts.running} · 待验收 ${memory.counts.review} · 阻塞/需复核 ${memory.counts.blocked}`,
    '## 接下来做什么',
    ...(memory.entries.length ? memory.entries.map(row => `### ${row.title}\n${statusLabels[row.status] ?? row.status}${row.stale ? ' · 需复核' : ''} · 负责人：${row.owner}\n${row.summary}\n${row.handoff ? `交付：${row.handoff.reviewStatus === 'accepted' ? '已验收' : row.handoff.reviewStatus === 'needs_changes' ? '待修改' : '候选，尚未验收'}${row.contentOrigin === 'derived' ? '；摘要来自正文节选，交接仍需核对' : ''}\n` : ''}${list(row.nextSteps)}\n来源：任务 ${row.key}${row.handoff ? ' · 交接 ' + row.handoff.id : ' · 当前任务状态'}`) : ['尚无任务。可以直接添加下一步行动，无需先与 Agent 聊天。']),
    '## 去哪里查\n在“任务交接”中按需查询任务；在“方向与规范”中读完整要求；在成果地图中核对交付。',
    `简报展示 ${memory.coverage.taskIncluded}/${memory.coverage.taskTotal} 项任务，${Math.min(8, memory.coverage.constraintTotal)}/${memory.coverage.constraintTotal} 条项目条件；省略部分仍可按需查阅，不代表已完成或已核对。`,
  ].join('\n\n');
}

export function renderProjectMemory(snapshot: Snapshot): string {
  return renderProjectBriefDocument(buildProjectBrief(snapshot));
}

/** Fixed headings and provenance are code-owned; Agents provide business content only. */
export function renderProjectMemoryDocument(memory: ProjectMemory): string {
  const titles = new Map(memory.entries.map(row => [row.key, row.title]));
  const label = (keys: string[]) => keys.map(key => titles.get(key) ?? key).join('、') || '无';
  return [
    '# ' + memory.project.name + ' · 项目记忆',
    '由本项目台帐与黑板生成；候选内容不代表已验收，缺失信息不会自动补写。',
    '## 目标与背景\n' + memory.project.background,
    '## 已采用方向\n' + (memory.directions.length ? memory.directions.map(direction => `方向 v${direction.version} · ${direction.id}\n${direction.sections.map(section => '### ' + section.title + '\n' + list(section.lines.map(line => `${line.text}（${{ fixed: '已确认', tentative: '暂定', open: '待决定' }[line.state]}）`))).join('\n\n')}`).join('\n\n') : '尚未采用项目方向。'),
    '## 已确认项目规范\n' + (memory.projectSpec ? `已发布 v${memory.projectSpec.version} · ${memory.projectSpec.versionId}\n\n${memory.projectSpec.sections.map(section => '### ' + section.title + '\n' + section.body).join('\n\n')}\n\n来源成果：${memory.projectSpec.sources.map(source => source.artifactId).join('、')}` : '尚未发布；候选文档不能代替项目规范。'),
    '## 已确认条件\n' + list(memory.constraints.map(item => `${item.text}（${item.scope} · v${item.revision} · ${item.id}）`)),
    `## 当前进度\n末级任务已完成：${memory.progress.completed.length}/${memory.progress.leafCount ?? memory.entries.length}\n进行中：${label(memory.progress.running)}\n待验收：${label(memory.progress.review)}\n阻塞/需复核：${label(memory.progress.blocked)}\n可接手：${label(memory.progress.ready)}`,
    '## 任务总结与交接',
    ...(memory.entries.length ? memory.entries.map(row => [
      `### ${row.title} · ${row.key}`,
      `状态：${statusLabels[row.status] ?? row.status}${row.stale ? ' · 需复核' : ''}${row.legacyCompletion ? ' · 历史导入，未重新验收' : ''}；负责人：${row.owner}`,
      `职责：${row.goal}\n验收：\n${list(row.criteria)}\n依赖输入：${row.dependencies.join('、') || '无'}`,
      `总结：${row.summary}${row.summaryTruncated ? `（节选 500/${row.summaryTotalChars} 字，完整内容见来源交接）` : ''}`,
      `交付状态：${row.handoff ? ({ accepted: '已验收', needs_changes: '待修改', unreviewed: '候选，尚未验收' }[row.handoff.reviewStatus]) : '尚未提交'}`,
      `已做内容：\n${list(row.content?.completed ?? [])}\n工作决定（不替代项目规范）：\n${list(row.content?.decisions ?? [])}`,
      `剩余事项：\n${list([...(row.blocker ? [row.blocker] : []), ...(row.content?.remaining ?? [])])}\n下一步${row.nextStepsSource === 'current-state' ? '（根据当前状态）' : ''}：\n${list(row.nextSteps ?? row.content?.nextSteps ?? [])}`,
      `后续接手：${row.successors.map(item => `${item.title}（${item.key}）`).join('、') || '尚未指定'}`,
      `来源与版本：要求 v${row.specRevision} · ${row.specId}${row.handoff ? `；交接 ${row.handoff.id}；成果 ${row.handoff.artifactId}` : '；暂无交接来源'}`,
    ].join('\n\n')) : ['尚无任务。']),
  ].join('\n\n');
}
