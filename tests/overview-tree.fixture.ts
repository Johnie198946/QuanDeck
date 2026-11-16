import { createEmptySnapshot } from '../src/data/projectStorage';
import { createSampleSnapshot } from '../src/data/fixtures';
import type { Snapshot, WorkItem } from '../src/data/types';

/** Isolated test data only. Never imported by the application. */
export function createOverviewFixtures(): Snapshot[] {
  const travel = createEmptySnapshot({ id: 'overview-travel', name: '我要去泰国玩', description: '曼谷与芭提雅 · 双人小众旅行，把路线、住宿和图文资料整理成一份攻略。' });
  travel.agents = createSampleSnapshot().agents; travel.defaultAgent = 'codex';
  travel.tasks['shared-root'] = { id: 'shared-root', title: '曼谷与芭提雅图文攻略', owner: 'agent', sessionIds: [], completion: null, manualLock: false, createdAt: '09:00' };
  travel.tasks.packing = { ...travel.tasks['shared-root'], id: 'packing', title: '整理出发前物品清单', owner: 'me' };
  const work = (id: string, parentTaskId: string, title: string, status: WorkItem['status']): WorkItem => ({ id, rootTaskId: 'shared-root', parentTaskId, title, status, phase: '资料准备', owner: 'agent', expected: `交付可核对的${title}`, dependsOnTaskIds: [], attemptIds: [] });
  const items = [
    work('routes', 'shared-root', '路线与交通', 'running'),
    work('airport', 'routes', '机场到考山路酒店', 'done'),
    work('transfer', 'routes', '曼谷 → 芭提雅交通 Bangkok transfer', 'running'),
    work('hotels', 'shared-root', '确定两座城市的住宿', 'waiting_reply'),
    work('images', 'shared-root', '收集酒店与景点照片', 'done'),
    work('assemble', 'shared-root', '汇总为图文旅行攻略', 'blocked'),
  ];
  items[3].waiting = { kind: 'reply', question: '曼谷住宿是否沿用考山路的酒店？', since: '10:00' };
  items[5].dependsOnTaskIds = ['routes', 'hotels', 'images'];
  items[2].executorId = 'codex'; items[2].attemptIds = ['transfer-run'];
  items[0].executorId = 'codex'; items[0].attemptIds = ['route-run'];
  travel.orchestrations!['shared-root'] = { taskId: 'shared-root', label: '泰国旅行', startedAt: '09:00', syncedAt: '10:20', coordinationTokens: null,
    executors: { codex: { id: 'codex', label: 'Codex', agentId: 'codex', parentExecutorId: null } }, phases: ['资料准备'], items: Object.fromEntries(items.map(item => [item.id, item])), itemOrder: items.map(item => item.id),
    capabilities: { subAgents: false, steps: true, tokens: false, permissionEvents: false }, attempts: {
      'transfer-run': { id: 'transfer-run', workItemId: 'transfer', executorId: 'codex', sessionId: '', parentSessionId: null, sourceLink: '', kind: 'initial', status: 'running', startedAt: '10:00', tokens: null, step: { label: '核对不同交通方式', completed: 2, total: 4 }, rounds: [] },
      'route-run': { id: 'route-run', workItemId: 'routes', executorId: 'codex', sessionId: '', parentSessionId: null, sourceLink: '', kind: 'initial', status: 'running', startedAt: '10:00', tokens: null, rounds: [] },
    } };
  travel.journal.blocks = Object.keys(travel.tasks).map(taskId => ({ id: `block-${taskId}`, kind: 'task', taskId }));
  const product = createEmptySnapshot({ id: 'overview-product', name: 'QuanDeck 体验优化', description: '让任务更清楚，让协作更轻松。' });
  product.agents = travel.agents; product.defaultAgent = 'codex';
  product.tasks['shared-root'] = { ...travel.tasks.packing, id: 'shared-root', title: '完成产品使用说明', completion: { reason: 'manual', at: '10:00' } };
  product.journal.blocks = [{ id: 'product-task', kind: 'task', taskId: 'shared-root' }];
  const empty = createEmptySnapshot({ id: 'overview-empty', name: '一个新的想法' });
  empty.agents = travel.agents; empty.defaultAgent = 'codex';
  return [travel, product, empty];
}
