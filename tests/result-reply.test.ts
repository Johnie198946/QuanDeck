import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { resultReplyTarget } from '../src/data/resultReply';
import { taskResultEntries } from '../src/data/resultPresentation';
import { deliveryReview, deliveryReviewCommand } from '../src/data/deliveryReview';
import type { RuntimeAction, RuntimeDriver, RuntimeEvent, RuntimeRunInput, RuntimeRunRecord } from '../src/data/runtimeContracts';

const memory = new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
  getItem:(key:string) => memory.get(key) ?? null, setItem:(key:string,value:string) => memory.set(key,value), removeItem:(key:string) => memory.delete(key),
}});

class Transport implements RuntimeDriver {
  records: RuntimeRunRecord[] = [];
  controls: {runId:string;action:RuntimeAction;payload?:Record<string,unknown>}[] = [];
  listener = (_event:RuntimeEvent) => {};
  stopConfirmed = true;
  rejectNext = false;
  ackLost = false;
  subscribe(listener: (event:RuntimeEvent) => void) { this.listener = listener; return () => {}; }
  async run(input:RuntimeRunInput) {
    const run:RuntimeRunRecord = {...input,runId:'run'+this.records.length,sessionId:'source'+this.records.length,acceptedAt:new Date().toISOString(),events:[],acceptance:'acknowledged'};
    this.records.push(run);
    if (this.rejectNext) { this.rejectNext=false; Object.assign(run,{acceptance:'rejected',stoppedConfirmed:true}); throw Object.assign(Error('未连接'),{rejected:true}); }
    if (this.ackLost) { run.acceptance='unknown'; throw Error('回执中断'); }
    return run;
  }
  async control(runId:string,action:RuntimeAction,payload?:Record<string,unknown>) {
    this.controls.push({runId,action,payload});
    const run=this.records.find(r=>r.runId===runId)!;
    this.emit(run,{status:action==='reply'?'running':'paused',stoppedConfirmed:action==='stop' && this.stopConfirmed});
    return {stoppedConfirmed:action==='stop' && this.stopConfirmed};
  }
  emit(run:RuntimeRunRecord,data:Partial<RuntimeEvent>) {
    const seq=run.events!.length;
    const event:RuntimeEvent={...data,id:run.runId+'-event-'+seq,sequence:seq,runId:run.runId,sessionId:run.sessionId,at:new Date(Date.now()+1000+seq).toISOString()};
    run.events!.push(event); this.listener(event);
  }
  listRuns=() => this.records;
  scan=async () => [];
}
async function exercise() {
  const base = new LocalWorkdeckDataSource(), driver=new Transport(), api=createRuntimeDataSource(base,driver);
  try {
    const projectId=(await api.createProject({name:'原项目'})).projectId!;
    await api.registerAgent({id:'writer',name:'Codex',short:'Codex',color:'#123456'});
    await api.bindRuntimeConnection('writer',{tool:'codex',connectionId:'writer-test',projectPath:'/tmp/result-reply'});
    const block=await api.addBlock('task','京都的方案');
    const item=(await api.load()).journal.blocks.find(b=>b.id===block);
    assert(item?.kind==='task'); const taskId=item.taskId;
    const first=await api.dispatchProjectTask(projectId,taskId,'writer'); assert(first.ok,first.message);
    const original=driver.records[0];
    driver.emit(original,{reply:{id:'ask',text:'请说明需要包含哪些地点？'},status:'waiting_reply'});
    await api.flushRuntime();
    let state=(await base.getProjectSnapshot(projectId))!;
    const raw=taskResultEntries(state,taskId,null)[0], draft=resultReplyTarget(state,taskId,raw);
    assert(draft.target,draft.reason);
    const clarification={target:draft.target,text:'包括清水寺。',messageId:'clarify'};
    assert((await api.replyToResult(clarification)).ok);
    assert((await api.replyToResult(clarification)).ok);
    assert.equal(driver.controls.filter(c=>c.action==='reply').length,1);
    assert.equal(driver.controls[0].runId,original.runId);
    const reply=(run:RuntimeRunRecord,id:string,text:string) => driver.emit(run,{status:'waiting_reply',reply:{id,text},turnCompleted:true});
    reply(original,'v1','第一版京都路线包含清水寺。');
    await api.flushRuntime(); state=(await base.getProjectSnapshot(projectId))!;
    const firstArtifact=state.collaboration!.artifacts.at(-1)!;
    const candidate=taskResultEntries(state,taskId,null).find(e=>e.artifactId===firstArtifact.id)!;
    const target=resultReplyTarget(state,taskId,candidate).target!;
    assert(target?.artifactId);
    assert(!resultReplyTarget(state,taskId,{...candidate,record:{...candidate.record,origin:'human'}}).target);
    assert(!(await api.replyToResult({target:{...target,agentId:'someone-else'},text:'误发',messageId:'wrong-agent'})).ok);
    const review=deliveryReview(state,firstArtifact.id)!;
    assert((await api.collaborate(deliveryReviewCommand(state,firstArtifact.id,'accepted',review.spec!.criteria.map(()=>true),''))).ok);
    const other=(await api.createProject({name:'切换后的项目'})).projectId!;
    const input={target,text:'加上京都站出发时间。',messageId:'revision-1'};
    driver.stopConfirmed=false;
    assert(!(await api.replyToResult(input)).ok);
    assert.equal(driver.records.length,1);
    driver.stopConfirmed=true;
    driver.rejectNext=true;
    const failed=await api.replyToResult(input);
    assert(!failed.ok);
    assert.equal(driver.records.length,2,failed.message);
    assert(failed.sessionId);
    const sent=await api.retryDispatch(failed.sessionId!);
    assert(sent.ok,sent.message);
    assert.equal(driver.records.length,3);
    const revised=driver.records[2];
    assert.equal(revised.taskId,taskId); assert.equal(revised.projectId,projectId); assert.equal(revised.agentId,'writer');
    assert.deepEqual(revised.allowedFallbackConnectionIds,[]);
    assert(revised.prompt?.includes(firstArtifact.body)); assert(revised.prompt?.includes(input.text));
    assert((await api.replyToResult(input)).ok);
    assert(!(await api.replyToResult({...input,text:'已改变的意见'})).ok);
    assert.equal(driver.records.length,3);
    assert.equal((await api.load()).project.id,other);
    reply(revised,'v2','第二版京都路线：09:00 从京都站出发，前往清水寺。');
    await api.flushRuntime(); state=(await base.getProjectSnapshot(projectId))!;
    assert.equal(state.collaboration!.artifacts.at(-1)!.version,firstArtifact.version+1);
    assert.equal(state.collaboration!.artifacts[0].body,firstArtifact.body);
    assert.equal(state.collaboration!.reviews.filter(r=>r.note===input.text).length,1);
    assert(!(await api.replyToResult({...input,messageId:'obsolete'})).ok);
    const newest=taskResultEntries(state,taskId,null).find(e=>e.artifactId===state.collaboration!.artifacts.at(-1)!.id)!;
    const next={target:resultReplyTarget(state,taskId,newest).target!,text:'改到上午十点',messageId:'revision-2'};
    driver.ackLost=true;
    assert(!(await api.replyToResult(next)).ok);
    assert(!(await api.replyToResult(next)).ok);
    assert.equal(driver.records.length,4);
    driver.records[3].acceptance='acknowledged';
    assert((await api.replyToResult(next)).ok);
    assert.equal(driver.records.length,4);
  } finally { api.dispose(); }
}
exercise().then(()=>console.log('Result replies: source scope, original author, versioned rework, stop verification, retries and recovery passed')).catch(error=>{console.error(error);process.exitCode=1;});
