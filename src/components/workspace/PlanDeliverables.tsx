import type { IdeaPlan } from '../../data/types';
import { latestGoalPlan } from '../../data/goalDelivery';
import { latestConclusion } from '../../data/discussion';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';

/** Expected deliveries describe the direction; actual content stays in the delivery map. */
export function PlanDeliverables({ plan }: { plan: IdeaPlan }) {
  const { snap } = useWorkdeck();
  const adopted = latestGoalPlan(snap, plan.id);
  const current = latestConclusion(plan, 'root');
  const hasDraft = !current?.adopted && !!current?.deliverables?.length;
  const slots = hasDraft ? current!.deliverables! : adopted?.slots ?? [];
  return <section id={`direction-${plan.id}-deliverables`} className="qd-direction-section qd-direction-deliverables" tabIndex={-1} aria-label="方向交付清单">
    <header><div><span className="qd-direction-eyebrow">交付结构</span><h3>最终会得到什么</h3></div><span className="qd-direction-version">{hasDraft ? '待确认' : adopted ? `v${adopted.draftVersion} 已确认` : '待制定'}</span></header>
    {slots.length ? <ol>{slots.map(slot => <li key={slot.id} className={slot.parentId ? 'is-child' : ''}><Icon name="box" size={16} /><div><strong>{slot.title}</strong>{slot.description && <p>{slot.description}</p>}</div></li>)}</ol> : <p>还没有交付清单。讨论方向时，请 Agent 一并说明每项任务要交付什么；返回后会显示在这里。</p>}
  </section>;
}
