/** Official Claude Agent SDK adapter. Uses the user's explicitly selected CLI and existing login. */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
export async function loadClaudeSdk() {
  try { return await import('@anthropic-ai/claude-agent-sdk'); }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return import(new URL('../../desktop/app/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs', import.meta.url).href); }
}
const blocksText = content => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text || '').join('') : '';
export function reportedClaudeTokens(modelUsage) {
  if (!modelUsage || typeof modelUsage !== 'object' || Array.isArray(modelUsage)) return null;
  const values = Object.values(modelUsage);
  if (!values.length || !values.every(value => value && ['inputTokens','outputTokens'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) && ['cacheReadInputTokens','cacheCreationInputTokens'].every(key => value[key] === undefined || Number.isSafeInteger(value[key]) && value[key] >= 0))) return null;
  return values.reduce((total, value) => total + value.inputTokens + value.outputTokens + (value.cacheReadInputTokens ?? 0) + (value.cacheCreationInputTokens ?? 0), 0);
}
function inputStream() {
  const queued = []; let waiter, ended = false;
  return { push(value) { if (ended) throw new Error('Claude 输入流已关闭'); if (waiter) { waiter({ value, done: false }); waiter = null; } else queued.push(value); }, end() { ended = true; waiter?.({ done: true }); waiter = null; }, [Symbol.asyncIterator]() { return this; }, next() { if (queued.length) return Promise.resolve({ value: queued.shift(), done: false }); if (ended) return Promise.resolve({ done: true }); return new Promise(resolve => { waiter = resolve; }); } };
}
export async function createClaudeRuntime(connection, { onNotification = () => {}, onRequest = () => {}, onExit = () => {}, sdk: provided } = {}) {
  const sdk = provided || await loadClaudeSdk();
  let query, sessionId, closed = false, stream, turnId, readTask, nativeChild, nativeExit;
  const pending = new Map(), questions = new Map();
  const notify = (method, params) => onNotification(method, { threadId: sessionId, ...params });
  const emit = event => notify('quandeck/event', { event });
  let startedTurnId;
  const sourceStarted = (id = turnId) => { if (id && startedTurnId !== id) { startedTurnId = id; notify('turn/started', { turn: { id } }); } };
  const rejectAdmissions = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  const canUseTool = (toolName, input, options) => new Promise(resolve => {
    sourceStarted();
    const id = options.toolUseID || randomUUID(), isQuestion = toolName === 'AskUserQuestion';
    questions.set(id, { resolve, input, isQuestion });
    const cancel = () => { if (!questions.has(id)) return; questions.delete(id); resolve({ behavior: 'deny', message: '用户请求已取消' }); emit({ requestResolved: id }); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    onRequest({ id, method: isQuestion ? 'item/tool/requestUserInput' : 'item/commandExecution/requestApproval', params: { requestId: id, threadId: sessionId, toolName, sessionId: options.agentID || sessionId, reason: options.title || options.decisionReason || `Claude 请求使用 ${toolName}`, scope: options.description, command: input.command, file_path: input.file_path, blockedPath: options.blockedPath, ...(isQuestion ? { questions: (input.questions || []).map(q => ({ ...q, id: q.question })) } : {}) } });
  });
  const begin = async (resume, id) => {
    if (query) throw new Error('Claude 会话已启动');
    sessionId = id || randomUUID(); stream = inputStream();
    query = sdk.query({ prompt: stream, options: { cwd: connection.projectPath, pathToClaudeCodeExecutable: connection.binary,
      spawnClaudeCodeProcess: options => {
        const jsEntry = /\.[cm]?js$/i.test(connection.binary);
        nativeChild = spawn(jsEntry ? connection.nodePath || process.execPath : options.command, options.args, { cwd: options.cwd, env: { ...options.env, ...(jsEntry && !connection.nodePath ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }, signal: options.signal, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
        nativeExit = new Promise(resolve => { nativeChild.once('exit', resolve); nativeChild.once('close', resolve); });
        return nativeChild;
      }, ...(resume ? { resume: sessionId } : { sessionId }),
      permissionMode: 'default', canUseTool, settingSources: ['user', 'project', 'local'], forwardSubagentText: true,
      extraArgs: { 'replay-user-messages': null }, ...(connection.model ? { model: connection.model } : {}), stderr: () => {} } });
    readTask = (async () => {
      try {
        for await (const message of query) {
          if (message.type === 'user' && message.isReplay && message.uuid && pending.has(message.uuid)) { sourceStarted(message.uuid); const p = pending.get(message.uuid); clearTimeout(p.timer); pending.delete(message.uuid); p.resolve({ turn: { id: message.uuid } }); }
          if (message.type === 'system' && message.subtype === 'init' && message.session_id) sessionId = message.session_id;
          if (message.type === 'assistant') {
            sourceStarted();
            const text = blocksText(message.message?.content);
            const target = message.agent_id || message.parent_tool_use_id;
            if (text) {
              if (target) emit({ targetSessionId: target, message: { id: message.uuid || message.message?.id, role: 'assistant', text } });
              else notify('item/completed', { item: { type: 'agentMessage', id: message.uuid || message.message?.id, text } });
            }
            for (const block of message.message?.content || []) if (block.type === 'tool_use') emit({ log: { kind: 'tool', label: block.name, detail: String(block.input?.command || block.input?.file_path || '').slice(0, 8000) } });
          }
          if (message.type === 'result') {
            if (message.user_message_uuid && pending.has(message.user_message_uuid)) { const p = pending.get(message.user_message_uuid); clearTimeout(p.timer); pending.delete(message.user_message_uuid); p.resolve({ turn: { id: message.user_message_uuid } }); }
            if (message.result && !message.is_error) notify('item/completed', { item: { type: 'agentMessage', id: message.uuid, text: message.result } });
            const reportedTokens = reportedClaudeTokens(message.modelUsage);
            if (reportedTokens !== null) notify('thread/tokenUsage/updated', { tokenUsage: { total: { totalTokens: reportedTokens } } });
            notify('turn/completed', { turn: { id: turnId, status: message.is_error || message.subtype !== 'success' ? 'failed' : 'completed', ...(message.is_error ? { error: { message: (message.errors || [message.result]).filter(Boolean).join('\n') || 'Claude 本轮失败' } } : {}) } });
          }
          if (message.type === 'system' && ['task_started', 'task_progress', 'task_notification'].includes(message.subtype) && !message.ambient) emit({ child: { id: message.task_id, sessionId: message.task_id, parentId: message.parent_task_id, title: message.description || message.summary || `子任务 ${message.task_id}`, status: message.subtype !== 'task_notification' ? 'running' : message.status === 'completed' ? 'done' : message.status === 'stopped' ? 'cancelled' : 'failed', ...(message.usage?.total_tokens != null ? { tokens: message.usage.total_tokens } : {}), ...(message.subtype === 'task_notification' ? { reply: message.summary, end: new Date().toISOString() } : message.subtype === 'task_started' ? { start: new Date().toISOString() } : {}) } });
          if (message.type === 'system' && message.subtype === 'session_writes_lost') emit({ error: 'Claude 报告源会话保存失败，请检查磁盘空间', status: 'failed' });
        }
        if (!closed) { closed = true; rejectAdmissions(new Error('Claude 源端已关闭')); onExit(new Error('Claude 源端已关闭')); }
      } catch (error) { rejectAdmissions(error); if (!closed) { closed = true; onExit(error); } }
    })();
    await query.initializationResult();
    return { thread: { id: sessionId } };
  };
  return {
    get closed() { return closed; },
    async call(method, params = {}) {
      if (method === 'thread/start' || method === 'thread/resume') return begin(method === 'thread/resume', params.threadId);
      if (method === 'account/read') { if (!query) await begin(false); const account = await query.accountInfo(); return { account }; }
      if (method === 'turn/interrupt') { await query?.interrupt(); return {}; }
      if (method !== 'turn/start' || !query) throw new Error(`Claude 不支持操作 ${method}`);
      turnId = randomUUID();
      const receipt = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(turnId); reject(new Error('Claude 未返回消息受理回执，请核对源会话')); }, 30000); pending.set(turnId, { resolve, reject, timer }); });
      stream.push({ type: 'user', session_id: sessionId, uuid: turnId, parent_tool_use_id: null, message: { role: 'user', content: params.input.map(item => ({ type: 'text', text: item.text })) } });
      return receipt;
    },
    reply(id, answer) {
      const request = questions.get(String(id)); if (!request) throw new Error('Claude 权限或问题已过期'); questions.delete(String(id));
      if (request.isQuestion) { const values = answer.answers || {}; request.resolve({ behavior: 'allow', updatedInput: { ...request.input, answers: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value?.answers) ? value.answers.join(', ') : String(value)])) } }); }
      else request.resolve(answer.decision === 'accept' ? { behavior: 'allow', updatedInput: request.input } : { behavior: 'deny', message: '用户拒绝了这次操作' });
    },
    reject(id) { const request = questions.get(String(id)); if (request) { questions.delete(String(id)); request.resolve({ behavior: 'deny', message: '用户停止了执行' }); } },
    async close() { closed = true; rejectAdmissions(new Error('Claude 执行已停止')); for (const id of questions.keys()) this.reject(id); stream?.end(); query?.close();
      if (nativeChild) {
        let timer;
        const wait = async ms => { try { await Promise.race([nativeExit, new Promise(resolve => { timer = setTimeout(resolve, ms); })]); } finally { clearTimeout(timer); } };
        await wait(3000);
        if (nativeChild.exitCode === null && nativeChild.signalCode === null) { nativeChild.kill('SIGKILL'); await wait(1500); }
        if (nativeChild.exitCode === null && nativeChild.signalCode === null) throw new Error('Agent 进程尚未确认退出');
      }
      await readTask; },
  };
}
export async function scanClaudeSessions(connection, { sdk: provided, now = Date.now() } = {}) {
  const sdk = provided || await loadClaudeSdk(), sessions = [];
  for (const info of await sdk.listSessions({ dir: connection.projectPath, includeWorktrees: false, limit: 1000 })) {
    if (info.cwd !== connection.projectPath || info.lastModified < now - 7 * 86400000) continue;
    const messages = await sdk.getSessionMessages(info.sessionId, { dir: connection.projectPath });
    const replies = messages.filter(m => m.type === 'assistant' && ['end_turn', 'stop_sequence'].includes(m.message?.stop_reason) && blocksText(m.message?.content)).map(m => ({ id: m.uuid, text: blocksText(m.message.content), at: m.timestamp || new Date(info.lastModified).toISOString() }));
    sessions.push({ sessionId: info.sessionId, connectionId: connection.connectionId, title: info.customTitle || info.summary || info.firstPrompt, updatedAt: new Date(info.lastModified).toISOString(), startedAt: info.createdAt ? new Date(info.createdAt).toISOString() : undefined, status: info.archived ? 'archived' : 'paused', tokens: null, replies: replies.slice(-1) });
  }
  return { sessions, coverage: '近 7 天 · 当前目录 · Claude 官方 SDK 会话读取' };
}
