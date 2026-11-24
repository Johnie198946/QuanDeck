import { useRef, useState } from 'react';
import { countOpen, findLine } from '../../data/ideas';
import { rootPlanOf } from '../../data/ideaEngine';
import { latestConclusion } from '../../data/discussion';
import { directionDeliverables } from '../../data/directionDeliverables';
import { directionFlowInput } from '../../data/directionFlow';
import { directionReadingSections } from '../../data/discussionAuthority';
import type { IdeaPlan, PlanLine } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { MarkdownMessage } from '../runtime/RichMessage';
import { PlanActions } from './PlanActions';
import { PlanOutlineEditor } from './PlanOutlineEditor';
import { PlanDiscussionBody } from './PlanDiscussionBody';
import { GoalAutomationControl } from './GoalAutomationControl';
import { PlanFlow } from './PlanFlow';
import { PlanDeliverables } from './PlanDeliverables';
import { Icon } from '../ui/Icon';
import './direction-document.css';

const STATE_LABEL = { fixed: '已确定', tentative: '暂定', open: '待补充' };

/** The outline and readable body are the same saved document, not separate state. */
export function PlanDocView({ plan, documentVersion = 'draft', summaryShown = false, onDocumentVersion, onDiscussSection, retrospective = false }: {
  plan: IdeaPlan; summaryShown?: boolean; retrospective?: boolean; documentVersion?: 'draft' | 'adopted'; onDocumentVersion?: (version: 'draft' | 'adopted') => void; onDiscussSection?: (scope: string) => void;
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
  const sections = directionReadingSections(doc, plan.id);
  const empty = !sections.length;
  const flow = !readOnly ? directionFlowInput(snap, plan) : null;
  const showFlow = !!flow && (flow.total > 1 || flow.missing);
  const deliveries = !readOnly ? directionDeliverables(snap, plan) : null;
  const showDeliveries = !!deliveries && (!!deliveries.current.length || deliveries.proposed !== undefined);
  const proposals = !latest?.adopted ? latest?.outline?.filter(section => section.lines.some(line => line.text.trim())) ?? [] : [];
  const showDiscussion = !!latest && (!summaryShown || !!(proposals.length || latest.proposed?.length || latest.open.length));
  const discussionTitle = latest?.adopted ? '已采纳的讨论' : '当前讨论建议';
  const editable = !readOnly && !retrospective;
  const currentSection = active === 'discussion' && !showDiscussion ? sections[0]?.id : active;
  const hasOutline = !!(sections.length || showDiscussion || showFlow || showDeliveries || (!readOnly && inherited.length));
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
  const rawTitle = (plan.scope !== "project" && !plan.itemId ? snap.tasks[plan.taskId]?.title : undefined) || plan.title;
  const heading = Array.from(rawTitle).length > 56 ? `${Array.from(rawTitle).slice(0,56).join("")}…` : rawTitle;
  return <div className="qd-plan qd-direction-doc" data-plan-id={plan.id}>
    <header className="qd-plan-head">
      <div><span className="qd-direction-eyebrow">方向方案</span><h2 title={rawTitle}>{heading}</h2>{rawTitle !== heading && <details className="qd-direction-original"><summary>查看完整需求</summary><p>{rawTitle}</p></details>}<p className="qd-plan-status">v{version} · {readOnly ? '已确认快照 · 只读' : approved ? '已确认版本' : retrospective ? '草稿留存' : '待确认版本'}{editable && open ? ` · ${open} 项可补充` : ''}</p></div>
      {editable && (latest || approved ? <PlanActions plan={plan} /> : <details className="qd-plan-secondary"><summary>确认与执行</summary><PlanActions plan={plan} /></details>)}
    </header>
    {plan.adopted && onDocumentVersion && <div className="qd-direction-document-version"><label>正文版本<select aria-label="切换正文版本" disabled={splitting} value={readOnly ? 'adopted' : 'draft'} onChange={event => { setEditing(false); onDocumentVersion(event.target.value as 'draft' | 'adopted'); }}>
      <option value="draft">当前草稿 · v{plan.draftVersion}</option><option value="adopted">最近确认 · v{plan.adopted.draftVersion ?? plan.adopted.version} · 只读</option>
    </select></label></div>}
    {!readOnly && <div className="qd-direction-toolbar"><details className="qd-plan-secondary"><summary>方案工具</summary><div><button type="button" className="qd-btn ghost small" onClick={() => setEditing(true)}><Icon name="pencil" size={14} />编辑大纲与正文</button>{editable && <button type="button" className="qd-link" disabled={splitting} aria-busy={splitting} onClick={() => void toDrafts()}>{splitting ? '正在读取拆分…' : '查看任务拆分'}<Icon name="chevron-right" size={14} /></button>}{splitError && <p role="alert">{splitError} 可再次点击“查看任务拆分”重试。</p>}</div></details></div>}
    {editable && snap.collaboration?.goalAutomation?.[plan.id] && <GoalAutomationControl plan={plan} />}
    <div className={hasOutline ? "qd-direction-reading-layout" : "qd-direction-reading-blank"}>
      {hasOutline && <nav className="qd-direction-outline" aria-label="方向方案大纲"><h3>方案大纲</h3>
        {showFlow && <button type="button" aria-current={active === 'flow' ? 'location' : undefined} onClick={() => select('flow')}><span>流程</span>已登记任务流程</button>}
        {showDiscussion && <button type="button" aria-current={active === 'discussion' ? 'location' : undefined} onClick={() => select('discussion')}><span>概览</span>{discussionTitle}</button>}
        {proposals.map((section, index) => sections.some(saved => saved.title === section.title) ? null : <button key={index} type="button" aria-current={active === 'proposal-' + index ? 'location' : undefined} onClick={() => select('proposal-' + index)}><span>提议</span>{section.title}</button>)}
        {!readOnly && inherited.length > 0 && <button type="button" aria-current={active === 'inherited' ? 'location' : undefined} onClick={() => select('inherited')}><span>引用</span>沿用上级方向</button>}
        {sections.map((section, index) => <button key={section.id} type="button" aria-current={currentSection === section.id ? 'location' : undefined} onClick={() => select(section.id)}><span>{String(index + 1).padStart(2, '0')}</span>{section.title}</button>)}
        {showDeliveries && <button type="button" aria-current={active === 'deliverables' ? 'location' : undefined} onClick={() => select('deliverables')}><span>交付</span>{deliveries?.current.length === 1 ? deliveries.current[0].title : '交付清单'}</button>}
      </nav>}
      <div className="qd-direction-body">
        {showFlow && <PlanFlow plan={plan} input={flow} />}
        {showDiscussion && latest && <section id={`direction-${plan.id}-discussion`} tabIndex={-1} className="qd-direction-section qd-direction-latest"><header><div><h3>{discussionTitle}</h3></div><span className="qd-direction-version">{latest.adopted ? '已采纳' : '讨论中'}</span></header><PlanDiscussionBody plan={plan} result={latest} showSummary={!summaryShown} /></section>}
        {!readOnly && inherited.length > 0 && <section id={`direction-${plan.id}-inherited`} tabIndex={-1} className="qd-direction-section is-inherited"><h3>沿用上级方向</h3>{inherited.map(line => <MarkdownMessage key={line.id} text={line.text} runId="" />)}</section>}
        {empty && !latest && (readOnly || retrospective ? <p className="qd-direction-empty">暂无方向正文。</p> : <div className="qd-direction-empty"><h3>先写下你希望怎样完成</h3><p>可以向 AI 提问，或直接写下方向。</p><button type="button" className="qd-btn ghost small" onClick={() => setEditing(true)}>写下方向</button></div>)}
        {sections.map((section, index) => <section key={section.id} id={`direction-${plan.id}-${section.id}`} data-plan-section={section.id} tabIndex={-1} className="qd-direction-section">
          <header><div><span className="qd-direction-eyebrow">{String(index + 1).padStart(2, '0')}</span><h3>{section.title}</h3></div>{editable && <button type="button" className="qd-link" onClick={() => onDiscussSection ? onDiscussSection(section.id) : patchWorkspace({ scope: section.id, pane: 'side' })}><Icon name="message" size={13} />讨论这一节</button>}</header>
          <div className="qd-direction-paragraphs">{section.lines.map(line => <div key={line.id} className={`qd-direction-paragraph state-${line.state}`}><span className="qd-direction-line-state">{STATE_LABEL[line.state]}</span><MarkdownMessage text={line.text} runId="" /></div>)}</div>
        </section>)}
        {showDeliveries && <PlanDeliverables plan={plan} />}
      </div>
    </div>
    {editing && !readOnly && <PlanOutlineEditor plan={plan} onClose={() => setEditing(false)} />}
  </div>;
}
