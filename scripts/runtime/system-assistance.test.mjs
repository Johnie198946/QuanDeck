import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRuntimeDriver } from './driver.mjs';
const binary=fileURLToPath(new URL('./fixtures/system-peer.mjs',import.meta.url));
const connection={connectionId:'first',tool:'codex',binary,nodePath:process.execPath,projectPath:'/old-project-must-not-be-read'};
const schema={type:'object',properties:{schemaVersion:{const:'quandeck.ai.classify.v1'},binding:{properties:{requestId:{const:'system1'},projectId:{const:'new-project'},sourceSeq:{const:0},inputId:{const:'input1'}}}}};
const input={requestId:'system1',projectId:'new-project',connectionId:'first',tool:'codex',kind:'classify',prompt:'Only analyze explicit input',outputSchema:schema,maxTokens:2000,timeoutMs:2000};
test('system Codex runs in an empty isolated new session, separate from business runs and events',async()=>{
 const events=[],driver=createRuntimeDriver({getConnection:()=>connection,onEvent:event=>events.push(event)});
 try{const [a,b]=await Promise.all([driver.assist(input),driver.assist(input)]);assert.equal(a.sourceSessionId,b.sourceSessionId);assert.equal(a.projectId,'new-project');assert.equal(a.actualTokens,23);assert.equal(a.contextPolicy,'new-isolated-session');assert.equal(a.toolPolicy,'read-only-isolated');assert.deepEqual(driver.listRuns(),[]);assert.deepEqual(events,[]);await assert.rejects(driver.assist({...input,prompt:'changed'}),/不能复用/);const next=await driver.assist({...input,requestId:'system2'});assert.notEqual(a.sourceSessionId,next.sourceSessionId);}finally{await driver.close();}
});
test('unconfirmed sandbox, unsupported first tool and any attempted system tool fail closed',async()=>{
 for(const override of [{model:'unsafe'},{tool:'dsh'}]){const driver=createRuntimeDriver({getConnection:()=>({...connection,...override})});try{await assert.rejects(driver.assist({...input,tool:override.tool??'codex'}),error=>['SYSTEM_ADAPTER_UNSUPPORTED'].includes(error.code));assert.equal(driver.listRuns().length,0);}finally{await driver.close();}}
 const driver=createRuntimeDriver({getConnection:()=>connection});try{await assert.rejects(driver.assist({...input,prompt:'REQUEST_TOOL'}),error=>error.code==='SYSTEM_TOOL_POLICY');}finally{await driver.close();}
});
test('system timeout has explicit unknown acceptance and never resends the same request',async()=>{
 const driver=createRuntimeDriver({getConnection:()=>connection});try{const request={...input,prompt:'TIMEOUT',timeoutMs:1000};await assert.rejects(driver.assist(request),error=>error.code==='SYSTEM_TIMEOUT');await assert.rejects(driver.assist(request),error=>error.code==='SYSTEM_TIMEOUT');assert.equal(driver.listRuns().length,0);}finally{await driver.close();}
});
test('closing driver cancels system inference promptly instead of waiting for the request timeout',async()=>{
 const driver=createRuntimeDriver({getConnection:()=>connection});const pending=driver.assist({...input,prompt:'TIMEOUT',timeoutMs:90000}).catch(error=>error);await new Promise(resolve=>setTimeout(resolve,60));const start=Date.now();await driver.close();const result=await pending;assert.equal(result.code,'SYSTEM_INTERRUPTED');assert(Date.now()-start<1500);assert.equal(driver.listRuns().length,0);
});
test('Claude system requests explicitly disable tools, settings, MCP and history; missing usage remains null',async()=>{
 let options;
 const sdk={query:value=>{options=value.options;return{close(){},async *[Symbol.asyncIterator](){yield{type:'system',subtype:'init',session_id:'real-claude-system',tools:[]};yield{type:'result',subtype:'success',session_id:'real-claude-system',is_error:false,structured_output:{ok:true},modelUsage:{model:{}}};}};}};
 const driver=createRuntimeDriver({getConnection:()=>({...connection,tool:'claude'}),systemSdk:sdk});
 try{const receipt=await driver.assist({...input,tool:'claude'});assert.deepEqual(options.tools,[]);assert.deepEqual(options.settingSources,[]);assert.deepEqual(options.skills,[]);assert.deepEqual(options.plugins,[]);assert.deepEqual(options.mcpServers,{});assert.equal(options.strictMcpConfig,true);assert.equal(options.persistSession,false);assert.equal(options.resume,undefined);assert.notEqual(options.cwd,connection.projectPath);assert.equal(receipt.actualTokens,null);assert.equal(receipt.sourceSessionId,'real-claude-system');assert.deepEqual(driver.listRuns(),[]);}finally{await driver.close();}
});
