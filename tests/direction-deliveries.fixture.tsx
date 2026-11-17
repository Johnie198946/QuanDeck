import { createRoot } from 'react-dom/client';
import { WorkdeckProvider } from '../src/state/WorkdeckContext';
import { SampleWorkdeckDataSource } from '../src/data/repository';
import { PlanDeliverables } from '../src/components/workspace/PlanDeliverables';
import { createDeliveryFixture } from './delivery-map.fixture';
import type { GoalPlanVersion, DeliverySlot } from '../src/data/goalDelivery';
import type { IdeaPlan } from '../src/data/types';
import '../src/components/workspace/direction-document.css';

/** Isolated generated fixture; no runtime, network or user data. */
export async function mountDirectionDeliveriesFixture() {
  const fixture = await createDeliveryFixture(), snapshot = fixture.snapshot;
  const main = fixture.binding('routes'), child = fixture.binding('airport'), assembly = fixture.binding('packing');
  const direction = snapshot.ideaPlans![fixture.planId];
  const makeSlot = (id: string, title: string, task: typeof main, planId: string): DeliverySlot => ({ id, title, taskKey: task.key, taskId: task.taskId, workItemId: task.workItemId, planId });
  const taskSlots = [makeSlot('self', '业务任务自身说明', main, 'contributors'), makeSlot('child', '子任务核对材料', child, 'contributors')];
  const goal: GoalPlanVersion = { id: 'contributors', title: '已登记的独立交付', scope: 'task', standalone: true, taskId: main.taskId, version: 2, draftVersion: 1, at: '', tasks: [main, child], slots: taskSlots };
  snapshot.collaboration!.goalPlans = {
    contributors: [goal],
    final: [{ ...goal, id: 'final', scope: 'project', slots: [makeSlot('final', '项目最终完整攻略', assembly, 'final')] }],
  };
  const own = (id: string, task: typeof main): IdeaPlan => ({ ...direction, id, scope: 'task', taskId: task.taskId, itemId: task.workItemId ?? null, discussion: { agentId: 'codex', conclusions: [] } });
  const sections = [
    { name: '业务任务', plan: own('own-direction', main) },
    { name: '子任务', plan: own('child-direction', child) },
    { name: '系统整合任务', plan: own('assembly-direction', assembly) },
    { name: '项目', plan: { ...direction, discussion: { agentId: 'codex', conclusions: [] } } },
  ];
  const source = new SampleWorkdeckDataSource({ snapshot, onPersist: () => {} });
  const container = document.createElement('div'); document.body.replaceChildren(container);
  createRoot(container).render(<WorkdeckProvider source={source} fallback={<p>读取隔离数据</p>}><main>{sections.map(section => <section key={section.name} aria-label={section.name}><h2>{section.name}</h2><PlanDeliverables plan={section.plan} /></section>)}</main></WorkdeckProvider>);
}
