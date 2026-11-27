import { Fragment, useMemo, useRef, useState } from 'react';
import type { Snapshot } from '../../data/types';
import { projectBackground } from '../../data/projectUnderstanding';
import { resultExcerpt } from '../../data/resultExcerpt';
import { downloadOutputFile } from '../../data/outputFiles';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon, type IconName } from '../ui/Icon';

const events: Record<string,[string,IconName]> = {
  project_created:['建立项目','folder'], task_created:['建立任务','check-square'],
  plan_adopted:['采用方案','check-circle'], goal_plan_materialized:['确认任务计划','calendar'],
  spec_revised:['修改任务要求','pencil'], dependencies_changed:['调整前置任务','link'],
  result_submitted:['提交成果','box'], result_reviewed:['验收成果','check-circle'],
  decision_recorded:['记录决定','bulb'], project_planning_changed:['更新任务计划','calendar'],
  task_annotation_saved:['记录任务批注','message'],
};

export function ProjectMemory({snapshot, open}: {
  snapshot: Snapshot;
  open: (taskId:string,itemId?:string,results?:boolean)=>void;
}) {
  const {toast}=useWorkdeck();
  const ledger=snapshot.collaboration;
  const rows=useMemo(()=>{
    const artifacts=new Map(ledger?.artifacts.map(item=>[item.id,item]));
    const submissions=new Map(ledger?.submissions.map(item=>[item.id,item]));
    const reviews=new Map(ledger?.reviews.map(item=>[item.id,item]));
    const decisions=new Map(ledger?.decisions.map(item=>[item.id,item]));
    const annotations=new Map(ledger?.taskAnnotations?.map(item=>[item.id,item]));
    const changes=new Map(snapshot.projectPlanning?.changes?.map(item=>[item.eventId,item]));
    return [...(ledger?.events??[])].filter(row=>events[row.type] && Number.isFinite(Date.parse(row.at)))
      .sort((a,b)=>b.at.localeCompare(a.at)||b.sequence-a.sequence).map(row=>{
        const task=row.taskKey ? ledger?.tasks[row.taskKey]:undefined;
        const review=row.type==='result_reviewed'?reviews.get(row.detail):undefined;
        const submission=submissions.get(review?.submissionId ?? (row.type==='result_submitted'?row.detail:''));
        const artifact=submission && artifacts.get(submission.artifactId);
        const decision=row.type==='decision_recorded'?decisions.get(row.detail):undefined;
        const annotation=row.type==='task_annotation_saved'?annotations.get(row.detail):undefined;
        const change=changes.get(row.id);
        const safeDetail=['project_created','project_planning_changed','spec_revised','task_created'].includes(row.type)?row.detail:undefined;
        const taskTitle=task?.title;
        let title=events[row.type][0];
        if (artifact) title=(review ? review.verdict==='accepted'?'验收':'退回' : '提交')+'《'+artifact.title+'》';
        else if (decision || annotation) title=resultExcerpt(decision?.text ?? annotation!.text,55);
        else if (row.type==='project_created') title='建立「'+snapshot.project.name+'」';
        else if (change?.fields.conclusion && change.fields.conclusion!==change.previous?.conclusion) title=change.fields.conclusion;
        else if (taskTitle) {
          const verbs:Record<string,string>={task_created:'建立',spec_revised:'修改要求',plan_adopted:'采用方案',dependencies_changed:'调整前置',goal_plan_materialized:'确认计划',project_planning_changed:'调整计划'};
          title=(verbs[row.type]??title)+'「'+taskTitle+'」';
        }
        const body=review?.note || decision?.text || annotation?.text || change?.fields.conclusion
          || (artifact && resultExcerpt(artifact.body,240)) || safeDetail || taskTitle || snapshot.project.name;
        return {...row,task,review,artifact,change,title,body};
      });
  },[ledger,snapshot.projectPlanning?.changes,snapshot.project.name]);
  const [selected,setSelected]=useState('');
  const detail=useRef<HTMLElement>(null);
  const background = projectBackground(snapshot);
  const understanding = snapshot.project.understanding;
  const event=rows.find(row=>row.id===selected)??rows[0];
  if (!event) return <p className="qm-record-empty"><Icon name="clock" size={24}/>项目建立、任务变更和成果验收会显示在这里。</p>;
  const {task,review,artifact,change,body}=event;
  const actor=snapshot.agents.find(agent=>agent.id===event.actor)?.name ?? ({human:'我',user:'我',system:'QuanDeck'} as Record<string,string>)[event.actor];
  const dayFormat=new Intl.DateTimeFormat('zh-CN',{day:'numeric',month:'long',year:'numeric',timeZone:snapshot.project.timeZone});
  const timeFormat=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:snapshot.project.timeZone});
  function pick(id:string) {
    setSelected(id);
    if (matchMedia('(max-width:760px)').matches) requestAnimationFrame(()=>detail.current?.scrollIntoView({block:'start'}));
  }
  return <section className="qm-memory" aria-label="项目记忆">
    {(understanding || background) && <details className="qm-project-background">
      <summary><Icon name="folder" size={17}/><strong>项目共享背景</strong><span>{resultExcerpt(understanding?.summary || background,72)}</span></summary>
      <dl>
        {snapshot.project.description && <><dt>项目目标</dt><dd>{snapshot.project.description}</dd></>}
        {background && <><dt>你提供的背景</dt><dd>{background}</dd></>}
        {understanding && <><dt>AI 对需求的理解</dt><dd>{understanding.summary}</dd></>}
      </dl>
      {!!understanding?.recommendations?.length && <section>
        <h3>可复用的知识与灵感</h3>
        {understanding.recommendations.map(source => <details key={source.id} className="qm-chosen-source">
          <summary>{source.title}</summary><p>{source.use}</p><p>{source.reason}</p><blockquote>{source.quote}</blockquote>
        </details>)}
      </section>}
    </details>}
    <ol aria-label="项目时间线" className="qm-memory-log">{rows.map((row,index)=>{
      const date=dayFormat.format(new Date(row.at));
      const context=row.task?.title;
      return <Fragment key={row.id}>
        {(!index || date!==dayFormat.format(new Date(rows[index-1].at))) && <li className="qm-memory-day"><i/>{date===dayFormat.format(new Date())?'今天 · ':''}{date}</li>}
        <li className="qm-memory-event"><time dateTime={row.at}>{timeFormat.format(new Date(row.at))}</time>
          <button type="button" aria-current={row.id===event.id?'true':undefined} onClick={()=>pick(row.id)}>
            <span className="qm-event-icon"><Icon name={events[row.type][1]} size={17}/></span>
            <span><strong>{row.title}</strong><small><span>{events[row.type][0]}</span>{context && !row.title.includes(context) && ' · '+context}</small></span>
            <Icon name="chevron-right" size={14}/>
          </button>
        </li>
      </Fragment>;
    })}</ol>
    <article className="qm-memory-reader" ref={detail}>
      <header><span className="qm-event-icon"><Icon name={events[event.type][1]} size={22}/></span>
        <div><h2>{event.title}</h2><small><Icon name="clock" size={13}/>{dayFormat.format(new Date(event.at))} {timeFormat.format(new Date(event.at))}{actor&&<> · {actor}</>}</small></div>
      </header>
      <section><h3><Icon name="folder" size={17}/>具体内容</h3>
        {review && <p>{review.verdict==='accepted'?'已验收':'已退回'}</p>}
        <p>{body}</p>
        {change&&<details><summary>查看本次变更</summary>{change.fields.start&&<p>{change.fields.start} 至 {change.fields.end||'未设截止日期'}</p>}{change.fields.researchSourceId&&<p>研究回执 {change.fields.researchSourceId}</p>}{change.previous?.conclusion&&change.previous.conclusion!==change.fields.conclusion&&<p>此前结论 · {change.previous.conclusion}</p>}</details>}
      </section>
      {task&&<section><h3><Icon name="check-square" size={17}/>关联任务</h3><button type="button" className="qm-record-link" onClick={()=>open(task.taskId,task.workItemId,!!artifact)}>{task.title}<Icon name="arrow-right" size={15}/></button></section>}
      {!!artifact?.attachments?.length&&<section><h3><Icon name="link" size={17}/>相关资料 <small>{artifact.attachments.length}</small></h3>
        <div className="qm-memory-files">{artifact.attachments.map(file=><button key={file.id} className="qm-record-link" onClick={()=>void downloadOutputFile(snapshot.project.id,file).catch(error=>toast(error instanceof Error?error.message:'未能打开资料','error'))}><Icon name="folder" size={16}/>{file.name}</button>)}</div>
      </section>}
      <details className="qm-memory-source"><summary>来源记录</summary><p>记录 {event.id}</p>{artifact&&<p>成果 {artifact.title} · 版本 {artifact.version}</p>}</details>
    </article>
  </section>;
}
