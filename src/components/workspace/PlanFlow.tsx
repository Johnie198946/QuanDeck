import { useCallback, useMemo } from 'react';
import type { IdeaPlan } from '../../data/types';
import { buildDirectionFlow, directionFlowInput } from '../../data/directionFlow';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { FlowDiagram } from '../discussion/FlowDiagram';

export function PlanFlow({ plan }: { plan: IdeaPlan }) {
  const { snap, openWorkspace } = useWorkdeck();
  // Serialize only the small task/edge projection. Observation-only snapshot changes do not re-layout.
  const key = JSON.stringify(directionFlowInput(snap, plan));
  const value = useMemo(() => buildDirectionFlow(JSON.parse(key)), [key]);
  const states = useMemo(() => Object.fromEntries(Object.entries(value.targets).map(([id, target]) => [id, target.state])), [value]);
  const open = useCallback((id: string) => { const t = value.targets[id]; if (t) openWorkspace(t.taskId, { view: 'tasks', itemId: t.itemId ?? null, selected: t.itemId ?? null, pane: 'main' }); }, [value, openWorkspace]);
  return <section id={`direction-${plan.id}-flow`} tabIndex={-1} className="qd-direction-section" aria-label="已登记任务流程">
    <header><div><span className="qd-direction-eyebrow">执行关系</span><h3>已登记任务流程</h3></div></header>
    <p>根据当前任务、前置依赖与子任务汇总关系自动绘制；讨论中的方法示意单独保留。</p>
    {value.notice && <p role="status">{value.notice}</p>}
    {value.graph && <FlowDiagram title="已登记任务流程" graph={value.graph} states={states} onNode={open} />}
  </section>;
}
