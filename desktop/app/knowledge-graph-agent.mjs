import { randomUUID } from 'node:crypto';
import { digest, noteSources, extractKnowledgeAtoms, reasonOverGroups } from './knowledge-reasoning.mjs';

import { retrieveCandidates } from './knowledge-candidates-worker.mjs';

const policies = { codex: 'read-only-isolated', claude: 'sdk-tools-disabled', dsh: 'isolated-no-tool-plugins' };
export function configuredAnalysisConnection(profiles, connections) {
  const profile=profiles?.[0];
  return profile?.connectionId && connections.find(row=>row.connectionId===profile.connectionId && row.tool===profile.tool && Object.hasOwn(policies,row.tool));
}
export function isAnalysisReceipt(receipt, request, contextPolicy = 'new-isolated-session') {
  return receipt?.requestId===request.requestId && receipt.projectId===request.projectId && receipt.connectionId===request.connectionId &&
    receipt.tool===request.tool && typeof receipt.sourceSessionId==='string' && !!receipt.sourceSessionId.trim() &&
    receipt.contextPolicy===contextPolicy && Object.hasOwn(policies,request.tool) && receipt.toolPolicy===policies[request.tool];
}

const DAY=86400000;
export const reviewPeriod=7*DAY;
export const profileKey = c => c && digest(JSON.stringify([c.tool,c.connectionId,c.model??null]));
const noteKey = notes => digest(JSON.stringify(notes.map(n=>[n.id,n.revision,n.title,n.body,n.expansions,n.attachments?.map(f=>[f.id,f.name,f.size,f.sha256])]).sort((a,b)=>a[0].localeCompare(b[0]))));
const problems={ SYSTEM_TIMEOUT:'Agent 回复超时，请稍后重试。', SYSTEM_CONNECTION_MISSING:'请在设置里重新连接首个 Agent。',
  SYSTEM_TOOL_POLICY:'Agent 尝试操作工具，本次分析已停止。' };

export function createKnowledgeGraphGenerator({readLibrary,saveGraph,readConfigured,connections,assist,prepareAttachments=async notes=>({notes,coverage:[]}),onProgress=()=>{},now=()=>Date.now(),signal}){
  let pending, checkpoint;
  function forgetNote(id) {
    if (!checkpoint) return;
    checkpoint.deleted.add(id);
    for (const [key,part] of checkpoint.parts) if (part.noteId===id) checkpoint.parts.delete(key);
    for (const [key,review] of checkpoint.reviews) if (review.noteIds.has(id)) checkpoint.reviews.delete(key);
  }
  const connection=()=>configuredAnalysisConnection(readConfigured(),connections());
  async function run(){
    signal?.throwIfAborted();
    const library=readLibrary(), {notes,agentGraph:previous}=library;
    const selected=connection(), chosen=profileKey(selected);
    if (!notes.length || checkpoint?.profile!==chosen) checkpoint=undefined;
    if(!notes.length)throw Error('先在「帮你记」写下一篇笔记。');
    if(!selected)throw Error('请在设置里连接首个支持分析的 Agent（Codex、Claude 或 DSH）。');
    const revision=noteKey(notes),fingerprint=digest(JSON.stringify([2,chosen,revision])),at=new Date(now()).toISOString();
    const prior=previous?.reasoning?.version===2 && previous.reasoning.profile===chosen ? previous.reasoning : undefined;
    const due=prior && now()-Date.parse(prior.reviewAt)>=reviewPeriod;
    if(previous?.fingerprint===fingerprint && prior && !due && !prior.attachmentCoverage?.some(f=>f.status==='failed')) {
      checkpoint=undefined;
      return {count:previous.edges.length,noteCount:notes.length,reused:true};
    }

    checkpoint??={profile:chosen,parts:new Map(),reviews:new Map(),deleted:new Set(),versions:new Map()};
    const versions=new Map(notes.map(n=>[n.id,n.revision]));
    for (const [id,version] of checkpoint.versions) {
      if (!versions.has(id)) forgetNote(id);
      else if (version!==versions.get(id)) {
        for (const [key,review] of checkpoint.reviews) if (review.noteIds.has(id)) checkpoint.reviews.delete(key);
      }
    }
    checkpoint.versions=versions;
    const current=()=>{
      signal?.throwIfAborted();
      if(profileKey(connection())!==chosen)throw Error('Agent 配置已变化，请重新生成。');
      const latest=readLibrary();
      if(noteKey(latest.notes)!==revision)throw Error('分析期间笔记有更新，将按最新内容重新生成。');
      return latest;
    };
    const ask=async(prompt,outputSchema)=>{
      current();
      const request={requestId:randomUUID(),projectId:'personal-knowledge',connectionId:selected.connectionId,
        tool:selected.tool,kind:'integration',timeoutMs:120000,prompt,outputSchema};
      let receipt;
      try{receipt=await assist(request);}catch(e){throw Error(problems[e?.code]??('Agent 分析未完成：'+(e?.message||'连接不可用')));}
      if(!isAnalysisReceipt(receipt,request))throw Error('Agent 的来源或隔离方式未能核对。');
      return receipt.output;
    };
    const {notes:materials,coverage}=await prepareAttachments(notes);
    current();
    const {atoms,chunks}=await extractKnowledgeAtoms({notes:materials,ask,previous:prior,checkpoint,onProgress});
    const sources=new Map(materials.map(n=>[n.id,new Map(noteSources(n))]));
    const byId=new Map(atoms.map(a=>[a.id,a])),quotes=new Map();
    for(const a of atoms){
      const quote=sources.get(a.noteId)?.get(a.source)?.slice(a.start,a.end);
      if(!quote || digest(quote)!==a.digest)throw Error('分析期间原文有更新。');
      quotes.set(a.id,quote);
    }
    const live=new Map(),history=[...(previous?.reasoning?.history??[])];
    const oldAtoms=new Map((previous?.reasoning?.atoms??[]).map(a=>[a.id,a]));
    const decision=new Map(library.decisions.map(d=>[d.evidence,d.result]));
    for(const f of previous?.reasoning?.findings??[]){
      if(prior && f.evidence.every(id=>byId.has(id))) live.set(f.key,f);
      else history.push({at,decision:decision.get(f.key),finding:f,anchors:f.evidence.map(id=>oldAtoms.get(id)).filter(Boolean)});
    }
    const changed=new Set(atoms.filter(a=>!prior || !oldAtoms.has(a.id)).map(a=>a.id));
    const round=prior?(prior.round+(due?1:0)):0;
    if(due){
      const historic=[...atoms].sort((a,b)=>a.id.localeCompare(b.id));
      for(let i=0;i<Math.min(32,historic.length);i++)changed.add(historic[((round-1)*32+i)%historic.length].id);
    }
    const reviewed=due?[]:prior?.reviewed??[];
    const neighbours=()=>[...live.values()].filter(f=>decision.get(f.key)!=='dismissed');
    const groups=await retrieveCandidates(atoms,quotes,neighbours(),changed,round,signal);
    const before=live.size;
    let report=await reasonOverGroups({groups,atoms,quotes,ask,reviewed,findings:live,checkpoint,onProgress});
    if(live.size>before && atoms.length>2){
      const next=await retrieveCandidates(atoms,quotes,neighbours(),changed,round,signal);
      report=await reasonOverGroups({groups:next,atoms,quotes,ask,reviewed:report.reviewed,findings:live,checkpoint,onProgress});
    }
    const latest = current();
    const decisions = new Map(latest.decisions.map(d => [d.evidence, d]));
    for (const original of prior?.findings ?? []) {
      const revised = live.get(original.key);
      if (!revised || revised === original) continue;
      // A confirmed interpretation belongs to the person who reviewed it.
      if (decisions.has(original.key) && original.evidence.every(id => byId.has(id))) {
        live.set(original.key, original);
      } else if (['category','mode','label','explanation','consequence','check','limitation'].some(k => original[k] !== revised[k])) {
        if (!history.some(entry => entry.at === at && entry.finding === original)) {
          history.push({at, decision:decisions.get(original.key)?.result, finding:original,
            anchors:original.evidence.map(id => oldAtoms.get(id)).filter(Boolean)});
        }
      }
    }
    for (const entry of history) {
      const d = decisions.get(entry.finding.key);
      if (entry.at === at && d) entry.decision = d.result;
    }
    const findings=[...live.values()];
    const edges=findings.map(f=>{
      const anchors=f.evidence.map(id=>byId.get(id)),[from,to]=anchors;
      return {from:from.noteId,to:to.noteId,fromRevision:from.revision,toRevision:to.revision,provider:selected.tool,
        evidenceKey:f.key,category:f.category,mode:f.mode,label:f.label,explanation:f.explanation,
        consequence:f.consequence,check:f.check,limitation:f.limitation,
        anchors:anchors.map(({noteId,revision,source,start,end,origin,at,digest})=>({noteId,revision,source,start,end,origin,at,digest}))};
    });
    if (previous && !previous.reasoning) {
      const oldFeedback = new Map();
      for (const edge of previous.edges ?? []) {
        const legacyKey = edge.evidenceKey ?? JSON.stringify(['agent', [[edge.from,edge.fromRevision],[edge.to,edge.toRevision]].sort()]);
        const feedback = decisions.get(legacyKey);
        if (!feedback || !edge.fromQuote || !edge.toQuote) continue;
        const sourceKey = JSON.stringify([[edge.from,digest(edge.fromQuote)],[edge.to,digest(edge.toQuote)]].sort());
        oldFeedback.set(sourceKey,{feedback,label:edge.label});
      }
      for (const edge of edges) {
        if (decisions.has(edge.evidenceKey) || edge.anchors.length !== 2) continue;
        const sourceKey = JSON.stringify(edge.anchors.map(a => [a.noteId,a.digest]).sort());
        const old = oldFeedback.get(sourceKey);
        if (old && (old.feedback.result === 'dismissed' || old.label === edge.label)) {
          decisions.set(edge.evidenceKey,{...old.feedback,evidence:edge.evidenceKey});
        }
      }
    }
    const nextLibrary = decisions.size === latest.decisions.length ? latest : {...latest, decisions:[...decisions.values()]};
    saveGraph(nextLibrary,{fingerprint,at,provider:selected.tool,notes:notes.map(({id,revision})=>({id,revision})),edges,
      reasoning:{version:2,profile:chosen,attachmentCoverage:coverage,chunks,atoms,findings,reviewed:report.reviewed,history,round,reviewAt:!prior||due?at:prior.reviewAt}});
    checkpoint=undefined;
    return {count:edges.length,noteCount:notes.length};
  }
  const generate=()=>pending??=run().finally(()=>{pending=undefined;onProgress(null);});
  generate.forgetNote=forgetNote;
  return generate;
}

// Debounce saves and coalesce edits that arrive during a run. A failed connection is retried on the next tick.
export function scheduleKnowledgeReviews({generate,canRun,readLibrary,onError=()=>{},now=()=>Date.now(),delay=30000,interval=3600000}){
  let timer,stopped=false,running=false,dirty=false;
  async function work(){
    if(stopped||running||!canRun())return;
    const {notes,agentGraph}=readLibrary();
    if(!notes.length)return;
    const scheduled=!agentGraph?.reasoning || now()-Date.parse(agentGraph.reasoning.reviewAt)>=reviewPeriod;
    if(!dirty&&!scheduled)return;
    dirty=false;running=true;
    let failed=false;
    try{await generate();}catch(error){failed=true;onError(error);}finally{
      running=false;
      if(dirty)queue();
      if(failed)dirty=true;
    }
  }
  function queue(){clearTimeout(timer);timer=setTimeout(()=>void work(),delay);timer.unref?.();}
  const tick=setInterval(()=>void work(),interval);tick.unref?.();
  return {changed(){if(!stopped){dirty=true;queue();}},stop(){stopped=true;clearInterval(tick);clearTimeout(timer);}};
}
