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
export function buildProjectMemory(snapshot: Snapshot, ledger: LedgerRow[] = deriveLedger(snapshot)) {
  const c = snapshot.collaboration;
  const latest = new Map<string, NonNullable<typeof c>['decisions'][number]>();
  for (const decision of c?.decisions ?? []) latest.set(decision.decisionId, decision);
  const constraints = [...latest.values()].filter(decision => decision.authority === 'confirmed' && !isGeneratedDiscussionSummaryDecision(snapshot, decision))
    .map(decision => ({ id: decision.id, revision: decision.revision, scope: decision.taskKey ?? 'project', kind: decision.kind, text: decision.text }));
  const normative = currentProjectSpec(snapshot);
  const directions = Object.values(snapshot.ideaPlans ?? {}).filter(plan => plan.scope === 'project' && plan.adopted).map(plan => ({
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
    projectSpec: normative ? { ...projectSpecPin(snapshot)!, sections: normative.sections.map(section => ({ title: section.title, body: section.body + specAttachmentContext(section.attachmentSources) })), sources: normative.sourcePins.map(pin => ({ artifactId: pin.artifactId, hash: pin.artifactHash })) } : undefined,
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

export function renderProjectMemory(snapshot: Snapshot): string {
  return renderProjectMemoryDocument(buildProjectMemory(snapshot));
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
