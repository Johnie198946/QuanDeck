/** Read-only observers. No credential/config files are opened and no source turn is started. */
import path from 'node:path';
import { homedir } from 'node:os';
import { readdir, readFile, stat } from 'node:fs/promises';
import * as zlib from 'node:zlib';
const iso = value => { const n = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(n) ? new Date(n).toISOString() : null; };
const text = blocks => Array.isArray(blocks) ? blocks.filter(b => b.type === 'text').map(b => b.text || '').join('') : '';
const entries = async dir => { try { return await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
export async function scanDshSessions(connection, { now = Date.now(), root = connection.sessionRoot || path.join(process.env.DSH_HOME?.trim() || homedir() + '/.dsh', 'sessions') } = {}) {
  const sessions = []; let skipped = 0;
  const cutoff = now - 7 * 86400000;
  // The default shipped profile uses $DSH_HOME/sessions. Unknown layouts/versions are refused.
  for (const project of await entries(root)) {
    if (!project.isDirectory() || project.isSymbolicLink()) continue;
    for (const session of await entries(path.join(root, project.name))) {
      if (!session.isDirectory() || session.isSymbolicLink()) continue;
      const dir = path.join(root, project.name, session.name);
      const candidates = (await entries(dir)).filter(f => f.isFile() && !f.isSymbolicLink() && /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(f.name)).sort((a, b) => Number(b.name.match(/\.v(\d+)/)?.[1] || 0) - Number(a.name.match(/\.v(\d+)/)?.[1] || 0));
      if (!candidates.length) continue;
      const file = path.join(dir, candidates[0].name), info = await stat(file);
      if (info.mtimeMs < cutoff) continue;
      if (info.size > 32 * 1024 * 1024) { skipped++; continue; }
      try {
        const bytes = await readFile(file);
        const raw = file.endsWith('.zstd') ? zlib.zstdDecompressSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8') : bytes.toString('utf8');
        // A concurrent append may leave an unfinished last line: never consume it.
        const lines = raw.slice(0, raw.lastIndexOf('\n')).split('\n');
        const header = JSON.parse(lines.shift());
        if (header.type !== 'session' || !header.id || !header.cwd || path.resolve(header.cwd) !== path.resolve(connection.projectPath) || header.parentSession) continue;
        if (![2, 3, 4].includes(header.version)) { skipped++; continue; }
        let title = '', pendingReply = null, lastAt = iso(header.createdAt), status = 'paused', tokens = 0, hasTokens = false;
        const replies = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line), data = event.data || {};
          const at = iso(event.time); if (at) lastAt = at;
          if (event.type === 'user/message' && !title) title = text(data.content).trim().slice(0, 100);
          if (event.type === 'assistant/message') {
            const reply = text(data.message?.content); if (reply && at) pendingReply = { id: `${header.id}:${event.seq}`, text: reply, at };
            const total = data.usage?.totalTokens ?? (typeof data.usage?.inputTokens === 'number' && typeof data.usage?.outputTokens === 'number' ? data.usage.inputTokens + data.usage.outputTokens : null);
            if (Number.isFinite(total) && total !== null && total >= 0) { tokens += total; hasTokens = true; }
          }
          if (event.type === 'turn/start') status = 'paused'; // disk activity is not proof the owning process is still alive
          if (event.type === 'turn/end') {
            if (pendingReply) replies.push(pendingReply); pendingReply = null;
            status = data.reason?.kind === 'error' ? 'failed' : ['aborted', 'interrupted'].includes(data.reason?.kind) ? 'paused' : 'waiting_reply';
          }
        }
        if (lastAt && Date.parse(lastAt) >= cutoff) sessions.push({ sessionId: header.id, connectionId: connection.connectionId, title: title || `DSH 会话 ${header.id.slice(-8)}`, startedAt: iso(header.createdAt), updatedAt: lastAt, status, tokens: hasTokens ? tokens : null, replies });
      } catch { skipped++; } // never claim a corrupt/truncated compressed log is successfully indexed
    }
  }
  return { sessions, coverage: `近 7 天 · 当前目录 · DSH 本地公开回复${skipped ? `；${skipped} 个旧版、过大或未完整落盘记录未读取` : ''}` };
}
export async function scanCodexSessions(connection, rpc, { now = Date.now() } = {}) {
  const sessions = []; let cursor, pages = 0, skipped = 0;
  const cutoff = now - 7 * 86400000;
  do {
    const result = await rpc.call('thread/list', { cwd: connection.projectPath, limit: 100, sortKey: 'updated_at', sortDirection: 'desc', ...(cursor ? { cursor } : {}) });
    for (const thread of result.data || []) {
      if (thread.cwd !== connection.projectPath || thread.parentThreadId || thread.updatedAt * 1000 < cutoff) continue;
      try {
        const { thread: detail } = await rpc.call('thread/read', { threadId: thread.id, includeTurns: true });
        const replies = [];
        for (const turn of detail.turns || []) {
          if (!['completed', 'failed', 'interrupted'].includes(turn.status)) continue;
          const reply = (turn.items || []).filter(i => i.type === 'agentMessage' && i.text).at(-1);
          if (reply) replies.push({ id: reply.id, text: reply.text, at: iso((turn.completedAt || detail.updatedAt) * 1000) });
        }
        const state = detail.status?.type;
        sessions.push({ sessionId: thread.id, connectionId: connection.connectionId, title: detail.name || detail.preview?.slice(0, 100) || `Codex 会话 ${thread.id.slice(-8)}`, startedAt: iso(thread.createdAt * 1000), updatedAt: iso(thread.updatedAt * 1000), status: state === 'active' ? 'running' : state === 'systemError' ? 'failed' : replies.length ? 'waiting_reply' : 'paused', tokens: null, replies });
      } catch { skipped++; }
    }
    cursor = result.nextCursor; pages++;
    if ((result.data || []).at(-1)?.updatedAt * 1000 < cutoff) break;
  } while (cursor && pages < 20);
  return { sessions, coverage: `近 7 天 · 当前目录 · Codex 官方 App Server${skipped ? `；${skipped} 条源会话读取失败` : ''}${cursor && pages >= 20 ? '；仍有更早记录未扫描' : ''}` };
}
