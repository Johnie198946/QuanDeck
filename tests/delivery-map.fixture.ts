import { LocalWorkdeckDataSource } from '../src/data/repository';
import { latestGoalPlan } from '../src/data/goalDelivery';
import { readPlanTasks } from '../src/data/projectWorkflow';

/** Isolated fixtures built through production commands; no runtime or external tools. */
export async function createDeliveryFixture() {
  const api = new LocalWorkdeckDataSource();
  const projectId = (await api.createProject({ name: '曼谷与芭提雅 · 图文旅行', description: '方向确定后，各项交付分别就位。' })).projectId!;
  await api.registerAgent({ id: 'codex', name: 'Codex', short: 'C', color: '#111111' });
  const planId = await api.ensureProjectPlan(projectId);
  // This fixture exercises pre-contract review/read-only compatibility, not strict per-item delivery.
  api.mutateRuntimeProject(projectId,d=>{delete d.ideaPlans![planId].contractSchema;});
  const task = (key: string, title: string, parentKey?: string) => ({ key, title, parentKey, expected: `真实可核对的${title}`, owner: 'me', phase: '资料准备', deps: [] });
  const recorded = await api.recordDiscussionConclusion(planId, 'root', { agentId: 'codex', summary: '先核对路线、照片与住宿，再把独立交付汇成图文攻略。', confirmed: [], open: [],
    tasks: readPlanTasks([task('routes', '核对交通路线'), task('airport', '机场到酒店', 'routes'), task('photos', '照片与地点'), task('hotels', '住宿方案'), task('packing', '出发清单')]),
    deliverables: [{ id: 'airport', title: '凌晨抵达 · 路线与地图', taskKey: 'airport', description: '保留地图来源、车程区间与费用口径。' }, { id: 'photos', title: '街巷与海岸 · 图文片段', taskKey: 'photos' }, { id: 'hotels', title: '住宿 · 等你确定', taskKey: 'hotels' }, { id: 'packing', title: '出发清单', taskKey: 'packing' }],
  });
  if (!recorded.ok) throw Error(recorded.message);
  let snapshot = await api.load();
  const conclusionId = snapshot.ideaPlans![planId].discussion!.conclusions.at(-1)!.id;
  const approved = await api.approvePlan(planId, conclusionId, projectId, 1);
  if (!approved.ok) throw Error(approved.message);
  snapshot = await api.load();
  const plan = latestGoalPlan(snapshot, planId)!;
  const binding = (key: string) => plan.tasks.find(task => task.draftKey.endsWith(`-${key}`))!;
  const deliver = async (key: string, title: string, body: string, accept = false) => {
    const task = binding(key);
    const result = await api.saveTaskOutput({ taskId: task.taskId, workItemId: task.workItemId, title, body, status: 'published', complete: accept });
    if (!result.ok) throw Error(result.message);
  };
  await deliver('airport', '凌晨抵达，先到酒店休息', '## 先看这三件事\n\n- 路线以实际酒店入口为终点。\n- 夜间接待需要提前核对。\n- 交通时长留出取行李与候车缓冲。\n\n|环节|安排|\n|---|---|\n|抵达|先领取行李|\n|出发|按核实的地图路线行驶|\n\n这是测试中实际提交的候选正文，不是已认可结论。');
  await deliver('photos', '把时间留给街巷和海岸', '## 一天，两种节奏\n\n上午在老街散步，下午留给安静的海边。\n\n### 素材说明\n\n这份样例只验证真实交付的展示，不模拟酒店图片或地理数据。', true);
  await deliver('packing', '随身物品检查', '## 待修改的原稿\n\n护照、充电器、行程文件。');
  snapshot = await api.load();
  const packing = binding('packing'), record = snapshot.collaboration!.tasks[packing.key];
  const review = await api.collaborate({ projectId, taskId: packing.taskId, workItemId: packing.workItemId, type: 'review', expectedVersion: record.version, idempotencyKey: 'fixture-return', payload: { submissionId: record.latestSubmissionId, verdict: 'needs_changes', checks: [false], note: '补齐行李限制来源' } });
  if (!review.ok) throw Error(review.message);
  const historic = (await api.createTaskWithAttachments('旧版资料备忘', [], projectId)).taskId!;
  await api.saveTaskOutput({ taskId: historic, title: '旧版路线记录', body: '保留旧版文件与正文，不能填充未完成的酒店章节。', status: 'published', complete: false });
  return { snapshot: await api.load(), planId, binding, historic };
}
