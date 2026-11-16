import { useEffect, useId, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { desktopHost, type ErasePreview } from '../../integration/desktop';
import type { RevisionPreview } from '../../data/projectionImport';

function download(name:string,body:string) {
  const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function ProjectDataControls() {
  const {snap,api}=useWorkdeck(),host=desktopHost(),id=useId();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [preview,setPreview]=useState<RevisionPreview|null>(null),[raw,setRaw]=useState('');
  const [erase,setErase]=useState<ErasePreview|null>(null),[confirmation,setConfirmation]=useState('');
  useEffect(()=>{setPreview(null);setRaw('');setErase(null);setConfirmation('');setMessage('');},[snap.project.id]);
  const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);setMessage('');try{await action();}catch(error){setMessage(error instanceof Error?error.message:'操作未完成');}finally{setBusy(false);}};
  if(!snap.project.id)return null;
  return <div className="qd-project-data" aria-busy={busy}>
    <h3>{snap.project.name}</h3>
    {host?.exportProject&&<div className="qd-setting-row"><div><strong>项目记忆快照</strong><p>台帐、当前索引及版本来源</p></div><button className="qd-btn ghost" disabled={busy} onClick={()=>void run(async()=>{await host.exportProject!(snap.project.id);setMessage('项目记忆已导出，后台自动维护');})}>导出</button></div>}
    <div className="qd-setting-row"><div><strong>批量修订任务</strong><p>导出后仅修改目标和验收条件，再预览采用</p></div><button className="qd-btn ghost" disabled={busy} onClick={()=>void run(async()=>download(`QuanDeck-${snap.project.name}-revisions.json`,await api.exportTaskRevisions(snap.project.id)))}>导出修订文件</button></div>
    <label className="qd-setting-row" htmlFor={`${id}-revision`}><span>预览修订文件</span><input id={`${id}-revision`} type="file" accept="application/json,.json" disabled={busy} onChange={event=>{const file=event.target.files?.[0];if(!file)return;void run(async()=>{if(file.size>2_000_000)throw Error('文件不能超过 2 MB');const text=await file.text();setPreview(await api.previewTaskRevisions(snap.project.id,text));setRaw(text);});event.target.value='';}}/></label>
    {preview&&<div className="qd-data-preview"><strong>{preview.changes.length} 项任务修订</strong>{preview.changes.map(change=><details key={change.key}><summary>{change.title}</summary><dl><dt>原目标</dt><dd>{change.before.goal}</dd><dt>新目标</dt><dd>{change.after.goal}</dd><dt>原验收</dt><dd>{change.before.criteria.join('；')}</dd><dt>新验收</dt><dd>{change.after.criteria.join('；')}</dd></dl></details>)}<div className="qd-settings-form-actions"><button className="qd-btn primary" disabled={busy||!preview.changes.length} onClick={()=>void run(async()=>{const result=await api.importTaskRevisions(snap.project.id,raw,preview.digest);if(!result.ok)throw Error(result.message);setPreview(null);setMessage(result.message??'已采用修订');})}>采用修订</button><button className="qd-btn ghost" disabled={busy} onClick={()=>setPreview(null)}>取消</button></div></div>}
    {host?.restoreWorkspace&&<div className="qd-setting-row"><div><strong>从备份恢复</strong><p>校验文件、保留回滚点，并执行隐私删除记录</p></div><button className="qd-btn ghost" disabled={busy} onClick={()=>void run(async()=>{const result=await host.restoreWorkspace!();if(result)setMessage('恢复已保存，应用将重新启动');})}>选择备份</button></div>}
    {host?.previewEraseProject&&<div className="qd-setting-row"><div><strong>彻底清除项目</strong><p>先检查关联项目与已登记备份</p></div><button className="qd-btn ghost" disabled={busy} onClick={()=>void run(async()=>{setErase(await host.previewEraseProject!(snap.project.id));setConfirmation('');})}>检查影响</button></div>}
    {erase&&<div className="qd-data-preview qd-erasure-preview"><strong>清除范围</strong><p>{erase.affectedProjects.map(project=>project.name).join('、')}</p><p>{erase.counts.tasks} 项任务 · {erase.counts.artifacts} 份成果 · {erase.counts.sessions} 个会话 · {erase.counts.attachments} 个附件 · {erase.backupCount} 份备份</p><p>清除后无法撤销。外部 Agent 和用户自行复制的文件需另行处理。</p><label htmlFor={`${id}-erase`}>输入项目名称确认</label><input id={`${id}-erase`} value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="off"/><div className="qd-settings-form-actions"><button className="qd-btn danger" disabled={busy||confirmation!==erase.projectName} onClick={()=>void run(async()=>{const result=await host!.eraseProject!({token:erase.token,confirmation:erase.projectId});if(result)setMessage('清除已完成，应用将重新启动');setErase(null);})}>清除列出的数据</button><button className="qd-btn ghost" disabled={busy} onClick={()=>setErase(null)}>取消</button></div></div>}
    <p className="qd-setting-feedback" role="status">{message}</p>
  </div>;
}
