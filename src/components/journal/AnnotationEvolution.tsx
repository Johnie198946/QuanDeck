import { useMemo, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import type { AnnotationHistoryEntry } from '../../data/annotationHistory';
import { annotationEvolution, compareConditions, judgmentLabels, type AnnotationJudgment, type EvolutionPair, type Judgment } from '../../data/annotationEvolution';
import './annotation-evolution.css';

type Jump = (id:string)=>void;
function Source({entry, jump, label}:{entry:AnnotationHistoryEntry; jump:Jump; label:string}){
  return <div className="qd-opinion-source">
    <strong>{label}</strong><small>{entry.at.slice(0,10)} · {entry.version}</small>
    <blockquote>{entry.text || '（未填写文字）'}</blockquote>
    <small>适用条件：{compareConditions(entry)}</small>
    <button type="button" className="qd-link" onClick={()=>jump(entry.id)}>定位这条批注</button>
  </div>;
}
function Comparison({pair,jump,previous}:{pair:EvolutionPair;jump:Jump;previous?:AnnotationJudgment}){
  const {snap,api}=useWorkdeck();
  const [verdict,setVerdict]=useState<Judgment>(previous?.verdict??'unresolved'),[note,setNote]=useState(previous?.note??'');
  const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
  async function save(){
    if(busy)return;
    setBusy(true);setStatus('');
    try{
      const r=await api.collaborate({projectId:snap.project.id,type:'review_annotation_pair',idempotencyKey:crypto.randomUUID(),
        payload:{pairId:pair.id,verdict,note,expectedRevision:previous?.revision??0}});
      if(!r.ok)throw Error(r.message||'未保存，请重试');
      setStatus('判断已保存');
    }catch(e){setStatus(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
  }
  return <details className="qd-opinion-comparison">
    <summary>{pair.topic} <span>{previous?'已标记：'+judgmentLabels[previous.verdict]:'待核对'}</span></summary>
    <p>{pair.later.object}：这两条记录的取向不同，请结合原文、版本和适用条件核对。</p>
    <div className="qd-opinion-columns"><Source entry={pair.earlier} jump={jump} label="较早的意见"/><Source entry={pair.later} jump={jump} label="较晚的意见"/></div>
    <fieldset><legend>我的判断</legend>
      <label>判断<select value={verdict} onChange={e=>setVerdict(e.target.value as Judgment)}>{Object.entries(judgmentLabels).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
      <label>说明（选填）<input maxLength={600} value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：两条意见分别针对桌面和手机"/></label>
      <button type="button" className="qd-btn ghost" disabled={busy||(verdict===(previous?.verdict??'unresolved')&&note.trim()===(previous?.note??''))} onClick={()=>void save()}>{busy?'保存中…':'保存判断'}</button>
    </fieldset>
    {previous&&<small>已保存 v{previous.revision} · {judgmentLabels[previous.verdict]}{previous.note?'：'+previous.note:''}。仅用于这组对照。</small>}
    <span role="status">{status}</span>
  </details>;
}
export function AnnotationEvolution({entries,jump}:{entries:AnnotationHistoryEntry[];jump:Jump}){
  const {snap}=useWorkdeck();
  const graph=useMemo(()=>annotationEvolution(entries),[entries]);
  const judgments=useMemo(()=>new Map((snap.collaboration?.annotationJudgments??[]).filter(j=>j.projectId===snap.project.id).map(j=>[j.pairId,j])),[snap]);
  const [n,setN]=useState(5);
  const sequences=graph.ordered.slice(-n);
  return <details className="qd-opinion"><summary>观点演变与疑似冲突 <small>{graph.revisions.length} 次修改或撤回 · {graph.comparisons.length} 组对照</small></summary>
    <h4>观点时间线</h4>
    {!sequences.length?<p>有批注后，可在这里回看意见的先后与修改。</p>:<ol className="qd-opinion-trail">
      {sequences.map(e=><li key={e.id}><time dateTime={e.at}>{e.at.slice(0,10)}</time><div><button type="button" className="qd-link" onClick={()=>jump(e.id)}>{e.object}</button>
        <p>{e.text || e.action || '（未填写文字）'}</p>
        {e.previousId&&<button type="button" className="qd-link" onClick={()=>jump(e.previousId!)}>{e.state==='withdrawn'?'撤回自':'修改自'}：查看上一版</button>}
      </div></li>)}</ol>}
    <h4>疑似冲突 <small>{graph.comparisons.length} 组</small></h4>
    {graph.comparisons.length===0&&<p>未找到同一对象上可对照的相反意见。按日期排列的独立意见不代表互相矛盾。</p>}
    {graph.comparisons.slice(0,n).map(pair=><Comparison key={snap.project.id+pair.id+':'+(judgments.get(pair.id)?.revision??0)} pair={pair} previous={judgments.get(pair.id)} jump={jump}/>)}
    {(graph.ordered.length>n||graph.comparisons.length>n)&&<button type="button" className="qd-link" onClick={()=>setN(n+10)}>显示更多时间线与对照</button>}
  </details>;
}
