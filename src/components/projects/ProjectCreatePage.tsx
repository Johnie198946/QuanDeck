import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { desktopHost } from '../../integration/desktop';
import { readPlanTasks } from '../../data/projectWorkflow';
import { fileSize } from '../../data/outputFiles';
import { MAX_ATTACHMENT_BYTES, MAX_TASK_ATTACHMENTS } from '../../data/taskAttachments';
import { Icon } from '../ui/Icon';
import './project-create.css';
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
  supplement: string;
}
type CreationStep = 1 | 2 | 3;
interface SavedDraft extends CreationDraft {
  step?: CreationStep;
  furthest?: CreationStep;
  analysis?: ProjectAnalysis;
  needsUpdate?: boolean;
  omitted?: string[];
  selected?: string;
}
const empty = (): CreationDraft => ({id:crypto.randomUUID(),name:'',goal:'',deadline:'',owner:'',files:[],tasks:[],context:'',supplement:''});
// Finish a departing page's write before the next project form reads the draft.
let draftQueue: Promise<unknown> = Promise.resolve();
function draftStorage(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest) {
  const request = draftQueue.then(() => runDraftTransaction(mode,work));
  draftQueue = request.catch(()=>{});
  return request;
}
function runDraftTransaction(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest) {
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
function ReferenceFile({file,onRemove}: {file: File; onRemove: () => void}) {
  const [thumbnail,setThumbnail] = useState('');
  useEffect(() => {
    if (!file.type.startsWith('image/')) {setThumbnail(''); return;}
    const url = URL.createObjectURL(file);
    setThumbnail(url);
    return () => URL.revokeObjectURL(url);
  },[file]);
  return <div className="qp-uploaded-file">
    {thumbnail ? <img src={thumbnail} alt=""/> : <Icon name="folder" size={18}/>}
    <span>{file.name}<small>{fileSize(file.size)}</small></span>
    <button type="button" className="qp-icon" aria-label={'移除 '+file.name} onClick={onRemove}><Icon name="close" size={13}/></button>
  </div>;
}
export function ProjectCreatePage({onCancel,onCreated}: {onCancel:()=>void;onCreated:(projectId:string)=>void}) {
  const {api,refreshProjects,switchProject,toast} = useWorkdeck();
  const [draft,setDraft] = useState(empty);
  const [ready,setReady] = useState(false);
  const [step,setStep] = useState<CreationStep>(1);
  const [furthest,setFurthest] = useState<CreationStep>(1);
  const showStep = (next: CreationStep) => {
    setStep(next);
    setFurthest(previous => previous > next ? previous : next);
    setError('');
  };
  const [analysis,setAnalysis] = useState<ProjectAnalysis>();
  const [needsUpdate,setNeedsUpdate] = useState(false);
  const [omitted,setOmitted] = useState<string[]>([]);
  const [analyzing,setAnalyzing] = useState(false);
  const analysisSequence = useRef(0);
  const inflight = useRef(false);
  const [selected,setSelected] = useState('');
  const [undo,setUndo] = useState<TaskDraft[][]>([]);
  const [isBusy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const pendingDraft = useRef<SavedDraft | undefined>(undefined);
  const lastStored = useRef<SavedDraft | undefined>(undefined);
  const created = useRef(false);
  const drag = useRef('');
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const labels = new Map(draft.tasks.map(task=>[task.key,task]));
  const current = labels.get(selected);
  const background = [draft.context.trim(),draft.supplement.trim()].filter(Boolean).join('\n\n');
  const confirmed = analysis && !needsUpdate ? analysis : undefined;
  useEffect(()=>{
    let active = true;
    void draftStorage('readonly',store=>store.get('current')).then(saved=>{
      if (!active || !saved) return;
      const {step,furthest,analysis,selected,needsUpdate,omitted,...data} = saved as SavedDraft;
      lastStored.current = saved as SavedDraft;
      const resumed = step || (data.tasks.length ? 3 : 1);
      setDraft({...data,supplement:data.supplement ?? ''});
      setStep(resumed);
      setFurthest(furthest || resumed);
      setSelected(data.tasks.find(task => task.key === selected)?.key ?? data.tasks[0]?.key ?? '');
      // Older drafts stored suggestions without a grounded knowledge review.
      if (analysis?.sourceId && Array.isArray(analysis.recommendations) && Array.isArray(analysis.attachments)) {
        setAnalysis(analysis); setNeedsUpdate(!!needsUpdate);
        setOmitted(omitted ?? []);
      }
    }).catch(()=>{}).finally(()=>{if(active)setReady(true);});
    return ()=>{active=false;analysisSequence.current++;inflight.current=false;};
  },[]);
  useLayoutEffect(()=>{
    if (!ready) return;
    const hasContent = draft.name || draft.goal || draft.deadline || draft.owner || draft.files.length || draft.tasks.length || draft.context || draft.supplement;
    pendingDraft.current = hasContent || lastStored.current ? {...draft,step,furthest,selected,analysis,needsUpdate,omitted} : undefined;
  },[ready,draft,step,furthest,selected,analysis,needsUpdate,omitted]);
  useEffect(()=>{
    const persist = () => {
      const value = pendingDraft.current;
      if (!value || value === lastStored.current || created.current) return;
      void draftStorage('readwrite',store=>store.put(value,'current')).then(()=>{
        lastStored.current = value;
      }).catch(()=>toast('项目草稿未能保存，请检查本机存储','error'));
    };
    window.addEventListener('pagehide',persist);
    return () => {window.removeEventListener('pagehide',persist);persist();};
  },[toast]);
  const update = <K extends keyof CreationDraft>(field: K,value: CreationDraft[K])=>{
    setDraft(prev=>({...prev,[field]:value}));
    setMessage('');
    if (['name','goal','files','context','supplement','deadline'].includes(field)) {
      analysisSequence.current++;
      inflight.current=false; setAnalyzing(false); setError('');
      if (field==='supplement') setNeedsUpdate(true);
      else {setAnalysis(undefined);setOmitted([]);setNeedsUpdate(false);}
    }
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
  const runAnalysis = async () => {
    if (lock.current || inflight.current) return;
    const analyze = desktopHost()?.analyzeProject;
    if (!analyze) {setError('这里尚未连接 AI。可在桌面版连接 Agent 后重试，或继续手动创建。');return;}
    if (background.length > 16000) {setError('背景和补充合计最多 16000 字，请精简后重试。');return;}
    const ticket = ++analysisSequence.current;
    inflight.current=true; setAnalyzing(true); setError(''); setMessage('');
    try {
      const files = await Promise.all(draft.files.map(async file => ({name:file.name,type:file.type,bytes:await file.arrayBuffer()})));
      if (analysisSequence.current !== ticket) return;
      const questions = needsUpdate && draft.supplement.trim() ? analysis?.questions : undefined;
      const result = await analyze({
        name:draft.name.trim(),goal:draft.goal.trim(),information:background,deadline:draft.deadline,files,
        ...(questions?.length ? {previousQuestions:questions} : {}),
      });
      if (analysisSequence.current !== ticket) return;
      if (!result?.sourceId || !Array.isArray(result.recommendations) || !Array.isArray(result.attachments)) throw Error('没有收到完整的 AI 需求理解，请重试。');
      setAnalysis(result);setNeedsUpdate(false);
      setOmitted(previous => previous.filter(id=>result.recommendations!.some(row=>row.id===id)));
    } catch(cause) {
      if (analysisSequence.current===ticket) setError(cause instanceof Error?cause.message:'AI 暂时没有回复，请重试。');
    } finally {
      if (analysisSequence.current===ticket) {inflight.current=false;setAnalyzing(false);}
    }
  };
  const advance = () => {
    if (!draft.name.trim() || !draft.goal.trim()) {setError('请填写项目名称和目标');return;}
    showStep(2);
    if (!confirmed) void runAnalysis();
  };
  const save = async () => {
    const value = pendingDraft.current ?? {...draft,step,furthest,selected,analysis,needsUpdate,omitted};
    try {await draftStorage('readwrite',store=>store.put(value,'current'));lastStored.current=value;setMessage('草稿已保存');}
    catch {setError('草稿未能保存，请检查本机存储');}
  };
  const create = async () => {
    if(lock.current || inflight.current) return;
    if (background.length > 16000) {setError('背景和补充合计最多 16000 字，请精简后重试。');setStep(1);return;}
    if (analysis && needsUpdate) {setError('请先更新需求理解，再创建项目。');setStep(2);return;}
    if(!draft.name.trim()||!draft.goal.trim()) {setError('请填写项目名称和目标');setStep(1);return;}
    lock.current = true;
    setBusy(true);setError('');
    try {
      const included=(task:TaskDraft):boolean=>task.include && (!task.parentKey || !!labels.get(task.parentKey) && included(labels.get(task.parentKey)!));
      const drafts = readPlanTasks(draft.tasks.filter(included).map(task=>({...task,expected:task.expected.trim() || '按任务标题核对交付'}))) ?? [];
      const files = await Promise.all(draft.files.map(async file=>({name:file.name,type:file.type,bytes:await file.arrayBuffer()})));
      const receipt = await api.createProject({
        name:draft.name,description:draft.goal,deadline:draft.deadline,ownerName:draft.owner,
        setup:{requestId:draft.id,tasks:drafts,files,background,
          ...(confirmed && {understanding:{summary:confirmed.summary,sourceId:confirmed.sourceId,attachments:confirmed.attachments ?? [],
            recommendations:(confirmed.recommendations ?? []).filter(row=>!omitted.includes(row.id))}})},
      });
      if (!receipt.ok || !receipt.projectId) throw Error(receipt.message || '项目未能创建');
      created.current = true;
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
    <header className="qp-head"><button className="qp-icon" type="button" aria-label="返回帮你管" title="返回帮你管" onClick={onCancel} disabled={isBusy}><Icon name="chevron-left" size={19}/></button><h1>新建项目</h1></header>
    <fieldset disabled={isBusy} className="qp-form-steps">
      <section className="qp-panel qp-step">
        <button type="button" className="qp-step-title" onClick={()=>showStep(1)} aria-expanded={step===1}><span>1</span>创建项目{step!==1 && <small>{draft.name}</small>}<Icon name={step===1?"chevron-down":"chevron-right"} size={16}/></button>
        {step===1 && <div className="qp-form">
          <div className="qp-create-fields">
            <label>项目名称<input required value={draft.name} maxLength={80} onChange={event=>update('name',event.target.value)}/></label>
            <label>截止日期<input type="date" value={draft.deadline} onChange={event=>update('deadline',event.target.value)}/></label>
            <label className="qp-project-goal">项目目标<textarea required rows={3} value={draft.goal} maxLength={2500} onChange={event=>update('goal',event.target.value)}/></label>
            <label>负责人<input value={draft.owner} maxLength={40} onChange={event=>update('owner',event.target.value)}/></label>
          </div>
          <label>项目背景（可选）<textarea value={draft.context} maxLength={16000} rows={2} onChange={event=>update('context',event.target.value)} placeholder="为什么做这件事？有哪些已知情况或限制？"/></label>
          <div className="qp-create-files">
            <strong>附件 / 参考资料</strong>
            <div className="qp-create-file-list" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();attachments(Array.from(event.dataTransfer.files));}}>
              <button type="button" className="qp-upload-button" aria-label="添加参考资料" onClick={()=>fileInput.current?.click()}>
                <Icon name="inbox" size={20}/><span>点击上传或拖入文件<small>每件最多 25 MB</small></span>
              </button>
              <input ref={fileInput} hidden multiple type="file" onChange={event=>{attachments(Array.from(event.target.files ?? []));event.target.value='';}}/>
              {draft.files.map((file,index)=><ReferenceFile key={index} file={file} onRemove={()=>update('files',draft.files.filter((_,i)=>i!==index))}/>)}
            </div>
          </div>
          <button type="button" className="qp-btn primary" onClick={advance}>理解需求<Icon name="arrow-right" size={15}/></button>
        </div>}
      </section>
      <section className="qp-panel qp-step">
        <button type="button" className="qp-step-title" disabled={furthest<2} aria-label="展开理解需求" onClick={advance} aria-expanded={step===2}><span>2</span>理解需求<Icon name={step===2?"chevron-down":"chevron-right"} size={16}/></button>
        {step===2 && <div className="qp-form">
          <div className="qp-research-columns" aria-busy={analyzing}>
            <section className="qp-brief"><h3><Icon name="bulb"/>AI 需求理解</h3>
              <p>{analyzing ? '正在结合目标、背景和资料分析…' : analysis?.summary || '等待 AI 理解需求。'}</p>
              {!analyzing && needsUpdate && analysis && <small className="qp-muted">上次理解 · 待更新</small>}
              {!analyzing && !!analysis?.attachments?.length && <details className="qp-analysis-files">
                <summary>附件读取情况 · {analysis.attachments.length}</summary>
                <ul>{analysis.attachments.map((file,i)=><li key={i}>{file.name} · {{read:'已读取',partial:'读取了部分内容',unsupported:'该格式暂不支持',failed:'读取失败',empty:'没有可读内容'}[file.status]}</li>)}</ul>
              </details>}
            </section>
            <section className="qp-recommendations"><h3><Icon name="link"/>相关知识与灵感</h3>
              {!analyzing && !!analysis?.recommendations?.length && <small className="qp-muted">勾选的资料将在项目任务间共享</small>}
              {!analyzing && analysis?.recommendations?.length ? analysis.recommendations.map(row=><div className="qp-knowledge-pick" key={row.id}>
                <label><input type="checkbox" checked={!omitted.includes(row.id)} onChange={event=>setOmitted(current=>event.target.checked?current.filter(id=>id!==row.id):[...current,row.id])}/><strong>{row.title}</strong></label>
                <p>{row.use}</p>
                <details><summary>查看依据 · {row.kind}</summary><p>{row.reason}</p><blockquote>{row.quote}</blockquote></details>
              </div>): <p className="qp-muted">{analyzing?'正在筛选可复用的资料…':analysis?'没有找到适合这个项目的资料。':'分析后显示可用的资料。'}</p>}
            </section>
            <section className="qp-create-questions"><h3><Icon name="help-circle"/>待确认的问题</h3>
              {!analyzing && analysis?.questions.length ? <ol>{analysis.questions.map((question,index)=><li key={index}>{question}</li>)}</ol> : <p className="qp-muted">{analyzing?'正在检查信息缺口…':analysis?'暂无需要补充的问题。':'分析后显示需要你补充的问题。'}</p>}
            </section>
          </div>
          <label>补充资料或回答<textarea value={draft.supplement} maxLength={Math.max(0,16000-draft.context.length-2)} rows={2} onChange={event=>update('supplement',event.target.value)}/></label>
          <div className="qp-actions">
            <button type="button" className="qp-btn" disabled={analyzing} onClick={()=>void runAnalysis()}>{analyzing?'正在理解…':analysis?'更新理解':'重试理解'}</button>
            {error && analysis && needsUpdate && <button type="button" className="qp-quiet" onClick={()=>{setAnalysis(undefined);setNeedsUpdate(false);setOmitted([]);showStep(3);}}>手动创建</button>}
            <button type="button" className="qp-btn" disabled={analyzing} onClick={()=>showStep(3)}>校准任务<Icon name="arrow-right" size={15}/></button>
          </div>
        </div>}
      </section>
      <section className="qp-panel qp-step">
        <button type="button" className="qp-step-title" aria-label="展开校准任务" aria-expanded={step===3} disabled={furthest<3 || !draft.name.trim() || !draft.goal.trim()} onClick={()=>showStep(3)}>
          <span>3</span>校准任务{!!draft.tasks.length && <small>{draft.tasks.length} 项</small>}<Icon name={step===3?"chevron-down":"chevron-right"} size={16}/>
        </button>
        {step===3 && <>
        <div className="qp-actions qp-draft-tools">
          <button type="button" className="qp-btn" onClick={()=>add()}><Icon name="plus" size={15}/>添加任务</button>
          <button type="button" className="qp-btn" disabled={analyzing} onClick={()=>void runAnalysis()}><Icon name="bulb" size={15}/>AI 拆解</button>
          {!!confirmed?.tasks.length && <button type="button" className="qp-btn" onClick={()=>{setTasks(confirmed.tasks);setSelected(confirmed.tasks[0].key);setAnalysis({...confirmed,tasks:[]});}}>采用本次拆解</button>}
          <button type="button" className="qp-btn" disabled={!undo.length} onClick={()=>{update('tasks',undo.at(-1)!);setUndo(prev=>prev.slice(0,-1));}}><Icon name="undo" size={14}/>撤销</button>
        </div>
        {!!confirmed?.tasks.length && <details className="qp-draft-preview"><summary>查看 {confirmed.tasks.length} 条建议</summary><ul>{confirmed.tasks.map(task=><li key={task.key}>{task.title}</li>)}</ul></details>}
        <div className="qp-calibrate">
          <div className="qp-draft-tree" aria-label="任务草稿">
            {draft.tasks.length ? draft.tasks.map(task=><div key={task.key} draggable onDragStart={event=>{drag.current=task.key;event.dataTransfer.setData('text/plain',task.key);}} onDragEnd={()=>{drag.current='';}} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();reorder(drag.current,task,event);drag.current='';}}
              className={'qp-draft-row'+(selected===task.key?' is-picked':'')} style={{paddingInlineStart:10+16*draftDepth(task,labels)}}>
              <Icon name="grip" size={13}/><input type="checkbox" aria-label={(task.title||'未命名任务')+' 纳入项目'} checked={task.include} onChange={event=>edit(task.key,{include:event.target.checked})}/><button type="button" className="qp-quiet" onClick={()=>setSelected(task.key)}>{task.title||'未命名任务'}</button>
            </div>) : <p className="qp-muted">还没有任务。可以手动添加或让 AI 拆解。</p>}
          </div>
          {current && <div className="qp-draft-detail qp-form"><h3><Icon name="folder" size={18}/>{current.title || '未命名任务'}</h3>
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
        </>}
      </section>
    </fieldset>
    {error && <p className="qp-error" role="alert">{error}</p>}
    <footer className="qp-create-footer"><span role="status" className="qp-save-message">{message}</span><button type="button" className="qp-btn" disabled={isBusy} onClick={()=>void save()}>保存草稿</button><button type="button" className="qp-btn primary" disabled={isBusy||analyzing||step===1||(!confirmed && step===2)||!!analysis && needsUpdate} onClick={()=>void create()}><Icon name="check" size={16}/>确认创建</button></footer>
  </main>;
}
