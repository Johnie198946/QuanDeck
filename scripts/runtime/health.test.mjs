import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { createRuntimeDriver } from './driver.mjs';
import { createBridgeService, commandInvocation } from '../agent-bridge.mjs';
import { classifyIncident, redactDiagnostic } from './health.mjs';
const binary = fileURLToPath(new URL('./fixtures/protocol-peer.mjs', import.meta.url));
const base = { connectionId:'primary', tool:'codex', binary, nodePath:process.execPath, projectPath:path.dirname(binary) };
const input = { dispatchId:'health-1', connectionId:'primary', projectId:'p', taskId:'t', agentId:'a', prompt:'silent' };
const wait = async condition => { for (let i=0; i<100; i++) { if (condition()) return; await new Promise(r=>setTimeout(r,10)); } assert.fail('source event timeout'); };
const ok = id => ({ connectionId:id, canStart:true });
const bad = id => ({ connectionId:id, canStart:false, issue:{title:'找不到 Agent 程序',message:'找不到 Agent 程序'} });

test('incident vocabulary is actionable without provider status codes or secrets', () => {
  for(const [error,code] of [['401 Unauthorized api_key=secret','login'],['insufficient_quota 429','quota'],['429 too many requests','rate_limit'],['502 model unavailable','model'],['ECONNRESET','network'],['受理结果未知','unknown_acceptance']]) {
    const issue=classifyIncident(error); assert.equal(issue.code,code); assert.doesNotMatch(issue.message,/401|429|502|secret/);
  }
  const safe=redactDiagnostic('API_KEY=abc token="def" Bearer xyz https://user:pass@host/path sk-secret-key-12345678');
  for(const secret of ['abc','def','xyz','user:pass','sk-secret-key-12345678']) assert.ok(!safe.includes(secret));
});
test('real local handshake is not claimed as model or balance availability and does not send prompt',async()=>{
  const service=createBridgeService();
  try {
    const configured=await service.test({...base,tool:'dsh',provider:'fixture',model:'fixture'});
    const report=await service.health({connectionId:configured.connectionId});
    assert.equal(report.canStart,true);
    assert.equal(report.checks.find(c=>c.key==='model').status,'unknown');
    assert.equal(report.checks.find(c=>c.key==='quota').status,'unknown');
    assert.equal(report.checks.find(c=>c.key==='login').status,'unknown');
    assert.ok(Date.parse(report.expiresAt)>Date.parse(report.checkedAt));
    assert.equal(service.runtime.listRuns().length,0);
    assert.equal(service.listConnections().connections[0].health.checkedAt,report.checkedAt);
  } finally {await service.runtime.close();}
});
test('missing CLI blocks before any runtime prompt and leaves a durable incident',async()=>{
  const service=createBridgeService({connections:[{...base,binary:'/definitely-not-installed/quandeck-agent'}]});
  try {
    await assert.rejects(service.runtime.run(input),e=>e.rejected===true);
    const report=await service.health({connectionId:'primary'});
    assert.equal(report.checks.length,6);assert.equal(new Set(report.checks.map(c=>c.key)).size,6);assert.equal(report.checks.find(c=>c.key==='protocol').status,'unknown');
    const run=service.runtime.listRuns()[0];
    assert.equal(run.acceptance,'rejected'); assert.equal(run.status,'failed');
    assert.equal(run.events.some(e=>e.message?.role==='user'),false);
    assert.equal(run.health.incident.status,'open');
  } finally {await service.runtime.close();}
});
test('fallback preference is persisted and rejects other project and unsupported adapters',async()=>{
  let saved;
  const service=createBridgeService({connections:[base,{...base,connectionId:'backup'}, {...base,connectionId:'other',projectPath:'/other'}, {...base,connectionId:'unsupported',tool:'cursor'}], saveConnections: c=>saved=structuredClone(c)});
  try {
    assert.equal(service.listConnections().connections[0].fallbackPolicy.mode,'ask');
    await assert.rejects(service.policy({connectionId:'primary',mode:'auto_before_start',connectionIds:['other']}),/同一个项目/);
    await assert.rejects(service.policy({connectionId:'primary',mode:'auto_before_start',connectionIds:['unsupported']}),/支持任务/);
    await service.policy({connectionId:'primary',mode:'auto_before_start',connectionIds:['backup']});
    assert.deepEqual(saved[0].fallbackPolicy,{mode:'auto_before_start',connectionIds:['backup']});
  } finally {await service.runtime.close();}
});
test('automatic fallback sends task once only to explicitly bound healthy alternative before source acceptance',async()=>{
  const checks=[];
  const d=createRuntimeDriver({getConnection:id=>({...base,connectionId:id}),commandInvocation,beforeStart:async id=>{checks.push(id);return id==='backup'?ok(id):bad(id);},fallbackConnections:()=>['unbound','backup']});
  try {
    const run=await d.run({...input,allowedFallbackConnectionIds:['backup']});
    assert.equal(run.connectionId,'backup'); assert.equal(run.fallback.acceptanceNotSent,true);
    assert.equal(run.fallback.fromConnectionId,'primary'); assert.deepEqual(checks,['primary','backup']);
    assert.equal(run.events.filter(e=>e.message?.role==='user').length,1);
    assert.equal((await d.run({...input,allowedFallbackConnectionIds:['backup']})).runId,run.runId);
  } finally {await d.close();}
});
test('no implicit fallback without project binding or when resuming an existing source',async()=>{
  for(const extras of [{},{sourceSessionId:'old',allowedFallbackConnectionIds:['backup']}]) {
    const checks=[]; const d=createRuntimeDriver({getConnection:id=>({...base,connectionId:id}),commandInvocation,beforeStart:async id=>{checks.push(id);return bad(id);},fallbackConnections:()=>['backup']});
    try {await assert.rejects(d.run({...input,...extras}),e=>e.rejected===true);assert.deepEqual(checks,['primary']);assert.equal(d.listRuns()[0].connectionId,'primary');} finally {await d.close();}
  }
});
test('fallback keeps original dispatch identity after restart without a second prompt',async()=>{
  const getConnection=id=>({...base,connectionId:id});
  const requested={...input,allowedFallbackConnectionIds:['backup']};
  const d=createRuntimeDriver({getConnection,commandInvocation,beforeStart:async id=>id==='backup'?ok(id):bad(id),fallbackConnections:()=>['backup']});
  let records;
  try { const first=await d.run(requested);assert.equal(first.connectionId,'backup');await d.close();records=d.listRuns(); }
  finally {await d.close();}
  let opened=0;
  const restored=createRuntimeDriver({getConnection,initialRuns:records,commandInvocation:(...args)=>{opened++;return commandInvocation(...args);}});
  try {
    const repeated=await restored.run(requested);
    assert.equal(repeated.runId,records[0].runId);assert.equal(repeated.connectionId,'backup');assert.equal(repeated.originalConnectionId,'primary');
    assert.equal(repeated.events.filter(e=>e.message?.role==='user').length,1);assert.equal(opened,0);
    await assert.rejects(restored.run({...requested,prompt:'different task'}),/IDEMPOTENCY_CONFLICT/);
  }finally{await restored.close();}
});
test('silence becomes attention once; no failure, fake progress, retry or fallback; activity resolves',async()=>{
  let clock=Date.now();
  const d=createRuntimeDriver({getConnection:()=>base,commandInvocation,now:()=>clock,stallAfterMs:100,monitorEveryMs:0});
  try {
    const run=await d.run({...input,prompt:'slow-finish'}); await wait(()=>d.read(run.runId).status==='running');
    clock+=101;d.inspectHealth();d.inspectHealth();
    const stalled=d.read(run.runId); assert.equal(stalled.health.incident.code,'suspected_stall');assert.equal(stalled.status,'running');
    assert.equal(stalled.events.filter(e=>e.incident?.status==='open').length,1);
    await wait(()=>d.read(run.runId).status==='waiting_reply');assert.equal(d.read(run.runId).health.incident.status,'resolved');
  } finally {await d.close();}
});
test('waiting for user or permission never triggers inactivity alarms',async()=>{
  for(const prompt of ['permission','question','hello']) {
    let clock=Date.now();const d=createRuntimeDriver({getConnection:()=>base,commandInvocation,now:()=>clock,stallAfterMs:100,monitorEveryMs:0});
    try {const run=await d.run({...input,prompt});await wait(()=>['waiting_permission','waiting_reply'].includes(d.read(run.runId).status));clock+=999999;d.inspectHealth();assert.equal(d.read(run.runId).health.incident,undefined);} finally {await d.close();}
  }
});
test('network failure keeps source identity and usage, emits friendly incident, never auto switches mid-run',async()=>{
  const d=createRuntimeDriver({getConnection:()=>base,commandInvocation,beforeStart:async()=>ok('primary'),fallbackConnections:()=>['backup']});
  try {
    const run=await d.run({...input,prompt:'network-fail',allowedFallbackConnectionIds:['backup']});await wait(()=>d.read(run.runId).status==='failed');
    const failed=d.read(run.runId);assert.equal(failed.connectionId,'primary');assert.equal(failed.sessionId,run.sessionId);assert.equal(failed.health.incident.code,'network');assert.equal(failed.tokens,25);assert.equal(failed.fallback,undefined);assert.doesNotMatch(JSON.stringify(failed),/private-token|sk-test-secret/);
    const stopped=await d.control(run.runId,'stop');assert.equal(stopped.stoppedConfirmed,true);
  } finally {await d.close();}
});
test('external adopted sessions cannot claim confirmed stop of an unowned process',async()=>{
  const d=createRuntimeDriver({getConnection:()=>base,commandInvocation,initialRuns:[{...input,adopted:true,runId:'external',sessionId:'external',status:'paused',acceptance:'acknowledged',events:[]}]});
  try {assert.equal((await d.control('external','stop')).stoppedConfirmed,false);} finally {await d.close();}
});
test('unknown source acknowledgement never falls back or replays the task',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'quandeck-health-ack-'));
  const rc2={...base,projectPath:dir,tool:'dsh',provider:'fixture',model:'fixture',binary:fileURLToPath(new URL('./fixtures/dsh-rc2-peer.mjs',import.meta.url))};
  const checks=[]; const d=createRuntimeDriver({getConnection:id=>({...rc2,connectionId:id}),commandInvocation,beforeStart:async id=>{checks.push(id);return ok(id);},fallbackConnections:()=>['backup']});
  try {
    await assert.rejects(d.run({...input,prompt:'missing-ack',allowedFallbackConnectionIds:['backup']}),e=>e.rejected===false);
    const run=d.listRuns()[0];assert.equal(run.acceptance,'unknown');assert.equal(run.health.incident.code,'unknown_acceptance');assert.equal(run.connectionId,'primary');assert.equal(run.fallback,undefined);
    await assert.rejects(d.run({...input,prompt:'missing-ack',allowedFallbackConnectionIds:['backup']}),/未知/);assert.deepEqual(checks,['primary']);
  } finally {await d.close();await rm(dir,{recursive:true,force:true});}
});
test('application restart does not confirm an earlier unobserved process exit',async()=>{
  const d=createRuntimeDriver({getConnection:()=>base,commandInvocation,initialRuns:[{...input,runId:'interrupted',sessionId:'old',status:'running',acceptance:'acknowledged',stoppedConfirmed:false,events:[]}]});
  try {assert.equal((await d.control('interrupted','stop')).stoppedConfirmed,false);} finally {await d.close();}
});
test('failed policy persistence does not enable automatic fallback in memory',async()=>{
  const service=createBridgeService({connections:[base,{...base,connectionId:'backup'}],saveConnections:()=>{throw Error('disk full');}});
  try {await assert.rejects(service.policy({connectionId:'primary',mode:'auto_before_start',connectionIds:['backup']}),/disk full/);assert.equal(service.listConnections().connections[0].fallbackPolicy.mode,'ask');} finally {await service.runtime.close();}
});
test('handoff resolves an incident only after confirmed stop and acknowledged same-task successor',async()=>{
  const d=createRuntimeDriver({getConnection:id=>({...base,connectionId:id}),commandInvocation});
  try {
    const run=await d.run({...input,prompt:'network-fail'});await wait(()=>d.read(run.runId).status==='failed');
    const next=await d.run({...input,dispatchId:'handoff-new',connectionId:'backup'});
    assert.throws(()=>d.resolveIncident(run.runId,{reason:'handed_off',successorRunId:next.runId}),/尚未确认/);
    await d.control(run.runId,'stop');
    const wrong=await d.run({...input,dispatchId:'other-task',taskId:'wrong'});
    assert.throws(()=>d.resolveIncident(run.runId,{reason:'handed_off',successorRunId:wrong.runId}),/尚未确认/);
    const resolved=d.resolveIncident(run.runId,{reason:'handed_off',successorRunId:next.runId});
    assert.equal(resolved.health.incident.resolvedReason,'handed_off');assert.equal(resolved.health.incident.status,'resolved');assert.equal(resolved.health.incident.successorRunId,next.runId);assert.equal(resolved.events.at(-1).status,undefined);
  } finally {await d.close();}
});
test('manual stop does not claim a stalled Agent recovered',async()=>{
  let clock=Date.now();const d=createRuntimeDriver({getConnection:()=>base,commandInvocation,now:()=>clock,stallAfterMs:100,monitorEveryMs:0});
  try {
    const run=await d.run(input);
    // The fixture sends its last startup event after the running status and usage.
    await wait(()=>d.read(run.runId).events.some(event=>event.step?.label==='输出'));
    clock+=101;d.inspectHealth();
    assert.equal(d.read(run.runId).health.incident.status,'open');
    const stopped=await d.control(run.runId,'stop');
    assert.equal(stopped.health.incident.status,'open');
    assert.equal(stopped.health.incident.resolvedReason,undefined);
  } finally {await d.close();}
});

test('login probe failure retains six unique rows and never overwrites valid protocol check',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'quandeck-health-login-'));
  const file=path.join(dir,'peer.mjs');
  await writeFile(file,(await readFile(binary,'utf8')).replace("result:{account:{type:'chatgpt'}}", "error:{message:'401 Unauthorized token=private-secret'}"));
  const service=createBridgeService({connections:[{...base,binary:file}]});
  try {const report=await service.health({connectionId:'primary'});assert.equal(report.canStart,false);assert.equal(report.issue.code,'login');assert.equal(report.checks.length,6);assert.equal(new Set(report.checks.map(c=>c.key)).size,6);assert.equal(report.checks.find(c=>c.key==='login').status,'failed');assert.equal(report.checks.find(c=>c.key==='protocol').status,'passed');assert.doesNotMatch(JSON.stringify(report),/private-secret|401/);}finally{await service.runtime.close();await rm(dir,{recursive:true,force:true});}
});
