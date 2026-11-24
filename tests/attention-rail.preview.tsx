import React from 'react';
import { createRoot } from 'react-dom/client';
import { ExecutionRail } from '../src/components/deck/ExecutionRail';
import { ProjectActivityRow } from '../src/components/deck/ProjectActivityRow';
import { WorkdeckProvider, useWorkdeck } from '../src/state/WorkdeckContext';
import { deriveProjectActivity, needsAttention } from '../src/data/projectActivity';
import { SampleWorkdeckDataSource } from '../src/data/repository';
import { createSampleSnapshot } from '../src/data/fixtures';
import '../src/index.css';
import '../src/quiet.css';

const snapshot = createSampleSnapshot(), sample = Object.values(snapshot.sessions)[0];
const taskId = Object.keys(snapshot.tasks)[0];
const request = {id:'q',token:'question-token',kind:'question' as const,prompt:'交付到哪里？',questions:[{id:'city',question:'选择城市',options:[{label:'南京'},{label:'上海'}]}]};
const permission = {id:'p',token:'permission-token',kind:'permission' as const,permissionSource:'codex',canDelegateToAI:true,prompt:'读取项目资料？',permissionOptions:[{id:'p-once',scope:'once' as const,label:'允许本次',description:'读取当前文件'}]};
snapshot.orchestrations = {};
snapshot.sessions = {};
for (const [id,req] of [['s1',request],['s2',permission]] as const) {
  snapshot.sessions[id] = {...sample,id,taskId,title:req.prompt,source:undefined,subAgents:[],status:'waiting_reply',linkedAsHistory:false,dispatchPhase:'acknowledged',runtime:{
    runId:'run-'+id,dispatchId:'dispatch-'+id,projectId:snapshot.project.id,taskId,connection:{connectionId:'isolated',tool:'codex',projectPath:'/fixture'},purpose:'execution',
    context:{capturedAt:snapshot.now,taskTitle:req.prompt,prompt:''},sequence:1,eventIds:[],requests:{[req.id]:req}
  }};
}
const source = new SampleWorkdeckDataSource({snapshot,onPersist:()=>{}});
let reject = true;
const calls:unknown[]=[];
Object.assign(window,{railControls:calls});
Object.assign(source,{controlSession:async (id:string,action:string,payload:{requestId:string;requestToken:string}) => {
  calls.push({id,action,payload});
  if (id==='s1' && reject) { reject=false; return {ok:false,message:'发送失败，请重试'}; }
  source.mutateRuntime(s => {
    const target=s.sessions[id],rt=target.runtime!;
    if (rt.requests?.[payload.requestId]?.token !== payload.requestToken) throw Error('请求已过期');
    target.status='running'; delete rt.requests![payload.requestId];
  });
  return {ok:true};
}});
function Surface(){
  const {snap}=useWorkdeck();
  return <><section aria-label="任务紧凑待办">{deriveProjectActivity(snap).entries.filter(needsAttention).map(entry=><ProjectActivityRow key={entry.id} entry={entry} compact/>)}</section><ExecutionRail/></>;
}
createRoot(document.querySelector('#root')!).render(<WorkdeckProvider source={source} fallback={null}><Surface/></WorkdeckProvider>);
