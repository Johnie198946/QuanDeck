import { isCollaborationArtifactFresh, taskKey, type CollaborationTask } from './collaboration';
import { currentChangeRequest } from './deliveryReview';
import { resultExcerpt } from './resultExcerpt';
import type { Snapshot } from './types';

export interface CloseoutEntry {
  key: string; itemId?: string; title: string; label: string; summary: string; goal: string;
  artifactId?: string; artifactTitle?: string; reviewNote?: string; criteria: string[]; remaining: string[];
  returned: boolean; pending: boolean; accepted: boolean; needsUpdate: boolean; settled: boolean;
}
export interface TaskCloseout { root: CloseoutEntry; children: CloseoutEntry[]; quiet: boolean; done: boolean; }

const labels: Record<CollaborationTask['status'],string> = {
  draft:'草稿',ready:'待推进',running:'进行中',blocked:'等待条件',paused:'已暂停',in_review:'待验收',done:'已记录完成',failed:'执行失败',cancelled:'已取消',
};

/** One projection per journal refresh, without projecting historical runs, receipts or usage. */
export function taskCloseouts(s: Snapshot) {
  const c=s.collaboration;
  const activeSpecs=new Map((c?.specs??[]).map(v=>[v.key+'@'+v.revision,v]));
  const subs=new Map((c?.submissions??[]).map(v=>[v.id,v]));
  const artifacts=new Map((c?.artifacts??[]).map(v=>[v.id,v]));
  const reviews=new Map((c?.reviews??[]).map(v=>[v.submissionId,v]));
  const handoffs=new Map((c?.handoffs??[]).map(v=>[v.submissionId,v]));
  const published=new Map<string, NonNullable<Snapshot['outputs']>[string]>();
  for(const output of Object.values(s.outputs??{})) if(output.status==='published') {
    const key=taskKey(output.taskId,output.workItemId), before=published.get(key);
    if(!before || before.updatedAt<output.updatedAt) published.set(key,output);
  }
  const groups=new Map<string,CollaborationTask[]>();
  for(const row of Object.values(c?.tasks??{})) if(row.workItemId&&!row.archived) {
    const g=groups.get(row.taskId); if(g)g.push(row); else groups.set(row.taskId,[row]);
  }
  function entry(taskId:string,row?:CollaborationTask):CloseoutEntry {
    const task=s.tasks[taskId], key=row?.key??taskId;
    const spec=row&&activeSpecs.get(key+'@'+row.specRevision);
    const sub=row?.latestSubmissionId ? subs.get(row.latestSubmissionId) : undefined;
    const artifact=sub?.key===key ? artifacts.get(sub.artifactId) : undefined;
    const review=sub&&reviews.get(sub.id);
    const returned=!!currentChangeRequest(row,sub,review);
    const handoff=sub&&handoffs.get(sub.id);
    const needsUpdate=!!row?.requiresRevalidation||!!artifact&&(sub?.specRevision!==row?.specRevision||!isCollaborationArtifactFresh(s,artifact.id));
    const pending=row?.status==='in_review';
    const accepted=!!artifact && row?.status==='done' && !needsUpdate && !row.legacyCompletion &&
      row.acceptedArtifactId===artifact.id && review?.verdict==='accepted';
    const goal=spec?.goal || task.originalTitle || task.title;
    const recorded=row?row.status==='done':!!task.completion;
    const summary=handoff?.content?.summary || artifact?.body || published.get(key)?.body;
    return { key, itemId:row?.workItemId, title:row?.title??task.title,
      label: returned?'待修改':needsUpdate?'需复核':accepted?'已验收':pending?'待验收':recorded?'已记录完成':row?labels[row.status]:'待推进',
      summary:resultExcerpt(summary||row?.blockReason||goal), goal, artifactId:artifact?.id, artifactTitle:artifact?.title || published.get(key)?.title,
      criteria:spec?.criteria??[], reviewNote:review?.note, remaining:sub?.unresolved??[],
      returned, pending, accepted, needsUpdate, settled:recorded&&!needsUpdate&&!pending };
  }
  const result=new Map<string,TaskCloseout>();
  for (const task of Object.values(s.tasks)) {
    const row=c?.tasks[task.id], root=entry(task.id,row);
    const children=(groups.get(task.id)??[]).map(child=>entry(task.id,child));
    const activeChildren=children.filter(x=>c?.tasks[x.key]?.status!=='cancelled');
    const done=root.settled&&activeChildren.every(x=>x.settled);
    result.set(task.id,{root,children,done,quiet:root.pending||row?.status==='done'||root.settled});
  }
  return result;
}
