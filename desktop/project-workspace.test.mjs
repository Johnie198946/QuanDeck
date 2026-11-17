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
 const a=await prepare('/project-a'),b=await prepare('/project-b');
 assert.equal(calls.length,2);assert.notEqual(a.bindings.codex.connectionId,b.bindings.codex.connectionId);
 assert.deepEqual(calls[0],{tool:'codex',projectPath:'/project-a',binary:'/bin/codex',model:'model-a'});
 assert.equal(a.bindings.codex.fallbackPolicy,undefined);assert.equal(a.bindings.codex.token,undefined);assert.deepEqual(a.issues,[]);
});
test('retry preserves project overrides and reports failed connections without losing project folder',async()=>{
 const pinned={connectionId:'pinned',tool:'codex',projectPath:'/project',capabilities,model:'override'};
 let calls=0;const prepare=createProjectWorkspacePreparer(options({testConnection:async()=>{calls++;throw Error('login expired');}}));
 assert.deepEqual((await prepare('/project',{codex:pinned})).bindings.codex,pinned);assert.equal(calls,0);
 const failed=await prepare('/project');assert.equal(failed.workspacePath,'/project');assert.deepEqual(failed.bindings,{});assert.match(failed.issues[0],/登录已失效/);
});
test('conflicting old defaults do not connect; invalid receipts are never bound',async()=>{
 let calls=0;const conflict=createProjectWorkspacePreparer(options({profiles:()=>({profiles:[],conflicts:['codex']}),testConnection:async()=>{calls++;}}));
 assert.match((await conflict('/project')).issues[0],/多套旧配置/);assert.equal(calls,0);
 for(const override of [{projectPath:'/other'},{tool:'claude'},{model:'different'},{capabilities:{dispatch:'true'}},{status:'needs_login'}]) {
  const prepare=createProjectWorkspacePreparer(options({testConnection:async input=>({...input,connectionId:'x',status:'ready',capabilities,...override})}));
  const result=await prepare('/project');assert.deepEqual(result.bindings,{});assert.equal(result.issues.length,1);
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
