import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { NoteDispatchDirectory, useDispatchDirectory } from './NoteDispatchDirectory';
import { NoteResultContinuation, useNoteContinuation } from './NoteResultContinuation';
import { noteTaskKey, noteSelectionTaskKey, type NoteSourceRef } from '../../data/noteTaskSource';
import { DeferredNoteImage } from './NoteThumbnail';
import { copyNoteDispatchPictures, type DispatchPictureChoices } from '../../data/noteDispatchPictures';
import type { OutputAttachment } from '../../data/types';
import { clearProjectDraft, projectDraftInput, storeProjectDraft, type ProjectIntake, type SavedProjectDraft } from '../../data/projectIntake';
import { ProjectConflictActions, ProjectIntakeFields } from '../projects/ProjectIntakeFields';
import { AgentLogo } from '../ui/AgentLogo';
import { projectBackground } from '../../data/projectUnderstanding';
import { noteRequirement } from '../../data/noteRequirement';
import { noteLogicGroups, findNoteLogicGroups } from '../../data/noteDispatchLogic';
import { useKnowledgeLibrary } from './useKnowledgeLibrary';
import { readKnowledge } from '../../data/knowledgeStore';
import { projectMaterialContext, visibleTaskMaterials } from '../../data/taskMaterialContext';
import { createMaterialRecall } from '../../data/materialRecall';
import { MaterialList } from '../projects/TaskMaterials';
import { sendNoteDispatch } from '../../data/sendNoteDispatch';
import type { RuntimeCommands } from '../../data/runtimeContracts';
import { desktopHost } from '../../integration/desktop';
import { canAttemptAgentDispatch } from '../../integration/agentProfiles';
import { testForConfig, useConfiguredAgents } from '../../integration/configuredAgents';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import '../work/task-handoff.css';
import './note-send.css';

export interface NoteTaskSource extends NoteSourceRef {
  noteTitle: string;
  text: string;
  selected?: boolean;
  localDraft?: boolean;
  pictures?: DispatchPictureChoices;
  draftUrls?: ReadonlyMap<string,string>;
  continueFrom?: {projectId:string; artifactId:string};
}

interface SendPreference { projectId:string; agentId:string; methodId?:string; methodIds?:string[]; customTags?:string[]; customSource?:string }
function readPreference(key:string): SendPreference | undefined {
  try {
    const record = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (record && ['projectId','agentId'].every(field => typeof record[field] === 'string') &&
        [record.methodIds, record.customTags].every(value => value === undefined || (Array.isArray(value) && value.every(item=>typeof item==='string')))) return record;
  } catch { /* Storage can be unavailable in private browsing. */ }
}

export interface NoteSendReceipt { projectId:string; taskId:string; message:string }
const lastDestinationKey = 'quandeck.note-dispatch.last-destination.v1';

export function NoteTaskDialog({ source, onDispatched, onOpenTask, onClose }: { source: NoteTaskSource; onDispatched?: (receipt:NoteSendReceipt) => void; onOpenTask: (task: { projectId:string; taskId:string }) => void; onClose: () => void }) {
  const { api, snap, projectSnapshots, refreshProjects, toast } = useWorkdeck();
  const projects = [snap,...projectSnapshots.filter(row => row.project.id !== snap.project.id)]
    .filter(row => row.project.id && !row.project.deletedAt);
  const brief = useMemo(() => noteRequirement(source.text), [source.text]);
  const additionalCriteria = brief.criteria.filter(value=>!source.text.split(/\r?\n/u).some(line=>line.trim().replace(/^[-*•]\s+/u,'')===value.trim().replace(/^[-*•]\s+/u,'')));
  const preferenceKey = 'quandeck.note-dispatch.destination.v1.' + source.noteId;
  const [preferred] = useState(() => readPreference(preferenceKey));
  const [lastDestination] = useState(() => readPreference(lastDestinationKey));
  const [projectId, setProjectId] = useState(() =>
    source.continueFrom?.projectId ?? [preferred?.projectId, lastDestination?.projectId].find(id => projects.some(row => row.project.id === id)) ?? projects[0]?.project.id ?? '');
  const [intake,setIntake] = useState<ProjectIntake>(()=>({
    name:source.noteTitle.trim().slice(0,80), goal:brief.goal.slice(0,2500), context:'', owner:'', deadline:'', files:[],
  }));
  const {name,goal,context:background} = intake;
  const intakeEdits = useRef(new Set<keyof ProjectIntake>());
  const updateIntake = <K extends keyof ProjectIntake>(key:K,value:ProjectIntake[K]) => {
    intakeEdits.current.add(key);
    setIntake(current=>({...current,[key]:value}));
  };
  const setBackground = (value:string) => updateIntake('context',value);
  const [optionsOpen,setOptionsOpen] = useState(false);
  const projectDraft = useRef<SavedProjectDraft | undefined>(undefined);
  const requestId = useRef<string>('');
  if (!requestId.current) requestId.current = crypto.randomUUID();
  const [pictureIds,setPictureIds] = useState(() => source.pictures?.suggested.map(file=>file.id) ?? []);
  const [textOnly,setTextOnly] = useState(false);
  const selectedPictures = source.pictures?.options.filter(file=>pictureIds.includes(file.id)) ?? [];
  const savedPictures = useRef<{projectId:string;selection:string;files:OutputAttachment[]} | undefined>(undefined);
  const previousProject = useRef(projectId);
  const [creationConflict,setCreationConflict] = useState<{id:string;name:string}>();
  const [createdProject,setCreatedProject] = useState<{id:string;name:string}>();
  const completedDraft = useRef(false);
  const creating = !projectId;
  const [agentChoice, setAgentChoice] = useState<string>();
  const [methods,setMethods] = useState<ReturnType<typeof noteLogicGroups>>([]);
  const [methodIds,setMethodIds] = useState<string[]>([]);
  const [customTags,setCustomTags] = useState<string[]>([]);
  const [tagQuery,setTagQuery] = useState('');
  const [editingTags,setEditingTags] = useState(false);
  const sourceKey = source.selected ? noteSelectionTaskKey(source,source.text) : noteTaskKey(source.noteId,source.lineIndex,source.text);
  const draftKey = 'note-dispatch:' + sourceKey;
  const [methodState,setMethodState] = useState<'loading'|'ready'|'error'>('loading');
  const {library, ready:libraryReady, error:libraryError} = useKnowledgeLibrary();
  const [sent, setSent] = useState<{ projectId: string; taskId: string; message: string; title:string; retryable?:boolean }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const target = projects.find(row => row.project.id === projectId);
  const continuation = useNoteContinuation(target,source.continueFrom ? '' : source.text,source.continueFrom?.artifactId);
  const continuing = !!projectId && continuation.enabled;
  const materialContext = creating ? [goal,background].filter(Boolean).join('\n') : target && projectMaterialContext(target);
  const findMaterial = useMemo(() => optionsOpen ? createMaterialRecall(library.notes) : undefined, [library.notes,optionsOpen]);
  const materialMatches = useMemo(() => findMaterial ? visibleTaskMaterials(findMaterial,{
    text:source.text, context:materialContext, projectId:projectId || undefined, projectName:target?.project.name ?? name.trim(),
    ...(source.todoId && {exclude:{noteId:source.noteId,todoId:source.todoId}}),
  }) : [], [findMaterial,source.text,source.noteId,source.todoId,projectId,target?.project.name,name,materialContext]);
  const {configured,reusableProfiles,tested} = useConfiguredAgents(target?.agents ?? []);
  const runtime = api as typeof api & Partial<RuntimeCommands>;
  const canRun = api.mode === 'live' && typeof runtime.dispatchProjectTask === 'function';
  const host = desktopHost();
  const available = new Map<string,string>();
  if (canRun) {
    for (const profile of configured) {
      const id = profile.agentId || profile.tool;
      const binding = target?.runtimeConnections?.[id];
      if ((profile.scope === 'application' || binding?.connectionId === profile.connectionId || (host && reusableProfiles.includes(profile))) &&
          canAttemptAgentDispatch(profile,binding,testForConfig(profile,tested))) available.set(id,profile.displayName || target?.agents.find(a => a.id === id)?.name || id);
    }
    for (const agent of target?.agents ?? []) {
      const binding = target?.runtimeConnections?.[agent.id];
      if (binding && canAttemptAgentDispatch(undefined,binding)) {
        available.set(agent.id,agent.name);
      }
    }
  }
  const defaultId = target && available.has(target.defaultAgent) ? target.defaultAgent : available.keys().next().value ?? '';
  const remembered = [preferred, lastDestination].find(pref => pref?.projectId === projectId && available.has(pref.agentId));
  const agentId = agentChoice ?? remembered?.agentId ?? defaultId;
  const agentLabel = available.get(agentId) || agentId;
  const missingAgent = !available.size;
  const [directory, setDirectory] = useState('');
  const assignedDirectory = target?.project.workspacePath || target?.runtimeConnections?.[agentId]?.projectPath;
  const canSelectDirectory = !!agentId && !!host?.chooseDirectory;
  const taskSourceDirectory = projectId && directory && directory !== assignedDirectory ? directory : undefined;
  const effectiveDirectory = directory || assignedDirectory || '';
  const folderScope = useRef('');
  folderScope.current = JSON.stringify([projectId,agentId]);
  const folderContext = useDispatchDirectory(continuing ? continuation.requirement : source.text,effectiveDirectory,projectId,agentId);
  const changeProject = (id:string) => {
    if (!id && completedDraft.current) {
      requestId.current = crypto.randomUUID();
      projectDraft.current = undefined;
      completedDraft.current = false;
    }
    setProjectId(id);
    continuation.reset();
    setDirectory(!id ? projectDraft.current?.workspacePath ?? '' : '');
    setCreationConflict(undefined);
    setAgentChoice(undefined);
    setError('');
    if(id) previousProject.current=id;
  };
  const selected = methodIds.flatMap(id => methods.filter(group => group.id === id));
  const logic = selected.flatMap(group => group.steps);
  const matches = findNoteLogicGroups(methods.filter(group => !methodIds.includes(group.id)),tagQuery);
  const addMethod = (id:string) => {
    setMethodIds(current=>current.includes(id) ? current : [...current,id]);
    setTagQuery('');
    setEditingTags(false);
  };
  const addCustom = () => {
    const tag = tagQuery.trim();
    if (!tag) return;
    setCustomTags(current=>current.includes(tag) ? current : [...current,tag]);
    setTagQuery('');
    setEditingTags(false);
  };
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, [source.noteId]);
  const restoredFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!libraryReady || restoredFor.current === sourceKey) return;
    restoredFor.current = sourceKey;
    if (libraryError) { setMethodState('error'); return; }
    const groups = noteLogicGroups(library);
    setMethods(groups);
    if (preferred) {
      const ids = preferred.methodIds ?? (preferred.methodId ? [preferred.methodId] : []);
      setMethodIds(ids.filter(id => groups.some(group=>group.id===id)));
      if (preferred.customSource === sourceKey) setCustomTags(preferred.customTags ?? []);
    } else {
      const related = groups.find(group=>group.noteIds.includes(source.noteId));
      setMethodIds(related ? [related.id] : []);
    }
    setMethodState('ready');
  }, [library, libraryReady, libraryError, preferred, sourceKey, source.noteId]);

  function draftForCreation(saved?: SavedProjectDraft): SavedProjectDraft {
    if (!saved) return {...intake,id:requestId.current,tasks:[],supplement:''};
    // Retain the full form's plan and apply edits made in the shortcut after returning.
    const edits = Object.fromEntries(Array.from(intakeEdits.current, key=>[key,intake[key]]));
    const changed = Array.from(intakeEdits.current).some(key=>key !== 'owner' && intake[key] !== saved[key]);
    return {...saved,...edits,...(changed && {analysis:undefined,needsUpdate:false,omitted:[]})};
  }

  function selectCreated(id:string,projectName:string) {
    setCreatedProject({id,name:projectName});
    setAgentChoice(agentId);
    completedDraft.current = true;
    previousProject.current = id;
    setProjectId(id);
  }

  function retainDraft(draft: SavedProjectDraft) {
    requestId.current=draft.id;
    projectDraft.current=draft;
    completedDraft.current=false;
    setCreationConflict(undefined);
    setError('');
  }

  async function usePreviouslyCreated() {
    if (!creationConflict || pending.current) return;
    pending.current=true; setBusy(true);
    const draft = {...draftForCreation(projectDraft.current),id:crypto.randomUUID(),workspacePath:directory};
    try {
      await storeProjectDraft(draftKey,draft);
      selectCreated(creationConflict.id,creationConflict.name);
      retainDraft(draft);
      setDirectory('');
    } catch { setError('本次填写未能保存为草稿，请重试。'); }
    finally { pending.current=false;setBusy(false); }
  }

  async function send(event: Pick<FormEvent,'preventDefault'>, retry=false, saveOnly=false) {
    event.preventDefault();
    if (pending.current || (sent && !retry)) return;
    if (!agentId && !saveOnly) { setError('请先选择可执行任务的 Agent。'); return; }
    setBusy(true);
    pending.current = true;
    setError('');
    setCreationConflict(undefined);
    try {
      if (continuing && (!continuation.ready || !agentId)) throw Error('请选择成果、填写要求并核对接收资料的 Agent。');
      if (!continuing && source.pictures?.needsChoice && !selectedPictures.length && !textOnly) throw Error('请选择配图，或勾选「仅发送文字」。');
      if (selectedPictures.length > 4 || selectedPictures.reduce((sum,file)=>sum+file.size,0) > 8*1024*1024)
        throw Error('每次可发送最多 4 张图片，合计 8 MB。请调整所选图片。');
      if (folderContext.blocked) throw Error('请先核对本次要修改的源码目录');
      if (agentId && !available.has(agentId)) throw Error('Agent 连接已变化，请重新选择');
      const { noteId, lineIndex, todoId, selection } = source;
      if (source.localDraft) {
        const latest = await readKnowledge();
        if (latest.deletedNoteIds?.includes(noteId) || !latest.notes.some(note => note.id === noteId))
          throw Error('来源笔记已删除，请关闭后重新选择');
      }
      const noteSource = {noteId,lineIndex,todoId,selection};
      const key = source.selected ? noteSelectionTaskKey(noteSource,source.text) : noteTaskKey(noteId,lineIndex,source.text);
      let id = projectId;
      if (!id) {
        const input = await projectDraftInput(draftForCreation(projectDraft.current),directory);
        const created = await api.createProject(input);
        if (created.conflictingProject) setCreationConflict(created.conflictingProject);
        if (!created.ok || !created.projectId) throw Error(created.message || '未创建项目');
        id = created.projectId;
        selectCreated(id,input.name);
        if (projectDraft.current) await clearProjectDraft(draftKey).catch(()=>{});
      }
      const includedTags = [...new Set([...customTags, tagQuery.trim()].filter(Boolean))];
      const instructions = [...new Set([...selected.flatMap(group=>group.instructions??[]), ...includedTags])];
      const fixed = continuing ? await continuation.freeze() : undefined;
      const pictureKey = JSON.stringify(selectedPictures.map(file=>file.id));
      if (!savedPictures.current || savedPictures.current.projectId!==id || savedPictures.current.selection!==pictureKey) {
        const copies = await copyNoteDispatchPictures(id,noteId,selectedPictures,source.draftUrls);
        savedPictures.current = {projectId:id,selection:pictureKey,files:copies};
      }
      const attachments = [...new Map([...savedPictures.current.files,...(fixed?.files ?? [])].map(file=>[file.id,file])).values()];
      const origin = {key,title:source.noteTitle,noteSource,logic,customTags:instructions,
        ...(fixed && {continuation:fixed.origin,noteImageIds:savedPictures.current.files.map(file=>file.id)})};
      const result = agentId ? await sendNoteDispatch(runtime,{projectId:id,text:source.text,retry,attachments,...(taskSourceDirectory && {sourceDirectory:taskSourceDirectory}),origin:{...origin,dispatch:{agentId,logic,customTags:instructions}}}) :
        await api.createTaskWithAttachments(source.text,attachments,id,origin);
      if (!result.taskId) throw Error(result.message || '未创建任务，请重试');
      if (result.ok && agentId) {
        try {
          localStorage.setItem(lastDestinationKey,JSON.stringify({projectId:id,agentId}));
          if (methodState === 'ready') localStorage.setItem(preferenceKey,JSON.stringify({projectId:id,agentId,methodIds,customTags:includedTags,customSource:sourceKey} satisfies SendPreference));
        } catch { /* Sending works without remembering a destination. */ }
      } else if (result.ok && !agentId) { try { localStorage.removeItem(preferenceKey); } catch { /* optional local preference */ } }
      const message = result.message || '请打开任务查看当前进展。';
      if (result.ok && result.dispatchMode !== 'conflict') {
        let acknowledgement = agentId ? agentLabel + ' 已受理，结果会回到这条笔记。' : '仅保存任务，尚未派发。';
        if (agentId && (result.dispatchMode === 'split' || result.dispatchMode === 'joined' || result.dispatchMode === 'existing')) acknowledgement = message;
        if (onDispatched) onDispatched({projectId:id,taskId:result.taskId,message:acknowledgement});
        else { toast(acknowledgement); onClose(); }
      } else {
        setSent({projectId:id,taskId:result.taskId,title:result.ok ? '需要确认分工' : '派发需要处理',
          retryable:'retryable' in result && result.retryable === true,message});
      }
      void refreshProjects().catch(() => toast('任务记录刷新失败，请重新打开帮你管查看。','error'));
    } catch (cause) { dialog.current?.showModal(); setError(cause instanceof Error ? cause.message : '未收到保存结果，请重试'); }
    finally { pending.current = false; setBusy(false); }
  }

  function viewTask() {
    if (!sent) return;
    onOpenTask({projectId:sent.projectId,taskId:sent.taskId});
    onClose();
  }

  const directoryField = agentId && (canSelectDirectory || effectiveDirectory) && <NoteDispatchDirectory
          folder={effectiveDirectory} custom={!!directory} canChoose={canSelectDirectory} creating={creating}
          context={folderContext} busy={busy} reset={()=>{setDirectory('');}} choose={async()=>{
            const scope=folderScope.current;
            try { const folder=await host?.chooseDirectory(); if (folder && scope===folderScope.current) { setDirectory(folder); folderContext.refresh(); setError(''); } }
            catch { if (scope===folderScope.current) setError('文件夹未能打开，请重试'); }
          }}/>;

  const destinationAction = projects.length>0 && <button type="button" className="qd-destination-toggle" disabled={busy} onClick={()=>{
    if (creating) changeProject(projects.find(row=>row.project.id===previousProject.current)?.project.id ?? projects[0].project.id);
    else changeProject('');
  }}><Icon name={creating?'chevron-left':'plus'} size={13}/>{creating?'选择已有项目':'新建项目'}</button>;

  return createPortal(<dialog ref={dialog} className={'qd-handoff-dialog qd-note-send'+(continuing ? ' is-continuation' : '')} aria-labelledby="note-task-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => void send(event)} aria-busy={busy}>
      <header><h2 id="note-task-title">{sent?.title || '发送到帮你管'}</h2>
        <button type="button" className="qd-icon-btn" disabled={busy} aria-label="关闭" onClick={onClose}><Icon name="close" size={18}/></button></header>
      <div className="qd-handoff-source"><small>{source.noteTitle || '未命名笔记'}{source.localDraft && ' · 本机草稿'}</small><strong>{brief.title}</strong>
        {!sent && brief.title !== source.text.trim() && <details className="qd-note-send-quote"><summary>查看选段全文</summary><p>{source.text}</p></details>}
      </div>
      {sent ? <p role="status" className="qd-handoff-boundary">{sent.message}</p> : <>
        {creating && <div className="qd-note-project-intake">
          <ProjectIntakeFields compact value={intake} update={updateIntake} onError={setError} disabled={busy} nameLabel="新项目名称" destinationAction={destinationAction}/>
        </div>}
        <div className={'qd-note-send-route'+(creating?' is-new':'')}>
          {!creating && <div className="qd-handoff-field">
            <div className="qd-destination-heading">
              <label htmlFor="qd-note-destination">目标项目</label>{destinationAction}
            </div>
            <select id="qd-note-destination" value={projectId} disabled={busy} onChange={e=>changeProject(e.target.value)} required>
              {!target && createdProject?.id===projectId && <option value={projectId}>{createdProject.name}</option>}
              {projects.map(row=><option key={row.project.id} value={row.project.id}>{row.project.name}</option>)}
            </select>
          </div>}
          <label className="qd-handoff-field">交给谁<span className="qd-note-recipient">
            {available.has(agentId) && <AgentLogo size={22} agent={target?.agents.find(agent=>agent.id===agentId) ?? {id:agentId,name:agentLabel,color:"#64748b"}}/>}
            <select value={agentId} disabled={busy} onChange={e => setAgentChoice(e.target.value)}>
            {Array.from(available,([id,label]) => <option key={id} value={id}>{label}</option>)}<option value="">{missingAgent ? '暂无可用 Agent' : '仅保存任务，稍后派发'}</option>
          </select></span></label>
        </div>
        {!creating && <NoteResultContinuation model={continuation} busy={busy}/>}
        {source.pictures && (source.pictures.options.length > 0 || source.pictures.needsChoice) &&
          <fieldset className="qd-send-pictures"><legend>随任务发送的原文图片</legend>
            {!continuing && source.pictures.needsChoice && <small>{source.pictures.options.length ? '选段提到了图片，请选出对应的原图。' : '没有找到选段引用的原图。可以返回笔记粘贴图片。'}</small>}
            <div>{source.pictures.options.map(file=><label key={file.id}>
              <input type="checkbox" checked={pictureIds.includes(file.id)} disabled={busy} onChange={event=>{
                setPictureIds(event.target.checked ? [...pictureIds,file.id] : pictureIds.filter(id=>id!==file.id));
                setTextOnly(false);setError('');
              }}/>
              {source.draftUrls?.get(file.id) ? <img src={source.draftUrls.get(file.id)} alt=""/> : <DeferredNoteImage noteId={source.noteId} file={file} alt=""/>}
              <span>{file.name}</span>
            </label>)}</div>
            {!continuing && source.pictures.needsChoice && <label><input type="checkbox" checked={textOnly} disabled={busy} onChange={event=>{
              setTextOnly(event.target.checked);setPictureIds([]);setError('');
            }}/>仅发送文字</label>}
          </fieldset>}
        {folderContext.needsSource && directoryField}
        {missingAgent && <p className="qd-method-hint">当前没有可执行任务的 Agent。可在「设置 → Agent 管理」连接。</p>}
        <details className="qd-note-send-options" open={optionsOpen} onToggle={event=>setOptionsOpen(event.currentTarget.open)}>
          <summary>思路与设置{selected.length+customTags.length>0 && <small>{selected.length+customTags.length} 个思路</small>}</summary>
          <div className="qd-handoff-field" onBlur={e=>{if (!e.currentTarget.contains(e.relatedTarget)) setEditingTags(false);}}>
            <label htmlFor="qd-method-search">执行思路</label>
            {(selected.length>0 || customTags.length>0) && <div className="qd-method-tags">
              {selected.map(group=><button type="button" key={group.id} disabled={busy} aria-label={'移除思路 '+group.title}
                onClick={()=>setMethodIds(methodIds.filter(id=>id!==group.id))}>{group.title}<Icon name="close" size={12}/></button>)}
              {customTags.map(tag=><button type="button" className="qd-custom-tag" key={tag} disabled={busy} aria-label={'移除补充 '+tag}
                onClick={()=>setCustomTags(customTags.filter(label=>label!==tag))}>{tag}<Icon name="close" size={12}/></button>)}
            </div>}
            <input id="qd-method-search" placeholder="搜索帮你想的思路，或写下补充并按回车" maxLength={1000} disabled={busy}
              autoComplete="off" value={tagQuery} onFocus={()=>setEditingTags(true)}
              onChange={e=>{setTagQuery(e.target.value);setEditingTags(true);}}
              onKeyDown={e=>{
                if (e.nativeEvent.isComposing) return;
                if (e.key==='Enter') {e.preventDefault();const exact=matches.find(group=>group.title===tagQuery.trim());if(exact) addMethod(exact.id); else addCustom();}
                if (e.key==='Escape' && editingTags) {e.stopPropagation();e.preventDefault();setTagQuery('');setEditingTags(false);}
              }}/>
            {editingTags && (matches.length>0 || tagQuery.trim()) && <div className="qd-method-options">
              {matches.map(group=><button type="button" key={group.id} onClick={()=>addMethod(group.id)}>{group.title}</button>)}
              {tagQuery.trim() && <button type="button" onClick={addCustom}>添加补充「{tagQuery.trim()}」</button>}
            </div>}
          </div>
          {logic.length>0 && <details className="qd-method-preview"><summary>随任务发送的 {logic.length} 条连线</summary><ol>
            {logic.map(step => <li key={step.id}><strong>{step.fromTitle} → {step.toTitle}</strong><span>{step.label} · {step.detail}</span></li>)}</ol></details>}
          {methodState === 'error' && <small className="qd-method-hint">帮你想的思路暂时无法读取，仍可手写补充。</small>}
          {!creating && target && (target.project.description || projectBackground(target)) && <details className="qd-project-intake"><summary>当前项目目标与背景</summary>
            {target.project.description && <p>{target.project.description}</p>}{projectBackground(target) && <p>{projectBackground(target)}</p>}
          </details>}
          <MaterialList matches={materialMatches} projectId={projectId}
            backgroundDraft={creating ? {text:background,setText:setBackground,busy} : undefined}/>
          <details className="qd-requirement"><summary>查看验收与交付</summary>
            <dl>{additionalCriteria.length>0 && <><dt>验收标准</dt><dd>{additionalCriteria.join('\n')}</dd></>}<dt>交付物</dt><dd>{brief.deliverable}</dd></dl>
          </details>
          {!folderContext.needsSource && directoryField}
        </details>
      </>}
      {error && <p role="alert" className="qd-handoff-error">{error}</p>}
      {creationConflict && <ProjectConflictActions disabled={busy} onUse={()=>void usePreviouslyCreated()} onNew={()=>{
        retainDraft({...draftForCreation(projectDraft.current),id:crypto.randomUUID(),workspacePath:directory});
      }}/>}
      <footer><button type="button" className="qd-btn ghost" onClick={onClose} disabled={busy}>{sent ? '继续写笔记' : '取消'}</button>
        {sent?.retryable && <button type="button" className="qd-btn mode" disabled={busy} onClick={e=>void send(e,true)}>{busy?'正在重试…':'重试派发原任务'}</button>}
        {sent ? <button type="button" className="qd-btn primary" disabled={busy} onClick={() => void viewTask()}>查看任务</button>
          : <button className={agentId ? "qd-btn primary" : "qd-btn ghost"} type={agentId ? "submit" : "button"} onClick={agentId ? undefined : e=>void send(e,false,true)} disabled={busy || folderContext.blocked || methodState === 'loading' || continuing && (!continuation.ready || !agentId) || (creating && (!name.trim() || !goal.trim()))}>
            {busy ? '正在发送…' : creating ? (agentId ? '创建并发送' : '仅保存任务') : agentId ? '发给 ' + agentLabel : '仅保存任务'}</button>}</footer>
    </form>
  </dialog>, document.body);
}
