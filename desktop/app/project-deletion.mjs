/** Trusted native lifecycle. UI confirmation happens once, before this function.
 * The durable erasure marker fences late writes; other projects keep their runs. */
export async function deleteProjectPermanently({projectId, store, core, runtime, drainProjections = async()=>{}}) {
  const snapshot=store.readProject(projectId);
  if(!snapshot){if(store.isProjectErased(projectId))return {erasedProjectIds:[projectId],restartRequired:false,externalCopies:'用户原始文件和 Agent 自身副本保留。'};throw Error('项目不存在');}
  const runs=runtime.listRuns().filter(run=>run.projectId===projectId), runIds=new Set(runs.map(run=>run.runId));
  for(const session of Object.values(snapshot.sessions??{})) {
    if(['unknown','submitting'].includes(session.dispatchPhase)||session.runtime?.controlPending)throw Error('本项目有受理结果未知或操作未结束的会话，未删除；请核对源 Agent 状态后重试');
    if(session.runtime?.runId && runIds.has(session.runtime.runId))continue;
    if(session.runtime?.stoppedConfirmed===true)continue;
    if(['archived','failed','cancelled'].includes(session.status)&&session.runtime?.stoppedConfirmed!==false)continue;
    throw Error('本项目存在无法从本机确认停止的源会话，未删除；请先核对源 Agent 已停止');
  }
  runtime.blockProject(projectId);core.pauseProjectForErasure(projectId);
  try {
    core.finalizeProjectForErasure(projectId);
    await runtime.stopProject(projectId);
    await runtime.flush();
    await core.flushProjectForErasure(projectId);
    // Stop owned timers and automation before deleting; an interrupted cleanup
    // must not restart already stopped work when a UI reconnects.
    core.finalizeProjectForErasure(projectId);
    await drainProjections();
    const preview=store.previewEraseProject(projectId,{scope:'project',preservedRuns:runtime.listRuns().filter(run=>run.projectId!==projectId).map(run=>({projectId:run.projectId,connectionId:run.connectionId}))});
    const result=store.eraseProject({token:preview.token,confirmation:projectId});
    // Synchronous reload shares the storage transaction's revision before another
    // project's next event can attempt a compare-and-swap write.
    core.reloadAfterProjectErasure(result.erasedProjectIds);
    runtime.forgetProject(projectId);await runtime.flush();
    return {...result,restartRequired:false};
  } catch(error) {
    if(!store.isProjectErased(projectId)) { runtime.unblockProject(projectId); core.resumeProjectAfterErasureFailure(projectId); }
    else {
      // A tombstone was committed; never lift admission fences or restore the ID.
      if(!store.readProject(projectId)){core.reloadAfterProjectErasure([projectId]);runtime.forgetProject(projectId);await runtime.flush();}
      error.message='项目已登记删除，部分副本清理尚未完成；重新启动后会继续清理。'+error.message;
    }
    throw error;
  }
}
