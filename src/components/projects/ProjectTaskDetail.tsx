import { useEffect, useRef, useState } from 'react';
import { taskKey } from '../../data/collaboration';
import { planningTask, priorityLevels, type PlannedTask } from '../../data/projectPlanning';
import type { ProjectAnalysis } from '../../data/projectAnalysis';
import { desktopHost } from '../../integration/desktop';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import { AnnotationHistory } from '../journal/AnnotationHistory';
import { TaskOutputButton } from '../outputs/OutputDialog';
import { TaskAttachmentsPanel } from '../workspace/TaskAttachments';
import type { ProjectTreeRow } from './ProjectGantt';
import { requestProductDispatch } from '../deck/ProductExecution';

export function ProjectTaskDetail({row,datesOnly=false,close,showResults}: {row:ProjectTreeRow;datesOnly?:boolean;close?:()=>void;showResults:()=>void}) {
  const {api,snap,toast,openTaskDirection,openWorkspace}=useWorkdeck();
  const {node}=row;
  const taskId=node.taskId!;
  const key=taskKey(taskId,node.itemId);
  const record=snap.collaboration?.tasks[key];
  const specification=snap.collaboration?.specs.find(spec=>spec.key===key&&spec.revision===record?.specRevision);
  const current=planningTask(snap,taskId,node.itemId);
  const [edit,setEdit]=useState(datesOnly),[form,setForm]=useState<PlannedTask>(current);
  const [criteria,setCriteria]=useState(specification?.criteria.join('\n') ?? '');
  const [expected,setExpected]=useState(snap.projectPlanning?.revision??0);
  const [specRevision,setSpecRevision]=useState(record?.specRevision);
  const [analysis,setAnalysis]=useState<ProjectAnalysis>(),[busy,setBusy]=useState(false);
  const [quote,setQuote]=useState(''),[question,setQuestion]=useState(''),[error,setError]=useState('');
  const [more,setMore]=useState(false);
  const lock=useRef(false);
  const details=useRef<HTMLDivElement>(null);
  const goal=specification?.goal || node.description || node.title;
  const captured=useRef(false);
  const changesAcceptance = !datesOnly && !!record?.acceptedArtifactId && (form.conclusion !== current.conclusion ||
    form.deliverable !== current.deliverable || criteria.trim() !== (specification?.criteria.join('\n') ?? ''));
  useEffect(()=>{
    if(edit)return;
    setForm(current);
    setCriteria(specification?.criteria.join('\n')??'');
    setExpected(snap.projectPlanning?.revision??0);
    setSpecRevision(record?.specRevision);
  },[edit,snap.projectPlanning,record?.specRevision]);
  useEffect(()=>{
    if(datesOnly&&!captured.current) {
      details.current?.querySelector<HTMLInputElement>('input[type=date]')?.focus();
      captured.current=true;
    }
  },[datesOnly,edit]);
  const startEdit=()=>{
    setForm(current);setCriteria(specification?.criteria.join('\n')??'');
    setExpected(snap.projectPlanning?.revision??0);setSpecRevision(record?.specRevision);setEdit(true);
  };
  const save=async()=>{
    if(lock.current||!api.updateProjectPlanning)return;
    lock.current=true;setBusy(true);setError('');
    try {
      const revision = edit && !datesOnly && specRevision!==undefined ? {criteria:criteria.split('\n').filter(text=>text.trim()),expectedSpecRevision:specRevision} : {};
      const result=await api.updateProjectPlanning(snap.project.id,{kind:'task',taskId,itemId:node.itemId,fields:form,expectedRevision:expected,...revision});
      if(!result.ok)throw Error(result.message||'保存失败');
      setEdit(false);setAnalysis(undefined);toast('任务信息已保存');if(datesOnly)close?.();
    } catch(cause) {setError(cause instanceof Error?cause.message:'保存失败');}
    finally {lock.current=false;setBusy(false);}
  };
  const research=async()=>{
    const analyze=desktopHost()?.analyzeProject;
    if(!analyze){setError('可以手动填写研究结论，或在桌面端连接 Agent。');return;}
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try {
      const source=[node.itemId?'':(snap.tasks[taskId]?.inputs??[]).map(input=>input.text).join('\n'),edit?form.information:current.information,
        current.conclusion && '已确认的旧结论：'+current.conclusion,quote&&'选中的原文：'+quote,question&&'问题：'+question].filter(Boolean).join('\n\n').slice(0,16000);
      const reply=await analyze({goal:goal.slice(0,2500),information:source,taskId,itemId:node.itemId,projectId:snap.project.id});
      setAnalysis(reply);
      setQuestion('');
    } catch(cause){setError(cause instanceof Error?cause.message:'研究没有完成');}
    finally {lock.current=false;setBusy(false);}
  };
  const selectText=()=>{
    const selection=window.getSelection();
    const selected=selection?.toString().trim()??'';
    if(selected.length>2&&selected.length<=1500&&details.current?.contains(selection?.anchorNode??null))setQuote(selected);
  };
  const field=(name:keyof PlannedTask,value:string)=>setForm(prev=>({...prev,[name]:value,...(name==='conclusion'?{researchSourceId:undefined}:{})}));
  const section=(name:string,text:string|undefined,editableField:'information'|'conclusion'|'deliverable')=>(
    <section className="qp-panel qp-task-section"><h3>{name}</h3>{edit
      ? <textarea aria-label={name} rows={4} maxLength={8000} value={form[editableField]??''} onChange={event=>field(editableField,event.target.value)}/>
      : <p className={text?'':'qp-muted'}>{text||'暂无'}</p>}</section>
  );
  return <article className="qp-task" ref={details}>
    <header className="qp-task-head">
      <div><p className={'qp-task-state '+node.bucket}>{node.state}</p><h2>{node.title}</h2></div>
      {datesOnly? <button type="button" className="qp-icon" aria-label="关闭排期编辑" onClick={close}><Icon name="close" size={16}/></button>:
        <div className="qp-actions">
          <button className="qp-btn primary" type="button" disabled={busy} onClick={()=>void research()}><Icon name="play" size={14}/>{busy?'请稍候…':'开始研究'}</button>
          <button type="button" className="qp-icon" aria-label="更多任务操作" aria-expanded={more} onClick={()=>setMore(!more)}>···</button>
        </div>}
    </header>
    {more && <div className="qp-actions qp-task-options"><button type="button" className="qp-btn" onClick={()=>void openTaskDirection(taskId,node.itemId)}>查看讨论记录</button><button type="button" className="qp-btn" onClick={()=>openWorkspace(taskId,{view:'tasks',itemId:node.itemId,selected:node.itemId})}>详细任务操作</button></div>}
    <div className="qp-task-meta">
      <span><Icon name="user" size={14}/>{node.owner||'未分派'}</span>
      <span><Icon name="calendar" size={14}/>{current.start&&current.end?current.start+' 至 '+current.end:current.end||current.start||'未排期'}</span>
      <span>{current.priority||'未设优先级'}</span>
      {!datesOnly && <button type="button" className="qp-btn" onClick={()=>requestProductDispatch({taskId,itemId:node.itemId,projectId:snap.project.id})}><Icon name="plane" size={14}/>分派</button>}
      {!edit && <button type="button" className="qp-btn" onClick={startEdit}><Icon name="pencil" size={14}/>编辑任务信息</button>}
    </div>
    {edit && <div className="qp-form-row qp-edit-meta"><label>开始日期<input type="date" value={form.start??''} onChange={event=>field('start',event.target.value)}/></label><label>截止日期<input type="date" value={form.end??''} onChange={event=>field('end',event.target.value)}/></label><label>优先级<select value={form.priority??''} onChange={event=>field('priority',event.target.value)}><option value="">未设置</option>{priorityLevels.map(level=><option key={level}>{level}</option>)}</select></label><label className="qp-milestone-control"><input type="checkbox" checked={form.milestone??false} onChange={event=>setForm(prev=>({...prev,milestone:event.target.checked}))}/>标为里程碑</label></div>}
    {!datesOnly && <>
      <p className="qp-task-objective" onMouseUp={selectText}>{goal}</p>
      <div className="qp-task-sections" onMouseUp={selectText}>
        {section('研究信息',current.information,'information')}
        {section('研究结论',current.conclusion,'conclusion')}
        <section className="qp-panel qp-task-section"><h3>验收标准</h3>{edit?<textarea aria-label="验收标准" rows={4} value={criteria} onChange={event=>setCriteria(event.target.value)}/>:specification?.criteria.length?<ul>{specification.criteria.map((text,index)=><li key={index}>{text}</li>)}</ul>:<p className="qp-muted">暂无</p>}</section>
        {section('交付物',current.deliverable,'deliverable')}
      </div>
      {!!quote && <form className="qp-inline-question qp-panel" onSubmit={event=>{event.preventDefault();if(question.trim())void research();}}>
        <q>{quote}</q><div className="qp-actions"><input aria-label="询问选中文字" value={question} maxLength={1200} onChange={event=>setQuestion(event.target.value)} placeholder="问一句…"/><button type="submit" className="qp-btn primary" disabled={busy||!question.trim()}>提问</button><button type="button" className="qp-btn" onClick={()=>setQuote('')}>关闭</button></div></form>}
      {analysis && <section className="qp-panel qp-research-review"><h3>研究建议 · 待确认</h3>{quote&&<q>{quote}</q>}<p>{analysis.summary}</p>
        {analysis.questions.map((text,index)=><p key={index}>{text}</p>)}
        <div className="qp-actions">
          <button type="button" className="qp-btn primary" onClick={()=>{
            if(!edit)startEdit();
            setForm(prev=>({...prev,conclusion:analysis.summary,researchSourceId:analysis.sourceId}));setAnalysis(undefined);setQuote('');
          }}>采用到研究结论</button>
          <button type="button" className="qp-btn" onClick={()=>{setAnalysis(undefined);setQuote('');}}>保留当前结论</button>
          <details><summary>查看本次来源</summary><small>只读分析回执 {analysis.sourceId}</small></details>
        </div>
      </section>}
      <div className="qp-actions qp-task-foot">
        <AnnotationHistory taskId={taskId} itemId={node.itemId}/>
        <details className="qp-material"><summary>附件</summary><TaskAttachmentsPanel taskId={taskId} workItemId={node.itemId}/></details>
        {current.researchSourceId&&<details><summary>结论来源</summary><small>只读分析回执 {current.researchSourceId}</small></details>}
        <button type="button" className="qp-btn" onClick={showResults}>看成果</button>
        <TaskOutputButton taskId={taskId} itemId={node.itemId}/>
      </div>
    </>}
    {edit && changesAcceptance && <p className="qp-muted">更新验收要求后，旧成果可在历史中查看，这项任务需要重新验收。</p>}
    {edit && <div className="qp-actions qp-task-foot"><button type="button" className="qp-btn primary" disabled={busy||!api.updateProjectPlanning} onClick={()=>void save()}>确认保存</button><button type="button" className="qp-btn" onClick={()=>{setEdit(false);close?.();}}>取消</button></div>}
    {error && <p className="qp-error" role="alert">{error}</p>}
  </article>;
}
