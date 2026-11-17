import { useRef, useState } from 'react';
import { countOpen, findLine } from '../../data/ideas';
import { rootPlanOf } from '../../data/ideaEngine';
import { latestConclusion } from '../../data/discussion';
import type { IdeaPlan, PlanLine } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { MarkdownMessage } from '../runtime/RichMessage';
import { PlanActions } from './PlanActions';
import { PlanOutlineEditor } from './PlanOutlineEditor';
import { PlanDiscussionBody } from './PlanDiscussionBody';
import { GoalAutomationControl } from './GoalAutomationControl';
import { PlanDeliverables } from './PlanDeliverables';
import { Icon } from '../ui/Icon';
import './direction-document.css';

const STATE_LABEL = { fixed: '已确定', tentative: '暂定', open: '待补充' };

/** The outline and readable body are the same saved document, not separate state. */
export function PlanDocView({ plan, documentVersion = 'draft', onDocumentVersion, onDiscussSection }: {
  plan: IdeaPlan; documentVersion?: 'draft' | 'adopted'; onDocumentVersion?: (version: 'draft' | 'adopted') => void; onDiscussSection?: (scope: string) => void;
}) {
  const { snap, api, patchWorkspace } = useWorkdeck();
  const [editing, setEditing] = useState(false), [active, setActive] = useState('discussion');
  const splittingRef = useRef(false);
  const [splitting, setSplitting] = useState(false), [splitError, setSplitError] = useState('');
  const readOnly = documentVersion === 'adopted' && !!plan.adopted;
  const doc = readOnly ? plan.adopted!.doc : plan.draft;
  const version = readOnly ? plan.adopted!.draftVersion ?? plan.adopted!.version : plan.draftVersion;
  const root = rootPlanOf(snap, plan.taskId);
  const parentDoc = root?.adopted?.doc ?? root?.draft;
  const inherited = plan.itemId && parentDoc ? (plan.inherit ?? []).map(id => findLine(parentDoc, id)?.line).filter(Boolean) as PlanLine[] : [];
  const latest = readOnly ? null : latestConclusion(plan, 'root');
  const open = countOpen(doc);
  const empty = !doc.sections.some(section => section.lines.length);
  const approved = plan.adopted?.draftVersion === plan.draftVersion;
  const select = (id: string) => {
    setActive(id);
    const element = document.getElementById(`direction-${plan.id}-${id}`);
    element?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    element?.focus({ preventScroll: true });
  };
  const toDrafts = async () => {
    if (readOnly || splittingRef.current) return;
    splittingRef.current = true; setSplitting(true); setSplitError('');
    try { await api.generateDrafts(plan.id); patchWorkspace({ mode: 'drafts', pane: 'main' }); }
    catch (error) { setSplitError(error instanceof Error ? error.message : '暂未能读取拆分草稿，请重试'); }
    finally { splittingRef.current = false; setSplitting(false); }
  };
  const sections = doc.sections;
  const rawTitle = (plan.scope !== "project" && !plan.itemId ? snap.tasks[plan.taskId]?.title : undefined) || plan.title;
  const heading = Array.from(rawTitle).length > 56 ? `${Array.from(rawTitle).slice(0,56).join("")}…` : rawTitle;
  return <div className="qd-plan qd-direction-doc" data-plan-id={plan.id}>
    <header className="qd-plan-head">
      <div><span className="qd-direction-eyebrow">方向方案</span><h2 title={rawTitle}>{heading}</h2>{rawTitle !== heading && <details className="qd-direction-original"><summary>查看完整需求</summary><p>{rawTitle}</p></details>}<p className="qd-plan-status">v{version} · {readOnly ? '已确认快照 · 只读' : approved ? '已确认版本' : '待确认版本'}{open ? ` · ${open} 项可补充` : ''}</p></div>
      {!readOnly && <PlanActions plan={plan} />}
    </header>
    {plan.adopted && onDocumentVersion && <div className="qd-direction-document-version"><label>正文版本<select aria-label="切换正文版本" disabled={splitting} value={readOnly ? 'adopted' : 'draft'} onChange={event => { setEditing(false); onDocumentVersion(event.target.value as 'draft' | 'adopted'); }}>
      <option value="draft">当前草稿 · v{plan.draftVersion}</option><option value="adopted">最近确认 · v{plan.adopted.draftVersion ?? plan.adopted.version} · 只读</option>
    </select></label><span>讨论结论记录与正文版本分别保存。</span></div>}
    {readOnly ? <div className="qd-direction-readonly" role="status"><p>正在阅读最近确认的正文快照。侧栏讨论基于当前草稿；修改或执行请先返回草稿。</p><button type="button" className="qd-btn ghost small" onClick={() => onDocumentVersion?.('draft')}>返回当前草稿</button></div> : <div className="qd-direction-toolbar"><p>先确定方向与执行逻辑，再按任务逐项完成。</p><button type="button" className="qd-btn ghost small" onClick={() => setEditing(true)}><Icon name="pencil" size={14} />编辑大纲与正文</button><button type="button" className="qd-link" disabled={splitting} aria-busy={splitting} onClick={() => void toDrafts()}>{splitting ? '正在读取拆分…' : '查看任务拆分'}<Icon name="chevron-right" size={14} /></button>{splitError && <p role="alert">{splitError} 可再次点击“查看任务拆分”重试。</p>}</div>}
    {!readOnly && <GoalAutomationControl plan={plan} />}
    <div className="qd-direction-reading-layout">
      <nav className="qd-direction-outline" aria-label="方向方案大纲"><h3>方案大纲</h3>
        {latest && <button type="button" aria-current={active === 'discussion' ? 'location' : undefined} onClick={() => select('discussion')}><span>概览</span>当前讨论建议</button>}
        {sections.map((section, index) => <button key={section.id} type="button" aria-current={active === section.id ? 'location' : undefined} onClick={() => select(section.id)}><span>{String(index + 1).padStart(2, '0')}</span>{section.title}{!section.lines.length && <small>待补充</small>}</button>)}
        {!readOnly && <button type="button" aria-current={active === 'deliverables' ? 'location' : undefined} onClick={() => select('deliverables')}><span>交付</span>最终会得到什么</button>}
      </nav>
      <div className="qd-direction-body">
        {latest && <section id={`direction-${plan.id}-discussion`} tabIndex={-1} className="qd-direction-section qd-direction-latest"><header><div><span className="qd-direction-eyebrow">当前讨论建议</span><h3>先看方向，再看分工</h3></div><span className="qd-direction-version">{latest.adopted ? '已采纳' : '讨论中'}</span></header><PlanDiscussionBody plan={plan} result={latest} /><p className="qd-direction-feedback-note">对图片、路线或选项的反馈只调整这一部分；确认并执行整个方向，请使用页首按钮。</p></section>}
        {!readOnly && inherited.length > 0 && <section className="qd-direction-section is-inherited"><h3>沿用上级方向</h3>{inherited.map(line => <MarkdownMessage key={line.id} text={line.text} runId="" />)}</section>}
        {empty && !latest && (readOnly ? <p className="qd-direction-empty">确认时尚无正文。</p> : <div className="qd-direction-empty"><h3>先写下你希望怎样完成</h3><p>你可以自主填写大纲和正文，也可以在“讨论与版本”中请 Agent 帮忙。明确的任务仍可直接执行。</p><button type="button" className="qd-btn ghost small" onClick={() => setEditing(true)}>写下方向</button></div>)}
        {sections.map((section, index) => <section key={section.id} id={`direction-${plan.id}-${section.id}`} data-plan-section={section.id} tabIndex={-1} className="qd-direction-section">
          <header><div><span className="qd-direction-eyebrow">{String(index + 1).padStart(2, '0')}</span><h3>{section.title}</h3></div>{!readOnly && <button type="button" className="qd-link" onClick={() => onDiscussSection ? onDiscussSection(section.id) : patchWorkspace({ scope: section.id, pane: 'side' })}><Icon name="message" size={13} />讨论这一节</button>}</header>
          {section.lines.length ? <div className="qd-direction-paragraphs">{section.lines.map(line => <div key={line.id} className={`qd-direction-paragraph state-${line.state}`}><span className="qd-direction-line-state">{STATE_LABEL[line.state]}</span><MarkdownMessage text={line.text} runId="" /></div>)}</div> : readOnly ? <p className="qd-direction-empty">确认时此章节尚无正文。</p> : <button type="button" className="qd-direction-add" onClick={() => setEditing(true)}><Icon name="plus" size={14} />补充这部分方向</button>}
        </section>)}
        {!readOnly && <PlanDeliverables plan={plan} />}
      </div>
    </div>
    {editing && !readOnly && <PlanOutlineEditor plan={plan} onClose={() => setEditing(false)} />}
  </div>;
}
