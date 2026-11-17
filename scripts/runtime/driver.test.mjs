import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile, access, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRuntimeDriver, initializeRuntime, runtimeInvocation } from './driver.mjs';
import { commandInvocation, resolveDshNpmCommand, createBridgeService } from '../agent-bridge.mjs';
const binary=fileURLToPath(new URL('./fixtures/protocol-peer.mjs',import.meta.url));
const connection={connectionId:'test',tool:'dsh',binary,nodePath:process.execPath,projectPath:path.dirname(binary),provider:'deepseek-official',model:'test-contract'};
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}assert.fail('event not received');};
const make=(options={})=>createRuntimeDriver({getConnection:()=>({...connection,...options.connection}),commandInvocation,...options});
const input={dispatchId:'dispatch1',connectionId:'test',projectId:'p1',taskId:'t1',agentId:'dsh',prompt:'hello'};
test('SDK handshake rejects invalid model and does not claim readiness',async()=>{await assert.rejects(initializeRuntime({...connection,model:'invalid'}),/Unknown model/);});
test('SDK receipt, actual reply and usage; a finished turn waits for user, never completes task',async()=>{
 const d=make(),events=[];d.subscribe(e=>events.push(e));try{const r=await d.run(input);await wait(()=>events.some(e=>e.status==='waiting_reply'));assert.ok(r.sessionId);assert.equal(events.find(e=>e.reply).reply.text,'已完成本轮真实协议测试');assert.equal(events.find(e=>e.tokens).tokens,15);assert.equal(events.some(e=>e.status==='done'),false);assert.equal(events.some(e=>e.turnCompleted===true&&e.status==='waiting_reply'),true);assert.equal((await d.run(input)).runId,r.runId);assert.equal(d.listRuns().length,1);}finally{await d.close();}
});
test('permissions wait for exact explicit user decision; stale answers cannot approve',async()=>{
 const d=make(),events=[];d.subscribe(e=>events.push(e));try{const r=await d.run({...input,prompt:'permission'});await wait(()=>events.some(e=>e.request));assert.equal(events.at(-1).status,'waiting_permission');await assert.rejects(d.control(r.runId,'reply',{prompt:'please finish the result'}),/先处理当前授权或问题/);await assert.rejects(d.control(r.runId,'reply',{requestId:'88'}),/明确/);await d.control(r.runId,'reply',{requestId:'88',decision:'rejected'});await wait(()=>events.some(e=>e.reply));await assert.rejects(d.control(r.runId,'reply',{requestId:'88',decision:'allowed-once'}),/过期/);}finally{await d.close();}
});
test('native user questions retain IDs and answer object; never auto answer',async()=>{
 const d=make(),events=[];d.subscribe(e=>events.push(e));try{const r=await d.run({...input,prompt:'question'});await wait(()=>events.some(e=>e.request));assert.equal(events.at(-1).request.id,'question1');assert.equal(events.at(-1).request.questions[0].id,'days');await d.control(r.runId,'reply',{requestId:'question1',answer:{cancelled:true}});await wait(()=>events.some(e=>e.reply));}finally{await d.close();}
});
test('subagent source identity and result are preserved',async()=>{const d=make(),e=[];d.subscribe(x=>e.push(x));try{await d.run({...input,prompt:'children'});await wait(()=>e.filter(x=>x.child).length===2);assert.equal(e.find(x=>x.child).child.sessionId,'child-1');assert.equal(e.filter(x=>x.child)[1].child.status,'done');}finally{await d.close();}});
test('pause kills only run process and resume reuses persisted source session',async()=>{const d=make();try{const r=await d.run(input);await d.control(r.runId,'stop');assert.equal(d.read(r.runId).status,'paused');const before=d.read(r.runId).sequence;await d.control(r.runId,'resume',{prompt:'hello again'});await wait(()=>d.read(r.runId).sequence>before+1);assert.equal(d.read(r.runId).sessionId,r.sessionId);await d.control(r.runId,'archive');assert.equal(d.read(r.runId).status,'done');}finally{await d.close();}});
test('recovery does not launch or resend previous prompt',async()=>{const d=make({initialRuns:[{...input,runId:'stored',sessionId:'saved',status:'running',sequence:4,events:[]}]});assert.equal(d.read('stored').status,'paused');assert.equal(d.read('stored').sequence,4);await d.close();});
test('recovered and adopted sources without a live process cannot be archived or cancelled as stopped', async () => {
 for (const adopted of [false, true]) {
  const d = make({ initialRuns: [{ ...input, adopted, runId: 'uncertain', sessionId: 'external', status: 'running', sequence: 1, events: [] }] });
  try {
   const stopped = await d.control('uncertain', 'stop');
   assert.equal(stopped.stoppedConfirmed, false);
   assert.equal(stopped.events.at(-1).stoppedConfirmed, false);
   for (const action of ['archive', 'cancel']) {
    await assert.rejects(d.control('uncertain', action), /尚未确认源 Agent 已停止/);
    assert.equal(d.read('uncertain').status, 'paused');
   }
   assert.equal(d.read('uncertain').events.some(event => ['done', 'cancelled'].includes(event.status)), false);
  } finally { await d.close(); }
 }
});
test('fresh stop proof survives recovery, while resuming clears it before new work', async () => {
 const d = make(); let stored;
 try {
  const receipt = await d.run(input);
  await d.control(receipt.runId, 'stop');
  stored = structuredClone(d.read(receipt.runId));
  assert.equal(stored.stoppedConfirmed, true);
  assert.equal(stored.events.at(-1).stoppedConfirmed, true);
 } finally { await d.close(); }
 const recovered = make({ initialRuns: [stored] });
 try {
  assert.equal(recovered.read(stored.runId).stoppedConfirmed, true);
  await recovered.control(stored.runId, 'archive');
  assert.equal(recovered.read(stored.runId).status, 'done');
  await recovered.control(stored.runId, 'resume', { prompt: 'continue' });
  assert.equal(recovered.read(stored.runId).stoppedConfirmed, false);
  assert.equal(recovered.read(stored.runId).events.at(-1).stoppedConfirmed, false);
 } finally { await recovered.close(); }
});
test('process crash becomes failure instead of success',async()=>{const d=make();try{const r=await d.run({...input,prompt:'crash'});await wait(()=>d.read(r.runId).status==='failed');}finally{await d.close();}});
test('Codex uses actual App Server thread, plan and cumulative token notifications',async()=>{const d=make({connection:{tool:'codex'}}),e=[];d.subscribe(x=>e.push(x));try{const r=await d.run(input);await wait(()=>e.some(x=>x.turnCompleted===true));assert.equal(e.find(x=>x.turnCompleted).status,'waiting_reply');assert.match(r.sessionId,/^[a-f0-9-]{36}$/);assert.equal(e.find(x=>x.tokens).tokens,25);assert.equal(e.find(x=>x.step?.total).step.completed,1);}finally{await d.close();}});
test('Windows DSH npm wrapper verified and bypassed without shell prompt interpolation',async()=>{
 const bin='C:\\npm\\dsh.cmd',entry='C:\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',node='C:\\node\\node.exe';
 const options={env:{PATH:'C:\\node'},readFile:async p=>p.endsWith('package.json')?JSON.stringify({name:'@deepseek-ai/dsh',bin:{dsh:'lib/bin.js'}}):'%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',isFile:async p=>[entry,node].includes(p)};
 assert.deepEqual(await resolveDshNpmCommand(bin,options),{binary:node,prefix:[entry]});assert.deepEqual(await commandInvocation(bin,['sdk'],'win32',options),{binary:node,args:[entry,'sdk']});
 assert.equal(await resolveDshNpmCommand(bin,{...options,readFile:async()=>''}),null);
});
test('DSH connection persists exact CLI config, stable identity, and opens its owned source run',async()=>{
 let stored,source;const s=createBridgeService({saveConnections:r=>stored=r,openManagedRun:async runId=>{source=runId;}});
 const c=await s.test({...connection,projectPath:connection.projectPath});assert.equal(c.status,'ready');assert.equal(stored[0].binary,binary);
 const c2=await s.test(connection);assert.equal(c.connectionId,c2.connectionId);
 const r=await s.runtime.run({...input,connectionId:c.connectionId});const opened=await s.open({mode:'live',tool:'dsh',connectionId:c.connectionId,sessionId:r.sessionId});assert.equal(opened.status,'opened');assert.equal(opened.runId,undefined);assert.equal(source,r.runId);assert.equal(opened.targetSessionId,r.sessionId);await s.runtime.close();
});
test('concurrent dispatch IDs wait for one acknowledged admission',async()=>{const d=make();try{const [a,b]=await Promise.all([d.run(input),d.run(input)]);assert.equal(a.runId,b.runId);assert.equal(a.acceptance,'acknowledged');assert.ok(a.acceptedAt);assert.equal(d.listRuns().length,1);}finally{await d.close();}});
test('same dispatch ID cannot be reused with different task or prompt, including concurrent admission',async()=>{
 const d=make();try{const initial=d.run(input);await assert.rejects(d.run({...input,taskId:'other',prompt:'changed'}),/IDEMPOTENCY_CONFLICT/);const receipt=await initial;await assert.rejects(d.run({...input,prompt:'changed'}),/IDEMPOTENCY_CONFLICT/);assert.equal(d.listRuns().length,1);assert.equal(d.read(receipt.runId).prompt,input.prompt);}finally{await d.close();}
});
test('new dispatch cannot resume an arbitrary source; existing task resumes only through its owned run', async () => {
 const d=make();
 try {
  await assert.rejects(d.run({...input, sourceSessionId:'foreign-conversation'}), error=>error.rejected&&/NEW_SOURCE_SESSION_REQUIRED/.test(error.message));
  assert.equal(d.listRuns().length,0);
  const first=await d.run(input);
  await assert.rejects(d.run({...input,dispatchId:'second-dispatch'}), /TASK_EXECUTION_UNSETTLED/);
  assert.equal(d.listRuns().length,1);
  await d.control(first.runId,'stop');
  await d.control(first.runId,'resume',{prompt:'Continue the same task'});
  assert.equal(d.read(first.runId).sessionId,first.sessionId);
 } finally { await d.close(); }
});
test('parallel different dispatch IDs cannot start the same task twice', async () => {
 const d=make();
 try {
  const first=d.run(input);
  await assert.rejects(d.run({...input,dispatchId:'racing-dispatch'}), /TASK_EXECUTION_UNSETTLED/);
  await first;
  assert.equal(d.listRuns().length,1);
 } finally { await d.close(); }
});
test('unknown admission cannot be bypassed by a new dispatch ID or connection', async () => {
 const d=make({initialRuns:[{...input,runId:'uncertain',sessionId:'uncertain-source',acceptance:'unknown',status:'paused',events:[]}]});
 try {
  await assert.rejects(d.run({...input,dispatchId:'new-after-unknown',connectionId:'another'}), /TASK_EXECUTION_UNSETTLED/);
  await assert.rejects(d.run({...input,dispatchId:'change-purpose',purpose:'review'}), /TASK_EXECUTION_UNSETTLED/);
  assert.equal(d.listRuns().length,1);
 } finally { await d.close(); }
});
test('new Codex task gets new conversation and rejects a provider returning an already owned source', async () => {
 for (const model of ['test-contract','reuse-source']) {
  const d=make({connection:{tool:'codex',model}});
  try {
   const first=await d.run(input);
   if(model==='reuse-source') {
    await assert.rejects(d.run({...input,dispatchId:'task-two',taskId:'t2'}),error=>error.rejected&&/SOURCE_SESSION_OWNED/.test(error.message));
    const rejected=d.listRuns().find(run=>run.taskId==='t2');
    assert.equal(rejected.events.some(event=>event.message?.role==='user'),false,'duplicate provider source is rejected before sending task content');
   } else {
    const second=await d.run({...input,dispatchId:'task-two',taskId:'t2'});
    assert.notEqual(second.sessionId,first.sessionId);
   }
  } finally { await d.close(); }
 }
});
test('adopt is idempotent only for the source owning task, including across projects and connections', async () => {
 const d=make();
 try {
  const first=await d.run(input);
  const imported={...input,sourceSessionId:first.sessionId};
  assert.equal((await d.adopt(imported)).runId,first.runId);
  for(const changes of [{taskId:'t2'},{projectId:'p2'},{workItemId:'child'},{connectionId:'other'}]) {
   await assert.rejects(d.adopt({...imported,dispatchId:'foreign-import',...changes}), /SOURCE_SESSION_OWNED/);
  }
  assert.equal(d.listRuns().length,1);
 } finally { await d.close(); }
});
test('independent connections may return equal opaque source IDs without sharing ownership', async () => {
 const d=createRuntimeDriver({getConnection:id=>({...connection,connectionId:id,tool:'codex',model:'reuse-source'}),commandInvocation});
 try {
  const first=await d.run(input);
  const second=await d.run({...input,dispatchId:'separate-account',connectionId:'other-account',projectId:'other-project',taskId:'t2'});
  assert.equal(first.sessionId,second.sessionId);
  assert.notEqual(first.connectionId,second.connectionId);
  assert.equal((await d.adopt({...input,dispatchId:'separate-account',connectionId:'other-account',projectId:'other-project',taskId:'t2',sourceSessionId:second.sessionId})).runId,second.runId);
 } finally { await d.close(); }
});
test('legacy budgets do not stop tracked usage or block replies after restart', async () => {
 const driver = make(), events = [];
 driver.subscribe(event => events.push(event));
 let stored;
 try {
  const run = await driver.run({ ...input, budget: { maxTokens: 10, enforcement: 'soft' } });
  await wait(() => events.some(event => event.reply));
  stored = structuredClone(driver.read(run.runId));
  assert.equal(stored.tokens, 15);
  assert.equal(stored.status, 'waiting_reply');
  assert.equal(events.some(event => event.status === 'paused'), false);
  await driver.control(run.runId, 'reply', { prompt: 'continue in the same session' });
  await wait(() => events.filter(event => event.reply).length === 2);
  assert.equal(driver.read(run.runId).sessionId, stored.sessionId);
 } finally { await driver.close(); }
 const restored = make({ initialRuns: [{ ...stored, status: 'paused' }] });
 try {
  const run = restored.read(stored.runId);
  assert.equal(run.lastReply, stored.lastReply);
  assert.equal(run.controls.canResume, true);
  assert.equal(run.controls.canReply, true);
  const beforeReply = run.sequence;
  await restored.control(run.runId, 'reply', { prompt: 'continue after restart' });
  await wait(() => restored.read(run.runId).events.some(event => event.reply && event.sequence > beforeReply));
  assert.equal(restored.read(run.runId).events.filter(event => event.reply).length, 2);
  assert.equal(restored.read(run.runId).sessionId, stored.sessionId);
 } finally { await restored.close(); }
});
test('failed handshake is rejected and never becomes an accepted retry receipt',async()=>{const d=make({connection:{model:'invalid'}});try{await assert.rejects(d.run(input),e=>e.rejected===true);assert.equal(d.listRuns()[0].acceptance,'rejected');assert.equal(d.listRuns()[0].acceptedAt,null);await assert.rejects(d.run(input),/未受理/);}finally{await d.close();}});
test('source transcript includes user message but journal reply emits only once per turn',async()=>{const d=make(),e=[];d.subscribe(x=>e.push(x));try{await d.run(input);await wait(()=>e.some(x=>x.reply));assert.equal(e.find(x=>x.message?.role==='user').message.text,'hello');assert.equal(e.filter(x=>x.reply).length,1);assert.equal(d.listRuns()[0].tool,'dsh');}finally{await d.close();}});
test('adopt external source imports exact public history without executing prompt',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
 const root=await mkdtemp(path.join(tmpdir(),'qd-adopt-'));const now=Date.now();const dir=path.join(root,'project','external');await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'session.v3.jsonl'),[{type:'session',version:3,id:'external',cwd:connection.projectPath,createdAt:now-1000},{type:'user/message',seq:1,time:now-900,data:{content:[{type:'text',text:'外部想法'}]}},{type:'assistant/message',seq:2,time:now-500,data:{message:{content:[{type:'text',text:'已有结论'}]}}},{type:'turn/end',seq:3,time:now,data:{reason:{kind:'completed'}}}].map(x=>JSON.stringify(x)).join('\n')+'\n');
 const d=make({connection:{sessionRoot:root},spawnProcess:()=>{throw new Error('adopt must not execute CLI');}});try{const r=await d.adopt({...input,sourceSessionId:'external'});assert.equal(r.status,'paused');assert.equal(r.lastReply,'已有结论');assert.equal(r.events.some(e=>e.message?.role==='user'),false);assert.equal(r.adopted,true);assert.equal(r.sessionId,'external');assert.equal((await d.adopt({...input,sourceSessionId:'external'})).runId,r.runId);}finally{await d.close();await rm(root,{recursive:true,force:true});}
});

test('Codex willRetry notifications never falsely terminate a recovering turn',async()=>{const d=make({connection:{tool:'codex'}}),e=[];d.subscribe(x=>e.push(x));try{await d.run({...input,prompt:'retry'});await wait(()=>e.some(x=>x.reply));assert.equal(e.some(x=>x.status==='failed'),false);const retry=e.find(x=>x.notice);assert.match(retry.notice,/正在重试/);assert.ok(e.some(x=>x.incident?.id===retry.incident.id&&x.incident.resolvedReason==='activity_resumed'));}finally{await d.close();}});
test('child public messages and usage stay attached to exact child identity',async()=>{const d=make(),e=[];d.subscribe(x=>e.push(x));try{await d.run({...input,prompt:'children'});await wait(()=>e.some(x=>x.reply));assert.equal(e.find(x=>x.targetSessionId==='child-1'&&x.message).message.text,'子 Agent 的公开输出');assert.equal(e.find(x=>x.childTokens).childTokens,2);assert.equal(d.listRuns()[0].tokens,15);}finally{await d.close();}});

test('Windows explicit Node path survives Chinese and spaced npm wrapper locations without PATH',async()=>{
 const bin='C:\\用户 目录\\npm\\dsh.cmd',entry='C:\\用户 目录\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',node='D:\\Node 自定义\\node.exe';
 const options={env:{PATH:''},nodePath:node,readFile:async p=>p.endsWith('package.json')?JSON.stringify({name:'@deepseek-ai/dsh',bin:{dsh:'lib/bin.js'}}):'%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',isFile:async p=>[entry,node].includes(p)};
 const result=await runtimeInvocation({binary:bin,nodePath:node},['sdk'],(binary,args,_platform,forwarded)=>commandInvocation(binary,args,'win32',{...options,...forwarded}));assert.deepEqual(result,{binary:node,args:[entry,'sdk']});
});
test('persistence failure stops source without crashing stdio callback, retains memory and can flush later',async()=>{
 let fail=false,errors=0;const d=make({saveRuns:()=>{if(fail)throw Error('disk full');},onPersistenceError:()=>errors++});try{const r=await d.run(input);await wait(()=>d.read(r.runId).status==='waiting_reply');fail=true;await d.control(r.runId,'stop');assert.equal(errors,1);assert.equal(d.lastPersistenceError,'disk full');assert.ok(d.read(r.runId).events.length);fail=false;await d.flush();assert.equal(d.lastPersistenceError,null);}finally{await d.close();}
});
test('permission operation details preserve ordinary task paths and mask actual secrets',async()=>{
 const cwd=await mkdtemp(path.join(os.tmpdir(),'quandeck-task-icons-20261116-'));
 const d=make({connection:{projectPath:cwd}}),e=[];d.subscribe(x=>e.push(x));try{const r=await d.run({...input,prompt:'permission'});await wait(()=>e.some(x=>x.request));assert.ok(e.find(x=>x.request).request.details.includes(cwd));assert.ok(e.find(x=>x.request).request.details.includes('[redacted]'));assert.equal(e.find(x=>x.request).request.details.includes('contract-secret'),false);assert.equal(e.find(x=>x.request).request.details.includes('sk-contract-key'),false);await d.control(r.runId,'reply',{requestId:'88',decision:'rejected'});}finally{await d.close();await rm(cwd,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
test('Codex child state mapping never counts pending, interrupted or closed agents as running',async()=>{
 const d=make({connection:{tool:'codex'}}),events=[];d.subscribe(e=>events.push(e));try{await d.run({...input,prompt:'child-states'});await wait(()=>events.some(e=>e.reply));assert.deepEqual(Object.fromEntries(events.filter(e=>e.child).map(e=>[e.child.id,e.child.status])),{pendingInit:'queued',running:'running',interrupted:'paused',completed:'done',errored:'failed',shutdown:'cancelled',notFound:'failed'});}finally{await d.close();}
});


test('persisted receipts cannot bypass an unknown actual CLI version', async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'quandeck-dsh-unknown-'));
 try {
  const entry=path.join(directory,'旧版 CLI.mjs'),marker=path.join(directory,'sdk-started.txt');
  await writeFile(entry,`import {writeFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('unknown');process.exit(0);}
writeFileSync(${JSON.stringify(marker)},'SDK must not start');process.exit(1);
`);
  const saved={...connection,binary:entry,projectPath:directory,cliVersion:'99.0.0',status:'ready',capabilities:{resume:true,permissions:true}};
  await assert.rejects(initializeRuntime(saved,{commandInvocation}),/无法确认/);
  const driver=createRuntimeDriver({getConnection:()=>saved,commandInvocation,initialRuns:[{...input,runId:'persisted-run',sessionId:'old-session',status:'paused',acceptedAt:new Date().toISOString(),acceptance:'acknowledged',sequence:0,events:[]}]});
  try {await assert.rejects(driver.control('persisted-run','resume',{prompt:'continue'}),/无法确认/);assert.equal(driver.read('persisted-run').sessionId,'old-session');assert.equal(driver.read('persisted-run').events.some(e=>e.message?.role==='user'),false);}
  finally {await driver.close();}
  await assert.rejects(access(marker),'metadata probe must not execute the SDK branch');
 } finally {await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

const rc2Binary=fileURLToPath(new URL('./fixtures/dsh-rc2-peer.mjs',import.meta.url));
const rc2Test=async callback=>{
 const cwd=await mkdtemp(path.join(os.tmpdir(),'quandeck-rc2-runtime-'));
 const rc2Connection={...connection,binary:rc2Binary,projectPath:cwd,protocol:'legacy-rc2',canResume:false};
 const driver=createRuntimeDriver({getConnection:()=>rc2Connection,commandInvocation});
 const trace=async()=>{try{return (await readFile(path.join(cwd,'rc2-wire.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(e){if(e.code==='ENOENT')return [];throw e;}};
 try{await callback({driver,rc2Connection,cwd,trace});}finally{await driver.close();await rm(cwd,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
};
test('rc2 uses only published initialize fields and exposes its verified protocol',async()=>rc2Test(async({rc2Connection,trace})=>{
 const rpc=await initializeRuntime(rc2Connection,{commandInvocation});assert.equal(rpc.protocol,'legacy-rc2');assert.equal(rpc.cliVersion,'0.2.0-rc.2');await rpc.close('shutdown');
 assert.deepEqual(rpc.sourceModel,{provider:rc2Connection.provider,model:rc2Connection.model});
 const init=(await trace())[0];assert.deepEqual(Object.keys(init.params).sort(),['cwd','model','provider']);assert.equal((await trace()).some(m=>m.method==='session/resume'),false);
}));
test('DSH connection without model fields uses source defaults, sends no prompt, and re-reads defaults on dispatch',async()=>rc2Test(async({rc2Connection,cwd,trace})=>{
 const sourceConfig=model=>`- id: agent-default-model\n  name: '@deepseek-ai/dsh-agent-default-model'\n  config:\n    provider: source-provider\n    model: ${model}\n    reasoningEffort: high\n- id: adapter\n  name: test-adapter\n  config:\n    apiKey: source-secret-never-persist\n`;
 await writeFile(path.join(cwd,'dsh-config.yml'),sourceConfig('model-before'));
 const {provider,model,...automatic}=rc2Connection;
 let stored;const service=createBridgeService({saveConnections:connections=>{stored=connections;}});
 try {
  const connected=await service.test(automatic);assert.equal(connected.status,'ready');assert.match(connected.note,/未发起模型请求/);
  const frames=await trace();assert.deepEqual(frames.map(frame=>frame.method),['initialize','shutdown']);
  assert.deepEqual(frames[0].params,{cwd:connected.projectPath,provider:'source-provider',model:'model-before',reasoningEffort:'high'});
  assert.deepEqual(connected.sourceModel,{provider:frames[0].params.provider,model:frames[0].params.model});
  assert.equal(stored[0].provider,undefined);assert.equal(stored[0].model,undefined);assert.equal(connected.provider,undefined);assert.equal(connected.model,undefined);
  assert.equal(Object.hasOwn(stored[0],'sourceModel'),false);assert.equal(JSON.stringify(stored).includes('model-before'),false);
  assert.equal(JSON.stringify(stored).includes('source-secret-never-persist'),false);assert.equal(JSON.stringify(connected).includes('source-secret-never-persist'),false);
  await writeFile(path.join(cwd,'dsh-config.yml'),sourceConfig('model-after'));
  const run=await service.runtime.run({...input,connectionId:connected.connectionId});assert.equal(run.acceptance,'acknowledged');
  await wait(()=>service.runtime.read(run.runId).status==='waiting_reply');
  assert.equal((await trace()).filter(frame=>frame.method==='initialize').at(-1).params.model,'model-after');
  const retested=await service.test(automatic);assert.deepEqual(retested.sourceModel,{provider:'source-provider',model:'model-after'});assert.equal(retested.connectionId,connected.connectionId);
  assert.equal(JSON.stringify(stored).includes('model-after'),false);assert.equal(Object.hasOwn(stored[0],'sourceModel'),false);
 } finally {await service.runtime.close();}
}));
test('DSH missing defaults never starts a session or saves a ready connection',async()=>rc2Test(async({rc2Connection,cwd,trace})=>{
 await writeFile(path.join(cwd,'dsh-config.yml'),'[]\n');const {provider,model,...automatic}=rc2Connection;
 const service=createBridgeService();
 try {await assert.rejects(service.test(automatic),/请先在 DSH 中设置默认模型/);assert.deepEqual(service.exportConnections(),[]);assert.deepEqual(await trace(),[]);}
 finally {await service.runtime.close();}
}));
test('rc2 acknowledges queued messages and supports multi-turn only in the live process with actual cache-aware usage',async()=>rc2Test(async({driver,trace})=>{
 const r=await driver.run(input);assert.equal(r.acceptance,'acknowledged');assert.ok(r.acceptedAt);await wait(()=>driver.read(r.runId).status==='waiting_reply');
 assert.equal(driver.read(r.runId).tokens,20);assert.equal(driver.read(r.runId).controls.canReply,true);assert.equal(driver.read(r.runId).controls.canResume,false);
 await driver.control(r.runId,'reply',{prompt:'follow-up'});await wait(()=>driver.read(r.runId).lastReply==='rc2 第 2 轮回报');assert.equal(driver.read(r.runId).tokens,40);assert.equal(driver.read(r.runId).status,'waiting_reply');
 const prompts=(await trace()).filter(m=>m.method==='session/prompt');assert.equal(prompts.length,2);assert.equal(new Set(prompts.map(m=>m.params.sessionId)).size,1);assert.equal((await trace()).some(m=>m.method==='session/resume'),false);assert.equal(driver.read(r.runId).events.some(e=>e.status==='done'),false);
}));
test('rc2 stop waits for source flush, then disables reply/resume without replacing source identity',async()=>rc2Test(async({driver,cwd,trace})=>{
 const r=await driver.run({...input,prompt:'hold'});await driver.control(r.runId,'stop');assert.match(await readFile(path.join(cwd,'rc2-flushed.txt'),'utf8'),/flushed/);
 assert.deepEqual(driver.read(r.runId).controls,{canResume:false,canReply:false,reason:'此 DSH 版本不能恢复已关闭的会话。记录已保留，请新建执行或在 DSH 原界面继续。'});
 await assert.rejects(driver.control(r.runId,'resume',{prompt:'continue'}),/不能恢复/);await assert.rejects(driver.control(r.runId,'reply',{prompt:'continue'}),/不能恢复/);
 assert.equal(driver.read(r.runId).sessionId,r.sessionId);const frames=await trace();assert.equal(frames.filter(m=>m.method==='initialize').length,1);assert.equal(frames.filter(m=>m.method==='session/prompt').length,1);assert.equal(frames.some(m=>m.method==='session/resume'),false);
 await driver.control(r.runId,'archive');assert.equal(driver.read(r.runId).status,'done');
}));
test('rc2 persisted and externally adopted session IDs cannot be replayed into a new process',async()=>rc2Test(async({rc2Connection,trace,cwd})=>{
 const old={...input,runId:'stored-rc2',sessionId:'external-rc2',status:'running',acceptedAt:new Date().toISOString(),acceptance:'acknowledged',sequence:0,events:[],protocol:'legacy-rc2'};
 const d=createRuntimeDriver({getConnection:()=>({...rc2Connection,protocol:'sdk',canResume:true}),commandInvocation,initialRuns:[old]});
 try{assert.equal(d.read(old.runId).status,'paused');assert.equal(d.read(old.runId).controls.canReply,false);await assert.rejects(d.control(old.runId,'reply',{prompt:'continue'}),/不能恢复/);assert.equal(d.read(old.runId).sessionId,old.sessionId);assert.equal(d.read(old.runId).events.some(e=>e.message?.role==='user'),false);await assert.rejects(d.run({...input,dispatchId:'external-dispatch',sourceSessionId:'external-rc2'}),e=>e.rejected&&/NEW_SOURCE_SESSION_REQUIRED/.test(e.message));assert.deepEqual(await trace(),[]);}finally{await d.close();}
 const history=path.join(cwd,'history','project','external-rc2');await mkdir(history,{recursive:true});const now=Date.now();await writeFile(path.join(history,'session.v3.jsonl'),[{type:'session',version:3,id:'external-rc2',cwd,createdAt:now-1000},{type:'assistant/message',seq:1,time:now-100,data:{message:{content:[{type:'text',text:'previous public result'}]}}},{type:'turn/end',seq:2,time:now,data:{reason:{kind:'completed'}}}].map(x=>JSON.stringify(x)).join('\n')+'\n');
 const adopted=createRuntimeDriver({getConnection:()=>({...rc2Connection,sessionRoot:path.join(cwd,'history')}),commandInvocation});try{const r=await adopted.adopt({...input,dispatchId:'adopted',sourceSessionId:'external-rc2'});assert.equal(r.lastReply,'previous public result');await assert.rejects(adopted.control(r.runId,'resume'),/不能恢复/);assert.equal(adopted.read(r.runId).sessionId,'external-rc2');assert.deepEqual(await trace(),[]);}finally{await adopted.close();}
}));
test('rc2 permissions remain source audit events, never actionable approvals or automatic grants',async()=>rc2Test(async({driver,trace})=>{
 const r=await driver.run({...input,prompt:'permission'});await wait(()=>driver.read(r.runId).status==='waiting_reply');const e=driver.read(r.runId).events;assert.equal(e.some(e=>e.request),false);assert.ok(e.some(e=>e.log?.label.includes('未获允许')));assert.ok(e.some(e=>e.notice?.includes('未获允许')));assert.ok(e.some(e=>e.log?.label==='工具执行失败'));await assert.rejects(driver.control(r.runId,'reply',{requestId:'approval-1',decision:'allowed-once'}),/过期/);assert.equal((await trace()).some(m=>m.result?.outcome==='allowed-once'),false);
 const other=await driver.run({...input,dispatchId:'unexpected',taskId:'unexpected-request-task',prompt:'unexpected-request'});await wait(()=>driver.read(other.runId).status==='waiting_reply');await new Promise(resolve=>setTimeout(resolve,30));assert.equal(driver.read(other.runId).events.some(e=>e.request),false);assert.ok((await trace()).some(m=>m.id===900&&m.error&&!m.result));
}));
test('rc2 children retain hierarchy and partial end state; unrelated sessions never enter the task',async()=>rc2Test(async({driver})=>{
 const r=await driver.run({...input,prompt:'children'});await wait(()=>driver.read(r.runId).status==='waiting_reply');const e=driver.read(r.runId).events;assert.equal(e.filter(e=>e.child).length,2);assert.equal(e.filter(e=>e.child).at(-1).child.status,'paused');assert.deepEqual(e.filter(e=>e.childTokens).map(e=>e.childTokens),[10,17]);assert.equal(e.some(e=>e.targetSessionId==='unrelated'||e.child?.id==='unrelated-child'),false);assert.equal(driver.read(r.runId).tokens,20);
}));
test('rc2 source limits and crashes never imply task completion or cross-process recovery',async()=>rc2Test(async({driver})=>{
 for(const reason of ['max-tokens','blocked']){const r=await driver.run({...input,dispatchId:reason,taskId:'case-'+reason,prompt:reason});await wait(()=>driver.read(r.runId).status==='paused');assert.ok(driver.read(r.runId).events.some(e=>e.notice));assert.equal(driver.read(r.runId).controls.canReply,true);assert.equal(driver.read(r.runId).events.some(e=>e.turnCompleted),false);}
 const r=await driver.run({...input,dispatchId:'crash',taskId:'crash-task',prompt:'crash'});await wait(()=>driver.read(r.runId).status==='failed');assert.equal(driver.read(r.runId).controls.canReply,false);await assert.rejects(driver.control(r.runId,'reply',{prompt:'retry'}),/不能恢复/);assert.equal(driver.read(r.runId).sessionId,r.sessionId);
}));
test('rc2 missing durable message acknowledgement remains unknown rather than reporting acceptance',async()=>rc2Test(async({driver})=>{
 await assert.rejects(driver.run({...input,prompt:'missing-ack'}),e=>!e.rejected&&/回执/.test(e.message));assert.equal(driver.listRuns()[0].acceptance,'unknown');assert.equal(driver.listRuns()[0].acceptedAt,null);
}));

for (const [scope, wire] of [['session','acceptForSession'],['rule',{acceptWithExecpolicyAmendment:{execpolicy_amendment:['git','status']}}],['network',{applyNetworkPolicyAmendment:{network_policy_amendment:{host:'example.com',action:'allow'}}}]]) {
 test(`Codex ${scope} approval is explicitly selected and forwarded unchanged to its source request`,async()=>{
  const d=make({connection:{tool:'codex'}}),events=[];d.subscribe(event=>events.push(event));
  try {
   const r=await d.run({...input,prompt:'permission-scopes'});await wait(()=>events.some(e=>e.request));
   const request=events.find(e=>e.request).request;
   assert.equal(request.permissionSource,'codex');
   assert.equal(events.some(e=>e.log?.label==='fixture approval receipt'),false);
   const option=request.permissionOptions.find(o=>scope==='network'?o.rule==='allow: example.com':o.scope===scope);
   assert.ok(option);
   await assert.rejects(d.control(r.runId,'reply',{requestId:request.id,approvalOptionId:'invented',decision:{acceptWithExecpolicyAmendment:{execpolicy_amendment:['anything']}}}),/未提供/);
   await d.control(r.runId,'reply',{requestId:request.id,approvalOptionId:option.id});
   await wait(()=>events.some(e=>e.log?.label==='fixture approval receipt'));
   assert.deepEqual(JSON.parse(events.find(e=>e.log?.label==='fixture approval receipt').log.detail),{decision:wire});
   await assert.rejects(d.control(r.runId,'reply',{requestId:request.id,approvalOptionId:option.id}),/过期/);
  } finally {await d.close();}
 });
}
test('restricted source decisions reject legacy once and do not create a local future grant',async()=>{
 const d=make({connection:{tool:'codex'}}),events=[];d.subscribe(e=>events.push(e));
 try {
  const r=await d.run({...input,prompt:'permission-restricted'});await wait(()=>events.some(e=>e.request));
  const request=events.find(e=>e.request).request;
  assert.deepEqual(request.permissionOptions.map(o=>o.scope),['session','deny']);
  await assert.rejects(d.control(r.runId,'reply',{requestId:request.id,decision:'allowed-once'}),/未提供/);
  await d.control(r.runId,'reply',{requestId:request.id,approvalOptionId:request.permissionOptions[0].id});await wait(()=>events.some(e=>e.turnCompleted));
  const next=await d.run({...input,dispatchId:'another-task',taskId:'t2',prompt:'permission-restricted'});
  await wait(()=>d.read(next.runId).status==='waiting_permission');
  assert.ok(d.read(next.runId).events.some(e=>e.request));
  // The fixture reuses wire request 88: a prior request's UI choice must not
  // approve a different source request that happens to reuse the same number.
  await assert.rejects(d.control(next.runId,'reply',{requestId:request.id,approvalOptionId:request.permissionOptions[0].id}),/未提供/);
 }finally{await d.close();}
});
test('Codex file changes expose session scope and use the source file response schema',async()=>{
 const d=make({connection:{tool:'codex'}}),events=[];d.subscribe(e=>events.push(e));
 try{
  const r=await d.run({...input,prompt:'permission-file'});await wait(()=>events.some(e=>e.request));
  const request=events.find(e=>e.request).request;
  assert.deepEqual(request.permissionOptions.map(o=>o.scope),['once','session','deny','cancel']);
  await d.control(r.runId,'reply',{requestId:request.id,approvalOptionId:request.permissionOptions.find(o=>o.scope==='session').id});
  await wait(()=>events.some(e=>e.log?.label==='fixture approval receipt'));
  assert.deepEqual(JSON.parse(events.find(e=>e.log?.label==='fixture approval receipt').log.detail),{decision:'acceptForSession'});
 }finally{await d.close();}
});
for(const [scope,permissions] of [['session',{fileSystem:{read:['/test/project'],write:null}}],['deny',{}]])test(`Codex permission profile ${scope} uses permission-grant response rather than command decision`,async()=>{
 const d=make({connection:{tool:'codex'}}),events=[];d.subscribe(e=>events.push(e));
 try{
  const r=await d.run({...input,prompt:'permission-profile'});await wait(()=>events.some(e=>e.request));const request=events.find(e=>e.request).request;
  await d.control(r.runId,'reply',{requestId:request.id,approvalOptionId:request.permissionOptions.find(o=>o.scope===scope).id});
  await wait(()=>events.some(e=>e.log?.label==='fixture approval receipt'));
  assert.deepEqual(JSON.parse(events.find(e=>e.log?.label==='fixture approval receipt').log.detail),{permissions,scope:scope==='deny'?'turn':'session'});
 }finally{await d.close();}
});
