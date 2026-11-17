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
