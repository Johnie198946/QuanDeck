// Only a complete, unambiguous user command changes phase. Questions, quoted text,
// additional requirements, conditionals and permission replies stay in their own flow.
export function isExecutionIntent(value) {
  if (typeof value !== 'string' || value.length > 100) return false;
  const text = value.trim().toLowerCase().replace(/[，。！、,!.;；\s]+/g, '');
  return /^(?:(?:好的|好|可以|支持|同意|确认|满意|方案满意|我满意方案了|我已确认|没问题))?(?:请|现在|立即|直接)?(?:开始执行|自动执行|开始自动执行|按方案执行|按这个方案执行|按此方案执行|执行|执行吧|继续执行)$/.test(text)
    || /^(?:yes)?(?:please)?(?:startexecution|execute|executetheplan|proceedwiththeplan)$/.test(text);
}

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
      scope: plan.scope ?? 'task',
      automationEnabled: !!project.collaboration?.goalAutomation?.[plan.id]?.enabled && project.collaboration.goalAutomation[plan.id].draftVersion === plan.draftVersion,
      conclusionId: conclusion?.id,
      approved: !!plan.adopted && plan.adopted.draftVersion === plan.draftVersion,
      taskCount: project.collaboration?.goalPlans?.[plan.id]?.at(-1)?.tasks?.length ?? items.length,
      conclusions: scoped.filter(value => value.id.startsWith(`conclusion:${session.id}:`) || value.sourceRef?.sessionId && value.sourceRef.sessionId === session.source?.sessionId).map(value => ({ id: value.id, sourceMessageId: value.sourceMessageId, summary: value.summary, visualBlocks: value.visualBlocks ?? [], feedback: (project.collaboration?.discussionFeedback ?? []).filter(f => f.binding.conclusionId === value.id) })),
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
      const delivery = located && await source.getSessionDelivery?.(located.session.id);
      const contextRestart = located && await source.inspectContextRestart?.(located.session.id);
      const submissionIssue = located?.session.runtime?.submissionIssue;
      return { ...run, submissionIssue, ...(contextRestart ? {contextRestart, controls: {...run?.controls, canReply:false, canResume:false, reason:contextRestart.reason}} : {}), ...(located?.workflow ? { workflow: located.workflow } : {}), ...(delivery ? { delivery, controls: { ...run?.controls, canReply: false, canResume: false, reason: '本次成果已提交。需要修改时，请更新任务要求并开启新的受管执行。' } } : {}) };
    },
    async control(runId, action, payload) {
      const located = await locate(runId);
      if (!located) throw new Error('此执行尚未关联到任务，请返回任务页面同步');
      if (action === 'open_delivery' || action === 'open_revision') {
        const delivery = await source.getSessionDelivery?.(located.session.id);
        if (!delivery) return { ok: false, message: '成果或任务要求已更新，请刷新后查看当前任务' };
        await showMain({ projectId: delivery.projectId, taskId: delivery.taskId, ...(delivery.workItemId ? { itemId: delivery.workItemId } : {}), view: action === 'open_delivery' ? 'results' : 'plan' });
        return { ok: true };
      }
      if (action === 'restart_fresh_context') return openReceipt(await source.restartFreshContext(located.session.id));
      if (action === 'discussion_feedback') return source.sendDiscussionFeedback(located.session.id, payload);
      const intent = action === 'reply' && !payload?.requestId && readRun(runId)?.purpose === 'discussion' && isExecutionIntent(payload?.prompt);
      if (intent) action = located.workflow?.approved ? 'enable_automation' : 'approve_and_execute';
      // A task tree already exists: an execution action resumes that tree, never
      // silently navigates to it or launches another monolithic root execution.
      if (action === 'execute_task' && located.workflow?.taskCount > 0) action = located.workflow.approved ? 'enable_automation' : 'approve_and_execute';
      if (!['approve_plan','approve_and_execute','enable_automation','open_direction','decompose_plan','open_tasks','execute_task'].includes(action)) return source.controlSession(located.session.id, action, payload);
      const { project, session, plan, workflow } = located;
      if (!plan || !workflow) return { ok: false, message: '这次会话没有可操作的方案，请从原任务继续' };
      if (pending.has(runId)) return { ok: false, message: '正在处理上一次方案操作' };
      pending.add(runId);
      try {
        if (action === 'open_direction') { await showMain({ projectId: project.project.id, taskId: plan.taskId, planId: plan.id, view: 'plan' }); return { ok: true }; }
        if (['approve_and_execute','enable_automation'].includes(action)) {
          if (!located.conclusionIsCurrent || (payload?.conclusionId && payload.conclusionId !== workflow.conclusionId)) return { ok: false, message: '方案已有更新，请先查看最新方向' };
          if ((payload?.expectedVersion ?? workflow.draftVersion) !== workflow.draftVersion) return { ok: false, message: '方向版本已变化，请刷新后继续' };
          if (['running','pending','waiting_permission'].includes(session.status)) return { ok: false, message: '请等当前讨论结束后启动自动执行' };
          let approvedDraftVersion = workflow.draftVersion;
          if (!workflow.approved) {
            if (action !== 'approve_and_execute') return { ok: false, message: '请先确认方向' };
            const approved = await source.approvePlan(plan.id, workflow.conclusionId, project.project.id, workflow.draftVersion);
            if (!approved.ok) return approved;
            approvedDraftVersion = approved.approvedDraftVersion ?? workflow.draftVersion;
          }
          const closed = await finishDiscussion(session.id, runId);
          if (!closed.ok) return closed;
          const result = await source.configureGoalAutomation(plan.id, { enabled: true, agentId: session.agentId, expectedDraftVersion: approvedDraftVersion, ...(intent ? { executionIntent: { text: payload.prompt.trim(), sourceSessionId: session.id } } : {}) }, project.project.id);
          if (result.ok) await showMain({ projectId: project.project.id, taskId: plan.taskId, planId: plan.id, view: 'plan' });
          return result.ok ? { ...result, message: '方向已确认，正在按任务依赖自动推进。' } : result;
        }
        if (action === 'open_tasks') { await showMain({ projectId: project.project.id, taskId: plan.taskId, view: 'tasks' }); return { ok: true }; }
        if (action === 'approve_plan') {
          if (!located.conclusionIsCurrent || (payload?.conclusionId && payload.conclusionId !== workflow.conclusionId)) return { ok: false, message: '这不是最新一轮方案，请返回任务查看最新结论后再确认' };
          if (['running','pending','waiting_permission'].includes(session.status)) return { ok: false, message: '请等当前回复完成，再确认这一版方向' };
          return source.approvePlan(plan.id, payload?.conclusionId || workflow.conclusionId, project.project.id, payload?.expectedVersion ?? workflow.draftVersion);
        }
        if (action === 'execute_task' && plan.scope === 'project') return { ok: false, message: '项目目标需要先拆分；请确认方向并自动执行' };
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
