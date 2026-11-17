import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import type { RuntimeConnectionBinding, RuntimeDriver, RuntimeEvent, RuntimeRunInput } from '../src/data/runtimeContracts';
const memory=new Map<string,string>();let failWrite=false,writes=0;
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{if(failWrite)throw Error('disk full');writes++;memory.set(key,value);},removeItem:(key:string)=>memory.delete(key)}});
const caps={observe:true,dispatch:true,resume:true,usage:true,subAgents:false,sourceOpen:true,permissions:true};
const binding=(profile:string,path:string):RuntimeConnectionBinding=>({tool:'codex',connectionId:`${profile}:${path}`,projectPath:path,capabilities:caps,profileRevision:profile,model:profile});
async function main(){
 let profile='v1',mode='ok',prepared=0,release:(()=>void)|undefined;
 const base=new LocalWorkdeckDataSource({prepareProjectWorkspace:async(path,existing={},projectId,agentId)=>{
  if(!agentId)return {workspacePath:path,bindings:existing,issues:[]};
  prepared++;assert.equal(agentId,'codex');assert(projectId);
  if(mode==='pending')await new Promise<void>(resolve=>release=resolve);
  return {workspacePath:path,bindings:{...existing,...(mode==='error'?{}:{codex:binding(profile,mode==='wrong-path'?'/wrong':path)})},issues:mode==='error'?['连接检查失败']:[]};
 }});
 let listener=(_event:RuntimeEvent)=>{};const calls:RuntimeRunInput[]=[],controls:{runId:string;action:string}[]=[],attachments:string[]=[];
 const driver:RuntimeDriver={subscribe:fn=>{listener=fn;return()=>{};},scan:async()=>[],control:async(runId,action)=>{controls.push({runId,action});return{};},prepareAttachments:async input=>{attachments.push(input.connectionId);return input.ids.map(id=>({id,name:id+'.png',path:input.connectionId.split(':')[1]+'/'+id+'.png'}));},run:async input=>{calls.push(input);return{connectionId:input.connectionId,runId:`run-${calls.length}`,sessionId:`source-${calls.length}`,acceptedAt:new Date().toISOString()};}};
 const source=createRuntimeDataSource(base,driver);source.stopIntelligence();await source.stopGoalAutomation();
 try{
  await source.registerAgent({id:'codex',name:'Codex',short:'Codex',color:'#123456'});
  const a=(await source.createProject({name:'Original',workspacePath:'/a'})).projectId!;
  const task=(await source.createTaskWithAttachments('A real in-progress fixture',[],a)).taskId!;
  const first=await source.dispatch(task,'codex');assert(first.ok,first.message);const firstSessionId=Object.values((await source.load()).sessions).find(session=>session.runtime?.runId==='run-1')!.id;assert.equal(calls[0].connectionId,'v1:/a');
  listener({id:'waiting',sequence:1,runId:'run-1',sessionId:'source-1',at:new Date().toISOString(),status:'waiting_reply'});await source.flushRuntime();
  const b=(await source.createProject({name:'Other',workspacePath:'/b'})).projectId!;
  const before=(await source.listProjects()).map(project=>project.version),beforeWrites=writes,checks=prepared;
  profile='v2'; // Application preference change itself never writes or probes projects.
  await source.registerAgent({id:'codex',name:'Codex',short:'Codex',color:'#123456'});
  assert.equal(writes,beforeWrites,'re-saving an existing identity does not rewrite the project library');assert.equal(prepared,checks);
  assert.deepEqual((await source.listProjects()).map(project=>project.version),before);
  const secondTask=(await source.createTaskWithAttachments('Uses current application profile',[],b)).taskId!;
  assert((await source.dispatch(secondTask,'codex')).ok);assert.equal(calls[1].connectionId,'v2:/b','existing project uses latest profile without a project repair');
  const resolved=await source.resolveProjectAgentConnection(a,'codex');assert(resolved.ok);assert.equal(resolved.binding!.connectionId,'v2:/a');assert.equal(calls.length,2,'resolving configuration creates no task or execution');
  let current=(await source.listProjects()).find(project=>project.project.id===a)!;
  assert.equal(current.sessions[firstSessionId].runtime!.connection.connectionId,'v1:/a','active session retains original transport');
  const file={id:'new-image',name:'image.png',type:'image/png',size:2};assert((await base.addTaskInput(a,task,'','supplement',[file])).ok);
  const continued=await source.controlSession(firstSessionId,'reply',{prompt:'请查看我补充的附件。',inputId:'supplement',attachmentIds:[file.id]});assert(continued.ok,continued.message);
  assert.deepEqual(attachments,['v1:/a']);assert.equal(controls.at(-1)!.runId,'run-1');
  profile='v3';const plan=await source.ensureProjectPlan(b);assert((await source.startDiscussion(plan,'codex','root',b)).ok);assert.equal(calls.at(-1)!.connectionId,'v3:/b','new discussions use latest global profile');
  mode='error';const blockedTask=(await source.createTaskWithAttachments('Connection must not silently fall back',[],b)).taskId!;
  const count=calls.length;assert.equal((await source.dispatch(blockedTask,'codex')).ok,false);assert.equal(calls.length,count);assert.equal((await source.load()).runtimeConnections!.codex.connectionId,'v3:/b','failure preserves history but cannot run with stale settings');
  mode='wrong-path';assert.equal((await source.resolveProjectAgentConnection(a,'codex')).ok,false);
  mode='ok';profile='v4';failWrite=true;assert.equal((await source.resolveProjectAgentConnection(a,'codex')).ok,false);failWrite=false;assert.equal((await source.listProjects()).find(project=>project.project.id===a)!.runtimeConnections!.codex.connectionId,'v2:/a','failed disk write rolls back only the transport cache');
  const c=(await source.createProject({name:'Late resolution',workspacePath:'/c'})).projectId!;
  mode='pending';const pending=source.resolveProjectAgentConnection(c,'codex');assert(release);assert((await source.deleteProject(c)).ok);release!();assert.equal((await pending).ok,false,'deleted project cannot be revived by a late receipt');
  console.log('Global profile next-operation resolution: cross-project updates, zero save-time project writes, immutable running session, attachment continuation, discussion, failure and deleted-project fences passed');
 }finally{source.dispose();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
