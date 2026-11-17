import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteProjectPermanently} from './app/project-deletion.mjs';
function fixture({unknown=false,stopFails=false}={}) {
  const log=[],projects={a:{project:{id:'a'},sessions:{s:{status:'waiting_reply',dispatchPhase:unknown?'unknown':'acknowledged',runtime:{runId:'a-run'}}}},b:{project:{id:'b'},sessions:{}}},erased=new Set();
  let runs=[{projectId:'a',runId:'a-run',status:'waiting_reply'},{projectId:'b',runId:'b-run',status:'running'}];
  const store={readProject:id=>projects[id],isProjectErased:id=>erased.has(id),previewEraseProject(id,options){assert.equal(options.scope,'project');return{token:id};},eraseProject({token}){log.push('erase');erased.add(token);delete projects[token];return{erasedProjectIds:[token],restartRequired:false};}};
  const runtime={listRuns:()=>runs,blockProject:id=>log.push('block:'+id),unblockProject:id=>log.push('unblock:'+id),async stopProject(id){log.push('stop:'+id);if(stopFails)throw Error('未确认停止');for(const run of runs)if(run.projectId===id){run.stoppedConfirmed=true;run.status='cancelled';}},flush:async()=>{},forgetProject(id){assert(runs.find(run=>run.projectId===id).stoppedConfirmed);runs=runs.filter(run=>run.projectId!==id);log.push('forget:'+id);}};
  const core={pauseProjectForErasure:id=>log.push('pause:'+id),resumeProjectAfterErasureFailure:id=>log.push('resume:'+id),flushProjectForErasure:async id=>log.push('flush:'+id),finalizeProjectForErasure:id=>log.push('timers:'+id),reloadAfterProjectErasure:ids=>{assert.equal(projects[ids[0]],undefined);log.push('reload');}};
  return{store,runtime,core,log,projects};
}
test('direct deletion stops only target, drains acknowledgements, erases and reloads before forgetting runtime',async()=>{
  const f=fixture(),result=await deleteProjectPermanently({projectId:'a',...f});assert.equal(result.restartRequired,false);assert.equal(f.projects.a,undefined);assert(f.projects.b);
  assert.deepEqual(f.runtime.listRuns(),[{projectId:'b',runId:'b-run',status:'running'}]);assert(f.log.indexOf('flush:a')<f.log.indexOf('erase'));assert(f.log.indexOf('reload')<f.log.indexOf('forget:a'));assert(!f.log.some(value=>value.endsWith(':b')));
  assert.deepEqual((await deleteProjectPermanently({projectId:'a',...f})).erasedProjectIds,['a']);
});
test('unknown admission blocks without touching project or other execution',async()=>{
  const f=fixture({unknown:true});await assert.rejects(deleteProjectPermanently({projectId:'a',...f}),/未知/);assert(f.projects.a);assert.deepEqual(f.log,[]);
});
test('unconfirmed source stop never erases data and allows an explicit retry',async()=>{
  const f=fixture({stopFails:true});await assert.rejects(deleteProjectPermanently({projectId:'a',...f}),/未确认停止/);assert(f.projects.a);assert(!f.log.includes('erase'));assert(f.log.includes('unblock:a'));assert(f.log.includes('resume:a'));assert.equal(f.runtime.listRuns()[1].status,'running');
});

// Reproduce the main-process registry race with real SQLite and bridge persistence,
// while all Agent requests are synthetic account-read fixtures.
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createLocalStore} from './app/local-store.mjs';
import {createBridgeService} from '../scripts/agent-bridge.mjs';
for(const partialCleanupFailure of [false,true])test(`another project's probe cannot resurrect erased registry entries during flush (${partialCleanupFailure?'cleanup error':'success'})`,async()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'quandeck-registry-race-')),store=createLocalStore(path.join(root,'store'));
  const connections=[{connectionId:'a-connection',tool:'codex',projectPath:'/a',binary:'/bin/codex'},{connectionId:'b-connection',tool:'codex',projectPath:'/b',binary:'/bin/codex'}];
  const projects=Object.fromEntries(['a','b'].map(id=>[id,{project:{id,name:id},tasks:{},sessions:{},runtimeConnections:{codex:{connectionId:`${id}-connection`,projectPath:`/${id}`,tool:'codex'}}}]));
  store.write('quandeck.projects.v1',{schema:1,agents:[],activeProjectId:'a',projects});store.write('runtime.connections',connections);
  const service=createBridgeService({connections,initialRuns:[{projectId:'a',runId:'a-run',dispatchId:'a-dispatch',taskId:'a-task',agentId:'codex',connectionId:'a-connection',sessionId:'a-source',status:'paused',acceptance:'acknowledged',stoppedConfirmed:true,events:[]}],findBinary:async()=>'/bin/codex',validDirectory:async dir=>dir,rpc:async(_binary,_cwd,action)=>action(async()=>({account:{type:'fixture'}})),exec:async()=>({stdout:'codex resume -C --cd'}),saveConnections:records=>store.write('runtime.connections',records),saveRuns:records=>store.write('runtime.runs',records)});
  let release,entered,flushes=0;const gate=new Promise(resolve=>release=resolve),atFlush=new Promise(resolve=>entered=resolve),originalFlush=service.runtime.flush.bind(service.runtime);
  const runtime=Object.assign(Object.create(service.runtime),{flush:async()=>{await originalFlush();if(++flushes===2){entered();await gate;}}});
  const core={pauseProjectForErasure(){},resumeProjectAfterErasureFailure(){},finalizeProjectForErasure(){},flushProjectForErasure:async()=>{},reloadAfterProjectErasure(){}};
  if(partialCleanupFailure){const erase=store.eraseProject;store.eraseProject=request=>{erase(request);throw Error('fixture attachment cleanup failed');};}
  const before=new Set(service.exportConnections().map(c=>c.connectionId));
  const deletion=deleteProjectPermanently({projectId:'a',store,core,runtime,pruneErasedConnections:()=>{
    const retained=new Set(store.read('runtime.connections',[]).map(c=>c.connectionId));return service.pruneConnections([...before].filter(id=>!retained.has(id)),'a');
  }});deletion.catch(()=>{});
  try{
    await atFlush;assert.equal(store.isProjectErased('a'),true);assert.equal(store.readProject('a'),undefined);
    await service.test({tool:'codex',projectPath:'/b',projectId:'b'});
    assert.equal(store.read('runtime.connections').some(c=>c.connectionId==='a-connection'),false,'B persists the registry while A deletion is suspended');
    assert.equal(service.exportConnections().some(c=>c.connectionId==='a-connection'),false);
    assert(store.read('runtime.connections').some(c=>c.connectionId==='b-connection'));
    release();if(partialCleanupFailure)await assert.rejects(deletion,/清理尚未完成/);else assert.equal((await deletion).restartRequired,false);
  }finally{release();await deletion.catch(()=>{});await service.runtime.close();store.close();rmSync(root,{recursive:true,force:true});}
});
