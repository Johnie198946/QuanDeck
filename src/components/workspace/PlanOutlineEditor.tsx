import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CommandResult, IdeaPlan, PlanSection } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';

type OutlineSource = { savePlanOutline(planId: string, sections: PlanSection[], expectedDraftVersion: number, projectId?: string): Promise<CommandResult> };
const uid = () => crypto.randomUUID();

export function PlanOutlineEditor({ plan, onClose }: { plan: IdeaPlan; onClose: () => void }) {
  const { api, snap, toast } = useWorkdeck();
  const [sections, setSections] = useState(() => plan.draft.sections.map(section => ({ ...section, body: section.lines.map(line => line.text).join('\n\n') })));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), version = useRef(plan.draftVersion);
  useEffect(() => { const trigger = document.activeElement as HTMLElement | null; const element = dialog.current; element?.showModal(); return () => { element?.close(); requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus(); }); }; }, []);
  const patch = (id: string, change: Partial<typeof sections[number]>) => setSections(rows => rows.map(row => row.id === id ? { ...row, ...change } : row));
  const save = async () => {
    if (busy) return;
    if (sections.some(section => !section.title.trim())) { setError('请为每一节填写标题。'); return; }
    setBusy(true); setError('');
    try {
      const prepared: PlanSection[] = sections.map(({ body, ...section }) => {
        if (body === section.lines.map(line => line.text).join('\n\n')) return { ...section, title: section.title.trim() };
        const unused = [...section.lines];
        const lines = body.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean).map(text => {
          const index = unused.findIndex(line => line.text === text);
          const existing = index >= 0 ? unused.splice(index, 1)[0] : undefined;
          return existing ?? { id: `line-${uid()}`, text, state: 'tentative' as const, userEdited: true };
        });
        return { ...section, title: section.title.trim(), lines };
      });
      const result = await (api as typeof api & OutlineSource).savePlanOutline(plan.id, prepared, version.current, snap.project.id);
      if (!result.ok) throw new Error(result.message || '方案暂未保存');
      toast('方向正文已保存。新版本需单独确认。'); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，输入仍保留。'); }
    finally { setBusy(false); }
  };
  return createPortal(<dialog ref={dialog} className="qd-outline-editor" aria-labelledby="direction-editor-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><h2 id="direction-editor-title">编辑方向大纲与正文</h2><p>基于 v{version.current} · 空行分段，保留 Markdown 格式</p></div><button type="button" className="qd-icon-btn" aria-label="关闭编辑" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></header>
    <div className="qd-outline-editor-sections">{sections.map((section, index) => <section key={section.id}>
      <div><span>{String(index + 1).padStart(2, '0')}</span><input aria-label={`第 ${index + 1} 节标题`} value={section.title} disabled={busy} onChange={event => patch(section.id, { title: event.target.value })} /><button type="button" className="qd-icon-btn" aria-label={`删除章节 ${section.title || index + 1}`} disabled={busy} onClick={() => setSections(rows => rows.filter(row => row.id !== section.id))}><Icon name="close" size={14} /></button></div>
      <textarea aria-label={`${section.title || `第 ${index + 1} 节`}正文`} rows={Math.min(8, Math.max(3, section.body.split('\n').length))} value={section.body} disabled={busy} placeholder="写下方向、执行逻辑或需要保留的约束…" onChange={event => patch(section.id, { body: event.target.value })} />
    </section>)}<button type="button" className="qd-link" disabled={busy} onClick={() => setSections(rows => [...rows, { id: `section-${uid()}`, title: '', kind: 'body', lines: [], body: '' }])}><Icon name="plus" size={14} />添加章节</button></div>
    <footer>{error && <p role="alert">{error}</p>}<span>保存只更新方向，不会启动任务。</span><button type="button" className="qd-btn ghost" disabled={busy} onClick={onClose}>取消</button><button type="button" className="qd-btn primary" disabled={busy || !sections.length} onClick={() => void save()}>{busy ? '正在保存…' : '保存方向正文'}</button></footer>
  </dialog>, document.body);
}
