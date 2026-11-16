import { createUsageAccounting, recordUsageReceipt } from './usageAccounting';
import type { LocalWorkdeckDataSource } from './repository';
import type { Snapshot } from './types';
import type { RuntimeDriver } from './runtimeContracts';
import { createAIProvider, type AIProvider, type SystemConnection } from './aiProvider';
import { firstSystemAgent } from './systemAgent';
import { beginIntelligenceJob, requestTaskTitleIn, finishTaskTitleJob, ensureIntelligence, failIntelligenceJob, finishIntakeJob, finishSummaryJob, intelligenceSourceSeq, requestSummaryIn, type IntelligenceResult } from './intelligence';

export function systemConnection(snapshot: Snapshot): SystemConnection {
  let configured: unknown;
  try { configured = JSON.parse(globalThis.localStorage?.getItem('quandeck.configured-agents.v1') ?? '[]'); } catch { throw new Error('SYSTEM_CONNECTION_MISSING：用户 Agent 配置无法读取，原文已保留'); }
  const agent = firstSystemAgent(snapshot, configured), first = Array.isArray(configured) ? configured[0] : undefined;
  if (!agent || !first || typeof first.connectionId !== 'string' || !first.connectionId || !['codex','claude','dsh','cursor','opencode'].includes(first.tool)) throw new Error('SYSTEM_CONNECTION_MISSING：请先连接用户 Agent 列表第一项；不会改用默认或第二项，原文已保留');
  // The trusted driver resolves this exact configured connection, then creates an isolated empty cwd.
  // It does not require or reuse the business project's workspace/session binding.
  return { agentId: agent.id, connectionId: first.connectionId, tool: first.tool };
}

export class IntelligenceRuntime {
  private provider: AIProvider;
  private stopped = false;
  private stopListening: () => void;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private seen = new Map<string, number>();
  private active = new Map<string, Promise<void>>();
  private queue: { projectId: string; jobId: string }[] = [];
  private scanning: Promise<void> | null = null;
  private rescan = false;
  private readonly ready: Promise<void>;
  constructor(private base: LocalWorkdeckDataSource, driver: RuntimeDriver, private debounceMs = 5000) {
    this.provider = createAIProvider(driver);
    this.stopListening = base.subscribe(() => { void this.scan().catch(() => {}); });
    this.ready = this.scan();
  }
  dispose() { this.stopped = true; this.stopListening(); for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.queue = []; }
  private async project(projectId: string) { return (await this.base.listProjects()).find(snapshot => snapshot.project.id === projectId); }
  private scan(): Promise<void> {
    if (this.scanning) { this.rescan = true; return this.scanning; }
    this.scanning = (async () => {
      do {
        this.rescan = false;
        for (const snapshot of await this.base.listProjects()) {
          if (this.stopped) return;
          // New-task and discussion entry points preserve the complete requirement.
          // Backfill display titles for those paths and existing data without a second
          // business run. Persistent jobs fence retries and manual names are never replaced.
          let canSummarize = false;
          try { systemConnection(snapshot); canSummarize = true; } catch { /* Connection UI retains the original text. */ }
          if (canSummarize) for (const task of Object.values(snapshot.tasks)) {
            if (task.id.startsWith('planning:') || Array.from(task.title).length <= 40 || task.originalTitle !== undefined || (task.titleRevision ?? 0) !== 0) continue;
            const jobs = Object.values(snapshot.intelligence?.jobs ?? {}).filter(job => job.kind === 'title' && (job.input as {taskId:string}).taskId === task.id);
            const queued = jobs.find(job => job.status === 'queued');
            if (queued) { this.enqueue(snapshot.project.id, queued.id); continue; }
            if (jobs.some(job => { const input = job.input as {title:string;titleRevision:number}; return input.title === task.title && input.titleRevision === (task.titleRevision ?? 0); })) continue;
            let receipt: IntelligenceResult | undefined;
            this.base.mutateRuntimeProject(snapshot.project.id, d => {
              const current = d.tasks[task.id];
              if (!current || current.title !== task.title || (current.titleRevision ?? 0) !== 0) return;
              receipt = requestTaskTitleIn(d, task.id);
            });
            if (receipt?.ok) this.enqueue(snapshot.project.id, receipt.jobId);
          }
          const projectId = snapshot.project.id, seq = intelligenceSourceSeq(snapshot), previous = this.seen.get(projectId);
          this.seen.set(projectId, seq);
          if (seq === previous || seq === 0) continue;
          const state = snapshot.intelligence?.summaryState;
          if (state?.blockedSourceSeq !== undefined && seq <= state.blockedSourceSeq || state?.status === 'ready' && state.sourceSeq === seq) continue;
          this.base.mutateRuntimeProject(projectId, d => { const summary = ensureIntelligence(d).summaryState; summary.dirty = true; if (summary.status === 'ready') summary.status = 'stale'; });
          this.schedule(projectId);
        }
      } while (this.rescan && !this.stopped);
    })().finally(() => { this.scanning = null; });
    return this.scanning;
  }
  private schedule(projectId: string) {
    if (this.stopped) return;
    const previous = this.timers.get(projectId); if (previous) clearTimeout(previous);
    const timer = setTimeout(() => { this.timers.delete(projectId); void this.requestSummary(projectId).catch(() => {}); }, this.debounceMs);
    // Desktop owns process lifetime; pending advisory work should not keep test/CLI processes alive.
    (timer as unknown as { unref?: () => void }).unref?.(); this.timers.set(projectId, timer);
  }
  private enqueue(projectId: string, jobId?: string) {
    if (!jobId || this.stopped || this.active.has(jobId) || this.queue.some(item => item.jobId === jobId)) return;
    this.queue.push({ projectId, jobId }); this.pump();
  }
  private pump() {
    while (!this.stopped && this.active.size < 2 && this.queue.length) {
      const item = this.queue.shift()!;
      const promise = this.run(item.projectId, item.jobId).finally(() => { this.active.delete(item.jobId); this.pump(); });
      this.active.set(item.jobId, promise);
    }
  }
  private async run(projectId: string, jobId: string) {
    let isSummary = false, attempted = false, provider = "unknown";
    let kind: "classify" | "summary" | "title" = "classify";
    const account = (d: Snapshot, meta: Record<string, unknown>, verified: boolean) => {
      if (!attempted || meta.acceptance === "rejected") return;
      const state = d.usageAccounting ??= createUsageAccounting(), id = `system:${jobId}`;
      if (state.receipts.some(receipt => receipt.id === id)) return;
      recordUsageReceipt(state, { id, projectId, runId: id, sequence: 0,
        at: typeof meta.finishedAt === "string" && Number.isFinite(Date.parse(meta.finishedAt)) ? meta.finishedAt : new Date().toISOString(),
        provider, purpose: kind, final: true,
        totalTokens: verified && typeof meta.actualTokens === "number" && Number.isSafeInteger(meta.actualTokens) && meta.actualTokens >= 0 ? meta.actualTokens : null,
      }, projectId);
    };
    try {
      const snapshot = await this.project(projectId), queued = snapshot?.intelligence?.jobs[jobId];
      if (!snapshot || queued?.status !== 'queued' || this.stopped) return;
      isSummary = queued.kind === 'summary'; kind = queued.kind;
      const connection = systemConnection(snapshot); provider = connection.tool;
      let admission!: IntelligenceResult;
      this.base.mutateRuntimeProject(projectId, d => { admission = beginIntelligenceJob(d, jobId, connection.agentId); });
      if (!admission.ok || !admission.job) throw new Error(admission.message ?? '后台系统请求未获受理');
      attempted = true;
      const output = queued.kind === 'title' ? await this.provider.summarizeTitle(admission.job, connection) : isSummary ? await this.provider.generateSummary(admission.job, connection) : await this.provider.classifyInput(admission.job, connection);
      if (this.stopped) return;
      let saved!: IntelligenceResult;
      this.base.mutateRuntimeProject(projectId, d => { saved = queued.kind === 'title' ? finishTaskTitleJob(d, jobId, output.result, output.meta) : isSummary ? finishSummaryJob(d, jobId, output.result, output.meta) : finishIntakeJob(d, jobId, output.result, output.meta); account(d, output.meta, true); });
      if (!saved.ok) throw Object.assign(new Error(saved.message ?? '系统结果未通过校验'), { systemMeta: output.meta });
      if (saved.stale || saved.jobId) this.schedule(projectId);
    } catch (error) {
      if (this.stopped) return;
      const details = error && typeof error === 'object' ? error as Record<string,unknown> : {};
      const meta = details.systemMeta && typeof details.systemMeta === 'object' ? details.systemMeta as Record<string,unknown> : Object.fromEntries(['requestId','actualTokens','sourceSessionId','acceptance','modelAcknowledged','modelRetried','retryGraceUsed','modelProgressed','lastModelProgressAt'].filter(key => details[key] !== undefined).map(key => [key,details[key]]));
      try { this.base.mutateRuntimeProject(projectId, d => { failIntelligenceJob(d, jobId, error instanceof Error ? error.message : String(error), meta);
        account(d, meta, meta.requestId === jobId && meta.projectId === projectId && typeof meta.sourceSessionId === "string"); }); } catch { /* Persistence failure is surfaced by the repository; never claim saved. */ }
    } finally {
      if (isSummary && !this.stopped) {
        const snapshot = await this.project(projectId);
        const state = snapshot?.intelligence?.summaryState;
        if (snapshot && state?.dirty && state.status !== 'failed' && intelligenceSourceSeq(snapshot) > (state.blockedSourceSeq ?? -1)) this.schedule(projectId);
      }
    }
  }
  async submitIntake(text: string, projectId?: string) {
    const selected = projectId ? Promise.resolve(projectId) : this.base.load().then(snapshot => snapshot.project.id);
    await this.ready; const target = await selected;
    const receipt = await this.base.submitIntake(text, target);
    if (receipt.ok) this.enqueue(target, receipt.jobId);
    return receipt;
  }
  async summarizeTaskTitle(taskId: string, projectId?: string) {
    const selected = projectId ? Promise.resolve(projectId) : this.base.load().then(snapshot => snapshot.project.id);
    await this.ready; const target = await selected;
    let receipt!: IntelligenceResult;
    this.base.mutateRuntimeProject(target, d => { receipt = requestTaskTitleIn(d, taskId); });
    if (receipt.ok) this.enqueue(target, receipt.jobId);
    return receipt;
  }
  async retryIntake(inputId: string, projectId?: string) {
    const selected = projectId ? Promise.resolve(projectId) : this.base.load().then(snapshot => snapshot.project.id);
    await this.ready; const target = await selected;
    const receipt = await this.base.retryIntake(inputId, target); if (receipt.ok) this.enqueue(target, receipt.jobId); return receipt;
  }
  async refreshProjectSummary(projectId?: string) { const selected = projectId ? Promise.resolve(projectId) : this.base.load().then(snapshot => snapshot.project.id); await this.ready; return this.requestSummary(await selected); }
  private async requestSummary(projectId: string) {
    // An immediate refresh consumes the pending debounce for this project.
    // Otherwise its old timer can issue a second costly request after a failure.
    clearTimeout(this.timers.get(projectId)); this.timers.delete(projectId);
    let receipt!: IntelligenceResult;
    this.base.mutateRuntimeProject(projectId, d => { receipt = requestSummaryIn(d); });
    if (receipt.ok) this.enqueue(projectId, receipt.jobId);
    return receipt;
  }
  async resolveSuggestion(id: string, decision: 'accepted'|'rejected', projectId?: string) {
    return this.base.resolveSuggestion(id, decision, projectId);
  }
  /** Tests and shutdown can await admitted requests without forcing scheduled model calls. */
  async flush() { await this.ready; await this.scanning; while (this.active.size || this.queue.length) { this.pump(); await Promise.all([...this.active.values()]); } }
}
