import { createOverviewFixtures } from './overview-tree.fixture';
import { ensureProjectDirection } from '../src/data/goalDelivery';
import type { Snapshot, TaskDraft } from '../src/data/types';

/** Browser-only data. The fake connection has no runtime driver or model endpoint. */
export function createDirectionFixtures(): Snapshot[] {
  const snapshots = createOverviewFixtures(), snapshot = snapshots[0];
  snapshot.runtimeConnections = { codex: { tool: 'codex', connectionId: 'direction-ui-fixture', projectPath: '/isolated-direction-fixture' } };
  const id = ensureProjectDirection(snapshot), plan = snapshot.ideaPlans![id];
  plan.draft.sections.push({ id: 'approach', title: '执行思路', kind: 'body', lines: [{ id: 'approach-1', text: '**先分开研究，再汇总。** 路线与图文资料分别形成可核对的交付，最后整理为旅行攻略。', state: 'tentative' }] });
  const task = (key: string, title: string, parentKey?: string, deps: string[] = []): TaskDraft => ({ key, title, parentKey, deps, expected: `交付可核对的${title}`, owner: 'agent', agentId: 'codex', phase: '执行', lineIds: [], include: true });
  plan.discussion!.conclusions = [{ id: 'direction-fixture', agentId: 'codex', scopeId: 'root', source: 'manual', recordedAt: '2026-11-17T08:00:00Z', summary: '## 两条研究线，一份图文攻略\n\n先查询真实路线，再整理照片与住宿参考。最后把结果拼成一份能直接使用的攻略。', confirmed: [], open: [],
    tasks: [task('route', '核对真实路线'), task('airport', '机场接驳', 'route'), task('media', '整理图文素材'), task('final', '合成图文攻略', undefined, ['route', 'media'])],
    outline: [{ id: 'approach', title: '执行思路', kind: 'body', lines: [{ id: 'approach-2', text: '路线与图片两条分支独立核对，汇总任务等待前置交付。', state: 'tentative' }] }],
    deliverables: [{ id: 'route-map', taskKey: 'route', title: '路线地图', description: '起终点、交通方式与来源' }, { id: 'reference-images', taskKey: 'media', title: '图片与住宿参考', description: '每张照片保留真实来源' }, { id: 'final-guide', taskKey: 'final', title: '完整图文攻略', description: '整合路线与资料，保留待核对项' }],
    visualBlocks: [{ id: 'city-reference', hash: 'fixture-hash', kind: 'photo', title: '讨论用图片参考', image: { url: 'https://direction-fixture.example/photo.jpg', alt: '方向页面测试图片', caption: '隔离测试素材，不是真实旅行照片' }, sources: [{ label: '测试素材来源', url: 'https://direction-fixture.example/source' }] }],
  }];
  return snapshots;
}
