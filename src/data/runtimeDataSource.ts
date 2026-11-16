import { LocalWorkdeckDataSource, type WorkdeckDataSource } from './repository';
import type { Agent, CommandResult, Session, Snapshot, Orchestration, Attempt, SessionStatus } from './types';
import type { RuntimeDriver, RuntimeCommands, RuntimeConnectionBinding, RuntimeEvent, RuntimeRunInput, RuntimeReceipt, RuntimeAction, ObservedRuntimeSession } from './runtimeContracts';
import { buildDiscussionBrief } from './discussion';
import { ensureTimeline, reduceExecutionEvent, dateInZone, refreshTimelineStats, executionMinutesByAgent, nextDate, dayBounds, type ExecutionState } from './timeline';
import { refreshBlocked } from './ideaEngine';

export type RuntimeWorkdeckDataSource = WorkdeckDataSource & RuntimeCommands & { dispose(): void; flushRuntime(): Promise<void>; syncTrackedSources(): Promise<void> };
const uuid = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`;
const terminal = new Set<SessionStatus>(['archived', 'failed', 'cancelled']);
const iso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const sourceState = (status: SessionStatus): ExecutionState => status === 'archived' ? 'done' : status === 'pending' ? 'queued' : status;
const sessionState = (status: NonNullable<RuntimeEvent['status']>): SessionStatus => status === 'done' ? 'archived' : status;
function orchestration(snapshot: Snapshot, taskId: string): Orchestration {
  return (snapshot.orchestrations ??= {})[taskId] ??= {
    taskId, label: snapshot.tasks[taskId].title, startedAt: new Date().toISOString(), syncedAt: new Date().toISOString(),
    coordinationTokens: null, phases: [], executors: {}, items: {}, itemOrder: [], attempts: {},
    capabilities: { subAgents: false, steps: false, tokens: false, permissionEvents: false },
  };
}
/** Archiving a coordinator cannot finish unfinished human or agent branches. */
export function settleRuntimeTask(snapshot: Snapshot, taskId: string, at: string) {
  const task = snapshot.tasks[taskId];
  if (!task || task.manualLock) return;
  const sessions = task.sessionIds.map(id => snapshot.sessions[id]).filter(Boolean).filter(s => !s.linkedAsHistory);
  const items = Object.values(snapshot.orchestrations?.[taskId]?.items ?? {});
  const activeItems = items.filter(item => item.status !== 'cancelled');
  const sessionsDone = sessions.every(session => session.status === 'archived');
  const itemsDone = activeItems.every(item => item.status === 'done');
  if (sessions.length > 0 && sessionsDone && itemsDone) task.completion ??= { reason: 'all_archived', at };
  else if (task.completion?.reason === 'all_archived') task.completion = null;
}
/** Structured conclusions are opt-in source output, never inferred from arbitrary prose. */
export function readAgentConclusion(text: string): { summary: string; confirmed: string[]; open: string[] } {
  const match = /<quandeck-conclusion>\s*([\s\S]*?)\s*<\/quandeck-conclusion>/i.exec(text);
  if (match) try {
    const value = JSON.parse(match[1]);
    if (typeof value.summary === 'string' && Array.isArray(value.confirmed) && Array.isArray(value.open) && [...value.confirmed, ...value.open].every(v => typeof v === 'string')) {
      return { summary: value.summary, confirmed: value.confirmed.slice(0, 100), open: value.open.slice(0, 100) };
    }
  } catch { /* Preserve the original source reply when its optional payload is malformed. */ }
  return { summary: text, confirmed: [], open: [] };
}
function usage(snapshot: Snapshot) {
  const zone = snapshot.project.timeZone ?? 'Asia/Shanghai';
  const sessions = Object.values(snapshot.sessions).filter(s => iso(s.lastActivity) && dateInZone(Date.parse(s.lastActivity), zone) === snapshot.date && s.dispatchPhase !== 'rejected');
  const tokensToday = (s: Session): number | null => {
    const samples = s.runtime?.usageSamples?.filter(sample => dateInZone(Date.parse(sample.at), zone) === snapshot.date);
    if (samples?.length) return samples.some(sample => sample.delta == null) ? null : samples.reduce((sum, sample) => sum + sample.delta!, 0);
    if (s.startedAt && iso(s.startedAt) && dateInZone(Date.parse(s.startedAt), zone) === snapshot.date) return s.tokens;
    return null;
  };
  const values = sessions.flatMap(s => tokensToday(s) == null ? [] : [tokensToday(s)!]);
  snapshot.stats.tokens = values.length ? values.reduce((a, b) => a + b, 0) : null;
  snapshot.stats.sessions = sessions.length;
  for (const agent of snapshot.agents) {
    const own = sessions.filter(s => s.agentId === agent.id);
    const tokens = own.flatMap(s => tokensToday(s) == null ? [] : [tokensToday(s)!]);
    if (own.length) {
      agent.today.sessions = own.length;
      agent.today.tokens = tokens.length ? tokens.reduce((a, b) => a + b, 0) : null;
      if (snapshot.timeline?.intervals.some(interval => interval.agentId === agent.id)) agent.today.minutes ??= 0;
    }
    agent.daily14 = Array.from({ length: 14 }, (_, index) => {
      const date = nextDate(snapshot.date, index - 13), [start, end] = dayBounds(date, zone);
      const covered = snapshot.timeline?.intervals.some(interval => interval.agentId === agent.id && Date.parse(interval.start) < end && Date.parse(interval.end ?? interval.observedThrough ?? snapshot.timeline!.asOf) >= start);
      return covered ? executionMinutesByAgent({ ...snapshot, date }).get(agent.id) ?? 0 : null;
    });
  }
  refreshTimelineStats(snapshot);
}
function brief(snapshot: Snapshot, taskId: string, itemId?: string) {
  const task = snapshot.tasks[taskId], item = itemId ? snapshot.orchestrations?.[taskId]?.items[itemId] : undefined;
  const plan = Object.values(snapshot.ideaPlans ?? {}).find(p => p.taskId === taskId && p.itemId === (itemId ?? null)) ?? Object.values(snapshot.ideaPlans ?? {}).find(p => p.taskId === taskId && !p.itemId);
  const doc = plan?.adopted?.doc;
  const lines = doc?.sections.flatMap(section => section.lines.map(line => `- ${section.title} [${line.state}] ${line.text}`)) ?? [];
  return { planVersion: plan?.adopted?.version, prompt: [
    `项目：${snapshot.project.name}`, `主任务：${task.title}`, item ? `本次执行的子任务：${item.title}` : '',
    item?.expected ? `交付要求：${item.expected}` : '',
    lines.length ? `已采用的方法 v${plan!.adopted!.version}：\n${lines.join('\n')}` : '',
    '只执行本次任务范围。需要权限或有未确认问题时向用户询问。每轮结束给出真实进展与产出，不把计划当作已完成。',
  ].filter(Boolean).join('\n\n') };
}

/** Electron owns this adapter. The renderer receives only domain commands and snapshots. */
class RuntimeSource {
  readonly mode = 'live' as const;
  readonly demo = undefined;
  private pending = new Map<string, Promise<CommandResult & { sessionId?: string }>>();
  private eventQueue: Promise<void> = Promise.resolve();
  private early = new Map<string, RuntimeEvent[]>();
  private stopListening: () => void;
  private recovering: Promise<CommandResult> | null = null;
  private scanning = new Map<string, Promise<CommandResult>>();
  constructor(private base: LocalWorkdeckDataSource, private driver: RuntimeDriver) {
    this.stopListening = driver.subscribe(event => {
      this.eventQueue = this.eventQueue.then(() => this.receive(event)).catch(error => {
        // Persistence errors stop mutation and remain visible to the caller of flushRuntime.
        this.lastEventError = error;
      });
    });
  }
  private lastEventError: unknown;
  dispose() { this.stopListening(); }
  async flushRuntime() { await this.eventQueue; if (this.lastEventError) { const error = this.lastEventError; this.lastEventError = undefined; throw error; } }
  private async locateSession(id: string) {
    for (const snapshot of await this.base.listProjects()) if (snapshot.sessions[id]) return { snapshot, session: snapshot.sessions[id] };
    return null;
  }
  private async locateRun(runId: string) {
    for (const snapshot of await this.base.listProjects()) {
      const session = Object.values(snapshot.sessions).find(s => s.runtime?.runId === runId);
      if (session) return { snapshot, session };
    }
    return null;
  }
  async bindRuntimeConnection(agentId: string, connection: RuntimeConnectionBinding): Promise<CommandResult> {
    if (!connection.connectionId || !connection.projectPath) return { ok: false, message: '缺少已验证的连接与项目目录' };
    const snapshot = await this.base.load();
    if (!snapshot.agents.some(a => a.id === agentId)) return { ok: false, message: '请先登记 Agent' };
    if (!snapshot.project.id) return { ok: false, message: '请先创建项目，再为项目连接 Agent' };
    const normalizePath = (value: string) => { const normalized = value.replace(/\\/g, '/').replace(/\/+$/, ''); return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized; };
    const collision = (await this.base.listProjects()).find(project => project.project.id !== snapshot.project.id && Object.values(project.runtimeConnections ?? {}).some(binding => binding.connectionId === connection.connectionId || binding.tool === connection.tool && normalizePath(binding.projectPath) === normalizePath(connection.projectPath)));
    if (collision) return { ok: false, message: `此工作目录已归属项目「${collision.project.name}」。请选择独立项目目录，避免会话重复记入多个项目。` };
    this.base.mutateRuntimeProject(snapshot.project.id, d => {
      const agent = d.agents.find(a => a.id === agentId)!;
      (d.runtimeConnections ??= {})[agentId] = structuredClone(connection);
      agent.connection = 'healthy'; agent.connectionNote = '本地连接已验证';
      agent.scan = { state: 'idle', lastAt: agent.scan.lastAt };
    });
    return { ok: true };
  }
  async dispatch(taskId: string, agentId: string) { return this.dispatchInternal(taskId, agentId); }
  async dispatchWork(taskId: string, itemId: string, agentId: string) { return this.dispatchInternal(taskId, agentId, itemId); }
  async startDiscussion(planId: string, agentId?: string, scope = 'root') {
    const snapshot = await this.base.load();
    const plan = snapshot.ideaPlans?.[planId];
    if (!plan || scope !== 'root' && !plan.draft.sections.some(section => section.id === scope)) return { ok: false, message: '讨论范围不存在' };
    return this.dispatchInternal(plan.taskId, agentId ?? plan.discussion?.agentId ?? snapshot.defaultAgent, plan.itemId ?? undefined, { planId, scope });
  }
  private async dispatchInternal(taskId: string, agentId: string, itemId?: string, discussion?: { planId: string; scope: string }, retryOf?: string) {
    const snapshot = await this.base.load();
    const key = `${snapshot.project.id}:${taskId}:${itemId ?? ''}:${agentId}:${discussion?.planId ?? 'execute'}:${discussion?.scope ?? ''}`;
    if (this.pending.has(key)) return this.pending.get(key)!;
    const work = this.submit(snapshot, taskId, agentId, itemId, discussion, retryOf);
    this.pending.set(key, work);
    try { return await work; } finally { this.pending.delete(key); }
  }
  private async submit(snapshot: Snapshot, taskId: string, agentId: string, itemId?: string, discussion?: { planId: string; scope: string }, retryOf?: string): Promise<CommandResult & {sessionId?: string}> {
    const task = snapshot.tasks[taskId], item = itemId ? snapshot.orchestrations?.[taskId]?.items[itemId] : undefined;
    const agent = snapshot.agents.find(a => a.id === agentId), connection = snapshot.runtimeConnections?.[agentId];
    if (!task || itemId && !item) return { ok: false, message: '任务不存在' };
    if (!agent || !connection) return { ok: false, message: '请先为此项目连接本地 Agent' };
    if (connection.capabilities?.dispatch === false) return { ok: false, message: '该连接尚不支持派发任务' };
    if (!discussion && (task.completion || item && ['done', 'cancelled'].includes(item.status))) return { ok: false, message: '任务已结束，请先重新打开' };
    if (!discussion && item?.dependsOnTaskIds.some(id => snapshot.orchestrations![taskId].items[id]?.status !== 'done')) return { ok: false, message: '前置任务尚未完成' };
    const purpose = discussion ? 'discussion' : 'execution';
    const existing = Object.values(snapshot.sessions).find(s => s.id !== retryOf && s.runtime && (s.runtime.workItemId || s.runtime.purpose === 'discussion' ? s.runtime.taskId : s.taskId) === taskId && s.runtime.workItemId === itemId && s.runtime.purpose === purpose && s.agentId === agentId && (!discussion || s.runtime.planId === discussion.planId && s.runtime.scope === discussion.scope) && (!terminal.has(s.status) || s.dispatchPhase === 'unknown'));
    if (existing) return { ok: true, sessionId: existing.id, message: existing.dispatchPhase === 'unknown' ? '已有受理状态待核对的提交，请先对账' : '已关联这次执行，请打开原会话继续' };
    const at = new Date().toISOString(), sessionId = uuid('session'), dispatchId = uuid('dispatch');
    const context = discussion ? { prompt: `${buildDiscussionBrief(snapshot, snapshot.ideaPlans![discussion.planId], discussion.scope)}\n\n每轮结尾可用以下可解析格式记录结论，只有已经与用户确认的事项放 confirmed；未确认问题放 open：\n<quandeck-conclusion>{"summary":"本轮结论","confirmed":[],"open":[]}</quandeck-conclusion>`, planVersion: undefined } : brief(snapshot, taskId, itemId);
    const attemptId = itemId && !discussion ? uuid('attempt') : undefined;
    this.base.mutateRuntimeProject(snapshot.project.id, d => {
      const session: Session = { id: sessionId, agentId, title: item?.title ?? task.title, taskId, origin: 'dispatch', dispatchId, dispatchPhase: 'submitting', status: 'pending', startedAt: null, lastActivity: at, tokens: null, step: null, rounds: [], subAgents: [],
        runtime: { dispatchId, projectId: d.project.id, taskId, workItemId: itemId, attemptId, connection: structuredClone(connection), purpose, planId: discussion?.planId, scope: discussion?.scope, context: { taskTitle: item?.title ?? task.title, prompt: context.prompt, planVersion: context.planVersion, capturedAt: at }, sequence: -1, eventIds: [] } };
      d.sessions[sessionId] = session;
      if (discussion) {
        const plan = d.ideaPlans![discussion.planId];
        plan.discussion ??= { agentId, conclusions: [] };
        Object.assign(plan.discussion, { agentId, sessionId, syncStatus: 'pending' });
      } else if (itemId && attemptId) {
        const o = d.orchestrations![taskId], w = o.items[itemId];
        const executorId = `executor:${agentId}`;
        o.executors[executorId] ??= { id: executorId, agentId, label: agent.name, parentExecutorId: null };
        const previous = o.attempts[w.attemptIds.at(-1) ?? ''];
        o.attempts[attemptId] = { id: attemptId, workItemId: itemId, executorId, sessionId, parentSessionId: null, sourceLink: '', kind: !previous ? 'initial' : previous.executorId === executorId ? 'retry' : 'reassign', status: 'queued', startedAt: at, tokens: null, rounds: [] };
        w.attemptIds.push(attemptId); w.status = 'queued'; w.owner = 'agent'; w.executorId = executorId; w.suggestedAgentId = agentId;
      } else d.tasks[taskId].sessionIds.push(sessionId);
    });
    const input: RuntimeRunInput = { dispatchId, projectId: snapshot.project.id, taskId, workItemId: itemId, agentId, connectionId: connection.connectionId, prompt: context.prompt, purpose };
    try {
      const receipt = await this.driver.run(input);
      await this.accept(sessionId, receipt);
      return { ok: true, sessionId, message: 'Agent 已受理' };
    } catch (error) {
      const rejected = !!error && typeof error === 'object' && 'rejected' in error && error.rejected === true;
      this.base.mutateRuntimeProject(snapshot.project.id, d => {
        const s = d.sessions[sessionId];
        if (s.dispatchPhase === 'acknowledged') return;
        s.dispatchPhase = rejected ? 'rejected' : 'unknown';
        s.status = rejected ? 'failed' : 'pending'; s.failure = message(error);
        if (discussion) d.ideaPlans![discussion.planId].discussion!.syncStatus = 'failed';
        if (attemptId) { const attempt = d.orchestrations![taskId].attempts[attemptId]; attempt.status = rejected ? 'failed' : 'queued'; d.orchestrations![taskId].items[itemId!].status = attempt.status; }
      });
      return { ok: false, sessionId, message: rejected ? message(error) : `受理结果待核对：${message(error)}` };
    }
  }
  private async accept(sessionId: string, receipt: RuntimeReceipt) {
    const located = await this.locateSession(sessionId);
    if (!located?.session.runtime) throw new Error('执行记录不存在');
    const meta = located.session.runtime;
    if (!receipt.runId || !receipt.sessionId || receipt.connectionId !== meta.connection.connectionId || !iso(receipt.acceptedAt)) throw new Error('Agent 返回的连接或会话标识无效');
    this.base.mutateRuntimeProject(located.snapshot.project.id, d => {
      const s = d.sessions[sessionId];
      s.runtime!.runId = receipt.runId; s.runtime!.acceptedAt = receipt.acceptedAt; s.dispatchPhase = 'acknowledged'; delete s.failure;
      if (s.status === 'pending') s.status = 'queued';
      s.source = { tool: meta.connection.tool, connectionId: receipt.connectionId, sessionId: receipt.sessionId };
      if (meta.attemptId) d.orchestrations![meta.taskId].attempts[meta.attemptId].source = { ...s.source };
    });
    this.eventQueue = this.eventQueue.then(async () => {
      const buffered = this.early.get(receipt.runId) ?? []; this.early.delete(receipt.runId);
      for (const event of buffered.sort((a, b) => a.sequence - b.sequence)) await this.receive(event);
    });
    await this.flushRuntime();
  }
  private async receive(event: RuntimeEvent): Promise<void> {
    if (!event.id || !event.runId || !event.sessionId || !iso(event.at) || !Number.isSafeInteger(event.sequence) || event.sequence < 0) return;
    if (event.tokens != null && (!Number.isFinite(event.tokens) || event.tokens < 0)) return;
    if (event.status && !['queued', 'running', 'waiting_reply', 'waiting_permission', 'paused', 'done', 'failed', 'cancelled'].includes(event.status)) return;
    const located = await this.locateRun(event.runId);
    if (!located) {
      // A driver may emit before run() resolves; keep a bounded, per-run inbox.
      const list = this.early.get(event.runId) ?? [];
      if (list.length < 500 && this.early.size < 100) { list.push(event); this.early.set(event.runId, list); }
      return;
    }
    const earlier = this.early.get(event.runId);
    if (earlier?.length) {
      this.early.delete(event.runId);
      for (const buffered of earlier.sort((a, b) => a.sequence - b.sequence)) await this.receive(buffered);
      // Re-read the persisted cursor after replay, rather than comparing to a stale snapshot.
      return this.receive(event);
    }
    const { snapshot, session } = located, meta = session.runtime!;
    if (event.sessionId !== session.source?.sessionId || event.sequence <= meta.sequence || meta.eventIds.includes(event.id) || iso(session.lastActivity) && Date.parse(event.at) < Date.parse(session.lastActivity)) return;
    this.base.mutateRuntimeProject(snapshot.project.id, d => {
      const s = d.sessions[session.id], rt = s.runtime!;
      rt.sequence = event.sequence; rt.eventIds = [...rt.eventIds.slice(-999), event.id]; rt.disconnected = false;
      s.lastActivity = event.at;
      if (event.status) { s.status = sessionState(event.status); delete rt.controlPending; }
      if (event.status === 'running') { s.startedAt ??= event.at; delete s.endedAt; s.failure = undefined; }
      if (event.status && terminal.has(s.status)) s.endedAt = event.at;
      if (event.status === 'failed') s.failure = event.reason ?? event.error ?? 'Agent 执行失败';
      const requests = rt.requests ??= rt.request ? { [rt.request.id]: rt.request } : {};
      if (event.status && ['paused', 'done', 'cancelled', 'failed'].includes(event.status)) for (const id of Object.keys(requests)) delete requests[id];
      if (event.requestResolved) { delete requests[event.requestResolved]; if (rt.controlPending === 'reply') delete rt.controlPending; }
      if (event.step !== undefined) s.step = event.step;
      if (event.tokens !== undefined) {
        if (event.tokens != null) {
          const samples = rt.usageSamples ??= [], previous = samples.at(-1);
          const delta = previous ? event.tokens >= previous.tokens ? event.tokens - previous.tokens : null : dateInZone(Date.parse(rt.context.capturedAt), d.project.timeZone ?? 'Asia/Shanghai') === dateInZone(Date.parse(event.at), d.project.timeZone ?? 'Asia/Shanghai') ? event.tokens : null;
          samples.push({ at: event.at, tokens: event.tokens, delta });
        }
        s.tokens = event.tokens;
      }
      if (event.reply && !s.rounds.some(round => round.id === event.reply!.id)) s.rounds.push({ id: event.reply.id, at: event.at, reply: event.reply.text });
      if (event.request) {
        requests[event.request.id] = structuredClone(event.request);
      }
      rt.request = Object.values(requests).at(-1);
      const visibleRequest = Object.values(requests).filter(request => request.kind === 'permission').at(-1) ?? rt.request;
      s.waitingReason = visibleRequest?.prompt; s.waitingQuestion = visibleRequest?.prompt; s.waitingOptions = visibleRequest?.options;
      if (s.source) { if (rt.request) s.source.requestId = rt.request.id; else delete s.source.requestId; }
      const o = d.orchestrations?.[rt.workItemId ? rt.taskId : s.taskId ?? rt.taskId];
      if (o && rt.purpose === 'execution') {
        o.syncedAt = event.at;
        if (event.tokens != null) o.capabilities.tokens = true;
        if (event.step) o.capabilities.steps = true;
        if (event.request?.kind === 'permission') o.capabilities.permissionEvents = true;
        if (!rt.workItemId) { o.mainSessionId ??= s.id; o.mainAgentId ??= s.agentId; o.coordinationTokens = s.tokens; }
      }
      if (rt.attemptId && o) {
        const a = o.attempts[rt.attemptId], w = o.items[rt.workItemId!];
        if (a) {
          a.status = sourceState(s.status); a.tokens = s.tokens; a.step = s.step; a.rounds = structuredClone(s.rounds); a.source = s.source ? { ...s.source } : undefined;
          if (s.startedAt) a.startedAt = s.startedAt; a.endedAt = s.endedAt;
          // Late receipts from an older attempt never overwrite a retry's visible state.
          if (w?.attemptIds.at(-1) === a.id) {
            w.status = visibleRequest ? visibleRequest.kind === 'permission' ? 'waiting_permission' : 'waiting_reply' : a.status;
            w.waiting = visibleRequest ? { kind: visibleRequest.kind === 'permission' ? 'permission' : 'reply', question: visibleRequest.prompt, since: event.at } : undefined;
            if (a.status === 'done') w.completedAt = event.at;
          }
          o.syncedAt = event.at;
        }
      }
      if (rt.purpose === 'discussion' && rt.planId && event.reply) {
        const plan = d.ideaPlans?.[rt.planId];
        if (plan?.discussion && !plan.discussion.conclusions.some(c => c.sourceMessageId === event.reply!.id && c.sourceRef?.sessionId === event.sessionId)) {
          plan.discussion.conclusions.push({ id: `conclusion:${s.id}:${event.reply.id}`, agentId: s.agentId, scopeId: rt.scope ?? 'root', recordedAt: event.at, ...readAgentConclusion(event.reply.text), source: 'agent', sourceMessageId: event.reply.id, sourceRef: s.source ? structuredClone(s.source) : undefined });
          plan.discussion.syncStatus = 'synced'; plan.discussion.syncedAt = event.at;
        }
      }
      if (event.child && rt.purpose === 'execution') this.projectChild(d, s, event);
      const executionId = rt.attemptId ? `attempt:${rt.attemptId}` : `session:${s.id}`;
      reduceExecutionEvent(ensureTimeline(d), { id: `runtime:${event.runId}:${event.id}`, sequence: event.sequence, at: event.at, projectId: d.project.id, executionId, sessionId: s.id, agentId: s.agentId, taskId: s.taskId ?? undefined, workItemId: rt.workItemId, attemptId: rt.attemptId, status: sourceState(s.status), tokens: s.tokens });
      for (const interval of d.timeline!.intervals) if (interval.executionId === executionId && interval.end === null) interval.observedThrough = event.at;
      if (o) refreshBlocked(o);
      if (rt.purpose === 'execution' && s.taskId) settleRuntimeTask(d, s.taskId, event.at);
      usage(d);
    });
  }
  private projectChild(d: Snapshot, parent: Session, event: RuntimeEvent) {
    const child = event.child!, rt = parent.runtime!, taskId = parent.taskId ?? '';
    const key = `child:${rt.runId}:${child.id}`, parentKey = child.parentId ? `child:${rt.runId}:${child.parentId}` : rt.workItemId ?? taskId;
    if (key === parentKey) return;
    const source = { ...parent.source!, parentSessionId: parent.source!.sessionId, childSessionId: child.sessionId, childCallId: child.id };
    const executorId = `executor:${key}`, attemptId = `attempt:${key}`, businessSession = child.sessionId ? `${parent.id}:child:${child.sessionId}` : parent.id;
    const record = parent.subAgents.find(v => v.id === child.id);
    const updated = { id: child.id, parentId: child.parentId, title: child.title, status: child.status, start: child.start ?? (record?.status === 'queued' && child.status === 'running' ? event.at : record?.start) ?? event.at, end: child.end ?? (['paused', 'cancelled', 'done', 'failed'].includes(child.status) ? event.at : undefined), tokens: child.tokens ?? record?.tokens ?? null, sessionRef: businessSession, source };
    if (record) Object.assign(record, updated); else parent.subAgents.push(updated);
    if (!d.tasks[taskId]) return;
    const o = orchestration(d, taskId);
    o.executors[executorId] = { id: executorId, agentId: parent.agentId, label: child.title, parentExecutorId: child.parentId ? `executor:child:${rt.runId}:${child.parentId}` : o.mainExecutorId ?? `executor:${parent.agentId}` };
    if (!o.items[key]) {
      o.items[key] = { id: key, rootTaskId: taskId, parentTaskId: parentKey, title: child.title, phase: 'Agent 子任务', dependsOnTaskIds: [], owner: 'agent', executorId, status: child.status, attemptIds: [attemptId] };
      o.itemOrder.push(key);
    } else { o.items[key].status = child.status; o.items[key].title = child.title; }
    const previous = o.attempts[attemptId];
    o.attempts[attemptId] = { id: attemptId, workItemId: key, executorId, sessionId: businessSession, parentSessionId: parent.id, sourceLink: '', kind: 'initial', startedAt: updated.start, endedAt: updated.end, tokens: updated.tokens, status: child.status, rounds: previous?.rounds ?? [], source };
    if (child.reply && !o.attempts[attemptId].rounds.some(r => r.id === event.id)) o.attempts[attemptId].rounds.push({ id: event.id, at: event.at, reply: child.reply });
    if (child.status === 'done') o.items[key].completedAt = event.at; else delete o.items[key].completedAt;
    o.syncedAt = event.at; o.capabilities.subAgents = true;
    if (!rt.workItemId) { o.mainSessionId = parent.id; o.mainAgentId = parent.agentId; o.mainExecutorId = `executor:${parent.agentId}`; o.executors[o.mainExecutorId] ??= { id: o.mainExecutorId, agentId: parent.agentId, label: d.agents.find(a => a.id === parent.agentId)?.name ?? parent.agentId, parentExecutorId: null }; }
    reduceExecutionEvent(ensureTimeline(d), { id: `runtime-child:${event.runId}:${event.id}`, sequence: event.sequence, at: event.at, projectId: d.project.id, executionId: `attempt:${attemptId}`, sessionId: businessSession, agentId: parent.agentId, taskId, workItemId: key, attemptId, status: child.status, tokens: updated.tokens });
    for (const interval of d.timeline!.intervals) if (interval.executionId === `attempt:${attemptId}` && interval.end === null) interval.observedThrough = event.at;
  }
  async controlSession(sessionId: string, action: RuntimeAction, payload?: Record<string, unknown>): Promise<CommandResult> {
    const located = await this.locateSession(sessionId), s = located?.session, rt = s?.runtime;
    if (!located || !s || !rt?.runId) return { ok: false, message: '这条会话还没有可操作的源端执行标识' };
    const pendingRequests = rt.requests ?? (rt.request ? { [rt.request.id]: rt.request } : {});
    if (action === 'reply' && (payload?.requestId ? !pendingRequests[String(payload.requestId)] : Object.keys(pendingRequests).length > 0)) return { ok: false, message: '请求已变化，请刷新后处理当前请求' };
    if (action === 'archive' && s.status === 'running') return { ok: false, message: '请先停止执行再归档' };
    if (rt.controlPending) return { ok: false, message: '上一操作正在等待源端回执' };
    this.base.mutateRuntimeProject(located.snapshot.project.id, d => { d.sessions[sessionId].runtime!.controlPending = action; });
    try { await this.driver.control(rt.runId, action, payload); await this.flushRuntime(); return { ok: true, message: '操作已发送，状态由 Agent 回执更新' }; }
    catch (error) { this.base.mutateRuntimeProject(located.snapshot.project.id, d => { const r = d.sessions[sessionId].runtime!; delete r.controlPending; d.sessions[sessionId].failure = message(error); }); return { ok: false, message: message(error) }; }
  }
  async cancelDispatch(sessionId: string) { return this.controlSession(sessionId, 'cancel'); }
  async prepareSourceSession(sessionId: string): Promise<CommandResult & { runId?: string }> {
    const located = await this.locateSession(sessionId), session = located?.session;
    if (!located || !session?.source) return { ok: false, message: '这条记录没有准确的源会话标识' };
    if (session.runtime?.runId) return { ok: true, runId: session.runtime.runId };
    const connection = located.snapshot.runtimeConnections?.[session.agentId];
    if (!connection || connection.connectionId !== session.source.connectionId || !this.driver.adopt) return { ok: false, message: '请先恢复这个项目的原 Agent 连接' };
    const dispatchId = uuid('import'), capturedAt = new Date().toISOString();
    try {
      const receipt = await this.driver.adopt({ dispatchId, projectId: located.snapshot.project.id, taskId: session.taskId ?? '', agentId: session.agentId, connectionId: connection.connectionId, sourceSessionId: session.source.sessionId, prompt: '', purpose: 'execution' });
      if (receipt.sessionId !== session.source.sessionId || receipt.connectionId !== connection.connectionId) return { ok: false, message: '源端返回的会话身份不匹配' };
      this.base.mutateRuntimeProject(located.snapshot.project.id, d => {
        d.sessions[session.id].runtime = { dispatchId, runId: receipt.runId, acceptedAt: receipt.acceptedAt, projectId: d.project.id, taskId: session.taskId ?? '', connection: structuredClone(connection), purpose: 'execution', context: { taskTitle: session.title, prompt: '', capturedAt }, sequence: Math.max(-1, ...(receipt.events ?? []).map(event => event.sequence)), eventIds: (receipt.events ?? []).map(event => event.id).slice(-1000) };
        // Import only associates an existing source. It neither unarchives the task nor submits a prompt.
      });
      return { ok: true, runId: receipt.runId };
    } catch (error) { return { ok: false, message: message(error) }; }
  }
  async retryDispatch(sessionId: string): Promise<CommandResult> {
    const located = await this.locateSession(sessionId), s = located?.session, rt = s?.runtime;
    if (!located || !s || !rt) return { ok: false, message: '执行记录不存在' };
    if (s.dispatchPhase === 'unknown' || !['failed', 'cancelled'].includes(s.status)) return { ok: false, message: '请先核对原执行；只有已失败或已取消的执行可重试' };
    // Keep the original project's identity even after the user navigates elsewhere.
    const key = `retry:${located.snapshot.project.id}:${sessionId}`;
    if (this.pending.has(key)) return this.pending.get(key)!;
    const work = this.submit(located.snapshot, rt.workItemId ? rt.taskId : s.taskId ?? rt.taskId, s.agentId, rt.workItemId, rt.planId ? { planId: rt.planId, scope: rt.scope ?? 'root' } : undefined, s.id);
    this.pending.set(key, work);
    try { return await work; } finally { this.pending.delete(key); }
  }
  async reconcile(sessionId: string): Promise<CommandResult> {
    const located = await this.locateSession(sessionId), rt = located?.session.runtime;
    if (!rt) return { ok: false, message: '没有可核对的派发记录' };
    const runs = await this.driver.listRuns?.() ?? [];
    const receipt = runs.find(r => r.dispatchId === rt.dispatchId && r.connectionId === rt.connection.connectionId);
    if (!receipt || receipt.acceptance !== 'acknowledged') return { ok: false, message: '暂未找到源端受理凭据，保留当前记录，未重复派发' };
    await this.accept(sessionId, receipt);
    for (const event of receipt.events ?? []) await this.receive(event);
    return { ok: true, message: '已核对源端会话' };
  }
  async syncRuntime(): Promise<CommandResult> {
    if (this.recovering) return this.recovering;
    this.recovering = this.recover();
    try { return await this.recovering; } finally { this.recovering = null; }
  }
  private async recover(): Promise<CommandResult> {
    const runs = await this.driver.listRuns?.() ?? [], known = new Set(runs.map(run => run.runId));
    for (const snapshot of await this.base.listProjects()) for (const session of Object.values(snapshot.sessions)) {
      const rt = session.runtime;
      if (!rt || terminal.has(session.status)) continue;
      if (rt.runId && known.has(rt.runId)) {
        const restored = runs.find(run => run.runId === rt.runId)!;
        for (const event of restored.events ?? []) await this.receive(event);
        if (restored.status === 'paused' && session.status !== 'paused') this.base.mutateRuntimeProject(snapshot.project.id, d => {
          const s = d.sessions[session.id]; s.status = 'paused'; s.runtime!.disconnected = true; delete s.runtime!.controlPending;
          s.runtime!.requests = {}; delete s.runtime!.request; delete s.waitingReason; delete s.waitingQuestion; delete s.waitingOptions; if (s.source) delete s.source.requestId;
          for (const interval of ensureTimeline(d).intervals) if (interval.sessionId === s.id && interval.end === null) interval.end = interval.observedThrough ?? d.timeline!.asOf;
          if (rt.attemptId) { const o = d.orchestrations?.[rt.taskId]; if (o?.attempts[rt.attemptId]) { o.attempts[rt.attemptId].status = 'paused'; if (o.items[rt.workItemId!].attemptIds.at(-1) === rt.attemptId) o.items[rt.workItemId!].status = 'paused'; } }
        });
        continue;
      }
      const receipt = runs.find(run => run.dispatchId === rt.dispatchId);
      if (receipt?.acceptance === 'acknowledged') { await this.accept(session.id, receipt); continue; }
      if (!rt.runId || !session.source) continue; // Unknown acceptance must be reconciled, never blindly replayed.
      this.base.mutateRuntimeProject(snapshot.project.id, d => {
        const s = d.sessions[session.id]; s.runtime!.disconnected = true; s.runtime!.controlPending = undefined;
        s.status = 'paused'; s.runtime!.requests = {}; delete s.runtime!.request; delete s.waitingReason; delete s.waitingQuestion; delete s.waitingOptions; if (s.source) delete s.source.requestId;
        const timeline = ensureTimeline(d), executionId = rt.attemptId ? `attempt:${rt.attemptId}` : `session:${s.id}`;
        const open = timeline.intervals.find(i => i.executionId === executionId && i.end === null);
        if (open) open.end = open.observedThrough ?? timeline.asOf;
        if (rt.attemptId) { const o = d.orchestrations?.[rt.taskId], a = o?.attempts[rt.attemptId]; if (a) { a.status = 'paused'; if (o!.items[rt.workItemId!].attemptIds.at(-1) === a.id) o!.items[rt.workItemId!].status = 'paused'; } }
      });
      try { await this.driver.recover?.({ dispatchId: rt.dispatchId, projectId: snapshot.project.id, taskId: rt.taskId, workItemId: rt.workItemId, agentId: session.agentId, connectionId: rt.connection.connectionId, prompt: rt.context.prompt, purpose: rt.purpose, runId: rt.runId, sessionId: session.source.sessionId, sourceSessionId: session.source.sessionId, sequence: rt.sequence, status: sourceState(session.status), acceptedAt: rt.acceptedAt, tokens: session.tokens }); }
      catch (error) { this.base.mutateRuntimeProject(snapshot.project.id, d => { d.sessions[session.id].failure = `恢复会话失败：${message(error)}`; }); }
    }
    return { ok: true, message: '已恢复本地记录；中断的执行等待手动继续' };
  }
  async syncTrackedSources() {
    for (const project of await this.base.listProjects()) for (const agent of project.agents) if (agent.tracked && project.runtimeConnections?.[agent.id]) await this.scanAgent(agent.id, project.project.id);
  }
  async scanAgent(agentId: string, projectId?: string): Promise<CommandResult> {
    const snapshot = projectId ? (await this.base.listProjects()).find(project => project.project.id === projectId) : await this.base.load();
    if (!snapshot) return { ok: false, message: '项目不存在' };
    const key = `${snapshot.project.id}:${agentId}`;
    if (this.scanning.has(key)) return this.scanning.get(key)!;
    const pending = this.scanProjectAgent(snapshot, agentId); this.scanning.set(key, pending);
    try { return await pending; } finally { this.scanning.delete(key); }
  }
  private async scanProjectAgent(snapshot: Snapshot, agentId: string): Promise<CommandResult> {
    const agent = snapshot.agents.find(a => a.id === agentId), connection = snapshot.runtimeConnections?.[agentId];
    if (!agent || !connection || !agent.tracked) return { ok: false, message: '请连接并跟踪这个 Agent' };
    this.base.mutateRuntimeProject(snapshot.project.id, d => { d.agents.find(a => a.id === agentId)!.scan.state = 'scanning'; });
    try {
      const result = await this.driver.scan(connection.connectionId), sessions = Array.isArray(result) ? result : result.sessions;
      this.base.mutateRuntimeProject(snapshot.project.id, d => {
        const currentAgent = d.agents.find(a => a.id === agentId);
        if (!currentAgent || d.runtimeConnections?.[agentId]?.connectionId !== connection.connectionId) return;
        if (!currentAgent.tracked) { currentAgent.scan.state = 'idle'; return; }
        for (const observed of sessions) this.observe(d, agent, connection, observed);
        d.agents.find(a => a.id === agentId)!.scan = { state: 'idle', lastAt: new Date().toISOString(), note: Array.isArray(result) ? undefined : result.coverage };
        usage(d);
      });
      return { ok: true, message: `已同步 ${sessions.length} 条真实会话` };
    } catch (error) {
      this.base.mutateRuntimeProject(snapshot.project.id, d => { const currentAgent = d.agents.find(a => a.id === agentId); if (currentAgent && d.runtimeConnections?.[agentId]?.connectionId === connection.connectionId) currentAgent.scan = { state: currentAgent.tracked ? 'failed' : 'idle', lastAt: agent.scan.lastAt, note: message(error) }; });
      return { ok: false, message: message(error) };
    }
  }
  private observe(d: Snapshot, agent: Agent, connection: RuntimeConnectionBinding, observed: ObservedRuntimeSession) {
    if (!observed.sessionId || observed.connectionId !== connection.connectionId || !iso(observed.updatedAt)) return;
    // A user explicitly attached a connection to this project. Never move an existing dispatched run.
    let session = Object.values(d.sessions).find(s => s.source?.connectionId === connection.connectionId && s.source.sessionId === observed.sessionId);
    if (session?.runtime) return;
    if (!session) {
      const id = uuid('observed');
      session = d.sessions[id] = { id, agentId: agent.id, title: observed.title, origin: 'observed', taskId: null, status: observed.status ?? 'paused', startedAt: observed.startedAt && iso(observed.startedAt) ? observed.startedAt : null, lastActivity: observed.updatedAt, step: null, tokens: null, rounds: [], subAgents: [], source: { tool: connection.tool, connectionId: connection.connectionId, sessionId: observed.sessionId } };
      if (d.autoJournal) d.journal.blocks.unshift({ id: uuid('block'), kind: 'session', sessionId: id });
    }
    if (iso(session.lastActivity) && Date.parse(observed.updatedAt) < Date.parse(session.lastActivity)) return;
    session.lastActivity = observed.updatedAt; session.title = observed.title;
    if (observed.status) session.status = observed.status;
    if (observed.tokens != null && Number.isFinite(observed.tokens) && observed.tokens >= 0) session.tokens = observed.tokens;
    for (const reply of observed.replies ?? []) if (iso(reply.at) && !session.rounds.some(r => r.id === reply.id)) session.rounds.push({ id: reply.id, at: reply.at, reply: reply.text });
    if (session.status === 'archived') { session.endedAt = observed.updatedAt; if (session.taskId) settleRuntimeTask(d, session.taskId, observed.updatedAt); }
    // Discovery does not imply continuous historical running time; draw only observed state transitions.
    const timeline = ensureTimeline(d), executionId = `session:${session.id}`, previous = timeline.cursors[executionId];
    if (!previous || Date.parse(observed.updatedAt) > Date.parse(previous.at)) reduceExecutionEvent(timeline, { id: `scan:${session.id}:${observed.updatedAt}`, sequence: (previous?.sequence ?? 0) + 1, at: observed.updatedAt, projectId: d.project.id, executionId, sessionId: session.id, agentId: agent.id, taskId: session.taskId ?? undefined, status: sourceState(session.status), tokens: session.tokens });
    for (const interval of timeline.intervals) if (interval.executionId === executionId && interval.end === null) interval.observedThrough = observed.updatedAt;
  }
}

export function createRuntimeDataSource(base: LocalWorkdeckDataSource, driver: RuntimeDriver): RuntimeWorkdeckDataSource {
  const runtime = new RuntimeSource(base, driver);
  return new Proxy(runtime, {
    get(target, key, receiver) {
      if (Reflect.has(target, key)) { const value = Reflect.get(target, key, receiver); return typeof value === 'function' ? value.bind(target) : value; }
      const value = Reflect.get(base, key); return typeof value === 'function' ? value.bind(base) : value;
    },
  }) as unknown as RuntimeWorkdeckDataSource;
}
