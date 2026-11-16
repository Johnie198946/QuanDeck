import { useState } from 'react';
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
export function PlanDocView({ plan }: { plan: IdeaPlan }) {
  const { snap, api, toast, patchWorkspace } = useWorkdeck();
  const [editing, setEditing] = useState(false), [active, setActive] = useState('discussion');
  const root = rootPlanOf(snap, plan.taskId);
  const parentDoc = root?.adopted?.doc ?? root?.draft;
  const inherited = plan.itemId && parentDoc ? (plan.inherit ?? []).map(id => findLine(parentDoc, id)?.line).filter(Boolean) as PlanLine[] : [];
  const latest = latestConclusion(plan, 'root');
  const open = countOpen(plan.draft);
  const empty = !plan.draft.sections.some(section => section.lines.length);
  const approved = plan.adopted?.draftVersion === plan.draftVersion;
  const select = (id: string) => {
    setActive(id);
    const element = document.getElementById(`direction-${plan.id}-${id}`);
    element?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    element?.focus({ preventScroll: true });
  };
  const toDrafts = async () => {
    try { await api.generateDrafts(plan.id); patchWorkspace({ mode: 'drafts', pane: 'main' }); }
    catch (error) { toast(error instanceof Error ? error.message : '暂未能读取拆分草稿', 'error'); }
  };
  const sections = plan.draft.sections;
  return <div className="qd-plan qd-direction-doc" data-plan-id={plan.id}>
    <header className="qd-plan-head">
      <div><span className="qd-direction-eyebrow">方向方案</span><h2>{plan.title}</h2><p className="qd-plan-status">v{plan.draftVersion} · {approved ? '已确认版本' : '待确认版本'}{open ? ` · ${open} 项可补充` : ''}</p></div>
      <PlanActions plan={plan} />
    </header>
    <div className="qd-direction-toolbar"><p>先确定方向与执行逻辑，再按任务逐项完成。</p><button type="button" className="qd-btn ghost small" onClick={() => setEditing(true)}><Icon name="pencil" size={14} />编辑大纲与正文</button><button type="button" className="qd-link" onClick={() => void toDrafts()}>查看任务拆分<Icon name="chevron-right" size={14} /></button></div>
    <GoalAutomationControl plan={plan} />
    <div className="qd-direction-reading-layout">
      <nav className="qd-direction-outline" aria-label="方向方案大纲"><h3>方案大纲</h3>
        {latest && <button type="button" aria-current={active === 'discussion' ? 'location' : undefined} onClick={() => select('discussion')}><span>概览</span>当前讨论建议</button>}
        {sections.map((section, index) => <button key={section.id} type="button" aria-current={active === section.id ? 'location' : undefined} onClick={() => select(section.id)}><span>{String(index + 1).padStart(2, '0')}</span>{section.title}{!section.lines.length && <small>待补充</small>}</button>)}
        <button type="button" aria-current={active === 'deliverables' ? 'location' : undefined} onClick={() => select('deliverables')}><span>交付</span>最终会得到什么</button>
      </nav>
      <div className="qd-direction-body">
        {latest && <section id={`direction-${plan.id}-discussion`} tabIndex={-1} className="qd-direction-section qd-direction-latest"><header><div><span className="qd-direction-eyebrow">当前讨论建议</span><h3>先看方向，再看分工</h3></div><span className="qd-direction-version">{latest.adopted ? '已采纳' : '讨论中'}</span></header><PlanDiscussionBody plan={plan} result={latest} /><p className="qd-direction-feedback-note">对图片、路线或选项的反馈只调整这一部分；确认并执行整个方向，请使用页首按钮。</p></section>}
        {inherited.length > 0 && <section className="qd-direction-section is-inherited"><h3>沿用上级方向</h3>{inherited.map(line => <MarkdownMessage key={line.id} text={line.text} runId="" />)}</section>}
        {empty && !latest && <div className="qd-direction-empty"><h3>先写下你希望怎样完成</h3><p>你可以自主填写大纲和正文，也可以在“讨论与版本”中请 Agent 帮忙。明确的任务仍可直接执行。</p><button type="button" className="qd-btn ghost small" onClick={() => setEditing(true)}>写下方向</button></div>}
        {sections.map((section, index) => <section key={section.id} id={`direction-${plan.id}-${section.id}`} data-plan-section={section.id} tabIndex={-1} className="qd-direction-section">
          <header><div><span className="qd-direction-eyebrow">{String(index + 1).padStart(2, '0')}</span><h3>{section.title}</h3></div><button type="button" className="qd-link" onClick={() => patchWorkspace({ scope: section.id, pane: 'side' })}><Icon name="message" size={13} />讨论这一节</button></header>
          {section.lines.length ? <div className="qd-direction-paragraphs">{section.lines.map(line => <div key={line.id} className={`qd-direction-paragraph state-${line.state}`}><span className="qd-direction-line-state">{STATE_LABEL[line.state]}</span><MarkdownMessage text={line.text} runId="" /></div>)}</div> : <button type="button" className="qd-direction-add" onClick={() => setEditing(true)}><Icon name="plus" size={14} />补充这部分方向</button>}
        </section>)}
        <PlanDeliverables plan={plan} />
      </div>
    </div>
    {editing && <PlanOutlineEditor plan={plan} onClose={() => setEditing(false)} />}
  </div>;
}
