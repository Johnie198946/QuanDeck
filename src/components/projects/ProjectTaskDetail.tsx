import { useEffect, useRef, useState } from 'react';
import { TaskWorkspaces } from '../runtime/TaskWorkspace';
import { SharedDecisions } from './SharedDecisions';
import { TaskMaterials } from './TaskMaterials';
import { taskMaterialQuery } from '../../data/taskMaterialContext';
import { taskKey } from '../../data/collaboration';
import { planningTask, priorityLevels, type PlannedTask } from '../../data/projectPlanning';
import type { ProjectAnalysis } from '../../data/projectAnalysis';
import { desktopHost } from '../../integration/desktop';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon, type IconName } from '../ui/Icon';
import { AnnotationHistory } from '../journal/AnnotationHistory';
import { TaskOutputButton } from '../outputs/OutputDialog';
import { TaskAttachmentsPanel } from '../workspace/TaskAttachments';
import type { ProjectTreeRow } from './ProjectGantt';
import { requestProductDispatch } from '../deck/ProductExecution';

import { NoteDispatchTrail, TaskResultPreview, type OpenNoteSource } from './NoteDispatchTrail';
import type { BoardResult } from '../homepage/homeBoardData';

export function ProjectTaskDetail({row,datesOnly=false,close,showResults,onOpenNote,results,openDecisionTask}: {row:ProjectTreeRow;openDecisionTask?:(key:string)=>void;datesOnly?:boolean;close?:()=>void;showResults:(id?:string)=>void;onOpenNote:OpenNoteSource;results:BoardResult[]}) {
  const {api,snap,toast,openTaskDirection,openWorkspace,openSourceSession}=useWorkdeck();
  const {node}=row;
  const taskId=node.taskId!;
  const key=taskKey(taskId,node.itemId);
  const attention = node.attention;
  const sourceTask = !node.itemId && snap.tasks[taskId]?.inputs?.some(input=>input.noteSource) ? snap.tasks[taskId] : undefined;
  const [showResearch,setShowResearch] = useState(false);
  const openAction = () => {
    if (!attention) return;
    if (attention.planId) {
      openWorkspace(taskId,{view:'plan',planId:attention.planId,projectId:node.projectId,itemId:node.itemId ?? null});
    } else if (attention.kind === 'review') {
      showResults(results.find(result=>result.currentSubmission)?.id ?? results[0]?.id);
    } else if (attention.entry?.sessionId) {
      openSourceSession(attention.entry.sessionId);
    } else {
      openWorkspace(taskId,{view:'tasks',selected:node.itemId ?? null,itemId:node.itemId ?? null,projectId:node.projectId});
    }
  };

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
  const [anchor,setAnchor]=useState<{left:number;top:number}>();
  const [asking,setAsking]=useState(false);
  const hideQuestion=()=>{setAnchor(undefined);setAsking(false);setQuote('');setQuestion('');};
  const lock=useRef(false);
  const details=useRef<HTMLDivElement>(null);
  const goal=specification?.goal || node.description || node.title;
  const repeatsGoal = [node.title, current.information, current.conclusion, current.deliverable]
    .some(text => text?.trim() === goal.trim());
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
    hideQuestion();
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
  const research=async(usePassage=false)=>{
    const analyze=desktopHost()?.analyzeProject;
    if(!analyze){setError('可以手动填写研究结论，或在桌面端连接 Agent。');return;}
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try {
      const source=[node.itemId?'':(snap.tasks[taskId]?.inputs??[]).map(input=>input.text).join('\n'),edit?form.information:current.information,
        current.conclusion && '已确认的旧结论：'+current.conclusion,usePassage&&quote&&'选中的原文：'+quote,usePassage&&question&&'问题：'+question].filter(Boolean).join('\n\n').slice(0,16000);
      const reply=await analyze({goal:goal.slice(0,2500),information:source,taskId,itemId:node.itemId,projectId:snap.project.id});
      setAnalysis(reply);setAnchor(undefined);setAsking(false);if(!usePassage)setQuote('');
      setQuestion('');
    } catch(cause){setError(cause instanceof Error?cause.message:'研究没有完成');}
    finally {lock.current=false;setBusy(false);}
  };
  const selectText=()=>{
    if(edit)return;
    const selection=window.getSelection();
    const selected=selection?.toString().trim();
    const card=details.current;
    if(!selected||selected.length>1500||!selection?.rangeCount||!card?.contains(selection.anchorNode)||!card.contains(selection.focusNode)) return;
    const range=selection.getRangeAt(0);
    const rects=range.getClientRects();
    const last=rects[rects.length-1];
    if(!last) return;
    const bounds=card.getBoundingClientRect();
    setQuote(selected);setQuestion('');setAsking(false);
    setAnchor({left:Math.max(0,last.right-bounds.left),top:last.bottom-bounds.top+5});
  };
  useEffect(()=>{
    if(!anchor)return;
    const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape') hideQuestion();};
    const outside=(event:MouseEvent)=>{if(event.target instanceof Element&&!event.target.closest('.qp-passage'))hideQuestion();};
    document.addEventListener('keydown',dismiss);
    document.addEventListener('pointerdown',outside);
    return ()=>{document.removeEventListener('keydown',dismiss);document.removeEventListener('pointerdown',outside);};
  },[anchor]);
  const field=(name:keyof PlannedTask,value:string)=>setForm(prev=>({...prev,[name]:value,...(name==='conclusion'?{researchSourceId:undefined}:{})}));
  const empty=(name:string,icon:IconName)=><button type="button" className="qp-section-empty" onClick={()=>{
    startEdit();
    requestAnimationFrame(()=>details.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="'+name+'"]')?.focus());
  }}><Icon name={icon} size={23}/><span>{'添加'+name}</span></button>;
  const section=(name:string,icon:IconName,text:string|undefined,editableField:'information'|'conclusion'|'deliverable')=>(
    <section className="qp-panel qp-task-section"><h3><Icon name={icon} size={18}/>{name}</h3>{edit
      ? <textarea aria-label={name} rows={4} maxLength={8000} value={form[editableField]??''} onChange={event=>field(editableField,event.target.value)}/>
      : text?<p>{text}</p>:empty(name,icon)}</section>
  );
  return <article className="qp-task" ref={details}>
    <header className="qp-task-head">
      <div className="qp-task-heading"><span className="qp-title-icon"><Icon name="check-square" size={21}/></span><h2>{node.title}</h2><span className={'qp-task-state '+node.bucket}>{node.state}</span></div>
      {datesOnly? <button type="button" className="qp-icon" aria-label="关闭排期编辑" onClick={close}><Icon name="close" size={16}/></button>:
        <div className="qp-actions">
          {attention && !edit && <button className="qp-btn primary" type="button" onClick={openAction}>{attention.action}<Icon name="arrow-right" size={14}/></button>}
          {(!sourceTask || showResearch || edit) && <button className={attention && !edit ? "qp-btn" : "qp-btn primary"} type="button" disabled={busy} onClick={()=>void research()}><Icon name="play" size={14}/>{busy?'请稍候…':'开始研究'}</button>}
          <button type="button" className="qp-icon" aria-label="更多任务操作" aria-expanded={more} onClick={()=>setMore(!more)}>···</button>
        </div>}
    </header>
    {!datesOnly && !edit && <TaskMaterials query={taskMaterialQuery(snap,taskId,node.itemId)} onOpenNote={onOpenNote}/>}
    {more && <div className="qp-actions qp-task-options"><button type="button" className="qp-btn" onClick={()=>void openTaskDirection(taskId,node.itemId)}>查看讨论记录</button><button type="button" className="qp-btn" onClick={()=>openWorkspace(taskId,{view:'tasks',itemId:node.itemId,selected:node.itemId})}>详细任务操作</button></div>}
    <div className="qp-task-meta">
      <span><Icon name="user" size={14}/>{node.owner||'未分派'}</span>
      <span><Icon name="calendar" size={14}/>{current.start&&current.end?current.start+' 至 '+current.end:current.end||current.start||'未排期'}</span>
      <span className="qp-priority" data-priority={current.priority}>{current.priority?'优先级 '+current.priority:'未设优先级'}</span>
      {!datesOnly && <button type="button" className="qp-btn" onClick={()=>requestProductDispatch({taskId,itemId:node.itemId,projectId:snap.project.id})}><Icon name="plane" size={14}/>分派</button>}
      {!edit && <button type="button" className="qp-btn" onClick={startEdit}><Icon name="pencil" size={14}/>编辑任务信息</button>}
    </div>
    {edit && <div className="qp-form-row qp-edit-meta"><label>开始日期<input type="date" value={form.start??''} onChange={event=>field('start',event.target.value)}/></label><label>截止日期<input type="date" value={form.end??''} onChange={event=>field('end',event.target.value)}/></label><label>优先级<select value={form.priority??''} onChange={event=>field('priority',event.target.value)}><option value="">未设置</option>{priorityLevels.map(level=><option key={level}>{level}</option>)}</select></label><label className="qp-milestone-control"><input type="checkbox" checked={form.milestone??false} onChange={event=>setForm(prev=>({...prev,milestone:event.target.checked}))}/>标为里程碑</label></div>}
    {!datesOnly && <>
      {!edit && <TaskWorkspaces snapshot={snap} taskId={taskId} itemId={node.itemId}/>}
      {openDecisionTask && !edit && <SharedDecisions taskKey={key} openTask={openDecisionTask}/>}
      {sourceTask ? <NoteDispatchTrail task={sourceTask} results={results} onOpenNote={onOpenNote} onResult={showResults}/> : <TaskResultPreview results={results} onResult={showResults}/>}
      {sourceTask && !edit && <button type="button" className="qn-source-link" aria-expanded={showResearch} onClick={()=>setShowResearch(!showResearch)}>{showResearch?'收起研究与验收要求':'查看研究与验收要求'}<Icon name={showResearch?'chevron-down':'chevron-right'} size={13}/></button>}
      {(!sourceTask || showResearch || edit) && <>{!repeatsGoal && <p className="qp-task-objective" onPointerUp={selectText} onKeyUp={event=>{if(event.shiftKey)selectText();}}>{goal}</p>}
      <div className="qp-task-sections" onPointerUp={selectText} onKeyUp={event=>{if(event.shiftKey)selectText();}}>
        {section('研究信息','flask',current.information,'information')}
        {section('研究结论','bulb',current.conclusion,'conclusion')}
        <section className="qp-panel qp-task-section"><h3><Icon name="check-square" size={18}/>验收标准</h3>{edit?<textarea aria-label="验收标准" rows={4} value={criteria} onChange={event=>setCriteria(event.target.value)}/>:specification?.criteria.length?<ul>{specification.criteria.map((text,index)=><li key={index}>{text}</li>)}</ul>:empty('验收标准','check-square')}</section>
        {section('交付物','box',current.deliverable,'deliverable')}
      </div>
      </>}
      {anchor&&<div className={'qp-passage'+(asking?' is-open':'')} style={{top:anchor.top,left:`clamp(0px, ${anchor.left}px, 100% - var(--qp-passage-width))`}}>
        {asking?<form onSubmit={event=>{event.preventDefault();if(question.trim())void research(true);}}>
          <q>{quote}</q><input aria-label="询问选中文字" autoFocus value={question} maxLength={1200} onChange={event=>setQuestion(event.target.value)} placeholder="想了解什么？"/>
          <button type="submit" aria-label="发送提问" className="qp-btn primary" disabled={busy||!question.trim()}><Icon name="plane" size={16}/></button>
          <button type="button" className="qp-icon" aria-label="关闭提问" onClick={hideQuestion}><Icon name="close" size={15}/></button></form>
          :<button type="button" className="qp-btn" onClick={()=>setAsking(true)}><Icon name="message" size={15}/>讨论这段</button>}
      </div>}
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
        {!results.length && <button type="button" className="qp-btn" onClick={()=>showResults()}>看成果</button>}
        <TaskOutputButton taskId={taskId} itemId={node.itemId}/>
      </div>
    </>}
    {edit && changesAcceptance && <p className="qp-muted">更新验收要求后，旧成果可在历史中查看，这项任务需要重新验收。</p>}
    {edit && <div className="qp-actions qp-task-foot"><button type="button" className="qp-btn primary" disabled={busy||!api.updateProjectPlanning} onClick={()=>void save()}>确认保存</button><button type="button" className="qp-btn" onClick={()=>{setEdit(false);close?.();}}>取消</button></div>}
    {error && <p className="qp-error" role="alert">{error}</p>}
  </article>;
}
