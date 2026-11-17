import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Snapshot } from '../../data/types';
import { renderProjectMemory } from '../../data/projectMemory';
import { Icon } from '../ui/Icon';
import './projects.css';

export function ProjectMemoryButton({ snapshot }: { snapshot: Snapshot }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="qd-link" onClick={() => setOpen(true)}><Icon name="message" size={15} />项目记忆</button>{open && <ProjectMemoryDialog snapshot={snapshot} onClose={() => setOpen(false)} />}</>;
}

function ProjectMemoryDialog({ snapshot, onClose }: { snapshot: Snapshot; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const text = useMemo(() => renderProjectMemory(snapshot), [snapshot]);
  const [message, setMessage] = useState('');
  useEffect(() => { const trigger = document.activeElement as HTMLElement | null, node = ref.current; node?.showModal(); return () => { node?.close(); if (trigger?.isConnected) trigger.focus(); }; }, []);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })), link = document.createElement('a');
    link.href = url; link.download = `${snapshot.project.name.replace(/[\\/:*?"<>|]/g, '-') || '项目'}-项目记忆.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('已导出当前项目记忆');
  };
  return createPortal(<dialog ref={ref} className="qd-discussion-dialog qd-project-memory" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><p className="qd-memory-eyebrow">{snapshot.project.name}</p><h2 id={titleId}>给新会话的项目记忆</h2></div><button type="button" className="qd-icon-btn" aria-label="关闭项目记忆" onClick={onClose}><Icon name="close" size={18} /></button></header>
    <p className="qd-dialog-description">项目来由、已定结论、任务交接与接下来要做的事。开始任务时会自动附上对应任务要求。</p>
    <div className="qd-memory-document"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt || '资料图片'}</span> }}>{text}</ReactMarkdown></div>
    <p role="status" className="qd-memory-feedback">{message}</p>
    <footer><button type="button" className="qd-btn ghost" onClick={onClose}>关闭</button><button type="button" className="qd-btn primary" onClick={download}>导出项目记忆</button></footer>
  </dialog>, document.body);
}
