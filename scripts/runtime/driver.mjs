import { approvalChoices, chooseApproval, publicApprovalChoices } from './approval-options.mjs';
import { discussionTurnMessage } from './discussion-style.mjs';
/** Real newline JSON-RPC runtimes. No task progress is inferred from elapsed time. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { scanDshSessions, scanCodexSessions } from './discovery.mjs';
import { createClaudeRuntime, scanClaudeSessions } from './claude.mjs';
import { createSystemAssistant } from './system-assistance.mjs';
import { probeDshVersion } from './dshVersion.mjs';
import { classifyIncident, incidentMetadata, redactDiagnostic } from './health.mjs';
import { resolveDshDefaults } from './dshDefaults.mjs';
import { readDshModelConfig } from './dsh-model-source.mjs';

const permissionRequest = request => request.method === 'approval/request' || /requestApproval$/.test(request.method);
const pendingRequestStatus = run => [...run.requests.values()].some(permissionRequest) ? 'waiting_permission' : run.requests.size ? 'waiting_reply' : undefined;
const canResolveRequest = run => !run.stopping && run.rpc && !run.rpc.closed && !run.turnEnded && ['running', 'waiting_permission', 'waiting_reply'].includes(run.status);
const textBlocks = blocks => Array.isArray(blocks) ? blocks.filter(b => b.type === 'text').map(b => b.text || '').join('') : '';
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const dispatchIdentity = input => canonical(Object.fromEntries(['dispatchId','connectionId','projectId','taskId','workItemId','agentId','prompt','purpose','sourceSessionId','collaboration'].filter(key => input[key] !== undefined).map(key => [key,input[key]])));
const taskIdentity = input => canonical([input.projectId ?? '', input.taskId ?? '', input.workItemId ?? '']);
const ownershipError = message => Object.assign(new Error(message), { rejected: true });
const RC2_RESTART_REASON = '此 DSH 版本不能恢复已关闭的会话。记录已保留，请新建执行或在 DSH 原界面继续。';
const reportedTokens = usage => {
  if (!usage || typeof usage !== 'object') return null;
  const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (valid(usage.totalTokens)) return usage.totalTokens;
  const input = usage.inputTokens ?? usage.input, output = usage.outputTokens ?? usage.output;
  if (!valid(input) || !valid(output)) return null;
  const cacheRead = usage.cacheReadTokens ?? 0, cacheWrite = usage.cacheWriteTokens ?? 0;
  return valid(cacheRead) && valid(cacheWrite) ? input + output + cacheRead + cacheWrite : null;
};
const runtimeControls = run => {
  const terminal = ['done', 'cancelled'].includes(run.status);
  const live = run.rpc && !run.rpc.closed && !run.stopping;
  const legacy = (run.protocol ?? run.connection.protocol) === 'legacy-rc2';
  if (legacy) return { canResume: false, canReply: !!live && !terminal && !['running', 'queued'].includes(run.status), ...(!live && !terminal ? { reason: RC2_RESTART_REASON } : {}) };
  return { canResume: !terminal && !['running', 'queued'].includes(run.status), canReply: !terminal };
};
const operationDetails = (value, cwd) => {
  const source = value && typeof value === 'object' ? value : {};
  return [...(cwd ? [`目录：${cwd}`] : []), ...['command', 'cmd', 'file_path', 'path', 'cwd', 'blockedPath', 'scope', 'grantRoot'].filter(key => source[key] != null).map(key => `${key}: ${Array.isArray(source[key]) ? source[key].join(' ') : String(source[key])}`)].join('\n').replace(/(?:(?<![\w-])sk-[\w-]{12,}|Bearer\s+\S+)/gi, '[redacted]').replace(/((?:API[_-]?KEY|TOKEN|PASSWORD|SECRET)\s*[=:]\s*)[^\s]+/gi, '$1[redacted]').slice(0, 8000);
};
const safeError = redactDiagnostic;
export function createRpcProcess(invocation, { cwd, spawnProcess = spawn, onNotification = () => {}, onRequest = () => {}, onExit = () => {} } = {}) {
  const child = spawnProcess(invocation.binary, invocation.args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...invocation.env } });
  const pending = new Map(); const decoder = new StringDecoder('utf8'); let buffer = '', sequence = 0, closed = false, exited = false, closing;
  const exit = new Promise(resolve => { const done = () => { exited = true; resolve(); }; child.once('exit', done); child.once('close', done); });
  const waitExit = async ms => { let timer; try { await Promise.race([exit, new Promise(resolve => { timer = setTimeout(resolve, ms); })]); } finally { clearTimeout(timer); } };
  const write = value => { if (closed || child.stdin.destroyed) throw new Error('源端连接已关闭'); child.stdin.write(JSON.stringify(value) + '\n'); };
  const fail = error => { if (closed) return; closed = true; for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } pending.clear(); onExit(error); };
  child.on('error', error => fail(new Error(`无法启动命令行工具：${safeError(error)}`)));
  child.on('exit', code => fail(new Error(`源端进程已退出（${code ?? 'signal'}）`)));
  child.stdin.on('error', error => fail(error)); child.stderr.on('data', () => {});
  child.stdout.on('data', chunk => {
    buffer += decoder.write(chunk);
    if (buffer.length > 8 * 1024 * 1024) { fail(new Error('源端协议帧超过 8 MB')); child.kill(); return; }
    let at;
    while ((at = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (message.method) {
        if (message.id !== undefined) onRequest(message);
        else onNotification(message.method, message.params ?? {});
      } else {
        const waiter = pending.get(message.id); if (!waiter) continue;
        pending.delete(message.id); clearTimeout(waiter.timer);
        if (message.error) waiter.reject(Object.assign(new Error(safeError(message.error)), incidentMetadata(message.error))); else waiter.resolve(message.result);
      }
    }
  });
  return {
    child, get closed() { return closed; },
    call(method, params = {}, timeout = 30000) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = timeout ? setTimeout(() => { pending.delete(id); reject(new Error(`源端 ${method} 超时，受理结果未知`)); }, timeout) : null;
        pending.set(id, { resolve, reject, timer });
        try { write({ jsonrpc: '2.0', id, method, params }); } catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    },
    notify(method, params) { write({ jsonrpc: '2.0', method, params }); },
    reply(id, result) { write({ jsonrpc: '2.0', id, result }); },
    reject(id, message = '此请求未获用户处理') { write({ jsonrpc: '2.0', id, error: { code: -32601, message } }); },
    async close(method) {
      if (closing) return closing;
      closing = (async () => {
        if (exited) return;
        if (!closed && method) { try { await this.call(method, {}, 5000); } catch {} }
        if (!child.stdin.destroyed) child.stdin.end();
        // rc.2 acknowledges shutdown before asynchronously flushing its session store.
        await waitExit(1500);
        if (!exited) { child.kill(); await waitExit(1000); }
        if (!exited) { child.kill('SIGKILL'); await waitExit(1000); }
        if (!exited) throw new Error('源端进程尚未退出，请核对执行状态');
      })();
      return closing;
    },
  };
}

/** Supports JS CLI entries explicitly, including paths containing spaces; never a shell command string. */
export async function runtimeInvocation(connection, args, commandInvocation) {
  if (/\.[cm]?js$/i.test(connection.binary)) return { binary: connection.nodePath || process.execPath, args: [connection.binary, ...args], env: connection.nodePath ? {} : { ELECTRON_RUN_AS_NODE: '1' } };
  return commandInvocation ? commandInvocation(connection.binary, args, process.platform, { nodePath: connection.nodePath }) : { binary: connection.binary, args };
}

export async function initializeRuntime(connection, options = {}) {
  if (connection.tool === 'claude') {
    if (/\.(cmd|bat)$/i.test(connection.binary)) {
      const invocation = await runtimeInvocation(connection, [], options.commandInvocation);
      if (!invocation.args?.length || !/\.[cm]?js$/i.test(invocation.args[0])) throw new Error('请使用 Claude 原生可执行文件，或已验证的 npm CLI.js 与 Node 路径');
      return createClaudeRuntime({ ...connection, binary: invocation.args[0], nodePath: invocation.binary }, options);
    }
    return createClaudeRuntime(connection, options);
  }
  if (!['dsh', 'codex', 'hermes'].includes(connection.tool)) throw new Error('此工具未提供已适配的执行协议');
  let dshVersion, dshDefaults, modelConfig;
  const modelPatches = async () => {
    modelConfig = connection.dshModelConfig ? await readDshModelConfig(connection.dshModelConfig, { storageDir: options.modelConfigDirectory }) : undefined;
    return modelConfig ? ['--patch', modelConfig.path] : [];
  };
  if (connection.tool === 'dsh') {
    // A persisted private snapshot must validate before even the version/config probe starts.
    await modelPatches();
    // Revalidate persisted connections at every process start; stale 0.5.1 receipts cannot bypass the gate.
    dshVersion = await probeDshVersion(await runtimeInvocation(connection, ['--version'], options.commandInvocation), { cwd: connection.projectPath });
    if (dshVersion.blocked) throw new Error(dshVersion.note);
    if (options.resuming && dshVersion.protocol === 'legacy-rc2') throw Object.assign(new Error(RC2_RESTART_REASON), { protocol: dshVersion.protocol });
    const patches = await modelPatches();
    dshDefaults = options.dshDefaults ?? await resolveDshDefaults(modelConfig ? { ...connection, provider: undefined, model: undefined } : connection, await runtimeInvocation(connection, ['sdk', ...patches, '--dump-config'], options.commandInvocation), { execute: options.execute });
    if (modelConfig && ['provider', 'model', 'reasoningEffort'].some(key => dshDefaults[key] !== modelConfig[key])) throw new Error('DSH 模型快照未在 SDK 配置中生效，请重新选择模型来源并测试连接');
  }
  const overrides = connection.tool === 'codex' ? Object.entries(options.configOverrides ?? {}).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]) : [];
  const invocation = await runtimeInvocation(connection, connection.tool === 'hermes' ? ['acp'] : connection.tool === 'dsh' ? ['sdk', ...await modelPatches(), ...(options.dshPatch ? ['--patch', options.dshPatch] : [])] : [...overrides, 'app-server', '--stdio'], options.commandInvocation);
  const rpc = createRpcProcess(invocation, { ...options, cwd: connection.projectPath });
  options.onClient?.(rpc);
  try {
    if (connection.tool === 'dsh') {
      rpc.protocol = dshVersion.protocol; rpc.cliVersion = dshVersion.cliVersion;
      const result = await rpc.call('initialize', { cwd: connection.projectPath, ...dshDefaults, ...(rpc.protocol === 'legacy-rc2' ? {} : { approvalRequests: true, capabilities: { userQuestions: true } }) });
      if (result?.serverInfo?.name !== 'deepseek-harness-sdk-runtime') throw new Error('CLI 返回的不是 DeepSeek Harness SDK 协议');
      rpc.sourceModel = { provider: dshDefaults.provider, model: dshDefaults.model };
    } else if (connection.tool === 'hermes') {
      const result = await rpc.call('initialize', { protocolVersion: 1, clientInfo: { name: 'quandeck', title: 'QuanDeck', version: '0.7.3' }, clientCapabilities: {} });
      if (result?.protocolVersion !== 1 || result.agentInfo?.name !== 'hermes-agent') throw new Error('CLI 未返回受支持的 Hermes ACP 协议');
      rpc.protocol = 'hermes-acp';
      rpc.canLoadSession = result.agentCapabilities?.loadSession === true;
    } else {
      await rpc.call('initialize', { clientInfo: { name: 'quandeck', title: 'QuanDeck', version: '0.7.3' }, capabilities: { experimentalApi: true } });
      rpc.notify('initialized', {});
    }
    return rpc;
  } catch (error) { await rpc.close(); throw error; }
}

export function createRuntimeDriver({ getConnection, commandInvocation, spawnProcess, onEvent, initialRuns = [], saveRuns, onPersistenceError, initialBlockedProjectIds = [], systemSdk, modelConfigDirectory, beforeStart, fallbackConnections = () => [], now = () => Date.now(), stallAfterMs = 180000, monitorEveryMs = 15000 } = {}) {
  const runs = new Map(), listeners = new Set(), dispatches = new Map(), admissions = new Map(), blockedProjects = new Set(initialBlockedProjectIds), transitions = new Set();
  const assertProjectOpen = projectId => { if (blockedProjects.has(projectId)) throw Object.assign(new Error("项目正在删除，未启动新的执行"), {rejected:true}); };
  // A source conversation belongs to exactly one managed run. Handoffs carry
  // frozen public records into a new source; they never transfer source ownership.
  const sourceOwner = (connection, sessionId, exceptRunId) => [...runs.values()].find(run => run.runId !== exceptRunId && run.connection.tool === connection.tool && run.connection.connectionId === connection.connectionId && run.sessionId === sessionId);
  const assertSourceOwner = (run, sessionId = run.sessionId) => {
    if (sourceOwner(run.connection, sessionId, run.runId)) throw ownershipError('SOURCE_SESSION_OWNED：源会话已属于另一条执行记录；新执行必须新建对话');
  };
  const system = createSystemAssistant({ getConnection, commandInvocation, spawnProcess, initializeRuntime, runtimeInvocation, sdk: systemSdk, modelConfigDirectory });
  for(const id of blockedProjects)system.blockProject(id);
  const snapshot = run => ({ ...run.input, runId: run.runId, sessionId: run.sessionId, connectionId: run.connection.connectionId, projectPath: run.connection.projectPath, protocol: run.protocol ?? run.connection.protocol, controls: runtimeControls(run), status: run.status, acceptedAt: run.acceptedAt, acceptance: run.acceptance, tool: run.connection.tool, provider: run.connection.provider, model: run.connection.model, sequence: run.sequence, events: run.events, tokens: run.tokens, lastReply: run.lastReply, health: run.health, fallback: run.fallback, originalConnectionId: run.input.originalConnectionId, stoppedConfirmed: !!run.stoppedConfirmed });
  let persistenceError = null, persistenceWrite = Promise.resolve();
  const failedPersistence = error => {
    if (persistenceError) return;
    persistenceError = safeError(error);
    try { onPersistenceError?.(error); } catch {}
    for (const run of runs.values()) {
      if (['done', 'cancelled', 'failed', 'paused'].includes(run.status)) continue;
      run.stopping = true;
      for (const id of run.requests.keys()) emit(run, { requestResolved: id });
      run.requests.clear();
      void run.rpc?.close(run.connection.tool === 'dsh' ? 'shutdown' : undefined).catch(() => {});
      emit(run, { status: 'paused', error: '本地记录保存失败，已停止源执行；请释放磁盘空间后重试保存' });
    }
  };
  const persist = () => {
    if (persistenceError) return;
    try { const result = saveRuns?.([...runs.values()].map(snapshot)); if (result?.then) persistenceWrite = Promise.resolve(result).catch(failedPersistence); }
    catch (error) { failedPersistence(error); }
  };
  const emit = (run, fields, activity = true) => {
    if (runs.get(run.runId) !== run) return; // Removed runs cannot recreate persisted copies.
    // Source activity must not hide another outstanding permission or question.
    if (fields.status === 'running' && run.requests.size) fields = { ...fields, status: pendingRequestStatus(run) };
    run.health ||= { lastActivityAt: new Date(now()).toISOString() };
    if (activity) {
      const progress = (fields.message && fields.message.role !== 'user') || fields.reply || typeof fields.tokens === 'number' && (run.tokens == null || fields.tokens > run.tokens) || fields.step || fields.child || fields.log || fields.request || fields.turnCompleted === true;
      if (progress || fields.message?.role === 'user' && run.health.incident?.status !== 'open') run.health.lastActivityAt = new Date(now()).toISOString();
      if (progress && run.health.incident?.status === 'open' && (run.health.incident.kind === 'attention' || (run.acceptance === 'acknowledged' && run.rpc && !run.rpc.closed))) {
        run.health.incident = { ...run.health.incident, status: 'resolved', resolvedAt: new Date(now()).toISOString(), resolvedReason: 'activity_resumed' };
        fields = { ...fields, incident: run.health.incident };
      }
    }
    if (fields.error) {
      const issue = classifyIncident(fields.error, fields.incidentCode);
      const previous = run.health.incident;
      const incident = previous?.status === 'open' && (previous.code === issue.code || (issue.code === 'process' && previous.kind === 'failure')) ? previous : { ...issue, id: randomUUID(), detectedAt: new Date(now()).toISOString(), status: 'open', kind: 'failure' };
      run.health.incident = incident;
      fields = { ...fields, error: issue.message, diagnostic: safeError(fields.error), incident };
    }
    if (fields.status) run.status = fields.status;
    // A provider payload cannot choose the trusted connection/run identity or cursor.
    const event = { ...fields, id: randomUUID(), sequence: ++run.sequence, at: new Date().toISOString(), runId: run.runId, sessionId: run.sessionId, stoppedConfirmed: run.stoppedConfirmed === true };
    run.events.push(event); if (run.events.length > 5000) run.events.shift();
    if (fields.reply) run.lastReply = fields.reply.text;
    if (typeof fields.tokens === 'number') run.tokens = fields.tokens;
    persist(); onEvent?.(event); for (const listener of listeners) listener(event);
    return event;
  };
  const resolveRequest = (run, id) => {
    if (!run.requests.delete(id)) return;
    emit(run, { requestResolved: id, ...(canResolveRequest(run) ? { status: pendingRequestStatus(run) || 'running' } : {}) });
  };
  const stopProcess = async run => { const hadLiveProcess = !!run.rpc; run.stopping = true; for (const [id, request] of run.requests) { try { run.rpc?.reject(request.wireId, '用户停止了执行'); } catch {} run.requests.delete(id); emit(run, { requestResolved: id }); } await run.rpc?.close(run.connection.tool === 'dsh' ? 'shutdown' : undefined); run.rpc = null; run.stoppedConfirmed = !run.input.adopted && (!run.recovered || run.stoppedConfirmed === true || hadLiveProcess); };
  const notification = (run, method, params) => {
    if (run.stopping) return;
    const target = params.threadId || params.sessionId;
    // Retry/error/heartbeat notifications show transport activity, not recovered model progress.
    if (target && (target === run.sessionId || run.knownSessions.has(target)) && ['item/agentMessage/delta','item/reasoning/summaryTextDelta','item/reasoning/textDelta'].includes(method) && typeof params.delta === 'string' && params.delta.length) {
      run.health ||= {};
      run.health.lastActivityAt = new Date(now()).toISOString();
    }
    if (run.connection.tool === 'hermes') {
      if (method !== 'session/update' || target !== run.sessionId || !run.hermesTurn) return;
      const update = params.update;
      if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
        const text = update.content.text;
        if (typeof text !== 'string') return;
        // Hermes can replay its full answer as the final chunk after streaming.
        if (text !== run.hermesTurn.text) run.hermesTurn.text += text;
        run.hermesTurn.acknowledge();
      }
      if (update?.sessionUpdate === 'plan' && Array.isArray(update.entries)) {
        emit(run, { step: { total: update.entries.length, completed: update.entries.filter(entry => entry.status === 'completed').length, label: update.entries.find(entry => entry.status === 'in_progress')?.content || '执行计划' } });
        run.hermesTurn.acknowledge();
      }
      return;
    }
    if (method === 'quandeck/event') { emit(run, params.event); return; }
    if (run.connection.tool === 'dsh') {
      if (method === 'session.status' && params.sessionId === run.sessionId && params.status === 'running') emit(run, { status: 'running' });
      if (method === 'session.event') {
        const event = params.event, data = event?.data ?? {};
        if (!event?.type || !run.knownSessions.has(params.sessionId)) return;
        const isRoot = params.sessionId === run.sessionId;
        if (event.type === 'assistant/message') {
          const text = textBlocks(data.message?.content);
          if (!isRoot && text) emit(run, { targetSessionId: params.sessionId, message: { id: String(event.id ?? event.seq ?? randomUUID()), role: 'assistant', text } });
          if (isRoot && text) { run.pendingReply = { id: String(event.id ?? event.seq ?? randomUUID()), text }; emit(run, { message: run.pendingReply }); }
          const usage = data.usage;
          if (usage && !isRoot) { const total = reportedTokens(usage); if (total !== null) { const childTokens = (run.childUsage.get(params.sessionId) || 0) + total; run.childUsage.set(params.sessionId, childTokens); emit(run, { targetSessionId: params.sessionId, childTokens }); } }
          // SDK TokenUsage: inputTokens/outputTokens/totalTokens. No estimated counters.
          if (usage && isRoot) {
            const total = reportedTokens(usage);
            if (total !== null) { run.usage += total; emit(run, { tokens: run.usage }); }
          }
        }
        if (event.type === 'tool/call' && data.callId) { run.toolCalls ||= new Map(); let args; try { args = JSON.parse(data.arguments); } catch {} run.toolCalls.set(data.callId, args); }
        if (isRoot && event.type === 'tool/call') emit(run, { status: 'running', step: { label: String(data.name || '执行工具') } });
        if (event.type === 'tool/result') emit(run, { targetSessionId: params.sessionId, log: { kind: 'tool', label: data.message?.isError ? '工具执行失败' : '工具执行完成', detail: String(data.error?.reason || textBlocks(data.message?.content) || '').slice(0, 8000) } });
        if (run.protocol === 'legacy-rc2' && event.type === 'approval/asked') emit(run, { targetSessionId: params.sessionId, log: { kind: 'tool', label: '源端请求权限', detail: `${data.toolName || '工具'}：${data.reason || '此 SDK 未提供外部权限回执通道'}` } });
        if (run.protocol === 'legacy-rc2' && event.type === 'approval/decided') {
          const outcome = ({ 'allowed-once': '源端已允许本次操作', rejected: '源端已拒绝操作', cancelled: '源端已取消操作', unavailable: '源端权限请求无人处理，操作未获允许' })[data.outcome] || '源端权限结果未知';
          emit(run, { targetSessionId: params.sessionId, ...(['unavailable', 'rejected', 'cancelled'].includes(data.outcome) ? { notice: outcome } : {}), log: { kind: 'tool', label: outcome, detail: '当前 DSH SDK 不支持 QuanDeck 回传权限决定。' } });
        }
        if (isRoot && event.type === 'step/start') emit(run, { status: 'running', step: { label: `模型步骤 ${data.step ?? ''}`.trim() } });
        if (isRoot && event.type === 'turn/end') {
          run.turnEnded = true;
          const kind = data.reason?.kind;
          if (run.pendingReply) { emit(run, { reply: run.pendingReply }); run.pendingReply = null; }
          if (kind === 'error' || kind === 'failed') emit(run, { status: 'failed', error: data.reason?.error ? safeError(data.reason.error) : '源端报告本轮执行失败' });
          else if (kind === 'completed') emit(run, { status: 'waiting_reply', turnCompleted: true });
          else emit(run, { status: 'paused', notice: ({ aborted: '本轮已中止', interrupted: '本轮已被中断', blocked: '本轮被源端阻止', 'max-tokens': '本轮达到源端 Token 限制', forked: '这是分支会话的结束标记' })[kind] || '源端结束了本轮，完成原因未确认' });
        }
      }
      if ((method === 'subagent.started' || method === 'subagent.finished') && params.childSessionId && run.knownSessions.has(params.parentSessionId)) {
        run.knownSessions.add(params.childSessionId);
        const reason = typeof params.stopReason === 'string' ? params.stopReason : params.stopReason?.kind;
        const status = method.endsWith('started') ? 'running' : params.status !== 'ok' || reason === 'error' ? 'failed' : run.protocol === 'legacy-rc2' && reason !== 'completed' ? 'paused' : 'done';
        emit(run, { child: { id: params.childSessionId, parentId: params.parentSessionId === run.sessionId ? undefined : params.parentSessionId, sessionId: params.childSessionId, title: `子任务 ${String(params.childSessionId).slice(-8)}`, status, ...(method.endsWith('started') ? { start: new Date().toISOString() } : { end: new Date().toISOString() }), ...(textBlocks(params.lastAssistantMessage) ? { reply: textBlocks(params.lastAssistantMessage) } : {}) } });
      }
      if (method === 'user-question.cancelled') resolveRequest(run, String(params.requestId));
      return;
    }
    if (params.threadId && params.threadId !== run.sessionId) return;
    if (method === 'turn/started') { run.turnEnded = false; run.turnId = params.turn?.id; emit(run, { status: 'running' }); }
    if (method === 'turn/completed') { run.turnEnded = true; if (run.pendingReply) { emit(run, { reply: run.pendingReply }); run.pendingReply = null; } emit(run, { status: params.turn?.status === 'failed' ? 'failed' : params.turn?.status === 'interrupted' ? 'paused' : 'waiting_reply', ...(params.turn?.status === 'completed' && !params.turn?.error ? { turnCompleted: true } : {}), ...(params.turn?.error ? { error: safeError(params.turn.error) } : {}) }); }
    if (method === 'item/completed' && params.item?.type === 'agentMessage') { run.pendingReply = { id: params.item.id, text: params.item.text || '' }; emit(run, { message: run.pendingReply }); }
    if (method === 'item/started' && ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall'].includes(params.item?.type)) emit(run, { status: 'running', step: { label: params.item.command || params.item.tool || ({ fileChange: '更新文件', collabAgentToolCall: '协调子任务' })[params.item.type] || '执行工具' } });
    if (method === 'item/completed' && params.item?.type === 'commandExecution') emit(run, { log: { kind: 'command', label: params.item.command || '运行命令', detail: String(params.item.aggregatedOutput || '').slice(0, 8000), ...(typeof params.item.exitCode === 'number' ? { exitCode: params.item.exitCode } : {}) } });
    if (method === 'item/completed' && params.item?.type === 'fileChange') emit(run, { log: { kind: 'file', label: '文件变更', detail: (params.item.changes || []).map(change => change.path).filter(Boolean).join('\n').slice(0, 8000) } });
    if (method === 'item/completed' && ['mcpToolCall', 'dynamicToolCall'].includes(params.item?.type)) emit(run, { log: { kind: 'tool', label: params.item.tool || '工具调用', detail: params.item.status || (params.item.success === false ? '失败' : '已返回') } });
    if (method === 'turn/plan/updated' && Array.isArray(params.plan)) emit(run, { step: { total: params.plan.length, completed: params.plan.filter(s => s.status === 'completed').length, label: params.plan.find(s => s.status === 'inProgress')?.step || params.explanation || '执行计划' } });
    if (method === 'thread/tokenUsage/updated' && typeof params.tokenUsage?.total?.totalTokens === 'number') emit(run, { tokens: params.tokenUsage.total.totalTokens });
    if (method === 'error') {
      if (params.willRetry) {
        const issue = classifyIncident(params.error);
        run.retryIssueCodes ??= new Set();
        if (run.retryIssueCodes.has(issue.code)) return;
        run.retryIssueCodes.add(issue.code);
        const incident = { ...issue, id: randomUUID(), detectedAt: new Date(now()).toISOString(), status: 'open', kind: 'attention' };
        run.health ||= {};
        run.health.incident = incident;
        const notice = issue.code === 'network' ? '模型连接暂时中断，Codex 正在重试。' : `${issue.title}，Codex 正在重试。`;
        emit(run, { incident, notice }, false);
      } else emit(run, { status: 'failed', error: safeError(params.error) });
    }
    // Tool calls report true receiver thread IDs when the installed Codex provides collab events.
    if (method === 'item/completed' && params.item?.type === 'collabAgentToolCall') {
      const item = params.item;
      const states = { pendingInit: 'queued', running: 'running', interrupted: 'paused', completed: 'done', errored: 'failed', shutdown: 'cancelled', notFound: 'failed' };
      for (const [id, state] of Object.entries(item.agentsStates || {})) emit(run, { child: { id, sessionId: id, title: item.prompt || `子任务 ${id.slice(-8)}`, status: states[state.status] || 'paused', reply: state.message } });
    }
  };
  const serverRequest = (run, message) => {
    if (run.connection.tool === 'hermes') {
      if (message.method === 'session/request_permission') run.rpc?.reply(message.id, { outcome: { outcome: 'cancelled' } });
      else run.rpc?.reject(message.id, 'QuanDeck 未开放该客户端能力');
      return;
    }
    if (run.protocol === 'legacy-rc2') { run.rpc?.reject(message.id, '此 DSH 版本未提供已适配的外部交互协议'); emit(run, { log: { kind: 'tool', label: '源端交互未接入', detail: '未发送权限批准或结构化问题回答。' } }); return; }
    if (run.stopping || run.turnEnded || ['paused', 'failed', 'done', 'cancelled'].includes(run.status)) { run.rpc?.reject(message.id, '本轮已停止或结束，请重新发起请求'); return; }
    const p = message.params ?? {}, id = String(p.requestId ?? message.id), targetSessionId = p.sessionId || p.threadId || run.sessionId;
    const details = operationDetails(run.toolCalls?.get(p.callId) || p, run.connection.projectPath);
    const permission = permissionRequest(message);
    const question = message.method === 'user-question/ask' || message.method === 'item/tool/requestUserInput';
    if (!permission && !question) { run.rpc?.reject(message.id, '此源端请求未适配'); return; }
    const approvals = permission ? approvalChoices(run.connection.tool, message.method, p).map(option => ({ ...option, id: `${randomUUID()}:${option.id}` })) : undefined;
    run.requests.set(id, { wireId: message.id, method: message.method, params: p, approvals });
    emit(run, { targetSessionId, status: pendingRequestStatus(run), request: { id, targetSessionId, details, kind: permission ? 'permission' : 'question', prompt: p.reason || p.command || p.toolName || p.questions?.map(q => q.question || q.title || q.header).join('\n') || '源端需要你的输入', questions: p.questions, options: approvals?.map(option => option.label), ...(permission ? { permissionOptions: publicApprovalChoices(approvals), permissionSource: run.connection.tool } : {}) } });
  };
  const attach = async (run, resume) => {
    assertSourceOwner(run);
    if (resume && beforeStart) { const report = await beforeStart(run.connection.connectionId); if (!report.canStart) throw new Error(report.issue?.message || 'Agent 暂时不可用，请检查连接'); }
    run.stopping = false; run.stoppedConfirmed = false;
    let rpc;
    try { rpc = await initializeRuntime(run.connection, { commandInvocation, spawnProcess, modelConfigDirectory, resuming: resume, onNotification: (m, p) => notification(run, m, p), onRequest: message => serverRequest(run, message), onExit: error => { if (!run.stopping) emit(run, { status: 'failed', error: safeError(error) }); } }); }
    catch (error) { if (error.protocol) { run.protocol = error.protocol; persist(); } throw error; }
    run.rpc = rpc;
    run.protocol = rpc.protocol;
    if (run.connection.tool === 'dsh') {
      if (resume) await rpc.call('session/resume', { sessionId: run.sessionId });
    } else if (run.connection.tool === 'hermes') {
      const params = { cwd: run.connection.projectPath, mcpServers: [] };
      if (resume) {
        if (!rpc.canLoadSession) throw new Error('当前 Hermes 版本不支持恢复会话');
        await rpc.call('session/load', { ...params, sessionId: run.sessionId });
      } else {
        const result = await rpc.call('session/new', params);
        if (!result?.sessionId) throw new Error('Hermes 未返回真实会话 ID');
        assertSourceOwner(run, result.sessionId);
        run.sessionId = result.sessionId;
        run.knownSessions.add(result.sessionId);
      }
    } else {
      const response = await rpc.call(resume ? 'thread/resume' : 'thread/start', { ...(resume ? { threadId: run.sessionId } : {}), cwd: run.connection.projectPath, approvalPolicy: 'on-request', sandbox: 'workspace-write', ...(run.connection.model ? { model: run.connection.model } : {}) });
      if (!response.thread?.id) throw new Error('Codex 未返回真实会话 ID');
      if (resume && response.thread.id !== run.sessionId) throw ownershipError('SOURCE_SESSION_MISMATCH：恢复回执不是原执行的源会话');
      assertSourceOwner(run, response.thread.id);
      run.sessionId = response.thread.id;
      run.knownSessions.add(response.thread.id);
    }
    return rpc;
  };
  const prompt = async (run, message) => {
    if (typeof message !== 'string' || !message.trim() || message.length > 100000) throw new Error('任务内容需要 1–100000 个字符');
    emit(run, { message: { id: randomUUID(), role: 'user', text: message } });
    message = discussionTurnMessage(run.input, message);
    run.turnEnded = false;
    if (run.connection.tool === 'dsh') {
      const result = await run.rpc.call('session/prompt', { sessionId: run.sessionId, contentBlocks: [{ type: 'text', text: message }] });
      if (run.protocol === 'legacy-rc2' && (typeof result?.messageId !== 'string' || !result.messageId)) throw new Error('DSH 未返回持久化消息回执，受理结果未知');
      return result;
    }
    if (run.connection.tool === 'hermes') {
      if (run.hermesTurn) throw new Error('Hermes 正在处理上一条消息');
      const rpc = run.rpc;
      return new Promise((resolve, reject) => {
        const turn = { text: '', acknowledge() { if (turn.acknowledged) return; turn.acknowledged = true; resolve({}); emit(run, { status: 'running' }); } };
        run.hermesTurn = turn;
        void rpc.call('session/prompt', { sessionId: run.sessionId, prompt: [{ type: 'text', text: message }] }, 180000).then(result => {
          if (run.stopping || run.rpc !== rpc) throw new Error('Hermes 执行已停止');
          if (result?.stopReason === 'cancelled') throw new Error('Hermes 已取消本轮');
          if (/^Error:/i.test(turn.text.trim())) throw new Error(turn.text.trim());
          if (result?.stopReason !== 'end_turn' || !turn.text.trim()) throw new Error('Hermes 未返回有效结果，请检查模型配置或原会话');
          turn.acknowledge();
          const total = result.usage?.totalTokens;
          if (Number.isFinite(total) && total >= 0) emit(run, { tokens: (run.tokens ?? 0) + total });
          const reply = { id: randomUUID(), text: turn.text };
          emit(run, { message: reply, reply, status: 'waiting_reply', turnCompleted: true });
        }).catch(error => {
          if (!turn.acknowledged) reject(error);
          else if (!run.stopping && run.rpc === rpc) emit(run, { status: 'failed', error: safeError(error) });
        }).finally(() => { if (run.hermesTurn === turn) run.hermesTurn = null; });
      });
    }
    run.retryIssueCodes = new Set();
    const result = await run.rpc.call('turn/start', { threadId: run.sessionId, input: [{ type: 'text', text: message }], approvalPolicy: 'on-request' });
    run.turnId = result.turn?.id; return result;
  };
  const scan = async connectionId => {
    const connection = getConnection(connectionId); if (!connection) throw new Error('连接不存在');
    if (connection.tool === 'dsh') return scanDshSessions(connection);
    if (connection.tool === 'claude') return scanClaudeSessions(connection);
    if (connection.tool === 'hermes') return { sessions: [], coverage: '已接入受管执行；外部 Hermes 会话发现尚未接入' };
    if (connection.tool !== 'codex') throw new Error('此工具尚未提供已适配的会话读取协议');
    const rpc = await initializeRuntime(connection, { commandInvocation, modelConfigDirectory, spawnProcess });
    const managedSessionIds = new Set([...runs.values()]
      .filter(run => run.connection.connectionId === connectionId)
      .flatMap(run => [...run.knownSessions]));
    try { return await scanCodexSessions(connection, rpc, { managedSessionIds }); } finally { await rpc.close(); }
  };
  const recover = record => {
    const connection = getConnection(record.connectionId); if (!connection) return null;
    const originalInput = { ...record, connectionId: record.originalConnectionId || record.fallback?.fromConnectionId || record.connectionId };
    const run = { input: originalInput, runId: record.runId, sessionId: record.sessionId, protocol: record.protocol ?? connection.protocol, knownSessions: new Set([record.sessionId]), connection, acceptedAt: record.acceptedAt, acceptance: record.acceptance || (record.acceptedAt ? 'acknowledged' : 'unknown'), sequence: record.sequence || 0, events: structuredClone(record.events || []), status: ['done', 'cancelled'].includes(record.status) ? record.status : 'paused', tokens: record.tokens, usage: record.tokens || 0, lastReply: record.lastReply, requests: new Map(), rpc: null, stopping: true, recovered: true, stoppedConfirmed: record.stoppedConfirmed === true && !record.adopted, health: structuredClone(record.health || { lastActivityAt: record.events?.at(-1)?.at || record.acceptedAt || new Date(now()).toISOString() }), fallback: record.fallback };
    run.childUsage = new Map();
    for (const event of run.events) {
      if (event.child?.sessionId) run.knownSessions.add(event.child.sessionId);
      if (event.targetSessionId && typeof event.childTokens === 'number') run.childUsage.set(event.targetSessionId, event.childTokens);
    }
    runs.set(run.runId, run); if (record.dispatchId) dispatches.set(record.dispatchId, run.runId);
    const stale = new Set(); for (const event of run.events) { if (event.request) stale.add(event.request.id); if (event.requestResolved) stale.delete(event.requestResolved); }
    for (const id of stale) emit(run, { requestResolved: id });
    return snapshot(run);
  };
  for (const record of initialRuns) recover(record);
  const inspectHealth = () => {
    for (const run of runs.values()) {
      if (!['running', 'queued'].includes(run.status) || !run.rpc || run.rpc.closed || run.stopping || run.requests.size) continue;
      const last = Date.parse(run.health?.lastActivityAt || run.acceptedAt || '');
      if (run.health?.incident?.kind === 'attention' && run.health.incident.status === 'open' && last > Date.parse(run.health.incident.detectedAt)) {
        run.health.incident = { ...run.health.incident, status: 'resolved', resolvedAt: new Date(now()).toISOString(), resolvedReason: 'activity_resumed' };
        emit(run, { incident: run.health.incident }, false);
      }
      if (!Number.isFinite(last) || now() - last < stallAfterMs || run.health?.incident?.status === 'open') continue;
      const incident = { ...classifyIncident('', 'suspected_stall'), id: randomUUID(), detectedAt: new Date(now()).toISOString(), status: 'open', kind: 'attention' };
      run.health.incident = incident;
      emit(run, { incident }, false);
    }
  };
  const healthTimer = monitorEveryMs > 0 ? setInterval(inspectHealth, monitorEveryMs) : null;
  healthTimer?.unref();
  return {
    inspectHealth,
    assist: system.assist,
    blockProject(projectId) { blockedProjects.add(projectId); system.blockProject(projectId); },
    unblockProject(projectId) { blockedProjects.delete(projectId); system.unblockProject(projectId); },
    async stopProject(projectId) {
      blockedProjects.add(projectId); system.blockProject(projectId);
      const selected = [...runs.values()].filter(run => run.input.projectId === projectId);
      if (selected.some(run => admissions.has(run.input.dispatchId) || transitions.has(run.runId) || run.acceptance === 'unknown')) throw Error('项目仍有受理结果未知或正在提交的执行，未删除；请核对源 Agent 状态后重试');
      await system.stopProject(projectId);
      for (const run of selected) {
        if (run.stoppedConfirmed === true) continue;
        await this.control(run.runId, 'cancel');
        if (run.stoppedConfirmed !== true) throw Error('尚未确认本项目源 Agent 已停止，未删除任何项目数据');
      }
      return selected.map(snapshot);
    },
    forgetProject(projectId) {
      const selected = [...runs.values()].filter(run => run.input.projectId === projectId);
      if (selected.some(run => admissions.has(run.input.dispatchId) || run.stoppedConfirmed !== true)) throw Error('仍有未停止的执行，不能移除运行记录');
      for (const run of selected) { runs.delete(run.runId); dispatches.delete(run.input.dispatchId); }
      system.forgetProject(projectId); persist();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async run(input) {
      assertProjectOpen(input.projectId);
      if (!input.dispatchId) throw new Error('缺少幂等派发 ID');
      const prior = dispatches.has(input.dispatchId) ? runs.get(dispatches.get(input.dispatchId)) : null;
      if (prior && dispatchIdentity(prior.input) !== dispatchIdentity(input)) throw Object.assign(new Error('IDEMPOTENCY_CONFLICT：同一派发 ID 的内容不能变化'), { rejected: true });
      if (admissions.has(input.dispatchId)) return admissions.get(input.dispatchId);
      if (dispatches.has(input.dispatchId)) {
        const existing = runs.get(dispatches.get(input.dispatchId));
        if (existing.acceptance === 'acknowledged') return snapshot(existing);
        const error = new Error(existing.acceptance === 'rejected' ? '源端未受理此派发，请重新提交' : '上次派发受理结果未知，请核对源会话后重试');
        error.rejected = existing.acceptance === 'rejected'; throw error;
      }
      if (input.sourceSessionId) throw ownershipError('NEW_SOURCE_SESSION_REQUIRED：新派发不能复用源会话；继续原任务请使用原执行记录');
      const unsettled = [...runs.values()].find(run => input.taskId && taskIdentity(run.input) === taskIdentity(input) && (admissions.has(run.input.dispatchId) || run.acceptance === 'unknown' || run.acceptance === 'acknowledged' && !run.stoppedConfirmed));
      if (unsettled) throw ownershipError('TASK_EXECUTION_UNSETTLED：原执行尚未确认停止或受理结果未知，请核对原执行，未重复派发');
      const connection = getConnection(input.connectionId); if (!connection) throw Object.assign(new Error('Agent 连接已失效，请重新配置'), { rejected: true });
      const run = { input: { ...input }, runId: randomUUID(), sessionId: randomUUID(), connection, acceptedAt: null, acceptance: 'rejected', sequence: 0, events: [], status: 'queued', tokens: null, usage: 0, requests: new Map(), rpc: null, stopping: false };
      run.knownSessions = new Set([run.sessionId]);
      run.childUsage = new Map();
      runs.set(run.runId, run); dispatches.set(input.dispatchId, run.runId);
      const admission = (async () => {
        try {
          if (beforeStart) {
            const report = await beforeStart(run.connection.connectionId);
            if (!report.canStart) {
              const allowed = new Set(Array.isArray(input.allowedFallbackConnectionIds) ? input.allowedFallbackConnectionIds : []);
              const candidates = !input.sourceSessionId ? fallbackConnections(connection.connectionId).filter(id => allowed.has(id)) : [];
              let replacement;
              for (const id of candidates) {
                const candidate = getConnection(id);
                if (!candidate || candidate.projectPath !== connection.projectPath || !['dsh', 'codex', 'claude', 'hermes'].includes(candidate.tool)) continue;
                const checked = await beforeStart(id);
                if (checked.canStart) { replacement = candidate; break; }
              }
              if (!replacement) throw Object.assign(new Error(report.issue?.message || 'Agent 连接暂时不可用，请检查连接'), { incidentCode: report.issue?.code });
              run.fallback = { fromConnectionId: connection.connectionId, toConnectionId: replacement.connectionId, reason: report.issue?.title || '原 Agent 暂时不可用', acceptanceNotSent: true };
              run.input.originalConnectionId = connection.connectionId;
              run.connection = replacement;
              emit(run, { fallback: run.fallback });
            }
          }
          await attach(run, false);
          assertProjectOpen(input.projectId);
          run.acceptance = 'unknown'; persist(); await prompt(run, input.prompt);
          run.acceptance = 'acknowledged'; run.acceptedAt = new Date().toISOString();
          if (run.fallback) emit(run, { fallback: run.fallback, fallbackAccepted: true }, false);
        } catch (error) {
          try { await stopProcess(run); } catch (stopError) { error = new Error('源端尚未确认停止，受理结果未知，请查看原会话，暂不重派'); run.acceptance = 'unknown'; }
          emit(run, { status: 'failed', error: safeError(error), incidentCode: error.incidentCode });
          error.rejected = run.acceptance === 'rejected'; throw error;
        }
        // Receipt follows source enqueue acknowledgement, never process spawn alone.
        persist(); return snapshot(run);
      })();
      admissions.set(input.dispatchId, admission);
      try { return await admission; } finally { admissions.delete(input.dispatchId); }
    },
    resolveIncident(runId, { reason, successorRunId } = {}) {
      const run = runs.get(runId), next = runs.get(successorRunId);
      if (reason !== 'handed_off' || !run || !run.stoppedConfirmed || !next || next === run || next.acceptance !== 'acknowledged' || !run.input.projectId || !run.input.taskId || run.input.projectId !== next.input.projectId || run.input.taskId !== next.input.taskId) throw new Error('尚未确认新 Agent 已接手这项任务');
      if (run.health?.incident?.status === 'open') {
        run.health.incident = { ...run.health.incident, status: 'resolved', resolvedAt: new Date(now()).toISOString(), resolvedReason: 'handed_off', successorRunId };
        emit(run, { incident: run.health.incident }, false);
      }
      return snapshot(run);
    },
    get lastPersistenceError() { return persistenceError; },
    async flush() { await persistenceWrite; try { await saveRuns?.([...runs.values()].map(snapshot)); persistenceError = null; } catch (error) { failedPersistence(error); throw error; } },
    listRuns() { return [...runs.values()].map(snapshot); },
    read(runId) { const run = runs.get(runId); if (!run) throw new Error('执行不存在'); return snapshot(run); },
    recover,
    scan,
    async adopt(input) {
      assertProjectOpen(input.projectId);
      if (!input.sourceSessionId || !input.dispatchId) throw new Error('缺少准确源会话或幂等 ID');
      const connection = getConnection(input.connectionId);
      if (!connection) throw ownershipError('Agent 连接已失效，请重新配置');
      const existing = () => {
        const owned = sourceOwner(connection, input.sourceSessionId);
        const dispatched = dispatches.has(input.dispatchId) ? runs.get(dispatches.get(input.dispatchId)) : null;
        if (dispatched && (dispatched !== owned || taskIdentity(dispatched.input) !== taskIdentity(input))) throw ownershipError('IDEMPOTENCY_CONFLICT：导入 ID 已属于另一条执行记录');
        if (owned && (owned.connection.connectionId !== input.connectionId || taskIdentity(owned.input) !== taskIdentity(input))) throw ownershipError('SOURCE_SESSION_OWNED：源会话已属于另一项任务，不能转移或复用');
        return owned;
      };
      const owned = existing();
      if (owned) return snapshot(owned);
      const { sessions } = await scan(input.connectionId);
      assertProjectOpen(input.projectId);
      const admitted = existing();
      if (admitted) return snapshot(admitted);
      const session = sessions.find(s => s.sessionId === input.sourceSessionId);
      if (!session) throw new Error('在当前连接目录未找到此源会话');
      if (session.status === 'running') throw new Error('该会话仍在原工具执行，请先在原工具暂停');
      const runId = randomUUID(), events = [], replies = session.replies || [];
      for (const reply of replies) {
        events.push({ id: randomUUID(), sequence: events.length + 1, at: reply.at, runId, sessionId: session.sessionId, message: { id: reply.id, role: 'assistant', text: reply.text } });
        events.push({ id: randomUUID(), sequence: events.length + 1, at: reply.at, runId, sessionId: session.sessionId, reply: { id: reply.id, text: reply.text } });
      }
      const record = { ...input, adopted: true, runId, sessionId: session.sessionId, acceptedAt: new Date().toISOString(), acceptance: 'acknowledged', status: 'paused', sequence: events.length, events, tokens: session.tokens, lastReply: replies.at(-1)?.text };
      const result = recover(record); persist(); return result;
    },
    async control(runId, action, payload = {}) {
      const run = runs.get(runId); if (!run) throw new Error('执行不存在');
      const starting=!['stop','cancel','archive'].includes(action);
      if(starting){assertProjectOpen(run.input.projectId);if(transitions.has(runId))throw Error('该执行仍在处理上一个操作');transitions.add(runId);}
      try {
      if (action === 'stop' || action === 'cancel' || action === 'archive') {
        if (['codex', 'claude'].includes(run.connection.tool) && run.turnId && run.rpc && !run.rpc.closed) { try { await run.rpc.call('turn/interrupt', { threadId: run.sessionId, turnId: run.turnId }); } catch {} }
        await stopProcess(run);
        if (!run.stoppedConfirmed) {
          // Detaching our record cannot prove that a recovered/external source stopped.
          // Never let archive/cancel turn this uncertainty into a terminal ledger state.
          emit(run, { status: 'paused' });
          if (action !== 'stop') throw new Error('尚未确认源 Agent 已停止，未归档或取消。请在源 Agent 中停止执行并核对状态，再重试。');
          return snapshot(run);
        }
        emit(run, { status: action === 'archive' ? 'done' : action === 'cancel' ? 'cancelled' : 'paused' }); return snapshot(run);
      }
      if (action === 'resume') {
        if (['running', 'queued'].includes(run.status) && run.rpc && !run.rpc.closed) throw new Error('任务正在执行，不能重复恢复');
        if (!run.rpc || run.rpc.closed) await attach(run, true);
        await prompt(run, payload.prompt || '请继续尚未完成的任务。'); return snapshot(run);
      }
      if (action !== 'reply') throw new Error('不支持的执行操作');
      const request = run.requests.get(String(payload.requestId));
      if (request) {
        if (!canResolveRequest(run)) throw new Error('该请求已过期或执行已停止，未发送回答');
        let answer, approval;
        if (permissionRequest(request)) {
          approval = chooseApproval(request.approvals ?? approvalChoices(run.connection.tool, request.method, request.params), payload);
          answer = approval.response;
        } else { if (!payload.answer || typeof payload.answer !== 'object') throw new Error('请填写源端问题的回答'); answer = payload.answer; }
        run.rpc.reply(request.wireId, answer);
        emit(run, { message: { id: randomUUID(), role: 'user', text: approval ? `${approval.label}${approval.rule ? `：${safeError(approval.rule)}` : ''}` : JSON.stringify(answer) } }); resolveRequest(run, String(payload.requestId)); return snapshot(run);
      }
      if (payload.requestId) throw new Error('该请求已过期，未发送回答');
      if (run.requests.size) throw new Error('请先处理当前授权或问题，不能用普通消息跳过源端请求');
      if (!run.rpc || run.rpc.closed) await attach(run, true);
      if (run.requests.size) throw new Error('源端出现新的授权或问题，请先处理当前请求');
      await prompt(run, payload.prompt); return snapshot(run);
      } finally {if(starting)transitions.delete(runId);}
    },
    async close() { clearInterval(healthTimer); await system.close(); await Promise.all([...runs.values()].map(async run => { await stopProcess(run); if (!['done', 'cancelled', 'failed'].includes(run.status)) emit(run, { status: 'paused' }); })); },
  };
}
