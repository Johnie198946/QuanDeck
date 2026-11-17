import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import type { RuntimeConnectionBinding, RuntimeDriver } from '../src/data/runtimeContracts';
const memory=new Map<string,string>();let failWrite=false;
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{if(failWrite)throw Error('disk full');memory.set(key,value);},removeItem:(key:string)=>memory.delete(key)}});
const caps={observe:true,dispatch:true,resume:true,usage:true,subAgents:false,sourceOpen:true,permissions:true};
const binding=(id:string,path='/original'):RuntimeConnectionBinding=>({tool:'codex',connectionId:id,projectPath:path,capabilities:caps});
async function main(){
 let mode='ok',prepared=0,launches=0,release:(()=>void)|undefined;
 const base=new LocalWorkdeckDataSource({prepareProjectWorkspace:async(path,existing={},projectId,agentId)=>{
  if(!agentId)return{workspacePath:path,bindings:existing,issues:[]};
  prepared++;assert.equal(agentId,'codex');assert(projectId);
  if(mode==='pending')await new Promise<void>(resolve=>release=resolve);
  return {workspacePath:path,bindings:{...existing,...(mode==='error'?{}:{codex:binding(`fixed-${prepared}`,mode==='wrong-path'?'/wrong':path)})},issues:mode==='error'?['连接检查失败，原连接保留']:[]};
 }});
 const driver:RuntimeDriver={subscribe:()=>()=>{},scan:async()=>[],control:async()=>({}),run:async input=>({connectionId:input.connectionId,runId:`run-${++launches}`,sessionId:`session-${launches}`,acceptedAt:new Date().toISOString()})};
 const source=createRuntimeDataSource(base,driver);source.stopIntelligence();await source.stopGoalAutomation();
 try{
  const a=(await source.createProject({name:'Original'})).projectId!;await source.registerAgent({id:'codex',name:'Codex',short:'Codex',color:'#123456'});await source.bindRuntimeConnection('codex',binding('old'));
  const b=(await source.createProject({name:'Other'})).projectId!;await source.bindRuntimeConnection('codex',binding('other','/other'));
  assert((await source.updateProject(a,{workspacePath:'/original'})).ok);assert.equal((await source.listProjects()).find(p=>p.project.id===a)!.runtimeConnections!.codex.connectionId,'old','ordinary save preserves pinned overrides');
  assert((await source.repairProjectAgentConnection(a,'codex','old')).ok);let current=(await source.listProjects()).find(p=>p.project.id===a)!;const first=current.runtimeConnections!.codex.connectionId;assert.match(first,/fixed/);assert.equal((await source.load()).project.id,b);assert.equal((await source.load()).runtimeConnections!.codex.connectionId,'other');assert.equal(launches,0);
  const count=prepared;assert.equal((await source.repairProjectAgentConnection(a,'codex','stale')).ok,false);assert.equal(prepared,count,'stale repair is rejected before the handshake');
  mode='error';assert.equal((await source.repairProjectAgentConnection(a,'codex',first)).ok,false);assert.equal((await source.listProjects()).find(p=>p.project.id===a)!.runtimeConnections!.codex.connectionId,first);
  mode='wrong-path';assert.equal((await source.repairProjectAgentConnection(a,'codex',first)).ok,false);
  mode='ok';failWrite=true;assert.equal((await source.repairProjectAgentConnection(a,'codex',first)).ok,false);failWrite=false;assert.equal((await source.listProjects()).find(p=>p.project.id===a)!.runtimeConnections!.codex.connectionId,first,'failed disk write rolls back the binding');
  mode='pending';const pending=source.repairProjectAgentConnection(a,'codex',first);assert(release);await source.bindRuntimeConnection('codex',binding('concurrent'),{projectId:a,expectedConnectionId:first});release!();assert.equal((await pending).ok,false);assert.equal((await source.listProjects()).find(p=>p.project.id===a)!.runtimeConnections!.codex.connectionId,'concurrent');
  mode='ok';await source.switchProject(a);const task=(await source.createIdea('A real in-progress fixture')).taskId!;assert((await source.dispatch(task,'codex')).ok);assert.equal((await source.repairProjectAgentConnection(a,'codex','concurrent')).ok,false,'running sessions block replacement');assert.equal((await source.load()).runtimeConnections!.codex.connectionId,'concurrent');assert.equal(launches,1,'repair does not dispatch or replay work');
  mode='pending';const removed=source.repairProjectAgentConnection(b,'codex','other');assert(release);assert((await source.deleteProject(b)).ok);release!();assert.equal((await removed).ok,false,'deleted project cannot be revived by a late receipt');
  console.log('Project Agent repair: explicit scope, no automatic overwrite, independent project, zero dispatch, failed handshake/disk rollback, path fence, CAS race, active-session and deleted-project guards passed');
 }finally{source.dispose();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
