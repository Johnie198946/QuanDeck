import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import './projects.css';
import { desktopHost } from '../../integration/desktop';
import { getConfiguredAgents } from '../../integration/configuredAgents';
import { reusableAgentProfiles } from '../../integration/agentProfiles';
import { ArchiveProjectButton, DeleteProjectButton } from './ProjectLifecycle';
import { ProjectMemoryButton } from './ProjectMemoryDialog';

const colors = [{value:'#ac4836',name:'陶红'},{value:'#5d8974',name:'松绿'},{value:'#5c7c9e',name:'雾蓝'},{value:'#b48d42',name:'麦金'},{value:'#8c7799',name:'灰紫'}];
export function ProjectDialog({ projectId, onClose, onSaved }: { projectId?: string; onClose: () => void; onSaved: (created: boolean) => void }) {
  const { api, snap, projectSnapshots, refreshProjects, toast } = useWorkdeck();
  const project = projectSnapshots.find(item => item.project.id === projectId)?.project ?? (snap.project.id === projectId ? snap.project : undefined);
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [deadline,setDeadline]=useState(project?.deadline??'');
  const [ownerName,setOwnerName]=useState(project?.ownerName??'');
  const [color, setColor] = useState(project?.color ?? colors[0].value);
  const host = desktopHost();
  const current = projectSnapshots.find(item => item.project.id === projectId) ?? (snap.project.id === projectId ? snap : undefined);
  const fixedPath = project?.workspacePath ?? Object.values(current?.runtimeConnections ?? {})[0]?.projectPath;
  const [workspacePath, setWorkspacePath] = useState(fixedPath ?? '');
  const configured = reusableAgentProfiles(getConfiguredAgents());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const trigger = document.activeElement as HTMLElement | null; const node = dialog.current; node?.showModal(); return () => { node?.close(); trigger?.focus(); }; }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const input = { name: name.trim(), description: description.trim(), color, deadline, ownerName:ownerName.trim(), ...(host && workspacePath.trim() ? {workspacePath:workspacePath.trim()} : {}) };
      const result = projectId ? await api.updateProject(projectId, input) : await api.createProject(input);
      if (!result.ok) throw new Error(result.message || '项目保存失败');
      await refreshProjects(); if (result.message) toast(result.message); onSaved(!projectId); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : '项目保存失败'); } finally { setBusy(false); }
  };
  return createPortal(<dialog ref={dialog} className="qd-project-dialog" aria-labelledby="qd-project-dialog-title" onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <header><div><span className="qd-project-dialog-icon" style={{color}}><Icon name="folder" size={24} /></span><h1 id="qd-project-dialog-title">{projectId ? '项目设置' : '开始一个新项目'}</h1></div><button type="button" className="qd-icon-btn" aria-label="关闭项目设置" disabled={busy} onClick={onClose}><Icon name="close" size={19} /></button></header>
      <label htmlFor="qd-project-name">项目名称</label><input autoFocus id="qd-project-name" maxLength={60} placeholder="例如：芭提雅旅行" value={name} onChange={event => setName(event.target.value)} required />
      <label htmlFor="qd-project-description">想完成什么 <small>选填</small></label><textarea id="qd-project-description" maxLength={500} rows={3} placeholder="写下目标，让任务围绕它展开" value={description} onChange={event => setDescription(event.target.value)} />
      {projectId && <div><label htmlFor="qd-project-deadline">截止日期</label><input id="qd-project-deadline" type="date" value={deadline} onChange={event=>setDeadline(event.target.value)} /><label htmlFor="qd-project-owner">负责人</label><input id="qd-project-owner" value={ownerName} maxLength={40} onChange={event=>setOwnerName(event.target.value)} /></div>}
      {host && <section className="qd-project-workspace">
        <label htmlFor="qd-project-directory">项目文件夹</label>
        <div className="qd-project-directory"><input id="qd-project-directory" value={workspacePath} readOnly={!!fixedPath} disabled={busy} placeholder="选择本项目保存文件的位置" onChange={event => setWorkspacePath(event.target.value)} /><button type="button" className="qd-btn" disabled={busy || !!fixedPath} onClick={async()=>{try{const directory=await host.chooseDirectory();if(directory)setWorkspacePath(directory);}catch{setError('无法打开文件夹选择器，请填写完整路径');}}}>选择文件夹</button></div>
        <p>{configured.profiles.length ? `复用已配置的 ${configured.profiles.map(profile=>profile.displayName || profile.tool).join('、')}，无需再次配置。` : '尚未设置应用 Agent，可先建立项目，再统一配置。'}</p>
        {configured.conflicts.length > 0 && <p role="status">部分 Agent 有多套旧配置，请在 Agent 设置中保存应用默认配置，完成后所有项目的新执行都会使用该配置。</p>}
        {project?.workspaceIssues?.length ? <div role="status"><p>项目已经保存，以下连接待恢复：</p><ul>{project.workspaceIssues.map(issue=><li key={issue}>{issue}</li>)}</ul><p>修改应用 Agent 配置后，下一次任务或讨论会自动重试连接。</p></div> : null}
      </section>}
      <fieldset><legend>项目颜色</legend><div className="qd-project-colors">{colors.map(item => <button type="button" key={item.value} aria-label={item.name} aria-pressed={color === item.value} style={{background:item.value}} onClick={() => setColor(item.value)}>{color === item.value && <Icon name="check" size={16} />}</button>)}</div></fieldset>
      {projectId && current && <section className="qd-project-lifecycle" aria-label="项目记忆与管理"><ProjectMemoryButton snapshot={current} /><div><ArchiveProjectButton projectId={projectId} title={project?.name ?? name} onArchived={onClose} /><DeleteProjectButton projectId={projectId} title={project?.name ?? name} label onDeleted={onClose} /></div></section>}
      {error && <p role="alert" className="qd-project-form-error">{error}</p>}
      <footer><button type="button" className="qd-btn ghost" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="qd-btn primary" disabled={!name.trim() || busy}>{busy ? '保存中…' : projectId ? '保存修改' : '创建项目'}<Icon name="arrow-right" size={15} /></button></footer>
    </form>
  </dialog>, document.body);
}
