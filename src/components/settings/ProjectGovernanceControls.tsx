import { useEffect, useId, useRef, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { LOCAL_PRINCIPAL } from '../../data/governance';
import type { Snapshot } from '../../data/types';
import './project-governance.css';

const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value];

export function ProjectGovernanceControls() {
  const {snap,api}=useWorkdeck(), id=useId(), projectId=snap.project.id;
  const governance=snap.collaboration?.governance;
  const [projects,setProjects]=useState<Snapshot[]>([]), [target,setTarget]=useState(''), [artifactIds,setArtifactIds]=useState<string[]>([]);
  const [artifactSearch,setArtifactSearch]=useState('');
  const [busy,setBusy]=useState(false), [notice,setNotice]=useState(''), [error,setError]=useState('');
  const current=useRef(projectId); current.current=projectId;
  useEffect(()=>{
    let disposed=false;
    setProjects([]);setTarget('');setArtifactIds([]);setArtifactSearch('');setNotice('');setError('');
    void api.listProjects().then(values=>{if(!disposed)setProjects(values.filter(p=>p.project.id!==projectId&&!p.project.deletedAt));}).catch(e=>{if(!disposed)setError(e instanceof Error?e.message:'项目列表读取失败');});
    return ()=>{disposed=true;};
  },[api,projectId]);
  const run=async(action:()=>Promise<string>)=>{
    if(busy)return;const captured=projectId;setBusy(true);setNotice('');setError('');
    try{const result=await action();if(current.current===captured)setNotice(result);}
    catch(e){if(current.current===captured)setError(e instanceof Error?e.message:'操作未完成');}
    finally{setBusy(false);}
  };
  const command=async(type:'grant_artifacts'|'revoke_grant',payload:Record<string,unknown>)=>{
    const result=await api.collaborate({projectId,idempotencyKey:`settings-${crypto.randomUUID()}`,type,payload});
    if(!result.ok)throw Error(result.message??'操作未完成');
  };
  if(!projectId)return null;
  const artifacts=(snap.collaboration?.artifacts??[]).filter(a=>{
    const task=snap.collaboration?.tasks[a.key];
    return !a.legacy&&task?.status==='done'&&!task.archived&&!task.requiresRevalidation&&task.acceptedArtifactId===a.id&&snap.collaboration?.freshness[a.id]!=='stale'&&(!a.expiresAt||Date.parse(a.expiresAt)>Date.now());
  });
  const visibleArtifacts=artifacts.filter(a=>`${a.title} ${a.id}`.toLowerCase().includes(artifactSearch.toLowerCase()));
  const grants=Object.values(governance?.grants??{}).filter(g=>!g.revokedAt);
  const controlsDisabled=busy||!!governance&&governance.ownerId!==LOCAL_PRINCIPAL;
  return <section className="qd-project-data" aria-label="成果授权" aria-busy={busy}>
    <h3>成果授权</h3>
    <p>只共享选中的已验收版本，有效期 7 天。</p>
    <label className="qd-setting-row" htmlFor={`${id}-target`}><span>允许哪个项目引用</span><select id={`${id}-target`} value={target} disabled={controlsDisabled||!projects.length} onChange={e=>setTarget(e.target.value)}><option value="">选择项目</option>{projects.map(p=><option key={p.project.id} value={p.project.id}>{p.project.name}</option>)}</select></label>
    {!projects.length&&<p>创建另一个项目后，可授权它引用成果。</p>}
    <details className="qd-data-preview">
      <summary>选择成果 · 已选 {artifactIds.length} 份</summary>
      <label htmlFor={`${id}-artifacts`}>筛选成果</label><input id={`${id}-artifacts`} type="search" value={artifactSearch} onChange={e=>setArtifactSearch(e.target.value)} placeholder="标题或成果 ID"/>
      <div className="qd-governance-checklist">
        {visibleArtifacts.slice(0,100).map(a=><label key={a.id}><input type="checkbox" checked={artifactIds.includes(a.id)} disabled={controlsDisabled} onChange={()=>setArtifactIds(values=>toggle(values,a.id))}/><span>{a.title}<small>v{a.version} · {snap.collaboration?.tasks[a.key]?.title}</small></span></label>)}
        {!visibleArtifacts.length&&<p>{artifacts.length?'没有匹配的成果':'暂无可授权的已验收成果'}</p>}
        {visibleArtifacts.length>100&&<p>显示前 100 份，请继续筛选</p>}
      </div>
    </details>
    <div className="qd-settings-form-actions"><button className="qd-btn primary" disabled={controlsDisabled||!target||!artifactIds.length||artifactIds.length>100} onClick={()=>void run(async()=>{await command('grant_artifacts',{principalId:LOCAL_PRINCIPAL,targetProjectId:target,artifactIds,expiresAt:new Date(Date.now()+7*86400000).toISOString()});if(current.current===projectId)setArtifactIds([]);return '已授权，7 天后到期';})}>授权引用</button></div>
    {grants.map(grant=><div className="qd-setting-row" key={grant.id}><div><strong>{projects.find(p=>p.project.id===grant.targetProjectId)?.project.name??'目标项目不可用'}</strong><p>{grant.artifactIds.length} 份成果 · {Date.parse(grant.expiresAt)<=Date.now()?'已到期':`${new Date(grant.expiresAt).toLocaleDateString()} 到期`}</p></div><button className="qd-btn ghost" disabled={controlsDisabled} onClick={()=>void run(async()=>{await command('revoke_grant',{grantId:grant.id});return '授权已撤销，关联成果将重新校验';})}>撤销</button></div>)}
    <p className="qd-setting-feedback" role="status">{notice}</p>
    {error&&<p className="qd-setting-feedback" role="alert">{error}</p>}
  </section>;
}
