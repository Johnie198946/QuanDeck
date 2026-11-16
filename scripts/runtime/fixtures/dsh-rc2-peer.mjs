// Synthetic peer constrained to the published dsh-v0.2.0-rc.2 wire schema.
// It verifies adapter boundaries; it is not a live vendor/model integration test.
import readline from 'node:readline';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
if (process.argv.includes('--version')) { console.log('0.2.0-rc.2'); process.exit(0); }
const sessions = new Map(); let eventId = 0;
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const notify = (method, params) => send({ method, params });
const event = (sessionId, type, data) => notify('session.event', { sessionId, event: { seq: ++eventId, type, data } });
const finish = (sessionId, round, reason = { kind: 'completed' }) => {
  event(sessionId, 'assistant/message', { message: { content: [{ type: 'text', text: `rc2 第 ${round} 轮回报` }] }, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 3, reasoningTokens: 4 } });
  event(sessionId, 'turn/end', { turn: round, reason });
  notify('session.status', { sessionId, status: 'idle' });
};
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line), params = message.params || {};
  appendFileSync(path.join(process.cwd(), 'rc2-wire.jsonl'), JSON.stringify(message) + '\n');
  if (message.method === 'initialize') {
    if (Object.keys(params).some(key => !['cwd', 'provider', 'model', 'reasoningEffort', 'maxTokens'].includes(key))) { send({ id: message.id, error: { code: -32602, message: 'rc2 does not negotiate interaction capabilities' } }); return; }
    send({ id: message.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } } });
  } else if (message.method === 'session/prompt') {
    const round = (sessions.get(params.sessionId) || 0) + 1; sessions.set(params.sessionId, round);
    const prompt = params.contentBlocks?.[0]?.text;
    if (prompt === 'missing-ack') { send({ id: message.id, result: {} }); return; }
    send({ id: message.id, result: { messageId: `message-${round}` } });
    notify('session.status', { sessionId: params.sessionId, status: 'running' });
    event(params.sessionId, 'step/start', { step: round });
    if (prompt === 'crash') { process.exit(2); return; }
    if (prompt === 'hold') return;
    if (prompt === 'permission') {
      event(params.sessionId, 'approval/asked', { id: 'approval-1', toolName: 'shell', callId: 'call-1', reason: '需要写入工作区外' });
      event(params.sessionId, 'approval/decided', { id: 'approval-1', outcome: 'unavailable' });
      event(params.sessionId, 'tool/result', { callId: 'call-1', message: { isError: true, content: [] }, error: { reason: 'Approval unavailable' } });
    }
    if (prompt === 'unexpected-request') {
      send({ id: 900, method: 'approval/request', params: { requestId: 'not-an-rc2-method', toolName: 'shell' } });
    }
    if (prompt === 'children') {
      notify('subagent.started', { parentSessionId: params.sessionId, childSessionId: 'known-child' });
      event('known-child', 'assistant/message', { message: { content: [{ type: 'text', text: 'child text' }] }, usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 } });
      event('known-child', 'assistant/message', { message: { content: [{ type: 'text', text: 'next child step' }] }, usage: { totalTokens: 7 } });
      notify('subagent.finished', { parentSessionId: params.sessionId, childSessionId: 'known-child', status: 'ok', stopReason: 'max-tokens', lastAssistantMessage: [{ type: 'text', text: 'partial child output' }] });
      event('unrelated', 'assistant/message', { message: { content: [{ type: 'text', text: 'unrelated output' }] }, usage: { totalTokens: 9999 } });
      notify('subagent.started', { parentSessionId: 'unrelated', childSessionId: 'unrelated-child' });
    }
    finish(params.sessionId, round, prompt === 'max-tokens' ? { kind: 'max-tokens' } : prompt === 'blocked' ? { kind: 'blocked' } : { kind: 'completed' });
  } else if (message.method === 'shutdown') {
    send({ id: message.id, result: {} }); setTimeout(() => { appendFileSync(path.join(process.cwd(), 'rc2-flushed.txt'), 'flushed\n'); process.exit(0); }, 60);
  } else if (message.method) {
    send({ id: message.id, error: { code: -32601, message: `rc2 does not implement ${message.method}` } });
  }
});
