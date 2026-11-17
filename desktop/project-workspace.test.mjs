import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectWorkspacePreparer } from './app/project-workspace.mjs';
const capabilities={observe:true,dispatch:true,resume:true,usage:true,subAgents:false,sourceOpen:true,permissions:true};
const profile={tool:'codex',projectPath:'/old',connectionId:'old',binary:'/bin/codex',model:'model-a',fallbackPolicy:{enabled:true},token:'never-copied'};
const options=(extra={})=>({records:()=>[profile],profiles:records=>({profiles:records,conflicts:[]}),projects:async()=>[],directory:async value=>value,testConnection:async input=>({...input,connectionId:`connection:${input.projectPath}`,status:'ready',capabilities}),...extra});
test('new projects reuse settings with separate scopes and no execution/policy/credential copying',async()=>{
 const calls=[];const prepare=createProjectWorkspacePreparer(options({testConnection:async input=>{calls.push(input);return{...input,connectionId:`connection:${input.projectPath}`,status:'ready',capabilities};}}));
 const emptyA=await prepare('/project-a'),emptyB=await prepare('/project-b');
 assert.equal(calls.length,0,'creating projects does not contact an Agent');assert.deepEqual(emptyA.bindings,{});assert.deepEqual(emptyB.bindings,{});
 const a=await prepare('/project-a',{},'a','codex'),b=await prepare('/project-b',{},'b','codex');
 assert.equal(calls.length,2);assert.notEqual(a.bindings.codex.connectionId,b.bindings.codex.connectionId);
 assert.deepEqual(calls[0],{tool:'codex',projectPath:'/project-a',binary:'/bin/codex',model:'model-a'});
 assert.equal(a.bindings.codex.fallbackPolicy,undefined);assert.equal(a.bindings.codex.token,undefined);assert.deepEqual(a.issues,[]);
});
test('directory-only save preserves transport history; next operation reports failed connection without losing folder',async()=>{
 const pinned={connectionId:'pinned',tool:'codex',projectPath:'/project',capabilities,model:'override'};
 let calls=0;const prepare=createProjectWorkspacePreparer(options({testConnection:async()=>{calls++;throw Error('login expired');}}));
 assert.deepEqual((await prepare('/project',{codex:pinned})).bindings.codex,pinned);assert.equal(calls,0);
 const failed=await prepare('/project',{},'p','codex');assert.equal(failed.workspacePath,'/project');assert.deepEqual(failed.bindings,{});assert.match(failed.issues[0],/登录已失效/);
});
test('conflicting old defaults do not connect; invalid receipts are never bound',async()=>{
 let calls=0;const conflict=createProjectWorkspacePreparer(options({profiles:()=>({profiles:[],conflicts:['codex']}),testConnection:async()=>{calls++;}}));
 assert.match((await conflict('/project',{},'p','codex')).issues[0],/多套旧配置/);assert.equal(calls,0);
 for(const override of [{projectPath:'/other'},{tool:'claude'},{model:'different'},{capabilities:{dispatch:'true'}},{status:'needs_login'}]) {
  const prepare=createProjectWorkspacePreparer(options({testConnection:async input=>({...input,connectionId:'x',status:'ready',capabilities,...override})}));
  const result=await prepare('/project',{},'p','codex');assert.deepEqual(result.bindings,{});assert.equal(result.issues.length,1);
 }
});
test('real directory validation and existing project collision are checked before handshake',async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'quandeck-workspace-')));try{
  const folder=path.join(root,'project');await mkdir(folder);const link=path.join(root,'alias');await symlink(folder,link);const file=path.join(root,'file');await writeFile(file,'x');let calls=0;
  const prepare=createProjectWorkspacePreparer({...options({projects:async()=>[{project:{id:'p',name:'Existing',workspacePath:folder}}],testConnection:async()=>{calls++;}}),directory:undefined});
  await assert.rejects(prepare(link),/已用于项目/);await assert.rejects(prepare(file),/不是文件夹/);await assert.rejects(prepare('relative'),/有效/);assert.equal(calls,0);
  const same=await prepare(folder,{codex:{connectionId:'existing'}},'p');assert.equal(same.workspacePath,folder);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('operation resolution checks only the chosen profile and rejects changed application defaults',async()=>{
 let records=[profile,{tool:'dsh',projectPath:'/setup',binary:'/bin/dsh'}];const calls=[];
 const prepare=createProjectWorkspacePreparer(options({records:()=>records,testConnection:async input=>{calls.push(input.tool);return{...input,connectionId:'new',status:'ready',capabilities};}}));
 const result=await prepare('/project',{},'project-id','codex');assert.deepEqual(calls,['codex']);assert.equal(result.bindings.codex.connectionId,'new');
 const missing=await prepare('/project',{},'project-id','missing');assert.match(missing.issues[0],/应用默认配置/);
 const stale=createProjectWorkspacePreparer(options({records:()=>records,testConnection:async input=>{records=[{...profile,model:'changed'}];return{...input,connectionId:'stale',status:'ready',capabilities};}}));
 const rejected=await stale('/project',{},'project-id','codex');assert.deepEqual(rejected.bindings,{});assert.match(rejected.issues[0],/配置已改变/);
});

test('next operations refresh stale profile caches, reuse identical transports and retain old receipt on failure',async()=>{
 let record={...profile,scope:'application'},calls=0;
 const prepare=createProjectWorkspacePreparer(options({records:()=>[record],testConnection:async input=>{calls++;return{...input,connectionId:`${input.model}:${input.projectPath}`,status:'ready',capabilities};}}));
 const initial=await prepare('/a',{},'a','codex');const frozen=structuredClone(initial.bindings.codex);
 assert.equal(calls,1);assert.match(frozen.profileRevision,/^[a-f0-9]{64}$/);
 const cached=await prepare('/a',initial.bindings,'a','codex');assert.equal(calls,1);assert.deepEqual(cached.bindings.codex,frozen);
 record={...record,model:'new-global-model'};
 const next=await prepare('/a',initial.bindings,'a','codex');assert.equal(calls,2);assert.equal(next.bindings.codex.connectionId,'new-global-model:/a');assert.notEqual(next.bindings.codex.profileRevision,frozen.profileRevision);
 assert.deepEqual(initial.bindings.codex,frozen,'original active session receipt is never changed');
 const fail=createProjectWorkspacePreparer(options({records:()=>[record],testConnection:async()=>{throw Error('login expired');}}));
 const rejected=await fail('/a',initial.bindings,'a','codex');assert.equal(rejected.issues.length,1);assert.deepEqual(rejected.bindings.codex,frozen);
});
