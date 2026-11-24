import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Snapshot } from '../../data/types';
import { buildProjectMemory, renderProjectMemory, renderTaskMemoryDetail } from '../../data/projectMemory';
import { buildTaskMemoryIndex, queryTaskMemory } from '../../data/taskMemory';
import { ProjectReflection } from './ProjectReflection';
import { Icon } from '../ui/Icon';
import './projects.css';

export function ProjectMemoryButton({ snapshot }: { snapshot: Snapshot }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="qd-link" onClick={() => setOpen(true)}><Icon name="message" size={15} />项目记忆</button>{open && <ProjectMemoryDialog snapshot={snapshot} onClose={() => setOpen(false)} />}</>;
}

function ProjectMemoryDialog({ snapshot, onClose }: { snapshot: Snapshot; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const text = useMemo(() => renderProjectMemory(snapshot), [snapshot]);
  const [view, setView] = useState<'brief' | 'tasks' | 'sources' | 'reflection'>('brief');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const taskIndex = useMemo(() => view === 'tasks' ? buildTaskMemoryIndex(snapshot) : undefined, [snapshot, view]);
  useEffect(() => { setCursors([undefined]); setSelected(undefined); }, [snapshot.project.id, query, taskIndex?.identity]);
  const matches = useMemo(() => {
    if (view !== 'tasks') return undefined;
    const request = { projectId: snapshot.project.id, query, limit: 12, includeArchived: true };
    try { return queryTaskMemory(snapshot, { ...request, cursor: cursors.at(-1) }, taskIndex); }
    catch { return queryTaskMemory(snapshot, request, taskIndex); }
  }, [snapshot, view, query, cursors, taskIndex]);
  const detail = useMemo(() => selected ? renderTaskMemoryDetail(snapshot, selected) : '', [snapshot, selected]);
  const references = useMemo(() => {
    if (view !== 'sources') return '';
    const memory = buildProjectMemory(snapshot, []);
    return ['## 已采用方向', ...memory.directions.map(direction => `### 方向 v${direction.version}\n` + direction.sections.map(section => `${section.title}\n${section.lines.map(line => `- ${line.text}（${line.state === 'fixed' ? '已确认' : line.state === 'tentative' ? '暂定' : '待决定'}）`).join('\n')}`).join('\n\n')),
      ...(!memory.directions.length ? ['尚未采用项目方向。'] : []),
      '## 已确认条件', ...memory.constraints.map(item => `- ${item.text}\n  来源 ${item.id} · v${item.revision} · ${item.scope === 'project' ? '整个项目' : '任务 ' + item.scope}`),
      '## 正式规范', ...(memory.projectSpec ? [`v${memory.projectSpec.version} · ${memory.projectSpec.versionId}`, ...memory.projectSpec.sections.map(section => `### ${section.title}\n${section.body}`)] : ['尚未发布正式规范。'])].join('\n\n');
  }, [snapshot, view]);
  const [message, setMessage] = useState('');
  useEffect(() => { const trigger = document.activeElement as HTMLElement | null, node = ref.current; node?.showModal(); return () => { node?.close(); if (trigger?.isConnected) trigger.focus(); }; }, []);
  const exportTask = view === 'tasks' && selected && snapshot.collaboration?.tasks[selected];
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportTask ? '# ' + snapshot.project.name + ' · 任务交接\n\n' + detail : text], { type: 'text/markdown;charset=utf-8' })), link = document.createElement('a');
    link.href = url; link.download = `${snapshot.project.name.replace(/[\\/:*?"<>|]/g, '-') || '项目'}-${exportTask ? exportTask.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) + '-交接' : '项目记忆'}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(exportTask ? '已导出所选任务的完整交接' : '已导出当前项目记忆');
  };
  return createPortal(<dialog ref={ref} className="qd-discussion-dialog qd-project-memory" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><p className="qd-memory-eyebrow">{snapshot.project.name}</p><h2 id={titleId}>项目记忆</h2></div><button type="button" className="qd-icon-btn" aria-label="关闭项目记忆" onClick={onClose}><Icon name="close" size={18} /></button></header>
    <p className="qd-dialog-description">先了解来由和下一步，再按需查阅交接与规范。任务只携带相关依据。</p>
    <div className="qd-memory-views" role="group" aria-label="记忆内容">{([['brief', '项目简报'], ['tasks', '任务交接'], ['sources', '方向与规范'], ['reflection', '复盘经验']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div>
    {view === 'reflection' && <ProjectReflection snapshot={snapshot} />}
    {view === 'tasks' && <section className="qd-memory-search" aria-label="本项目任务交接">
      <label>查找任务或结论<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="输入任务名称、编号或关键词" /></label>
      <p role="status">{matches?.total ?? 0} 项匹配 · 每页最多 12 项</p>
      <ul>{matches?.items.map(card => <li key={card.key}><button type="button" aria-pressed={selected === card.key} onClick={() => setSelected(card.key)}><strong>{card.title}</strong><span>{card.stale ? '需复核' : card.summaryKind === 'accepted-result' ? '已验收' : card.summaryKind === 'candidate' ? '候选，尚未验收' : '尚未提交'}{card.archived ? ' · 已归档' : ''}</span></button></li>)}</ul>
      {!!matches?.total && <div className="qd-memory-pages"><button type="button" className="qd-btn ghost" disabled={cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>上一页</button><button type="button" className="qd-btn ghost" disabled={!matches?.nextCursor} onClick={() => setCursors(value => [...value, matches?.nextCursor])}>下一页</button></div>}
      {!selected && <p>选择一项，查看完整要求、交接内容和来源。原始结果仍在对应成果地图中。</p>}
    </section>}
    {view !== 'reflection' && <div className="qd-memory-document"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt || '资料图片'}</span> }}>{view === 'brief' ? text : view === 'sources' ? references : detail}</ReactMarkdown></div>}
    <p role="status" className="qd-memory-feedback">{message}</p>
    <footer><button type="button" className="qd-btn ghost" onClick={onClose}>关闭</button><button type="button" className="qd-btn primary" onClick={download}>{exportTask ? '导出这项交接' : '导出项目简报'}</button></footer>
  </dialog>, document.body);
}
