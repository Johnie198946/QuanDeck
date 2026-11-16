/** Real newline JSON-RPC runtimes. No task progress is inferred from elapsed time. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { scanDshSessions, scanCodexSessions } from './discovery.mjs';
import { createClaudeRuntime, scanClaudeSessions } from './claude.mjs';
import { probeDshVersion } from './dshVersion.mjs';

const textBlocks = blocks => Array.isArray(blocks) ? blocks.filter(b => b.type === 'text').map(b => b.text || '').join('') : '';
const operationDetails = (value, cwd) => {
  const source = value && typeof value === 'object' ? value : {};
  return [...(cwd ? [`目录：${cwd}`] : []), ...['command', 'cmd', 'file_path', 'path', 'cwd', 'blockedPath', 'scope'].filter(key => source[key] != null).map(key => `${key}: ${Array.isArray(source[key]) ? source[key].join(' ') : String(source[key])}`)].join('\n').replace(/(?:(?<![\w-])sk-[\w-]{12,}|Bearer\s+\S+)/gi, '[redacted]').replace(/((?:API[_-]?KEY|TOKEN|PASSWORD|SECRET)\s*[=:]\s*)[^\s]+/gi, '$1[redacted]').slice(0, 8000);
};
const safeError = error => String(error?.message || error || '源端执行失败').replace(/(?:(?<![\w-])sk-[\w-]{12,}|Bearer\s+\S+)/gi, '[redacted]').slice(0, 1500);
export function createRpcProcess(invocation, { cwd, spawnProcess = spawn, onNotification = () => {}, onRequest = () => {}, onExit = () => {} } = {}) {
  const child = spawnProcess(invocation.binary, invocation.args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...invocation.env } });
  const pending = new Map(); const decoder = new StringDecoder('utf8'); let buffer = '', sequence = 0, closed = false;
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
        if (message.error) waiter.reject(new Error(safeError(message.error))); else waiter.resolve(message.result);
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
      if (closed) return;
      if (method) { try { await this.call(method, {}, 5000); } catch {} }
      child.stdin.end(); child.kill();
      const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 3000); timer.unref?.();
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
  if (!['dsh', 'codex'].includes(connection.tool)) throw new Error('此工具未提供已适配的执行协议');
  if (connection.tool === 'dsh') {
    // Revalidate persisted connections at every process start; stale 0.5.1 receipts cannot bypass the gate.
    const version = await probeDshVersion(await runtimeInvocation(connection, ['--version'], options.commandInvocation), { cwd: connection.projectPath });
    if (version.blocked) throw new Error(version.note);
  }
  const invocation = await runtimeInvocation(connection, connection.tool === 'dsh' ? ['sdk'] : ['app-server', '--stdio'], options.commandInvocation);
  const rpc = createRpcProcess(invocation, { ...options, cwd: connection.projectPath });
  try {
    if (connection.tool === 'dsh') {
      if (!connection.provider?.trim() || !connection.model?.trim()) throw new Error('请填写 DSH 已配置的 Provider 与 Model ID');
      const result = await rpc.call('initialize', { cwd: connection.projectPath, provider: connection.provider, model: connection.model, approvalRequests: true, capabilities: { userQuestions: true } });
      if (result?.serverInfo?.name !== 'deepseek-harness-sdk-runtime') throw new Error('CLI 返回的不是 DeepSeek Harness SDK 协议');
    } else {
      await rpc.call('initialize', { clientInfo: { name: 'quandeck', title: 'QuanDeck', version: '0.5.0' }, capabilities: { experimentalApi: true } });
      rpc.notify('initialized', {});
    }
    return rpc;
  } catch (error) { await rpc.close(); throw error; }
}

export function createRuntimeDriver({ getConnection, commandInvocation, spawnProcess, onEvent, initialRuns = [], saveRuns, onPersistenceError } = {}) {
  const runs = new Map(), listeners = new Set(), dispatches = new Map(), admissions = new Map();
  const snapshot = run => ({ ...run.input, runId: run.runId, sessionId: run.sessionId, connectionId: run.connection.connectionId, status: run.status, acceptedAt: run.acceptedAt, acceptance: run.acceptance, tool: run.connection.tool, provider: run.connection.provider, model: run.connection.model, sequence: run.sequence, events: run.events, tokens: run.tokens, lastReply: run.lastReply });
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
  const emit = (run, fields) => {
    if (fields.status) run.status = fields.status;
    const event = { id: randomUUID(), sequence: ++run.sequence, at: new Date().toISOString(), runId: run.runId, sessionId: run.sessionId, ...fields };
    run.events.push(event); if (run.events.length > 5000) run.events.shift();
    if (fields.reply) run.lastReply = fields.reply.text;
    if (typeof fields.tokens === 'number') run.tokens = fields.tokens;
    persist(); onEvent?.(event); for (const listener of listeners) listener(event);
    return event;
  };
  const stopProcess = async run => { run.stopping = true; for (const [id, request] of run.requests) { try { run.rpc?.reject(request.wireId, '用户停止了执行'); } catch {} run.requests.delete(id); emit(run, { requestResolved: id }); } await run.rpc?.close(run.connection.tool === 'dsh' ? 'shutdown' : undefined); run.rpc = null; };
  const notification = (run, method, params) => {
    if (run.stopping) return;
    if (method === 'quandeck/event') { emit(run, params.event); return; }
    if (run.connection.tool === 'dsh') {
      if (method === 'session.status' && params.sessionId === run.sessionId && params.status === 'running') emit(run, { status: 'running' });
      if (method === 'session.event') {
        const event = params.event, data = event?.data ?? {};
        if (!event?.type) return;
        const isRoot = params.sessionId === run.sessionId;
        if (event.type === 'assistant/message') {
          const text = textBlocks(data.message?.content);
          if (!isRoot && text) emit(run, { targetSessionId: params.sessionId, message: { id: String(event.id ?? event.seq ?? randomUUID()), role: 'assistant', text } });
          if (isRoot && text) { run.pendingReply = { id: String(event.id ?? event.seq ?? randomUUID()), text }; emit(run, { message: run.pendingReply }); }
          const usage = data.usage;
          if (usage && !isRoot) { const childTokens = usage.totalTokens ?? (typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number' ? usage.inputTokens + usage.outputTokens : null); if (typeof childTokens === 'number' && Number.isFinite(childTokens) && childTokens >= 0) emit(run, { targetSessionId: params.sessionId, childTokens }); }
          // SDK TokenUsage: inputTokens/outputTokens/totalTokens. No estimated counters.
          if (usage && isRoot) {
            const input = usage.inputTokens ?? usage.input, output = usage.outputTokens ?? usage.output;
            const total = usage.totalTokens ?? (typeof input === 'number' && typeof output === 'number' ? input + output : undefined);
            if (typeof total === 'number' && Number.isFinite(total) && total >= 0) { run.usage += total; emit(run, { tokens: run.usage }); }
          }
        }
        if (event.type === 'tool/call' && data.callId) { run.toolCalls ||= new Map(); let args; try { args = JSON.parse(data.arguments); } catch {} run.toolCalls.set(data.callId, args); }
        if (isRoot && event.type === 'tool/call') emit(run, { status: 'running', step: { label: String(data.name || '执行工具') } });
        if (event.type === 'tool/result') emit(run, { targetSessionId: params.sessionId, log: { kind: 'tool', label: data.message?.isError ? '工具执行失败' : '工具执行完成', detail: String(data.error?.reason || textBlocks(data.message?.content) || '').slice(0, 8000) } });
        if (isRoot && event.type === 'step/start') emit(run, { status: 'running', step: { label: `模型步骤 ${data.step ?? ''}`.trim() } });
        if (isRoot && event.type === 'turn/end') {
          const kind = data.reason?.kind;
          if (run.pendingReply) { emit(run, { reply: run.pendingReply }); run.pendingReply = null; }
          if (kind === 'error' || kind === 'failed') emit(run, { status: 'failed', error: '源端报告本轮执行失败' });
          else if (kind === 'aborted' || kind === 'interrupted') emit(run, { status: 'paused' });
          else emit(run, { status: 'waiting_reply' });
        }
      }
      if (method === 'subagent.started' || method === 'subagent.finished') emit(run, { child: { id: params.childSessionId, parentId: params.parentSessionId === run.sessionId ? undefined : params.parentSessionId, sessionId: params.childSessionId, title: `子任务 ${String(params.childSessionId).slice(-8)}`, status: method.endsWith('started') ? 'running' : params.status === 'ok' ? 'done' : 'failed', ...(method.endsWith('started') ? { start: new Date().toISOString() } : { end: new Date().toISOString() }), ...(textBlocks(params.lastAssistantMessage) ? { reply: textBlocks(params.lastAssistantMessage) } : {}) } });
      if (method === 'user-question.cancelled') { run.requests.delete(params.requestId); emit(run, { requestResolved: params.requestId }); }
      return;
    }
    if (params.threadId && params.threadId !== run.sessionId) return;
    if (method === 'turn/started') { run.turnId = params.turn?.id; emit(run, { status: 'running' }); }
    if (method === 'turn/completed') { if (run.pendingReply) { emit(run, { reply: run.pendingReply }); run.pendingReply = null; } emit(run, { status: params.turn?.status === 'failed' ? 'failed' : params.turn?.status === 'interrupted' ? 'paused' : 'waiting_reply', ...(params.turn?.error ? { error: safeError(params.turn.error) } : {}) }); }
    if (method === 'item/completed' && params.item?.type === 'agentMessage') { run.pendingReply = { id: params.item.id, text: params.item.text || '' }; emit(run, { message: run.pendingReply }); }
    if (method === 'item/started' && ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall'].includes(params.item?.type)) emit(run, { status: 'running', step: { label: params.item.command || params.item.tool || ({ fileChange: '更新文件', collabAgentToolCall: '协调子任务' })[params.item.type] || '执行工具' } });
    if (method === 'item/completed' && params.item?.type === 'commandExecution') emit(run, { log: { kind: 'command', label: params.item.command || '运行命令', detail: String(params.item.aggregatedOutput || '').slice(0, 8000), ...(typeof params.item.exitCode === 'number' ? { exitCode: params.item.exitCode } : {}) } });
    if (method === 'item/completed' && params.item?.type === 'fileChange') emit(run, { log: { kind: 'file', label: '文件变更', detail: (params.item.changes || []).map(change => change.path).filter(Boolean).join('\n').slice(0, 8000) } });
    if (method === 'item/completed' && ['mcpToolCall', 'dynamicToolCall'].includes(params.item?.type)) emit(run, { log: { kind: 'tool', label: params.item.tool || '工具调用', detail: params.item.status || (params.item.success === false ? '失败' : '已返回') } });
    if (method === 'turn/plan/updated' && Array.isArray(params.plan)) emit(run, { step: { total: params.plan.length, completed: params.plan.filter(s => s.status === 'completed').length, label: params.plan.find(s => s.status === 'inProgress')?.step || params.explanation || '执行计划' } });
    if (method === 'thread/tokenUsage/updated' && typeof params.tokenUsage?.total?.totalTokens === 'number') emit(run, { tokens: params.tokenUsage.total.totalTokens });
    if (method === 'error') emit(run, params.willRetry ? { notice: safeError(params.error) } : { status: 'failed', error: safeError(params.error) });
    // Tool calls report true receiver thread IDs when the installed Codex provides collab events.
    if (method === 'item/completed' && params.item?.type === 'collabAgentToolCall') {
      const item = params.item;
      const states = { pendingInit: 'queued', running: 'running', interrupted: 'paused', completed: 'done', errored: 'failed', shutdown: 'cancelled', notFound: 'failed' };
      for (const [id, state] of Object.entries(item.agentsStates || {})) emit(run, { child: { id, sessionId: id, title: item.prompt || `子任务 ${id.slice(-8)}`, status: states[state.status] || 'paused', reply: state.message } });
    }
  };
  const serverRequest = (run, message) => {
    const p = message.params ?? {}, id = String(p.requestId ?? message.id), targetSessionId = p.sessionId || p.threadId || run.sessionId;
    const details = operationDetails(run.toolCalls?.get(p.callId) || p, run.connection.projectPath);
    const permission = message.method === 'approval/request' || /requestApproval$/.test(message.method);
    const question = message.method === 'user-question/ask' || message.method === 'item/tool/requestUserInput';
    if (!permission && !question) { run.rpc?.reject(message.id, '此源端请求未适配'); return; }
    run.requests.set(id, { wireId: message.id, method: message.method, params: p });
    emit(run, { targetSessionId, status: permission ? 'waiting_permission' : 'waiting_reply', request: { id, targetSessionId, details, kind: permission ? 'permission' : 'question', prompt: p.reason || p.command || p.toolName || p.questions?.map(q => q.question || q.title || q.header).join('\n') || '源端需要你的输入', questions: p.questions, options: permission ? ['允许本次', '拒绝'] : undefined } });
  };
  const attach = async (run, resume) => {
    run.stopping = false;
    const rpc = await initializeRuntime(run.connection, { commandInvocation, spawnProcess, onNotification: (m, p) => notification(run, m, p), onRequest: message => serverRequest(run, message), onExit: error => { if (!run.stopping) emit(run, { status: 'failed', error: safeError(error) }); } });
    run.rpc = rpc;
    if (run.connection.tool === 'dsh') {
      if (resume) await rpc.call('session/resume', { sessionId: run.sessionId });
    } else {
      const response = await rpc.call(resume ? 'thread/resume' : 'thread/start', { ...(resume ? { threadId: run.sessionId } : {}), cwd: run.connection.projectPath, approvalPolicy: 'on-request', sandbox: 'workspace-write', ...(run.connection.model ? { model: run.connection.model } : {}) });
      if (!response.thread?.id) throw new Error('Codex 未返回真实会话 ID');
      run.sessionId = response.thread.id;
    }
    return rpc;
  };
  const prompt = async (run, message) => {
    if (typeof message !== 'string' || !message.trim() || message.length > 100000) throw new Error('任务内容需要 1–100000 个字符');
    emit(run, { message: { id: randomUUID(), role: 'user', text: message } });
    if (run.connection.tool === 'dsh') return run.rpc.call('session/prompt', { sessionId: run.sessionId, contentBlocks: [{ type: 'text', text: message }] });
    const result = await run.rpc.call('turn/start', { threadId: run.sessionId, input: [{ type: 'text', text: message }], approvalPolicy: 'on-request' });
    run.turnId = result.turn?.id; return result;
  };
  const scan = async connectionId => {
    const connection = getConnection(connectionId); if (!connection) throw new Error('连接不存在');
    if (connection.tool === 'dsh') return scanDshSessions(connection);
    if (connection.tool === 'claude') return scanClaudeSessions(connection);
    if (connection.tool !== 'codex') throw new Error('此工具尚未提供已适配的会话读取协议');
    const rpc = await initializeRuntime(connection, { commandInvocation, spawnProcess });
    try { return await scanCodexSessions(connection, rpc); } finally { await rpc.close(); }
  };
  const recover = record => {
    const connection = getConnection(record.connectionId); if (!connection) return null;
    const run = { input: { ...record }, runId: record.runId, sessionId: record.sessionId, connection, acceptedAt: record.acceptedAt, acceptance: record.acceptance || (record.acceptedAt ? 'acknowledged' : 'unknown'), sequence: record.sequence || 0, events: structuredClone(record.events || []), status: ['done', 'cancelled'].includes(record.status) ? record.status : 'paused', tokens: record.tokens, usage: record.tokens || 0, lastReply: record.lastReply, requests: new Map(), rpc: null, stopping: true };
    runs.set(run.runId, run); if (record.dispatchId) dispatches.set(record.dispatchId, run.runId);
    const stale = new Set(); for (const event of run.events) { if (event.request) stale.add(event.request.id); if (event.requestResolved) stale.delete(event.requestResolved); }
    for (const id of stale) emit(run, { requestResolved: id });
    return snapshot(run);
  };
  for (const record of initialRuns) recover(record);
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async run(input) {
      if (!input.dispatchId) throw new Error('缺少幂等派发 ID');
      if (admissions.has(input.dispatchId)) return admissions.get(input.dispatchId);
      if (dispatches.has(input.dispatchId)) {
        const existing = runs.get(dispatches.get(input.dispatchId));
        if (existing.acceptance === 'acknowledged') return snapshot(existing);
        const error = new Error(existing.acceptance === 'rejected' ? '源端未受理此派发，请重新提交' : '上次派发受理结果未知，请核对源会话后重试');
        error.rejected = existing.acceptance === 'rejected'; throw error;
      }
      const connection = getConnection(input.connectionId); if (!connection) throw Object.assign(new Error('Agent 连接已失效，请重新配置'), { rejected: true });
      const run = { input: { ...input }, runId: randomUUID(), sessionId: input.sourceSessionId || randomUUID(), connection, acceptedAt: null, acceptance: 'rejected', sequence: 0, events: [], status: 'queued', tokens: null, usage: 0, requests: new Map(), rpc: null, stopping: false };
      runs.set(run.runId, run); dispatches.set(input.dispatchId, run.runId);
      const admission = (async () => {
        try {
          await attach(run, Boolean(input.sourceSessionId));
          run.acceptance = 'unknown'; persist(); await prompt(run, input.prompt);
          run.acceptance = 'acknowledged'; run.acceptedAt = new Date().toISOString();
        } catch (error) {
          await stopProcess(run); emit(run, { status: 'failed', error: safeError(error) });
          error.rejected = run.acceptance === 'rejected'; throw error;
        }
        // Receipt follows source enqueue acknowledgement, never process spawn alone.
        persist(); return snapshot(run);
      })();
      admissions.set(input.dispatchId, admission);
      try { return await admission; } finally { admissions.delete(input.dispatchId); }
    },
    get lastPersistenceError() { return persistenceError; },
    async flush() { await persistenceWrite; try { await saveRuns?.([...runs.values()].map(snapshot)); persistenceError = null; } catch (error) { failedPersistence(error); throw error; } },
    listRuns() { return [...runs.values()].map(snapshot); },
    read(runId) { const run = runs.get(runId); if (!run) throw new Error('执行不存在'); return snapshot(run); },
    recover,
    scan,
    async adopt(input) {
      if (!input.sourceSessionId || !input.dispatchId) throw new Error('缺少准确源会话或幂等 ID');
      const owned = [...runs.values()].find(r => r.connection.connectionId === input.connectionId && r.sessionId === input.sourceSessionId);
      if (owned) return snapshot(owned);
      const { sessions } = await scan(input.connectionId);
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
      if (action === 'stop' || action === 'cancel' || action === 'archive') {
        if (['codex', 'claude'].includes(run.connection.tool) && run.turnId && run.rpc && !run.rpc.closed) { try { await run.rpc.call('turn/interrupt', { threadId: run.sessionId, turnId: run.turnId }); } catch {} }
        await stopProcess(run); emit(run, { status: action === 'archive' ? 'done' : action === 'cancel' ? 'cancelled' : 'paused' }); return snapshot(run);
      }
      if (action === 'resume') {
        if (['running', 'queued'].includes(run.status) && run.rpc && !run.rpc.closed) throw new Error('任务正在执行，不能重复恢复');
        if (!run.rpc || run.rpc.closed) await attach(run, true);
        await prompt(run, payload.prompt || '请继续尚未完成的任务。'); return snapshot(run);
      }
      if (action !== 'reply') throw new Error('不支持的执行操作');
      const request = run.requests.get(String(payload.requestId));
      if (request) {
        let answer;
        if (request.method === 'approval/request') { if (!['allowed-once', 'rejected', 'cancelled'].includes(payload.decision)) throw new Error('请明确允许本次或拒绝'); answer = { outcome: payload.decision }; }
        else if (/requestApproval$/.test(request.method)) { if (!['allowed-once', 'rejected', 'cancelled'].includes(payload.decision)) throw new Error('请明确允许本次或拒绝'); answer = { decision: payload.decision === 'allowed-once' ? 'accept' : payload.decision === 'cancelled' ? 'cancel' : 'decline' }; }
        else { if (!payload.answer || typeof payload.answer !== 'object') throw new Error('请填写源端问题的回答'); answer = payload.answer; }
        run.rpc.reply(request.wireId, answer); emit(run, { message: { id: randomUUID(), role: 'user', text: request.method === 'approval/request' || /requestApproval$/.test(request.method) ? (payload.decision === 'allowed-once' ? '允许本次' : payload.decision === 'cancelled' ? '取消' : '拒绝') : JSON.stringify(answer) } }); run.requests.delete(String(payload.requestId)); emit(run, { requestResolved: String(payload.requestId) }); return snapshot(run);
      }
      if (payload.requestId) throw new Error('该请求已过期，未发送回答');
      if (!run.rpc || run.rpc.closed) await attach(run, true);
      await prompt(run, payload.prompt); return snapshot(run);
    },
    async close() { await Promise.all([...runs.values()].map(async run => { await stopProcess(run); if (!['done', 'cancelled', 'failed'].includes(run.status)) emit(run, { status: 'paused' }); })); },
  };
}
