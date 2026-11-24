import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { desktopHost } from '../../integration/desktop';
import { readPlanTasks } from '../../data/projectWorkflow';
import { fileSize } from '../../data/outputFiles';
import { knowledgeKindLabels } from '../../data/knowledgeIndex';
import { useKnowledgeRecommendations } from '../knowledge/KnowledgePages';
import { MAX_ATTACHMENT_BYTES, MAX_TASK_ATTACHMENTS } from '../../data/taskAttachments';
import { Icon } from '../ui/Icon';
import type { TaskDraft } from '../../data/types';
import type { ProjectAnalysis } from '../../data/projectAnalysis';

interface CreationDraft {
  id: string;
  name: string;
  goal: string;
  deadline: string;
  owner: string;
  files: File[];
  tasks: TaskDraft[];
  context: string;
}
const empty = (): CreationDraft => ({id:crypto.randomUUID(),name:'',goal:'',deadline:'',owner:'',files:[],tasks:[],context:''});
function draftStorage(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest) {
  return new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('quandeck-project-create-draft',1);
    open.onupgradeneeded = () => open.result.createObjectStore('draft');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('draft',mode);
      const request = work(tx.objectStore('draft'));
      tx.oncomplete = () => {db.close();resolve(request.result);};
      tx.onerror = tx.onabort = () => {db.close();reject(tx.error);};
    };
  });
}
function newDraft(parentKey?: string, title = ''): TaskDraft {
  return {key:crypto.randomUUID(), title, expected:'', owner:'unassigned', deps:[], lineIds:[], include:true, phase:'执行', parentKey};
}
function removeDraft(tasks: TaskDraft[], key: string) {
  const parent = tasks.find(task => task.key === key)?.parentKey;
  return tasks.filter(task => task.key !== key).map(task => ({
    ...task, parentKey:task.parentKey === key ? parent : task.parentKey,
    deps:task.deps.filter(dependency => dependency !== key),
  }));
}
function tryDraftTree(tasks: TaskDraft[]) {
  // An unfinished title or acceptance field can be entered after arranging the tree.
  const valid = readPlanTasks(tasks.map(task => ({...task,title:task.title || '未命名任务',expected:task.expected || '待填写'})));
  const byKey = new Map(tasks.map(task => [task.key,task]));
  return (valid ?? []).map(task=>byKey.get(task.key)!);
}
function draftDepth(task: TaskDraft, tasks: Map<string,TaskDraft>) {
  let depth = 0;
  for (let parent = task.parentKey; parent && depth < tasks.size; parent = tasks.get(parent)?.parentKey) depth++;
  return depth;
}
export function ProjectCreatePage({onCancel,onCreated}: {onCancel:()=>void;onCreated:(projectId:string)=>void}) {
  const {api,refreshProjects,switchProject,toast} = useWorkdeck();
  const [draft,setDraft] = useState(empty);
  const [ready,setReady] = useState(false);
  const [step,setStep] = useState(1);
  const [analysis,setAnalysis] = useState<ProjectAnalysis>();
  const [selected,setSelected] = useState('');
  const [undo,setUndo] = useState<TaskDraft[][]>([]);
  const [isBusy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const drag = useRef('');
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const labels = new Map(draft.tasks.map(task=>[task.key,task]));
  const current = labels.get(selected);
  const related = useKnowledgeRecommendations(step===2 ? draft.name + ' ' + draft.goal : '');
  useEffect(()=>{
    let active = true;
    void draftStorage('readonly',store=>store.get('current')).then(saved=>{
      if (active && saved) {setDraft(saved as CreationDraft);setStep(3);}
    }).catch(()=>{}).finally(()=>{if(active)setReady(true);});
    return ()=>{active=false;};
  },[]);
  const update = <K extends keyof CreationDraft>(field: K,value: CreationDraft[K])=>{
    setDraft(prev=>({...prev,[field]:value}));
    if (field === 'name' || field === 'goal' || field === 'context') setAnalysis(undefined);
  };
  const setTasks = (tasks:TaskDraft[])=>{
    try {
      const ordered = tryDraftTree(tasks);
      setUndo(prev=>[...prev.slice(-24),draft.tasks]);
      update('tasks',ordered);
      setError('');
    } catch(cause) {setError(String(cause instanceof Error?cause.message:cause));}
  };
  const edit = (key:string, patch:Partial<TaskDraft>) => update('tasks',draft.tasks.map(task=>task.key===key?{...task,...patch}:task));
  const add = (parentKey?: string, title?: string) => {
    if (draft.tasks.length >= 100) return;
    const task = newDraft(parentKey,title);
    setTasks([...draft.tasks,task]);
    setSelected(task.key);
  };
  const reorder = (from:string,target:TaskDraft,event:DragEvent) => {
    if (!from||from===target.key) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dropInside = event.clientX > bounds.left + 60;
    const before = event.clientY < bounds.top + bounds.height / 2;
    const source = labels.get(from);
    if (!source) return;
    const rows = draft.tasks.filter(task=>task.key!==from);
    const index = rows.findIndex(task=>task.key===target.key);
    rows.splice(index + (before ? 0 : 1), 0, {...source,parentKey:dropInside ? target.key : target.parentKey});
    setTasks(rows);
  };
  const attachments = (files:File[]) => {
    const all = [...draft.files,...files];
    if (all.length>MAX_TASK_ATTACHMENTS || all.some(file=>file.size>MAX_ATTACHMENT_BYTES) || all.reduce((total,file)=>total+file.size,0)>50*1024*1024) {
      setError('附件最多 20 件，每件最多 25 MB，合计最多 50 MB');
      return;
    }
    update('files',all);
    setError('');
  };
  const advance = () => {
    if (!draft.name.trim() || !draft.goal.trim()) {setError('请填写项目名称和目标');return;}
    setError('');
    setStep(2);
  };
  const runAnalysis = async () => {
    if (lock.current) return;
    const analyze = desktopHost()?.analyzeProject;
    if (!analyze) {setError('这里尚未连接 AI，可以直接填写任务。');return;}
    lock.current=true; setBusy(true); setError('');
    try {
      const notes = await Promise.all(draft.files.map(async file => {
        const textual = /^text\//i.test(file.type) || /\.(txt|md|csv|tsv|json|log)$/i.test(file.name);
        return textual ? `文字附件 ${file.name}\n${await file.slice(0, 5000).text()}` : `附件 ${file.name}（本次仅提供文件名）`;
      }));
      const information = [draft.context, ...notes].filter(Boolean).join('\n\n').slice(0,16000);
      setAnalysis(await analyze({goal:draft.goal, information}));
      setMessage('已收到建议，等你校准。');
    }
    catch(cause) {setError(cause instanceof Error?cause.message:'AI 暂时没有回复');}
    finally {lock.current=false;setBusy(false);}
  };
  const save = async () => {
    try {await draftStorage('readwrite',store=>store.put(draft,'current'));setMessage('草稿已保存');}
    catch {setError('草稿未能保存，请检查本机存储');}
  };
  const create = async () => {
    if(lock.current) return;
    if(!draft.name.trim()||!draft.goal.trim()) {setError('请填写项目名称和目标');setStep(1);return;}
    lock.current = true;
    setBusy(true);setError('');
    try {
      const included=(task:TaskDraft):boolean=>task.include && (!task.parentKey || !!labels.get(task.parentKey) && included(labels.get(task.parentKey)!));
      const drafts = readPlanTasks(draft.tasks.filter(included).map(task=>({...task,expected:task.expected.trim() || '按任务标题核对交付'}))) ?? [];
      const files = await Promise.all(draft.files.map(async file=>({name:file.name,type:file.type,bytes:await file.arrayBuffer()})));
      const receipt = await api.createProject({
        name:draft.name,description:draft.goal,deadline:draft.deadline,ownerName:draft.owner,
        setup:{requestId:draft.id,tasks:drafts,files,background:draft.context},
      });
      if (!receipt.ok || !receipt.projectId) throw Error(receipt.message || '项目未能创建');
      await draftStorage('readwrite',store=>store.delete('current')).catch(()=>{});
      await refreshProjects();
      await switchProject(receipt.projectId);
      toast('项目已创建');
      onCreated(receipt.projectId);
    } catch(cause) {setError(cause instanceof Error?cause.message:'项目未能创建');}
    finally {lock.current=false;setBusy(false);}
  };
  if(!ready) return <main className="qp-create" aria-busy="true"><h1>新建项目</h1></main>;
  return <main className="qp-create">
    <header className="qp-head"><button className="qp-quiet" type="button" onClick={onCancel} disabled={isBusy}><Icon name="chevron-left" size={16}/>帮你管</button><h1>新建项目</h1></header>
    <fieldset disabled={isBusy} className="qp-form-steps">
      <section className="qp-panel qp-step">
        <button type="button" className="qp-step-title" onClick={()=>setStep(1)} aria-expanded={step===1}><span>1</span>创建项目{step!==1 && <small>{draft.name}</small>}</button>
        {step===1 && <div className="qp-form">
          <div className="qp-form-row"><label>项目名称<input value={draft.name} maxLength={80} required onChange={event=>update('name',event.target.value)}/></label><label>截止日期<input type="date" value={draft.deadline} onChange={event=>update('deadline',event.target.value)}/></label><label>负责人<input value={draft.owner} maxLength={40} onChange={event=>update('owner',event.target.value)}/></label></div>
          <label>项目目标<textarea rows={4} value={draft.goal} maxLength={2500} required onChange={event=>update('goal',event.target.value)}/></label>
          <div className="qp-files" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();attachments(Array.from(event.dataTransfer.files));}}><button type="button" className="qp-btn" onClick={()=>fileInput.current?.click()}><Icon name="plus" size={14}/>添加参考资料</button>
            <input ref={fileInput} hidden multiple type="file" onChange={event=>{attachments(Array.from(event.target.files ?? []));event.target.value='';}}/>
            {draft.files.map((file,index)=><span key={index}>{file.name} · {fileSize(file.size)} <button type="button" className="qp-icon" aria-label={'移除 '+file.name} onClick={()=>update('files',draft.files.filter((_,i)=>i!==index))}><Icon name="close" size={12}/></button></span>)}
          </div>
          <button type="button" className="qp-btn primary" onClick={advance}>理解需求<Icon name="arrow-right" size={15}/></button>
        </div>}
      </section>
      {(step>=2 || draft.tasks.length>0) && <section className="qp-panel qp-step">
        <button type="button" className="qp-step-title" onClick={()=>setStep(2)} aria-expanded={step===2}><span>2</span>理解需求</button>
        {step===2 && <div className="qp-form">
          <div className="qp-brief"><h3>{analysis?'AI 理解':'项目目标'}</h3><p>{analysis?.summary || draft.goal}</p></div>
          {!!analysis?.questions.length && <div><h3>需要核对</h3><ul>{analysis.questions.map(question=><li key={question}>{question}</li>)}</ul></div>}
          <label>补充资料或回答<textarea value={draft.context} maxLength={16000} rows={3} onChange={event=>update('context',event.target.value)}/></label>
          {!!related.length && <section className="qp-recommendations"><h3>相关知识</h3>{related.map(source=>{
            const excerpt = source.excerpt || source.text.slice(0,150);
            const reference = [source.title, source.projectName || knowledgeKindLabels[source.kind], excerpt].filter(Boolean).join(' · ');
            return <details key={source.id}>
              <summary><strong>{source.title}</strong><small>{source.projectName || knowledgeKindLabels[source.kind]}</small></summary>
              <p>{excerpt || '无文字摘录'}</p>
              {!!excerpt && <button className="qp-btn" type="button" disabled={draft.context.includes(reference) || draft.context.length+reference.length+2>16000} onClick={()=>update('context',[draft.context,reference].filter(Boolean).join('\n\n'))}>引用这段资料</button>}
            </details>;
          })}</section>}
          {!!draft.files.length && <small className="qp-muted">AI 可读取文字附件的开头。图片和其他文件请在补充资料中说明。</small>}
          <div className="qp-actions"><button type="button" className="qp-btn" onClick={()=>void runAnalysis()}>{isBusy?'正在研究…':'开始研究'}</button><button type="button" className="qp-btn primary" onClick={()=>setStep(3)}>校准任务<Icon name="arrow-right" size={15}/></button></div>
        </div>}
      </section>}
      {step>=3 && <section className="qp-panel qp-step">
        <div className="qp-step-title"><span>3</span>校准任务</div>
        <div className="qp-actions qp-draft-tools">
          <button type="button" className="qp-btn" onClick={()=>add()}><Icon name="plus" size={15}/>添加任务</button>
          <button type="button" className="qp-btn" onClick={()=>void runAnalysis()}>AI 拆解</button>
          {!!analysis?.tasks.length && <button type="button" className="qp-btn" onClick={()=>{setTasks(analysis.tasks);setSelected(analysis.tasks[0].key);setAnalysis({...analysis,tasks:[]});}}>采用本次拆解</button>}
          <button type="button" className="qp-btn" disabled={!undo.length} onClick={()=>{update('tasks',undo.at(-1)!);setUndo(prev=>prev.slice(0,-1));}}><Icon name="undo" size={14}/>撤销</button>
        </div>
        {!!analysis?.tasks.length && <details className="qp-draft-preview"><summary>查看 {analysis.tasks.length} 条建议</summary><ul>{analysis.tasks.map(task=><li key={task.key}>{task.title}</li>)}</ul></details>}
        <div className="qp-calibrate">
          <div className="qp-draft-tree" aria-label="任务草稿">
            {draft.tasks.length ? draft.tasks.map(task=><div key={task.key} draggable onDragStart={event=>{drag.current=task.key;event.dataTransfer.setData('text/plain',task.key);}} onDragEnd={()=>{drag.current='';}} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();reorder(drag.current,task,event);drag.current='';}}
              className={'qp-draft-row'+(selected===task.key?' is-picked':'')} style={{paddingInlineStart:10+16*draftDepth(task,labels)}}>
              <Icon name="grip" size={13}/><input type="checkbox" aria-label={(task.title||'未命名任务')+' 纳入项目'} checked={task.include} onChange={event=>edit(task.key,{include:event.target.checked})}/><button type="button" className="qp-quiet" onClick={()=>setSelected(task.key)}>{task.title||'未命名任务'}</button>
            </div>) : <p className="qp-muted">还没有任务。可以手动添加或让 AI 拆解。</p>}
          </div>
          {current && <div className="qp-draft-detail qp-form">
            <label>任务名称<input value={current.title} maxLength={200} onChange={event=>edit(current.key,{title:event.target.value})}/></label>
            <label>验收标准<textarea rows={3} maxLength={2000} value={current.expected} onChange={event=>edit(current.key,{expected:event.target.value})}/></label>
            <label>上级任务<select value={current.parentKey??''} onChange={event=>setTasks(draft.tasks.map(task=>task.key===current.key?{...task,parentKey:event.target.value||undefined}:task))}>
              <option value="">主任务</option>{draft.tasks.filter(task=>task.key!==current.key).map(task=><option key={task.key} value={task.key}>{task.title||'未命名任务'}</option>)}
            </select></label>
            <div className="qp-actions">
              <button type="button" className="qp-quiet" onClick={()=>add(current.key)}>拆出子任务</button>
              <button type="button" className="qp-quiet" disabled={draft.tasks[0]===current} onClick={()=>{
                const before = draft.tasks[draft.tasks.indexOf(current)-1];
                if(before) {setTasks(removeDraft(draft.tasks,current.key).map(task=>task.key===before.key?{...task,title:[task.title,current.title].filter(Boolean).join(' / '),expected:[task.expected,current.expected].filter(Boolean).join('\n')}:task)); setSelected(before.key);}
              }}>并入上一项</button>
              <button type="button" className="qp-quiet" onClick={()=>{setTasks(removeDraft(draft.tasks,current.key));setSelected('');}}>移除</button>
            </div>
          </div>}
        </div>
      </section>}
    </fieldset>
    {error && <p className="qp-error" role="alert">{error}</p>}
    <footer className="qp-create-footer"><span role="status">{message}</span><button type="button" className="qp-btn" disabled={isBusy} onClick={()=>void save()}>保存草稿</button><button type="button" className="qp-btn primary" disabled={isBusy||step<3} onClick={()=>void create()}><Icon name="check" size={16}/>确认创建</button></footer>
  </main>;
}
