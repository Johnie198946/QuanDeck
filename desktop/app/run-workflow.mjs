/** Console actions resolve their original project, never whichever project is active now. */
export function locateRunWorkflow(projects, runId) {
  for (const project of projects) for (const session of Object.values(project.sessions)) {
    if (session.runtime?.runId !== runId) continue;
    const plan = project.ideaPlans?.[session.runtime.planId];
    if (!plan) return { project, session };
    const scoped = [...(plan.discussion?.conclusions ?? [])].reverse().filter(value => value.scopeId === (session.runtime.scope || 'root'));
    const related = Object.values(project.sessions).filter(value => value.runtime?.planId === plan.id && (value.runtime?.scope || 'root') === (session.runtime.scope || 'root'));
    const conclusion = scoped.find(value => value.id.startsWith(`conclusion:${session.id}:`) ||
      (value.sourceRef?.sessionId && value.sourceRef.sessionId === session.source?.sessionId) ||
      (related.length === 1 && !value.sourceRef && !value.sourceMessageId));
    const conclusionIsCurrent = !scoped.length || !!conclusion && scoped[0].id === conclusion.id;
    const items = Object.values(project.orchestrations?.[plan.taskId]?.items ?? {}).filter(item => item.status !== 'cancelled');
    return { project, session, plan, conclusionIsCurrent, workflow: {
      projectId: project.project.id, taskId: plan.taskId, planId: plan.id,
      draftVersion: plan.draftVersion, adoptedVersion: plan.adopted?.version,
      conclusionId: conclusion?.id,
      approved: !!plan.adopted && plan.adopted.draftVersion === plan.draftVersion,
      taskCount: items.length,
    } };
  }
  return null;
}

export function createRunWorkflow({ source, readRun, openRun, showMain }) {
  const pending = new Set();
  const locate = async runId => locateRunWorkflow(await source.listProjects(), runId);
  async function finishDiscussion(sessionId, runId) {
    let located = await locate(runId);
    if (!located || located.session.id !== sessionId) return { ok: false, message: '讨论来源已变化，请刷新' };
    if (['unknown','submitting'].includes(located.session.dispatchPhase || '')) return { ok: false, message: '讨论受理状态尚未确认，请先核对源会话' };
    if (['running','pending','waiting_permission'].includes(located.session.status)) {
      const stopped = await source.controlSession(sessionId, 'stop');
      if (!stopped.ok) return stopped;
      located = await locate(runId);
      if (!located || ['running','pending','waiting_permission'].includes(located.session.status)) return { ok: false, message: '等待讨论停止回执后才能开始新任务' };
    }
    if (!['archived','failed','cancelled'].includes(located.session.status)) {
      const archived = await source.controlSession(sessionId, 'archive');
      if (!archived.ok) return archived;
      located = await locate(runId);
      if (!located || !['archived','failed','cancelled'].includes(located.session.status)) return { ok: false, message: '等待讨论归档回执；尚未执行任务' };
    }
    if (readRun(runId)?.stoppedConfirmed !== true) return { ok: false, message: '尚未收到源 Agent 已停止的回执，请先在源会话核对；未启动新的执行' };
    return { ok: true };
  }
  async function openReceipt(receipt) {
    if (!receipt.ok || !receipt.sessionId) return receipt;
    const project = (await source.listProjects()).find(value => value.sessions[receipt.sessionId]);
    const id = project?.sessions[receipt.sessionId]?.runtime?.runId;
    if (id) await openRun(id);
    return receipt;
  }
  return {
    async read(runId) {
      const run = readRun(runId), located = await locate(runId);
      return { ...run, ...(located?.workflow ? { workflow: located.workflow } : {}) };
    },
    async control(runId, action, payload) {
      const located = await locate(runId);
      if (!located) throw new Error('此执行尚未关联到任务，请返回任务页面同步');
      if (!['approve_plan','decompose_plan','open_tasks','execute_task'].includes(action)) return source.controlSession(located.session.id, action, payload);
      const { project, session, plan, workflow } = located;
      if (!plan || !workflow) return { ok: false, message: '这次会话没有可操作的方案，请从原任务继续' };
      if (pending.has(runId)) return { ok: false, message: '正在处理上一次方案操作' };
      pending.add(runId);
      try {
        if (action === 'open_tasks') { await showMain({ projectId: project.project.id, taskId: plan.taskId, view: 'tasks' }); return { ok: true }; }
        if (action === 'approve_plan') {
          if (!located.conclusionIsCurrent || (payload?.conclusionId && payload.conclusionId !== workflow.conclusionId)) return { ok: false, message: '这不是最新一轮方案，请返回任务查看最新结论后再确认' };
          if (['running','pending','waiting_permission'].includes(session.status)) return { ok: false, message: '请等当前回复完成，再确认这一版方向' };
          return source.approvePlan(plan.id, payload?.conclusionId || workflow.conclusionId, project.project.id, payload?.expectedVersion ?? workflow.draftVersion);
        }
        if (action === 'decompose_plan' && !workflow.approved) return { ok: false, message: '先确认方向，再拆分执行任务' };
        if (workflow.taskCount > 0) { await showMain({ projectId: project.project.id, taskId: plan.taskId, view: 'tasks' }); return { ok: true, message: '执行任务已创建，请选择具体子任务' }; }
        const closed = await finishDiscussion(session.id, runId);
        if (!closed.ok) return closed;
        if (action === 'decompose_plan') return openReceipt(await source.startDiscussion(plan.id, session.agentId, session.runtime.scope || 'root', project.project.id));
        return openReceipt(await source.dispatchProjectTask(project.project.id, plan.taskId, session.agentId, plan.itemId || undefined));
      } finally { pending.delete(runId); }
    },
  };
}
