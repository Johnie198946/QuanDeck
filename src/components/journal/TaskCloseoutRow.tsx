import { useEffect, useRef, useState } from 'react';
import type { CloseoutEntry, TaskCloseout } from '../../data/taskCloseout';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { TaskOutputButton } from '../outputs/OutputDialog';
import { TaskIcon } from '../ui/TaskIcon';
import { Icon } from '../ui/Icon';
import { ArtifactThumbnail, artifactCover } from '../outputs/ArtifactThumbnail';
import { AnnotationHistory } from './AnnotationHistory';
import { AppliedLessons } from '../projects/AcceptedReflection';
import { DeliveryReview } from '../results/DeliveryReview';
import './task-closeout.css';

function Evidence({ entry, taskId }: { entry: CloseoutEntry; taskId: string }) {
  const { openWorkspace } = useWorkdeck();
  return <div className="qd-closeout-evidence">
    <dl>
      <dt>任务要求</dt><dd>{entry.goal}</dd>
      {entry.criteria.length > 0 && <><dt>验收条件</dt><dd><ul>{entry.criteria.map((s,i)=><li key={i}>{s}</li>)}</ul></dd></>}
      {entry.reviewNote && <><dt>最近验收意见</dt><dd>{entry.summary && entry.reviewNote.includes(entry.summary) ? <details><summary>查看验收原文</summary>{entry.reviewNote}</details> : entry.reviewNote}</dd></>}
      {entry.remaining.length>0 && <><dt>提交时的遗留事项</dt><dd>{entry.remaining.join('；')}</dd></>}
    </dl>
    {entry.artifactTitle && <button className="qd-link" type="button" onClick={()=>openWorkspace(taskId,{view:'results',focus:true,itemId:entry.itemId??null,selected:entry.itemId??null})}>查看成果：{entry.artifactTitle}<Icon name="arrow-right" size={13}/></button>}
  </div>;
}

function ChildCard({ taskId, child }: { taskId: string; child: CloseoutEntry }) {
  const { snap } = useWorkdeck();
  const returned = child.returned ? snap.collaboration?.artifacts.find(a => a.id === child.artifactId) : undefined;
  return <section className="qd-closeout-child">
    <div className="qd-closeout-subheading"><strong>{child.title}</strong><small>{child.label}</small></div>
    <p>{child.returned ? child.reviewNote : child.summary}</p>
    <AnnotationHistory taskId={taskId} itemId={child.itemId}/>
    {returned && <TaskOutputButton taskId={taskId} itemId={child.itemId} revision={returned} />}
    {child.pending && child.artifactId && <DeliveryReview artifactId={child.artifactId} actionLabel="验收子任务成果"/>}
    {child.accepted && child.artifactId && <AppliedLessons key={child.artifactId} artifactId={child.artifactId} pendingOnly/>}
    <details><summary>子任务详情</summary><Evidence entry={child} taskId={taskId}/>
      {child.accepted&&<DeliveryReview artifactId={child.artifactId} newLessonOnly/>}</details>
  </section>;
}

export function TaskCloseoutRow({taskId, model}:{taskId:string;model:TaskCloseout}) {
  const {snap,api,toast,registerTaskNode,locatedTask,openTaskDirection,openWorkspace}=useWorkdeck();
  const node=useRef<HTMLElement>(null), [expanded,setExpanded]=useState(false);
  useEffect(()=>{registerTaskNode(taskId,node.current);return()=>registerTaskNode(taskId,null)},[taskId,registerTaskNode]);
  const {root,children}=model;
  const artifact = snap.collaboration?.artifacts.find(value => value.id === root.artifactId);
  const withImage = !!artifact?.outputId && !!artifactCover(artifact);
  const displayTitle = root.artifactTitle?.replace(/^QuanDeck\s+v?\d+(?:\.\d+)+\s*[·|–—-]\s*/i,'').trim() || snap.tasks[taskId].title;
  const pendingChildren=children.filter(c=>c.pending || c.returned);
  const firstChild=children.find(c=>c.artifactTitle);
  const summary=root.artifactTitle?root.summary:firstChild?firstChild.title+'：'+firstChild.summary:root.settled?'已记录完成，尚无交付正文。':root.summary;
  const excerpt = summary?.split(/[；;]/u,1)[0].match(/^[^。！？\n]+[。！？]?/u)?.[0].trim() || summary;
  const mark = root.accepted ? 'check-circle' : root.pending ? 'check-square' : root.needsUpdate ? 'alert' : 'check';
  return <article ref={node} tabIndex={-1} data-task={taskId} className={'qd-closeout-row qd-result-card'+(withImage?' has-cover':'')+(locatedTask===taskId?' is-located':'')}>
    <header className="qd-result-meta">
      <span className="qd-result-kind" title={root.title}><TaskIcon snapshot={snap} taskId={taskId} size={15}/><span>{root.title !== displayTitle ? root.title : root.artifactTitle ? '交付成果' : '任务'}</span></span>
      <span className={'qd-closeout-state '+(root.accepted?'accepted':'')}><Icon name={mark} size={13}/>{root.label}</span>
    </header>
    <div className="qd-result-layout">
      <div className="qd-result-copy">
        <h3><button type="button" title={snap.tasks[taskId].title} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{displayTitle}</button></h3>
        {excerpt && excerpt !== displayTitle && <p className="qd-closeout-summary">{excerpt}</p>}
      </div>
      {artifact && withImage && <ArtifactThumbnail artifact={artifact} projectId={snap.project.id}/>}
    </div>
    {pendingChildren.map(c=><ChildCard key={c.key} child={c} taskId={taskId}/>)}
    {root.pending&&root.artifactId&&<DeliveryReview artifactId={root.artifactId} actionLabel="验收成果"/>}
    {root.accepted && root.artifactId && <AppliedLessons key={root.artifactId} artifactId={root.artifactId} pendingOnly/>}
    <div className="qd-card-foot">
      <AnnotationHistory taskId={taskId}/>
      {artifact && <button type="button" className="qd-open-result" onClick={()=>openWorkspace(taskId,{view:'results',focus:true,selected:null})}>看成果<Icon name="arrow-right" size={14}/></button>}
    </div>
    <details className="qd-closeout-details" open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}>
      <summary>任务详情{children.length>0?' · '+children.length+' 项子任务':''}</summary>
      <Evidence entry={root} taskId={taskId}/>
      {root.accepted&&<DeliveryReview artifactId={root.artifactId} newLessonOnly/>}
      {children.filter(c=>!c.pending && !c.returned).map(c=><ChildCard key={c.key} child={c} taskId={taskId}/>)}
      <div className="qd-closeout-utilities">
        <button type="button" className="qd-link" onClick={()=>void openTaskDirection(taskId)}>查看方向方案</button>
        {!root.artifactId&&<TaskOutputButton taskId={taskId} compact/>}
        {(root.settled||root.needsUpdate)&&<button type="button" className="qd-link" onClick={async()=>{try{await api.reopenTask(taskId); toast('任务已重新打开');}catch(e){toast(e instanceof Error?e.message:'重新打开失败','error')}}}>重新打开任务</button>}
      </div>
    </details>
  </article>
}
export function PendingChildren({taskId,children}:{taskId:string;children:CloseoutEntry[]}) {
  return <>{children.filter(c=>c.pending || c.returned).map(c=><ChildCard key={c.key} child={c} taskId={taskId}/>)}</>;
}
