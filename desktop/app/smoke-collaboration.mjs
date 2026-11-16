/** Runs only in isolated installer --smoke-test user data, never in a user's workspace. */
export async function checkCollaboration(core, store) {
  const require = (value, message) => { if (!value) throw new Error('Collaboration smoke: ' + message); };
  const project = await core.createProject({ name: '安装验证 · 人工协作' });
  require(project.ok && project.projectId, 'project creation');
  let sequence = 0;
  const command = async (type, taskId, payload, guarded = false) => {
    const snapshot = await core.load();
    const result = await core.collaborate({ projectId: project.projectId, idempotencyKey: 'installer-smoke-' + ++sequence, type, taskId, payload,
      ...(guarded ? { expectedVersion: snapshot.collaboration.tasks[taskId].version } : {}) });
    require(result.ok, type + ': ' + result.message); return result;
  };
  const created = await command('create_task', undefined, { title: '核对人工成果', goal: '人工任务使用同一台帐并保留验收证据', criteria: ['保留用户条件', '成果可追溯'], owner: 'me' });
  const taskId = created.resourceId;
  await command('record_decision', taskId, { kind: 'constraint', text: '预算不得超过 5000 元' });
  const context = await command('build_context', taskId, {});
  require(context.context?.prompt.includes('5000'), 'confirmed decision in bounded context');
  const submission = await command('submit', taskId, { title: '人工交付', body: '保留预算 5000 元的条件，交由负责人核对。', sourceIds: [], unresolved: [], nextSteps: [] }, true);
  let snapshot = await core.load();
  require(snapshot.collaboration.tasks[taskId].status === 'in_review' && !snapshot.tasks[taskId].completion, 'submission must await review');
  require(Object.keys(snapshot.sessions).length === 0 && Object.keys(snapshot.collaboration.runs).length === 0, 'human task must not fabricate an AI run');
  await command('review', taskId, { submissionId: submission.resourceId, verdict: 'accepted', checks: [true, true], note: '安装测试已逐项核对' }, true);
  snapshot = await core.load();
  require(snapshot.collaboration.tasks[taskId].status === 'done' && snapshot.collaboration.reviews.length === 1, 'accepted result completes task');
  const persisted = store.read('quandeck.projects.v1');
  require(persisted.projects[project.projectId].collaboration.reviews.length === 1, 'review persisted to SQLite');
  const original = persisted.projects[project.projectId].collaboration.decisions[0].text;
  persisted.projects[project.projectId].collaboration.decisions[0].text = 'illegal rewrite';
  let rejected = false; try { store.write('quandeck.projects.v1', persisted); } catch { rejected = true; }
  require(rejected && store.read('quandeck.projects.v1').projects[project.projectId].collaboration.decisions[0].text === original, 'immutable history survives rejected write');
  return { ok: true, storage: 'sqlite', humanTask: true, reviewRequired: true, boundedContext: true, immutableHistory: true };
}
