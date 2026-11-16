import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createBridgeService, sourceArguments } from '../agent-bridge.mjs';
import { createRuntimeDriver } from './driver.mjs';
import { buildDshSystemPatch, verifyDshSystemConfig } from './dsh-system.mjs';
const binary=fileURLToPath(new URL('./fixtures/system-peer.mjs',import.meta.url));
const connection={connectionId:'connected',tool:'codex',binary,nodePath:process.execPath,projectPath:'/not-read'};
const request={connectionId:connection.connectionId,tool:connection.tool,requestId:'hello-request-one'};
test('real protocol hello requires completed reply, coalesces clicks/nonces, and creates no business runs',async()=>{
 let launches=0;
 const service=createBridgeService({connections:[connection],spawnProcess:(...args)=>{launches++;return spawn(...args);}});
 try {
  const [a,b,c]=await Promise.all([service.probe(request),service.probe(request),service.probe({...request,requestId:'another-click'})]);
  assert.equal(a.status,'connected');assert.deepEqual(a,b);assert.deepEqual(a,c);assert.equal(launches,1);
  assert.deepEqual(await service.probe(request),a);assert.equal(launches,1);assert.deepEqual(service.runtime.listRuns(),[]);
  await assert.rejects(service.probe({...request,requestId:''}),/标识/);
 }finally{await service.runtime.close();}
});
test('an incorrect reply, provider failure or tool request can never be a connected result',async()=>{
 for(const mode of ['wrong','error','tool']){
  let attempts=0;
  const systemSdk={query:()=>{attempts++;return{close(){},async *[Symbol.asyncIterator](){
   yield{type:'system',subtype:'init',session_id:'test',tools:mode==='tool'?['Bash']:[]};
   yield{type:'result',subtype:mode==='error'?'error_during_execution':'success',is_error:mode==='error',session_id:'test',structured_output:{reply:'goodbye'}};
  }}}};
  const service=createBridgeService({connections:[{...connection,tool:'claude'}],systemSdk});
  try{const input={...request,tool:'claude'};assert.equal((await service.probe(input)).status,'failed');assert.equal((await service.probe(input)).status,'failed');assert.equal(attempts,1);assert.deepEqual(service.runtime.listRuns(),[]);}finally{await service.runtime.close();}
 }
});
test('DSH rc2 one-shot uses source route with isolated plugin patch and cleans up for hello/title/tool failure/timeout',async()=>{
 const dsh={...connection,tool:'dsh',binary:fileURLToPath(new URL('./fixtures/dsh-system-peer.mjs',import.meta.url)),projectPath:fileURLToPath(new URL('./fixtures',import.meta.url))};
 let cwd;
 const driver=createRuntimeDriver({getConnection:()=>dsh,spawnProcess:(binary,args,options)=>{cwd=options.cwd;return spawn(binary,args,options);}});
 const base={projectId:'p',connectionId:'connected',tool:'dsh',kind:'connectivity',maxTokens:256,timeoutMs:10000,outputSchema:{type:'object',properties:{reply:{const:'hello'}}}};
 try{
  const hello=await driver.assist({...base,requestId:'dsh-hello',prompt:'hello'});assert.equal(hello.output.reply,'hello');assert.equal(hello.toolPolicy,'isolated-no-tool-plugins');assert.notEqual(cwd,dsh.projectPath);await assert.rejects(access(cwd));
  const title=await driver.assist({...base,kind:'title',requestId:'dsh-title',prompt:'TITLE'});assert.equal(title.output.title,'简洁标题');
  await assert.rejects(driver.assist({...base,requestId:'dsh-tool',prompt:'REQUEST_TOOL'}),e=>e.code==='SYSTEM_TOOL_POLICY');await assert.rejects(access(cwd));
  await assert.rejects(driver.assist({...base,requestId:'dsh-timeout',prompt:'TIMEOUT',timeoutMs:1000}),e=>e.code==='SYSTEM_TIMEOUT');await assert.rejects(access(cwd));assert.deepEqual(driver.listRuns(),[]);
 }finally{await driver.close();}
});
test('DSH unknown tool/plugin remains disabled; malformed or unverified overlays fail before inference',()=>{
 const names=['llm','session','agent','tools','system-prompt','agent-loop','sdk-app','sdk-jsonrpc-server'];
 const rows=names.map(name=>({id:name,name:`@deepseek-ai/dsh-${name}`}));rows.push({id:'external',name:'custom-mcp-plugin',config:{token:'must-not-copy'}},{id:'settings',name:'@deepseek-ai/dsh-settings'},{id:'config-editor',name:'@deepseek-ai/dsh-config-editor'});
 const patch=buildDshSystemPatch(JSON.stringify(rows),'hello');assert.equal(patch.find(p=>p.id==='external').disabled,true);assert.equal(patch.find(p=>p.id==='settings').disabled,true);assert.equal(patch.find(p=>p.id==='config-editor').disabled,true);assert(!JSON.stringify(patch).includes('must-not-copy'));
 const applied=rows.map(row=>({...row,...patch.find(p=>p.id===row.id)}));verifyDshSystemConfig(JSON.stringify(applied),'hello');
 applied.at(-1).disabled=false;assert.throws(()=>verifyDshSystemConfig(JSON.stringify(applied),'hello'));
 assert.throws(()=>buildDshSystemPatch(JSON.stringify([{id:'group',group:true,config:rows}]),'hello'));
});
test('source arguments resume native Codex/Claude and never launch the DSH web UI',()=>{
 const id='019a7d11-6213-7110-9279-000000000003';
 assert.deepEqual(sourceArguments('codex','/project',id),['resume',id,'-C','/project']);
 assert.deepEqual(sourceArguments('claude','/project',id),['--resume',id]);
 assert.throws(()=>sourceArguments('dsh','/project',id),/尚未提供/);
 assert.throws(()=>sourceArguments('claude','/project','bad; shell'));
});

test('DSH current SDK uses the same isolated hello path with negotiated requests',async()=>{
 process.env.QD_FIXTURE_MODERN='1';
 const dsh={...connection,tool:'dsh',binary:fileURLToPath(new URL('./fixtures/dsh-system-peer.mjs',import.meta.url)),projectPath:fileURLToPath(new URL('./fixtures',import.meta.url))};
 const service=createBridgeService({connections:[dsh]});
 try{assert.equal((await service.probe({...request,tool:'dsh'})).status,'connected');assert.deepEqual(service.runtime.listRuns(),[]);}finally{delete process.env.QD_FIXTURE_MODERN;await service.runtime.close();}
});
test('owned Codex and Claude source actions open real agent session without runtime popup or prompt',async()=>{
 const id='019a7d11-6213-7110-9279-000000000003';
 for(const tool of ['codex','claude']){
  let opened;
  const service=createBridgeService({connections:[{...connection,tool,canResume:true}],validDirectory:async value=>value,initialRuns:[{connectionId:connection.connectionId,runId:'owned-run',sessionId:id,tool,status:'done',events:[],sequence:0}],terminalOpen:async(binary,cwd,sessionId)=>{opened={tool,sessionId};},openSourceTool:async(c,sessionId)=>{opened={tool:c.tool,sessionId};}});
  try{const result=await service.open({mode:'live',connectionId:connection.connectionId,tool,sessionId:id});assert.equal(result.status,'opened');assert.equal(result.runId,undefined);assert.deepEqual(opened,{tool,sessionId:id});}finally{await service.runtime.close();}
 }
});
