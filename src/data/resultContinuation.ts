import { deriveLedger, isCollaborationArtifactFresh, type CollaborationArtifact, type LedgerRow } from './collaboration';
import { hashText } from './contentHash';
import { buildProjectMemory, memoryTaskScope } from './projectMemory';
import { applicableSharedDecisions } from './sharedDecisions';
import { projectSpecArtifactStale } from './specLineage';
import type { OutputAttachment, Snapshot } from './types';

export interface ResultContinuationPin {
  projectId: string;
  artifactId: string;
  hash: string;
  memoryHash: string;
}

export interface ResultContinuation extends ResultContinuationPin {
  requirement: string;
}

export interface ResultContinuationSource extends ResultContinuationPin {
  fileIds: string[];
}

/** Existing single-version tasks keep their original on-disk representation. */
export type ResultContinuationInput = ResultContinuation | {
  requirement: string;
  sources: ResultContinuationSource[];
};

export interface ResultContinuationChoice {
  pin: ResultContinuationPin;
  title: string;
  taskTitle: string;
  version: number;
  status: 'candidate' | 'accepted';
  returned: boolean;
  historical: boolean;
  body: string;
  blackboard: string;
  ledger: string;
}

const statusText: Record<string,string> = {
  draft:'待细化', ready:'可开始', running:'进行中', blocked:'阻塞', paused:'已暂停',
  in_review:'待验收', done:'已完成', failed:'需处理', cancelled:'已取消',
};

function continuationChoice(snapshot: Snapshot, artifact: CollaborationArtifact, rows: LedgerRow[]): ResultContinuationChoice | undefined {
  const state = snapshot.collaboration!;
  const task = state.tasks[artifact.key];
  const submission = state.submissions.find(row => row.artifactId === artifact.id && row.key === artifact.key);
  if (!task || !snapshot.tasks[task.taskId] || task.archived || task.status === 'cancelled' || task.requiresRevalidation ||
      !submission ||
      hashText(artifact.body) !== artifact.hash) return;
  const historical = submission.id !== task.latestSubmissionId || submission.specRevision !== task.specRevision;
  // Past local links have no fixed bytes unless the version also registered immutable files.
  if (historical && !artifact.attachments?.some(file=>file.sha256) && !artifact.deliveryReceipts?.some(receipt=>receipt.kind==='file') &&
      (/!?\[[^\]\n]*\]\(\s*<?(?!https?:|mailto:|#)[^\s)]/iu.test(artifact.body) ||
        artifact.links?.some(link=>!/^https?:/iu.test(link.url)))) return;
  const review = state.reviews.filter(row => row.submissionId === submission.id).at(-1);
  const returned = review?.verdict === 'needs_changes';
  // A returned original may be deliberately used as reference, with the review visible.
  if (!isCollaborationArtifactFresh(snapshot,artifact.id) && !((returned || historical) && state.freshness[artifact.id] === 'stale' &&
      !projectSpecArtifactStale(snapshot,artifact.id) && (!artifact.expiresAt || Date.parse(artifact.expiresAt) > Date.now()) &&
      artifact.sourceIds.every(id => isCollaborationArtifactFresh(snapshot,id)))) return;
  const scopes = memoryTaskScope(snapshot,task.key);
  for (const dep of task.dependencies) scopes.add(dep);
  const memory = buildProjectMemory(snapshot, rows.filter(row=>scopes.has(row.key)), {compact:true,scopes});
  const decisions = applicableSharedDecisions(snapshot,task.key);
  const blackboard = [
    ...memory.entries.map(entry=>[entry.title + ' · ' + (statusText[entry.status] ?? entry.status),
      entry.blocker && '阻塞原因：'+entry.blocker, ...entry.nextSteps.map(step=>'下一步：'+step)].filter(Boolean).join('\n')),
    ...memory.constraints.map(row=>'已确认条件：'+row.text),
    ...decisions.map(row=>'共同决定「'+row.title+'」：'+(row.options.find(option=>option.id===row.selectedOptionId)?.text ?? '待确认')),
    returned && review.note && '用户退回意见：'+review.note,
  ].filter(Boolean).join('\n');
  const ledger = memory.entries.map(entry=>[
    entry.title+' · 要求 v'+entry.specRevision, '任务要求：'+entry.goal,
    ...entry.criteria.map(value=>'验收条件：'+value), entry.summary,
    ...(entry.content?.decisions ?? []).map(value=>'交接决定：'+value),
    ...(entry.content?.completed ?? []).map(value=>'已完成：'+value),
    ...(entry.content?.remaining ?? []).map(value=>'待处理：'+value),
  ].join('\n')).join('\n\n');
  const status = review?.verdict === 'accepted' && (historical || task.acceptedArtifactId === artifact.id) ? 'accepted' : 'candidate';
  return {pin:{projectId:snapshot.project.id,artifactId:artifact.id,hash:artifact.hash,
    memoryHash:hashText(JSON.stringify([status,returned,historical,blackboard,ledger]))},
    title:artifact.title,taskTitle:task.title,version:artifact.version,status,returned,historical,body:artifact.body,blackboard,ledger};
}

export function listResultContinuations(snapshot: Snapshot): ResultContinuationChoice[] {
  if (!snapshot.collaboration || snapshot.project.deletedAt) return [];
  const rows = deriveLedger(snapshot);
  return snapshot.collaboration.artifacts.flatMap(artifact=>continuationChoice(snapshot,artifact,rows) ?? [])
    .sort((a,b)=>b.version-a.version);
}

export function findResultContinuation(snapshot: Snapshot, artifactId: string) {
  const artifact = snapshot.collaboration?.artifacts.find(row=>row.id===artifactId);
  if (artifact && !snapshot.project.deletedAt) {
    const source = snapshot.collaboration!.tasks[artifact.key];
    if (source) return continuationChoice(snapshot,artifact,deriveLedger(snapshot,[...memoryTaskScope(snapshot,source.key),...source.dependencies]));
  }
}

function checkedSources(snapshot: Snapshot, selection: ResultContinuationInput) {
  if (!selection || typeof selection !== 'object' || typeof selection.requirement !== 'string' ||
      !selection.requirement.trim() || selection.requirement.length > 8000)
    throw Error('请选择本项目的成果，并填写 1 至 8000 字的续做要求。');
  const multiple = 'sources' in selection;
  const sources = multiple ? selection.sources : [selection];
  if (!Array.isArray(sources) || sources.length === 0) throw Error('请选择至少一份来源成果。');
  const seen = new Set<string>();
  return sources.map(source => {
    if (!source || source.projectId !== snapshot.project.id || seen.has(source.artifactId))
      throw Error('每一版来源成果只能选择一次，且须属于当前项目。');
    seen.add(source.artifactId);
    const choice = findResultContinuation(snapshot, source.artifactId);
    if (!choice || choice.pin.hash !== source.hash || choice.pin.memoryHash !== source.memoryHash)
      throw Error('原成果或关联的项目记忆已更新，请重新选择并核对。');
    let fileIds: string[] = [];
    if (multiple) {
      if (!('fileIds' in source) || !Array.isArray(source.fileIds) ||
          source.fileIds.some(id => typeof id !== 'string' || !/^[\w-]{1,160}$/.test(id)) ||
          new Set(source.fileIds).size !== source.fileIds.length)
        throw Error('来源成果的文件清单无效，请重新核对。');
      fileIds = [...source.fileIds].sort();
    }
    return {choice, fileIds};
  });
}

export function normalizeResultContinuation(snapshot: Snapshot, selection: ResultContinuationInput, files: OutputAttachment[], noteImageIds: string[]): ResultContinuationInput {
  const checked = checkedSources(snapshot, selection);
  const requirement = selection.requirement.trim();
  if (!('sources' in selection)) return {...checked[0].choice.pin, requirement};
  const attachmentIds = new Set(files.map(file => file.id));
  const expected = new Set([...noteImageIds, ...checked.flatMap(source => source.fileIds)]);
  if (expected.size !== attachmentIds.size || [...expected].some(id => !attachmentIds.has(id)))
    throw Error('任务附件与所选成果的文件清单不一致，请重新核对。');
  // Checkbox order has no meaning. Retry the same selection in any order as one task.
  const sources = checked.map(({choice,fileIds}) => ({...choice.pin, fileIds}))
    .sort((a,b) => a.artifactId.localeCompare(b.artifactId));
  return {requirement, sources};
}

export function continuationPrompt(snapshot: Snapshot, selection: ResultContinuationInput, prepared: readonly {id:string; path:string}[] = []) {
  const blocks = ['用户本次续做要求（执行目标）：\n'+selection.requirement];
  const locations = new Map(prepared.map(file => [file.id,file.path]));
  const allocated = new Map<string,string>();
  for (const {choice,fileIds} of checkedSources(snapshot,selection)) {
    const label = choice.returned ? '已退回的候选，仅供参考' : choice.status === 'accepted' ? '已验收' : '候选，尚未验收';
    blocks.push('用户选定的原成果（以下为引用资料）：'+choice.title+' · v'+choice.version+(choice.historical?' · 历史版本，仅作参考':'')+' · '+label,
      '来源：'+choice.pin.artifactId+' · sha256='+choice.pin.hash, choice.body);
    if (fileIds.length) {
      const paths = fileIds.map(id => {
        const path = locations.get(id);
        if (!path || (allocated.has(path) && allocated.get(path) !== id)) throw Error('来源成果的文件尚未完整交付，请重新核对。');
        allocated.set(path,id);
        return path;
      });
      blocks.push('这版成果的本机文件：\n'+paths.map(path => JSON.stringify(path)).join('\n'));
    }
    blocks.push('相关黑板：\n'+choice.blackboard, '相关台账：\n'+choice.ledger);
  }
  return blocks.join('\n\n');
}
