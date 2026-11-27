import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { noteTaskKey, noteSelectionTaskKey, type NoteSourceRef } from '../../data/noteTaskSource';
import { hashText } from '../../data/contentHash';
import { noteLogicGroups, findNoteLogicGroups } from '../../data/noteDispatchLogic';
import { readKnowledge } from '../../data/knowledgeStore';
import { sendNoteDispatch } from '../../data/sendNoteDispatch';
import type { RuntimeCommands } from '../../data/runtimeContracts';
import { desktopHost } from '../../integration/desktop';
import { canAttemptAgentDispatch } from '../../integration/agentProfiles';
import { testForConfig, useConfiguredAgents } from '../../integration/configuredAgents';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import '../work/task-handoff.css';

export interface NoteTaskSource extends NoteSourceRef {
  noteTitle: string;
  text: string;
  selected?: boolean;
  settings?: boolean;
}

interface SendPreference { projectId:string; agentId:string; connectionId:string; methodId:string; methodIds?:string[]; customTags?:string[]; customSource?:string; logicHash:string }
function readPreference(key:string): SendPreference | undefined {
  try {
    const record = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (record && ['projectId','agentId','connectionId','methodId','logicHash'].every(field => typeof record[field] === 'string') &&
        [record.methodIds, record.customTags].every(value => value === undefined || (Array.isArray(value) && value.every(item=>typeof item==='string')))) return record;
  } catch { /* Storage can be unavailable in private browsing. */ }
}

export function NoteTaskDialog({ source, onClose }: { source: NoteTaskSource; onClose: () => void }) {
  const { api, snap, projectSnapshots, refreshProjects, switchProject, openWorkspace, toast } = useWorkdeck();
  const projects = [snap,...projectSnapshots.filter(row => row.project.id !== snap.project.id)]
    .filter(row => row.project.id && !row.project.deletedAt);
  const preferenceKey = 'quandeck.note-dispatch.destination.v1.' + source.noteId;
  const [preferred] = useState(() => readPreference(preferenceKey));
  const [projectId, setProjectId] = useState(projects.find(project => project.project.id === preferred?.projectId)?.project.id ?? projects[0]?.project.id ?? '');
  const [name, setName] = useState('');
  const previousProject = useRef(projectId);
  const creationRequest = useRef<{name:string; directory:string; id:string} | undefined>(undefined);
  const creating = !projectId;
  const [agentChoice, setAgentChoice] = useState<string>();
  const [methods,setMethods] = useState<ReturnType<typeof noteLogicGroups>>([]);
  const [methodIds,setMethodIds] = useState<string[]>([]);
  const [customTags,setCustomTags] = useState<string[]>([]);
  const [tagQuery,setTagQuery] = useState('');
  const [editingTags,setEditingTags] = useState(false);
  const sourceKey = source.selected ? noteSelectionTaskKey(source,source.text) : noteTaskKey(source.noteId,source.lineIndex,source.text);
  const [methodState,setMethodState] = useState<'loading'|'ready'|'error'>('loading');
  const [sent, setSent] = useState<{ projectId: string; taskId: string; message: string; title:string }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const target = projects.find(row => row.project.id === projectId);
  const {configured,reusableProfiles,tested} = useConfiguredAgents(target?.agents ?? []);
  const runtime = api as typeof api & Partial<RuntimeCommands>;
  const canRun = api.mode === 'live' && typeof runtime.dispatchProjectTask === 'function';
  const host = desktopHost();
  const available = new Map<string,string>();
  const connections = new Map<string,string>();
  if (canRun) {
    for (const profile of configured) {
      const id = profile.agentId || profile.tool;
      const binding = target?.runtimeConnections?.[id];
      if ((profile.scope === 'application' || binding?.connectionId === profile.connectionId || (host && reusableProfiles.includes(profile))) &&
          canAttemptAgentDispatch(profile,binding,testForConfig(profile,tested))) available.set(id,profile.displayName || target?.agents.find(a => a.id === id)?.name || id);
    }
    for (const profile of configured) {
      const id = profile.agentId || profile.tool;
      if (available.has(id) && profile.connectionId) connections.set(id,profile.connectionId);
    }
    for (const agent of target?.agents ?? []) {
      const binding = target?.runtimeConnections?.[agent.id];
      if (binding && canAttemptAgentDispatch(undefined,binding)) {
        available.set(agent.id,agent.name);
        connections.set(agent.id,binding.connectionId);
      }
    }
  }
  const defaultId = target && available.has(target.defaultAgent) ? target.defaultAgent : available.keys().next().value ?? '';
  const agentId = agentChoice ?? (projectId === preferred?.projectId && available.has(preferred.agentId) ? preferred.agentId : defaultId);
  const needsDirectory = !!agentId && !!host && !target?.project.workspacePath &&
    !Object.values(target?.runtimeConnections ?? {}).some(binding=>binding.projectPath);
  const changeProject = (id:string) => {
    setProjectId(id);
    setAgentChoice(undefined);
    setError('');
    if(id) previousProject.current=id;
  };
  const selected = methodIds.flatMap(id => methods.filter(group => group.id === id));
  const logic = selected.flatMap(group => group.steps);
  const logicHash = hashText(JSON.stringify(customTags.length ? {logic,customTags} : logic));
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
  const checkedPreference = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    if (!preferred || source.settings) element?.showModal();
    let active = true;
    void readKnowledge().then(library => {
      if (!active) return;
      const groups = noteLogicGroups(library);
      setMethods(groups);
      if (preferred) {
        const ids = preferred.methodIds ?? [preferred.methodId].filter(Boolean);
        setMethodIds(ids.filter(id => groups.some(group=>group.id===id)));
        if (preferred.customSource === sourceKey) setCustomTags(preferred.customTags ?? []);
      } else {
        const related = groups.find(group=>group.noteIds.includes(source.noteId));
        setMethodIds(related ? [related.id] : []);
      }
      setMethodState('ready');
    }).catch(() => { if (active) setMethodState('error'); });
    return () => { active = false; element?.close(); };
  }, [source.noteId]);

  useEffect(() => {
    if (checkedPreference.current || methodState === 'loading') return;
    checkedPreference.current = true;
    if (!source.settings && methodState === 'ready' && preferred && preferred.projectId === projectId &&
        preferred.agentId === agentId && !!agentId && preferred.connectionId === connections.get(agentId) &&
        JSON.stringify(preferred.methodIds ?? [preferred.methodId].filter(Boolean)) === JSON.stringify(methodIds) &&
        preferred.logicHash === logicHash) {
      void send(undefined,true);
    } else dialog.current?.showModal();
  }, [methodState,projectId,agentId,logicHash,methodIds]);

  async function send(event?: FormEvent, quick = false) {
    event?.preventDefault();
    if (pending.current || sent) return;
    setBusy(true);
    pending.current = true;
    setError('');
    try {
      if (agentId && !available.has(agentId)) throw Error('Agent 连接已变化，请重新选择');
      const { noteId, lineIndex, todoId, selection } = source;
      const noteSource = {noteId,lineIndex,todoId,selection};
      const key = source.selected ? noteSelectionTaskKey(noteSource,source.text) : noteTaskKey(noteId,lineIndex,source.text);
      let id = projectId;
      let directory:string | null = null;
      if(needsDirectory && host) {
        directory=await host.chooseDirectory();
        if(!directory) { dialog.current?.showModal(); return; }
      }
      if (!id) {
        const projectName=name.trim();
        if(!projectName) throw Error('请填写新项目名称');
        if(!creationRequest.current || creationRequest.current.name!==projectName || creationRequest.current.directory!==(directory??'')) {
          creationRequest.current={name:projectName,directory:directory??'',id:crypto.randomUUID()};
        }
        const created = await api.createProject({name:projectName, requestId:creationRequest.current.id, ...(directory && {workspacePath:directory})});
        if (!created.ok || !created.projectId) throw Error(created.message || '未创建项目');
        id = created.projectId;
        setProjectId(id);
        previousProject.current=id;
      } else if(directory) {
        const saved=await api.updateProject(id,{workspacePath:directory});
        if(!saved.ok) throw Error(saved.message || '项目文件夹未保存');
      }
      const origin = {key,title:source.noteTitle,noteSource,logic,customTags};
      const result = agentId ? await sendNoteDispatch(runtime,{projectId:id,text:source.text,origin:{...origin,dispatch:{agentId,logic,customTags}}}) :
        await api.createTaskWithAttachments(source.text,[],id,origin);
      if (!result.taskId) throw Error(result.message || '未创建任务，请重试');
      if (result.ok && agentId && connections.has(agentId) && methodState === 'ready') {
        try {
          const savedProject=(await api.listProjects()).find(row=>row.project.id===id);
          const connectionId=savedProject?.runtimeConnections?.[agentId]?.connectionId || connections.get(agentId);
          localStorage.setItem(preferenceKey,JSON.stringify({projectId:id,agentId,connectionId,methodId:methodIds[0] ?? '',methodIds,logicHash,customTags,customSource:sourceKey} satisfies Partial<SendPreference>));
        } catch { /* Sending works without remembering a destination. */ }
      } else if (result.ok && !agentId) { try { localStorage.removeItem(preferenceKey); } catch { /* optional local preference */ } }
      const title = !result.ok ? '派发需要处理' : result.dispatchMode === 'conflict' ? '需要确认分工' :
        result.dispatchMode === 'joined' ? '已补充到原任务' : '已加入「' + (target?.project.name || name.trim()) + '」';
      if (quick && result.ok && ['start','existing'].includes(result.dispatchMode ?? '')) {
        toast(result.dispatchMode === 'existing' ? result.message || '已关联原任务' : '已发给 ' + available.get(agentId) + ' · ' + target?.project.name);
        onClose();
        await refreshProjects();
        return;
      }
      dialog.current?.showModal();
      setSent({projectId:id,taskId:result.taskId,title,
        message:agentId ? result.message || '任务已保存。' : '任务已保存，可在帮你管分派。'});
      await refreshProjects();
    } catch (cause) { dialog.current?.showModal(); setError(cause instanceof Error ? cause.message : '未收到保存结果，请重试'); }
    finally { pending.current = false; setBusy(false); }
  }

  async function viewTask() {
    if (!sent || !await switchProject(sent.projectId)) return;
    onClose();
    openWorkspace(sent.taskId, { projectId: sent.projectId, view: 'tasks', pane: 'main', focus: true });
  }

  return createPortal(<dialog ref={dialog} className="qd-handoff-dialog" aria-labelledby="note-task-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => void send(event)} aria-busy={busy}>
      <header><h2 id="note-task-title">{sent?.title || '发送到帮你管'}</h2>
        <button type="button" className="qd-icon-btn" disabled={busy} aria-label="关闭" onClick={onClose}><Icon name="close" size={18}/></button></header>
      <div className="qd-handoff-source"><small>{source.noteTitle || '未命名笔记'}</small><p>{source.text}</p></div>
      {sent ? <p role="status" className="qd-handoff-boundary">{sent.message}</p> : <>
        <div className="qd-handoff-field">
          <div className="qd-destination-heading">
            <label htmlFor="qd-note-destination">{creating?'新项目名称':'目标项目'}</label>
            {projects.length>0 && <button type="button" className="qd-destination-toggle" disabled={busy} onClick={()=>{
              if(creating) changeProject(projects.find(row=>row.project.id===previousProject.current)?.project.id ?? projects[0].project.id);
              else changeProject('');
            }}><Icon name={creating?'chevron-left':'plus'} size={13}/>{creating?'选择已有项目':'新建项目'}</button>}
          </div>
          {creating ? <input id="qd-note-destination" key="name" autoFocus required maxLength={80} placeholder="例如：关西旅行" value={name} onChange={e=>setName(e.target.value)} disabled={busy}/> :
            <select id="qd-note-destination" key="project" value={projectId} disabled={busy} onChange={e=>changeProject(e.target.value)} required>
              {projects.map(row=><option key={row.project.id} value={row.project.id}>{row.project.name}</option>)}
            </select>}
        </div>
        <label className="qd-handoff-field">交给谁<select value={agentId} disabled={busy} onChange={e => setAgentChoice(e.target.value)}>
          {Array.from(available,([id,label]) => <option key={id} value={id}>{label}</option>)}<option value="">只加入项目，稍后分派</option>
        </select></label>
        {needsDirectory && <small className="qd-method-hint">首次发送时，选择这个项目的工作文件夹。</small>}
        {!available.size && <small className="qd-method-hint">连接可执行任务的 Agent 后，可从这里直接派发。</small>}
        {/\]\(attachment:/i.test(source.text) && <small className="qd-method-hint">本次发送所选文字。内嵌文件可在项目任务中添加。</small>}
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
      </>}
      {error && <p role="alert" className="qd-handoff-error">{error}</p>}
      <footer><button type="button" className="qd-btn ghost" onClick={onClose} disabled={busy}>{sent ? '继续写笔记' : '取消'}</button>
        {sent ? <button type="button" className="qd-btn primary" onClick={() => void viewTask()}>查看任务</button>
          : <button className="qd-btn primary" type="submit" disabled={busy || !!tagQuery.trim() || methodState === 'loading' || (!projectId && !name.trim())}>
            {busy ? '正在发送…' : creating ? (agentId ? '创建并发送' : '创建并加入') : agentId ? '发给 ' + available.get(agentId) : '发送'}</button>}</footer>
    </form>
  </dialog>, document.body);
}
