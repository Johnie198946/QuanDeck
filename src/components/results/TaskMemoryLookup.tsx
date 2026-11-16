import { useMemo, useRef, useState } from 'react';
import { buildTaskMemoryIndex, queryTaskMemory } from '../../data/taskMemory';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';

export function TaskMemoryLookup() {
  const { snap, openWorkspace, openSourceSession, toast } = useWorkdeck();
  const [query, setQuery] = useState('');
  const cache = useRef<{ snapshot: typeof snap; index: ReturnType<typeof buildTaskMemoryIndex> } | null>(null);
  const result = useMemo(() => {
    if (!query.trim()) return null;
    if (!cache.current || cache.current.snapshot !== snap || cache.current.index.validUntil <= Date.now()) cache.current = { snapshot: snap, index: buildTaskMemoryIndex(snap) };
    return queryTaskMemory(snap, { projectId: snap.project.id, query, limit: 8, includeArchived: true }, cache.current.index);
  }, [snap, query]);
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); toast('已复制'); } catch { toast('复制失败，请选中文字复制', 'error'); } };
  return <section className="qd-memory-lookup" aria-label="查询任务与来源会话"><label><Icon name="search" size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="查任务、结论或 Agent Session ID" aria-label="查任务、结论或 Agent Session ID" />{query && <button type="button" aria-label="清空任务查询" onClick={() => setQuery('')}><Icon name="close" size={14} /></button>}</label>
    {result && <div className="qd-memory-matches"><p role="status">{result.total ? `找到 ${result.total} 项${result.total > result.items.length ? ` · 显示前 ${result.items.length} 项` : ''}` : '没有找到匹配任务'}</p>{result.items.map(card => <article key={card.key}><header><button type="button" disabled={!snap.tasks[card.taskId]} onClick={() => openWorkspace(card.taskId, { view: 'results', selected: card.workItemId ?? null, focus: true })}>{card.title}<Icon name="arrow-right" size={13} /></button><span>{card.archived ? '已归档' : card.stale ? '待重新核对' : card.summaryKind === 'accepted-result' ? '已验收' : card.summaryKind === 'candidate' ? '候选成果' : '任务目标'}</span></header><p>{card.summary}</p><details><summary>任务与会话链路 · {card.executions.length}</summary><div className="qd-memory-id"><span>任务 ID</span><code>{card.key}</code><button type="button" onClick={() => void copy(card.key)}>复制</button></div>{!card.executions.length && <small>尚无 Agent 会话记录。</small>}{card.executions.map(execution => <section key={execution.id}><strong>{execution.tool} · {snap.agents.find(agent => agent.id === execution.agentId)?.name ?? execution.agentId}</strong>{([['本地会话', execution.sessionId], ['Agent Session', execution.sourceSessionId], ['连接', execution.connectionId], ['执行', execution.runId]] as [string,string | undefined][]).filter((pair): pair is [string,string] => !!pair[1]).map(([name,id]) => <div className="qd-memory-id" key={name}><span>{name}</span><code>{id}</code><button type="button" onClick={() => void copy(id)}>复制</button></div>)}<button type="button" className="qd-link" onClick={() => openSourceSession(execution.sessionId)}>打开来源会话<Icon name="external" size={12} /></button></section>)}</details></article>)}</div>}
  </section>;
}
