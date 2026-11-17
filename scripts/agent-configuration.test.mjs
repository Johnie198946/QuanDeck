import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'quandeck-config-test-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), 'src/integration/configuredAgents.ts', 'src/integration/connectionDiagnostics.ts', '--outDir', dir, '--module', 'commonjs', '--target', 'ES2022', '--lib', 'ES2022,DOM', '--skipLibCheck']);
mkdirSync(path.join(dir, 'node_modules'));
symlinkSync(path.dirname(require.resolve('react/package.json')), path.join(dir, 'node_modules/react'));
const { applicationAgentEntries, persistAgentConfiguration, getConfiguredAgents, removeConfiguredAgent, replaceConfiguredAgentConnection, restoreConfiguredAgentConnection, CONFIGURED_AGENTS_KEY } = require(path.join(dir, 'integration/configuredAgents.js'));
const { getTestedConnections, saveTestedConnection } = require(path.join(dir, 'integration/gateway.js'));
process.on('exit', () => rmSync(dir, {recursive:true, force:true}));
const store = () => { const data=new Map(); return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),clear:()=>data.clear()}; };
globalThis.localStorage=store();globalThis.sessionStorage=store();globalThis.window=new EventTarget();
const caps={observe:true,dispatch:true,resume:true,usage:true,subAgents:true,sourceOpen:true,permissions:true};
const input={tool:'dsh',projectPath:'/work',binary:'/tools/bin.js',nodePath:'/tools/node',provider:'deepseek-official',model:'user-configured-model'};
const ready={...input,connectionId:'real-receipt-id',status:'ready',login:'unknown',checkedAt:new Date().toISOString(),capabilities:caps,note:'SDK handshake'};
test('configuration is gated by exact successful receipt and durable runtime binding',async()=>{
 const operations=[];
 const api={registerAgent:async value=>{operations.push(['register',value]);return{ok:true};},bindRuntimeConnection:async(...args)=>{operations.push(['bind',...args]);return{ok:true};}};
 window.quandeckDesktop={savePreference:async(...args)=>operations.push(['persist',...args])};
 await assert.rejects(persistAgentConfiguration(api,input),/先测试/);
 await assert.rejects(persistAgentConfiguration(api,input,{...ready,status:'needs_login',connectionId:undefined}),/先测试/);
 await assert.rejects(persistAgentConfiguration(api,{...input,model:'changed'},ready),/参数已变化/);
 await assert.rejects(persistAgentConfiguration(api,{...input,provider:'changed'},ready),/参数已变化/);
 assert.equal(operations.length,0,'unverified inputs never register or write preferences');
 await assert.rejects(persistAgentConfiguration({registerAgent:api.registerAgent},input,ready),/桌面版/);
 const saved=await persistAgentConfiguration(api,input,ready);
 assert.equal(saved.connectionId,ready.connectionId);
 assert.deepEqual(operations.map(item=>item[0]),['register','bind','persist']);
 assert.equal(operations[1][1],'dsh');
 assert.deepEqual(operations[1][2],{connectionId:ready.connectionId,tool:'dsh',projectPath:'/work',capabilities:caps,provider:input.provider,model:input.model});
 assert.equal(operations[2][1],CONFIGURED_AGENTS_KEY);
 assert.equal(getConfiguredAgents()[0].binary,input.binary);
 assert.equal(getConfiguredAgents()[0].provider,input.provider);
 assert.equal(getConfiguredAgents()[0].model,input.model);
 await persistAgentConfiguration(api,input,ready);
 assert.equal(getConfiguredAgents().length,1,'repeat verified save preserves identity');
 await removeConfiguredAgent(saved.id);
 assert.equal(getConfiguredAgents().length,0);
 assert.equal(JSON.parse(operations.at(-1)[2]).length,0,'removal also persists to desktop store');
});
test('failed binding or disk write never becomes a saved connection',async()=>{
 localStorage.clear();
 const api={registerAgent:async()=>({ok:true}),bindRuntimeConnection:async()=>({ok:false,message:'binding failed'})};
 await assert.rejects(persistAgentConfiguration(api,input,ready),/binding failed/);
 assert.deepEqual(getConfiguredAgents(),[]);
 api.bindRuntimeConnection=async()=>({ok:true});
 window.quandeckDesktop={savePreference:async()=>{throw new Error('disk full');}};
 await assert.rejects(persistAgentConfiguration(api,input,ready),/disk full/);
 assert.deepEqual(getConfiguredAgents(),[]);
});
test('other tools preserve only tested manual discussion ability',async()=>{
 localStorage.clear();window.quandeckDesktop=undefined;
 const manual={tool:'claude',projectPath:'/work',connectionId:'manual-verified',status:'unsupported',discussionOpen:true,login:'unknown',capabilities:Object.fromEntries(Object.keys(caps).map(key=>[key,false])),checkedAt:new Date().toISOString(),note:'CLI only'};
 await persistAgentConfiguration({registerAgent:async()=>({ok:true})},{tool:'claude',projectPath:'/work'},manual);
 assert.equal(getConfiguredAgents()[0].tool,'claude');
 assert.equal(manual.capabilities.dispatch,false);
});
test('named profiles keep separate identities, receipts and runtime bindings for the same tool/project',async()=>{
 localStorage.clear();sessionStorage.clear();window.quandeckDesktop=undefined;
 const bound=[];
 const api={registerAgent:async()=>({ok:true}),bindRuntimeConnection:async(id,binding)=>{bound.push([id,binding.connectionId]);return{ok:true};}};
 const primary={...input,agentId:'custom-primary',displayName:'企业 DSH'};
 const backup={...input,agentId:'custom-backup',displayName:'备用 DSH'};
 const first=await persistAgentConfiguration(api,primary,{...ready,...primary,connectionId:'primary'});
 await persistAgentConfiguration(api,backup,{...ready,...backup,connectionId:'backup'});
 assert.deepEqual(bound,[['custom-primary','primary'],['custom-backup','backup']]);
 assert.equal(getConfiguredAgents().length,2);
 await assert.rejects(persistAgentConfiguration(api,backup,{...ready,...primary,connectionId:'primary'}),/身份已变化/);
 await persistAgentConfiguration(api,{...primary,displayName:'企业 DSH 新名称'},{...ready,...primary,connectionId:'primary'});
 assert.equal(getConfiguredAgents().length,2,'renaming a profile preserves identity');
 await removeConfiguredAgent(first.id);
 assert.equal(getConfiguredAgents()[0].agentId,'custom-backup','removing one profile does not remove its sibling');
});
test('source-default DSH connections bind and persist without requiring model identifiers',async()=>{
 localStorage.clear();sessionStorage.clear();
 const operations=[];
 const api={registerAgent:async value=>{operations.push(['register',value]);return{ok:true};},bindRuntimeConnection:async(...args)=>{operations.push(['bind',...args]);return{ok:true};}};
 window.quandeckDesktop={savePreference:async(...args)=>operations.push(['persist',...args])};
 const defaults={tool:'dsh',projectPath:'/work',binary:'/tools/bin.js',nodePath:'/tools/node'};
 const receipt={...defaults,connectionId:'source-default-receipt',status:'ready',login:'unknown',checkedAt:ready.checkedAt,capabilities:caps,note:'SDK handshake'};
 await assert.rejects(persistAgentConfiguration(api,defaults),/先测试/);
 await assert.rejects(persistAgentConfiguration(api,defaults,{...receipt,status:'unsupported',connectionId:undefined}),/先测试/);
 assert.deepEqual(operations,[],'untested default configuration never writes or binds');
 const saved=await persistAgentConfiguration(api,defaults,receipt);
 assert.deepEqual(operations.map(item=>item[0]),['register','bind','persist']);
 assert.equal(operations[0][1].makeDefault,true);
 assert.deepEqual(JSON.parse(JSON.stringify(operations[1][2])),{connectionId:receipt.connectionId,tool:'dsh',projectPath:'/work',capabilities:caps});
 assert.equal(operations[2][1],CONFIGURED_AGENTS_KEY);
 assert.deepEqual(JSON.parse(operations[2][2]),[saved]);
 assert.deepEqual(getConfiguredAgents(),[saved]);
 assert.equal(Object.hasOwn(saved,'provider'),false);
 assert.equal(Object.hasOwn(saved,'model'),false);
});
test('retesting an existing DSH project with source defaults clears old overrides and preserves identity',async()=>{
 localStorage.clear();sessionStorage.clear();
 const bindings=[],writes=[];
 const api={registerAgent:async()=>({ok:true}),bindRuntimeConnection:async(...args)=>{bindings.push(args);return{ok:true};}};
 window.quandeckDesktop={savePreference:async(key,value)=>writes.push({key,value})};
 const previous=await persistAgentConfiguration(api,input,ready);
 const defaults={tool:'dsh',projectPath:input.projectPath,binary:input.binary,nodePath:input.nodePath};
 const receipt={...defaults,connectionId:'new-default-receipt',status:'ready',login:'unknown',checkedAt:ready.checkedAt,capabilities:caps,note:'SDK handshake'};
 const saved=await persistAgentConfiguration(api,defaults,receipt);
 assert.equal(saved.id,previous.id,'retesting does not duplicate the same tool/project');
 assert.equal(saved.connectionId,receipt.connectionId);
 assert.deepEqual(getConfiguredAgents(),[saved]);
 assert.deepEqual(JSON.parse(writes.at(-1).value),[saved]);
 assert.equal(bindings[0][1].provider,input.provider);
 assert.equal(bindings[0][1].model,input.model);
 assert.equal(bindings[1][1].provider,undefined);
 assert.equal(bindings[1][1].model,undefined);
 for(const record of [saved,getConfiguredAgents()[0],JSON.parse(writes.at(-1).value)[0]]) {
   assert.equal(Object.hasOwn(record,'provider'),false);
   assert.equal(Object.hasOwn(record,'model'),false);
 }
});

const { diagnoseConnection, connectionDiagnosticReport } = require(path.join(dir, 'integration/connectionDiagnostics.js'));
test('connection diagnostics distinguish SDK startup, model reply and local service failures',()=>{
 assert.equal(diagnoseConnection('handshake',new Error('无法读取 DSH 的默认模型'),'dsh').code,'SDK_MODEL');
 assert.equal(diagnoseConnection('handshake',new Error('此命令行包装器不能安全接收任务参数'),'dsh').code,'CLI_LAUNCHER');
 assert.equal(diagnoseConnection('reply',new Error('未连通，回复超时，请稍后重试'),'dsh').stage,'reply');
 assert.equal(diagnoseConnection('reply',new Error('未连通，请检查 Agent 的 SDK 配置与版本'),'dsh').code,'ISOLATION_UNSUPPORTED');
 assert.equal(diagnoseConnection('reply',new Error('无法连接本地服务，请确认已启动连接服务和地址正确'),'dsh').stage,'host');
 assert.equal(diagnoseConnection('handshake',new Error('needs_login'),'codex').code,'SIGN_IN');
});
test('diagnostics never surface raw errors, configuration fragments, secrets or unverified version text',()=>{
 const secret='sk-private-token-do-not-display';
 for(const raw of [`unknown failure ${secret}`,`ENOENT C:/private/${secret}/dsh.cmd`,`未连通，请检查 Agent 的 SDK 配置与版本 apiKey: ${secret}`]){
  const diagnostic=diagnoseConnection('reply',new Error(raw),'dsh');
  const report=connectionDiagnosticReport('dsh',diagnostic,`0.2.0-rc.2\napiKey: ${secret}`);
  assert(!JSON.stringify(diagnostic).includes(secret));assert(!report.includes(secret));assert(!report.includes('C:/private'));
  assert(report.includes('CLI 版本：未读取'));
 }
 const report=connectionDiagnosticReport('dsh',diagnoseConnection('reply','timeout','dsh'),'0.2.0-rc.2');
 assert(report.includes('CLI 版本：0.2.0-rc.2'));assert(report.includes('失败阶段：等待模型回复'));
});

const replacementFixture = () => {
 localStorage.clear(); sessionStorage.clear(); window.quandeckDesktop=undefined;
 const config={...input,id:'existing-preference-agent',configuredAt:'2026-11-16T00:00:00.000Z',connectionId:'original-connection'};
 const unrelated={tool:'codex',projectPath:'/visible-project',id:'unrelated-agent',configuredAt:config.configuredAt,connectionId:'other-connection'};
 localStorage.setItem(CONFIGURED_AGENTS_KEY,JSON.stringify([config,unrelated]));
 const originalBinding={tool:'dsh',connectionId:config.connectionId,projectPath:config.projectPath,provider:input.provider,model:input.model,capabilities:caps};
 const owner={project:{id:'original-project'},runtimeConnections:{'registered-dsh-agent':structuredClone(originalBinding)}};
 const visible={project:{id:'visible-project'},runtimeConnections:{codex:{tool:'codex',connectionId:unrelated.connectionId,projectPath:unrelated.projectPath}}};
 const receipt={tool:'dsh',projectPath:input.projectPath,binary:input.binary,nodePath:input.nodePath,dshModelSource:{profile:'desktop',revision:'a'.repeat(64)},connectionId:'snapshot-connection',status:'ready',login:'unknown',checkedAt:ready.checkedAt,capabilities:caps,protocol:'legacy-rc2',note:'verified hello'};
 const calls=[];
 const api={
  listProjects:async()=>structuredClone([visible,owner]),
  load:async()=>{throw new Error('replacement must not use the visible project');},
  registerAgent:async()=>{throw new Error('replacement must preserve the registered Agent');},
  bindRuntimeConnection:async(agentId,binding,guard)=>{
   calls.push({agentId,binding:structuredClone(binding),guard});
   if(guard.projectId!==owner.project.id||agentId!=='registered-dsh-agent'||owner.runtimeConnections[agentId].connectionId!==guard.expectedConnectionId) return {ok:false,message:'stale binding'};
   owner.runtimeConnections[agentId]=structuredClone(binding);return {ok:true};
  },
 };
 return {config,unrelated,originalBinding,owner,visible,receipt,calls,api};
};

test('model replacement keeps Agent identities, updates the original project, publishes cache after save, and restores it',async()=>{
 const {config,unrelated,originalBinding,owner,visible,receipt,calls,api}=replacementFixture();
 const beforeVisible=structuredClone(visible),saved=[];
 window.quandeckDesktop={comparePreference:async(key,expected,value)=>{
  assert.equal(key,CONFIGURED_AGENTS_KEY);assert.equal(localStorage.getItem(key),expected);
  assert.deepEqual(getTestedConnections(),[],'new test cache is not published before durable apply');
  saved.push(JSON.parse(value));return true;
 }};
 const next=await replaceConfiguredAgentConnection(api,config,receipt);
 assert.equal(next.id,config.id);assert.equal(next.connectionId,receipt.connectionId);
 assert.equal(next.provider,undefined);assert.equal(next.model,undefined);
 assert.deepEqual(next.dshModelSource,receipt.dshModelSource);
 assert.deepEqual(next.previousConnection,{input,binding:originalBinding,projectId:'original-project'});
 assert.deepEqual(calls[0].guard,{projectId:'original-project',expectedConnectionId:config.connectionId});
 assert.equal(calls[0].agentId,'registered-dsh-agent');
 assert.equal(owner.runtimeConnections['registered-dsh-agent'].connectionId,receipt.connectionId);
 assert.deepEqual(saved[0],[next,unrelated]);assert.deepEqual(getConfiguredAgents(),[next,unrelated]);
 assert.deepEqual(getTestedConnections(),[receipt]);assert.deepEqual(visible,beforeVisible);
 window.quandeckDesktop={comparePreference:async(key,expected,value)=>{assert.equal(localStorage.getItem(key),expected);saved.push(JSON.parse(value));return true;}};
 const restored=await restoreConfiguredAgentConnection(api,next);
 assert.equal(restored.id,config.id);assert.equal(restored.connectionId,config.connectionId);
 assert.equal(restored.previousConnection,undefined);assert.equal(restored.dshModelSource,undefined);
 assert.equal(restored.provider,input.provider);assert.equal(restored.model,input.model);
 assert.deepEqual(owner.runtimeConnections['registered-dsh-agent'],originalBinding);
 assert.deepEqual(calls[1].guard,{projectId:'original-project',expectedConnectionId:receipt.connectionId});
 assert.deepEqual(getConfiguredAgents(),[restored,unrelated]);assert.deepEqual(saved[1],[restored,unrelated]);
 assert.deepEqual(getTestedConnections(),[],'restoration never reuses the new model hello receipt');
 assert.deepEqual(visible,beforeVisible);
});

test('failed durable save or preference CAS restores the original binding without changing preferences or test cache',async()=>{
 for(const mode of ['disk','cas']) {
  const {config,originalBinding,owner,receipt,calls,api}=replacementFixture();
  saveTestedConnection({...ready,connectionId:config.connectionId});
  const before=localStorage.getItem(CONFIGURED_AGENTS_KEY),cache=getTestedConnections();
  window.quandeckDesktop=mode==='disk'?{savePreference:async()=>{throw new Error('disk full');}}:{comparePreference:async()=>false};
  await assert.rejects(replaceConfiguredAgentConnection(api,config,receipt),/已恢复原项目连接/);
  assert.deepEqual(owner.runtimeConnections['registered-dsh-agent'],originalBinding);
  assert.equal(localStorage.getItem(CONFIGURED_AGENTS_KEY),before);assert.deepEqual(getTestedConnections(),cache);
  assert.deepEqual(calls.map(call=>call.guard.expectedConnectionId),[config.connectionId,receipt.connectionId]);
  assert.deepEqual(calls.map(call=>call.binding.connectionId),[receipt.connectionId,config.connectionId]);
 }
});

test('replacement rejects stale preferences, wrong receipts, and ambiguous project ownership without writing',async()=>{
 const {config,receipt,calls,api}=replacementFixture();let saves=0;
 window.quandeckDesktop={comparePreference:async()=>{saves++;return true;}};
 for(const invalid of [{...receipt,status:'unsupported'},{...receipt,projectPath:'/other'},{...receipt,dshModelSource:undefined}]) await assert.rejects(replaceConfiguredAgentConnection(api,config,invalid),/先完成/);
 localStorage.setItem(CONFIGURED_AGENTS_KEY,JSON.stringify([{...config,connectionId:'changed-elsewhere'}]));
 await assert.rejects(replaceConfiguredAgentConnection(api,config,receipt),/已被修改或移除/);
 localStorage.setItem(CONFIGURED_AGENTS_KEY,JSON.stringify([config]));
 const projects=await api.listProjects();
 await assert.rejects(replaceConfiguredAgentConnection({...api,listProjects:async()=>[...projects,{...projects[1],project:{id:'duplicate-project'}}]},config,receipt),/无法确定/);
 assert.deepEqual(calls,[]);assert.equal(saves,0);assert.deepEqual(getTestedConnections(),[]);
});

test('rollback never overwrites a concurrent binding change and a failed restore keeps the applied cache',async()=>{
 const {config,owner,receipt,api}=replacementFixture();
 window.quandeckDesktop={comparePreference:async()=>{
  owner.runtimeConnections['registered-dsh-agent'].connectionId='concurrent-connection';return false;
 }};
 await assert.rejects(replaceConfiguredAgentConnection(api,config,receipt),/未覆盖其他操作/);
 assert.equal(owner.runtimeConnections['registered-dsh-agent'].connectionId,'concurrent-connection');
 assert.equal(getConfiguredAgents()[0].connectionId,config.connectionId);assert.deepEqual(getTestedConnections(),[]);
 const fresh=replacementFixture();window.quandeckDesktop={comparePreference:async()=>true};
 const next=await replaceConfiguredAgentConnection(fresh.api,fresh.config,fresh.receipt);
 window.quandeckDesktop={comparePreference:async()=>false};
 await assert.rejects(restoreConfiguredAgentConnection(fresh.api,next),/已恢复原项目连接/);
 assert.equal(fresh.owner.runtimeConnections['registered-dsh-agent'].connectionId,next.connectionId);
 assert.deepEqual(getConfiguredAgents()[0],next);assert.deepEqual(getTestedConnections(),[fresh.receipt]);
});

test('running-work binding rejection preserves the selected connection and cache',async()=>{
 const {config,receipt,api,calls}=replacementFixture();let saves=0;
 window.quandeckDesktop={comparePreference:async()=>{saves++;return true;}};
 await assert.rejects(replaceConfiguredAgentConnection({...api,bindRuntimeConnection:async()=>({ok:false,message:'原连接仍有关联会话，请先结束并归档'})},config,receipt),/先结束并归档/);
 assert.deepEqual(calls,[]);assert.equal(saves,0);assert.equal(getConfiguredAgents()[0].connectionId,config.connectionId);assert.deepEqual(getTestedConnections(),[]);
});

test('renderer storage failure after durable CAS cannot leave preferences and runtime binding on different connections',async()=>{
 const {config,owner,receipt,api}=replacementFixture();
 let durable=localStorage.getItem(CONFIGURED_AGENTS_KEY);
 window.quandeckDesktop={comparePreference:async(_key,expected,value)=>{if(durable!==expected)return false;durable=value;return true;}};
 const setItem=localStorage.setItem;
 localStorage.setItem=(key,value)=>{
  if(key===CONFIGURED_AGENTS_KEY&&JSON.parse(value)[0].connectionId===receipt.connectionId) throw new Error('renderer storage quota');
  return setItem(key,value);
 };
 try {
  await replaceConfiguredAgentConnection(api,config,receipt).catch(()=>{});
  assert.equal(JSON.parse(durable)[0].connectionId,owner.runtimeConnections['registered-dsh-agent'].connectionId,'a failed renderer publish must not roll back only the project binding');
 } finally {localStorage.setItem=setItem;}
});

test('an unavailable transient test cache cannot report an already committed replacement or restore as failed',async()=>{
 const {config,owner,receipt,api}=replacementFixture();
 window.quandeckDesktop={comparePreference:async()=>true};
 const setItem=sessionStorage.setItem;
 sessionStorage.setItem=()=>{throw new Error('session cache unavailable');};
 try {
  const next=await replaceConfiguredAgentConnection(api,config,receipt);
  assert.equal(getConfiguredAgents()[0].connectionId,receipt.connectionId);
  assert.equal(owner.runtimeConnections['registered-dsh-agent'].connectionId,receipt.connectionId);
  const restored=await restoreConfiguredAgentConnection(api,next);
  assert.equal(restored.connectionId,config.connectionId);
  assert.equal(getConfiguredAgents()[0].connectionId,config.connectionId);
  assert.equal(owner.runtimeConnections['registered-dsh-agent'].connectionId,config.connectionId);
 } finally {sessionStorage.setItem=setItem;}
});

test('application configuration persists once, preserves legacy overrides, and never binds current project',async()=>{
 localStorage.clear();const ops=[];window.quandeckDesktop={savePreference:async()=>ops.push('persist')};
 const api={registerAgent:async()=>{ops.push('register');return{ok:true};},bindRuntimeConnection:async()=>{throw Error('must not bind');}};
 localStorage.setItem(CONFIGURED_AGENTS_KEY,JSON.stringify([{id:'old',...input,model:'old-override'},{id:'other',tool:'codex',projectPath:'/other'}]));
 const saved=await persistAgentConfiguration(api,input,ready,{applicationDefault:true});
 assert.equal(saved.scope,'application');assert.deepEqual(ops,['register','persist']);
 assert.equal(getConfiguredAgents().find(r=>r.id==='old').model,'old-override');
 await persistAgentConfiguration(api,input,ready,{applicationDefault:true});
 assert.equal(getConfiguredAgents().filter(r=>r.scope==='application').length,1);
 assert.equal(getConfiguredAgents()[0].id,saved.id,'editing default retains priority');
});

test('application DSH model replacement and restore never inspect or rebind project connections',async()=>{
 localStorage.clear();window.quandeckDesktop={savePreference:async()=>{}};const api={registerAgent:async()=>({ok:true}),listProjects:async()=>{throw Error('must not inspect projects');},bindRuntimeConnection:async()=>{throw Error('must not bind');}};
 const original=await persistAgentConfiguration(api,input,ready,{applicationDefault:true});
 const receipt={...ready,connectionId:'replacement',dshModelSource:{profile:'verified-model',revision:'r1'}};
 const changed=await replaceConfiguredAgentConnection(api,original,receipt);assert.equal(changed.scope,'application');assert.equal(changed.previousApplicationConnection.connectionId,ready.connectionId);
 const restored=await restoreConfiguredAgentConnection(api,changed);assert.equal(restored.scope,'application');assert.equal(restored.connectionId,ready.connectionId);
});

test('one application entry per identity retains migration history until removal; removal cannot resurrect a legacy profile',async()=>{
 globalThis.localStorage=store();globalThis.sessionStorage=store();const saved=[];
 window.quandeckDesktop={savePreference:async(_key,value)=>saved.push(value)};
 const api={registerAgent:async()=>({ok:true}),bindRuntimeConnection:async()=>({ok:true})};
 const old=await persistAgentConfiguration(api,input,ready);
 const app=await persistAgentConfiguration(api,{...input,projectPath:'/setup'},{...ready,projectPath:'/setup',connectionId:'setup-receipt'},{applicationDefault:true});
 assert.equal(getConfiguredAgents().length,2,'migration history stays until explicit removal');
 assert.deepEqual(applicationAgentEntries(getConfiguredAgents()).map(item=>item.id),[app.id]);
 assert.deepEqual(app.capabilities,caps);
 await removeConfiguredAgent(app.id);assert.equal(getConfiguredAgents().length,0,'removing application identity removes old selectable defaults too');
 assert.equal(JSON.parse(saved.at(-1)).some(item=>item.id===old.id),false);
});
