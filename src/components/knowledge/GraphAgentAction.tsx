import { useEffect, useState } from 'react';
import { desktopHost } from '../../integration/desktop';
import type { KnowledgeLibrary } from '../../data/knowledgeNotes';
import { Icon } from '../ui/Icon';
import './graph-agent.css';

function failureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') ||
    'Agent 暂时无法生成图谱，请稍后再试。';
}

export function GraphAgentAction({ library }: { library: KnowledgeLibrary }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  useEffect(() => {
    const host = desktopHost();
    let current = true, notified = false;
    const off = host?.onKnowledgeGraphProgress?.(next => { notified = true; setProgress(next); });
    void host?.getKnowledgeGraphProgress?.().then(next => { if (current && !notified) setProgress(next); }).catch(() => {});
    return () => { current = false; off?.(); };
  }, []);
  const [failed, setFailed] = useState(false);
  const graph = library.agentGraph;
  const coverage = graph?.reasoning?.attachmentCoverage ?? [];
  const states: Record<string,string> = {read:'已读取',partial:'已读取可识别部分',unsupported:'本机暂不支持',empty:'未识别到文字',failed:'未能读取'};
  const latest = new Map(graph?.notes.map(note => [note.id, note.revision]));
  const stale = graph && (latest.size !== library.notes.length || library.notes.some(note => latest.get(note.id) !== note.revision));

  const title = '用首个已连接的 Agent 从笔记提取观点，再核对原文、关联和适用条件';
  async function generate() {
    setFailed(false);
    setBusy(true);
    setStatus('');
    try {
      const host = desktopHost();
      if (!host?.generateKnowledgeGraph) throw new Error('请在桌面版连接 Agent 后分析笔记。');
      const result = await host.generateKnowledgeGraph();
      setStatus(result.reused ? '笔记和 Agent 配置都没变，已沿用上次结果。' : result.count ? `已检查 ${result.noteCount} 篇笔记，找到 ${result.count} 条关联。` : `已检查 ${result.noteCount} 篇笔记，暂未找到有原文依据的关联。`);
    } catch (error) { setFailed(true); setStatus(failureMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="qd-graph-agent-action">
    <button className="qd-btn ghost" type="button" title={title} disabled={busy || !!progress || !library.notes.length}
      onClick={() => void generate()}><Icon name="bulb" size={15} />
      {progress ? `分析中 · ${progress.completed + 1}/${progress.total}` : busy ? 'Agent 正在找关联…' : '用 Agent 找关联'}</button>
    {library.notes.length > 0 && <details className="qd-graph-agent-scope"><summary>分析范围</summary><p>分析 {library.notes.length} 篇笔记的文字及选段问答，引用可回到原文。保存后会更新改动的部分；使用桌面版时，每周回顾历史材料。{graph && `上次分析了 ${graph.notes.length} 篇，找到 ${graph.edges.length} 条关联。`}</p>
      {coverage.length>0 && <ul>{coverage.map(file=><li key={file.noteId+':'+file.fileId}>{file.name} · {states[file.status]}{file.method && '（'+file.method+'）'}</li>)}</ul>}</details>}
    {(status || stale) && <small role={failed ? 'alert' : 'status'}>{stale && !failed ? '笔记已更新，可重新分析。' : status}</small>}
  </div>;
}
