/** Installer-only regression: the caller selects isolated --smoke-test user data. */
export async function checkIntegration(core, store, webContents) {
  const require = (value, message) => { if (!value) throw new Error('Integration smoke: ' + message); };
  const wait = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Integration smoke timed out waiting for rendered result');
  };
  const project = await core.createProject({ name: '安装验证 · 多任务完整成果' });
  require(project.ok && project.projectId, 'project creation');
  let serial = 0;
  const collaborate = async (type, taskId, payload) => {
    const snapshot = await core.load();
    const result = await core.collaborate({ projectId: project.projectId, idempotencyKey: `integration-collab-smoke-${++serial}`, type, taskId, payload,
      ...(taskId ? { expectedVersion: snapshot.collaboration.tasks[taskId].version } : {}) });
    require(result.ok, `${type}: ${result.message}`); return result;
  };
  const createSource = async (title, body) => {
    const taskId = (await collaborate('create_task', undefined, { title, goal: title, owner: 'me', criteria: ['记录当天安排并保留来源'] })).resourceId;
    const submission = await collaborate('submit', taskId, { title, body, sourceIds: [], unresolved: [], nextSteps: [] });
    await collaborate('review', taskId, { submissionId: submission.resourceId, verdict: 'accepted', checks: [true], note: '隔离安装验收样例，已人工核对' });
    return { taskId, artifactId: (await core.load()).collaboration.tasks[taskId].acceptedArtifactId };
  };
  const first = await createSource('第一天 · 抵达曼谷', '抵达后先办理入住，留出休息时间。');
  const second = await createSource('第二天 · 街区漫步', '上午街区漫步，下午自由活动。');
  const sourceIds = [first.artifactId, second.artifactId];
  const artifactsBefore = JSON.stringify((await core.load()).collaboration.artifacts);
  const integrate = async (type, draftId, payload, overrides = {}) => {
    const snapshot = await core.load();
    return core.integrate({ projectId: project.projectId, idempotencyKey: `integration-smoke-${++serial}`, type, draftId, payload,
      ...(draftId ? { expectedRevision: snapshot.integration.drafts[draftId].revision } : {}), ...overrides });
  };
  const success = (result, operation) => { require(result.ok, `${operation}: ${result.message}`); return result; };
  const content = async draftId => { const state = (await core.load()).integration; return state.revisions.find(revision => revision.id === state.drafts[draftId].revisionId); };
  const created = success(await integrate('create', undefined, { title: '泰国两日 · 安装验收完整攻略', sourceIds }), 'create');
  const initial = await content(created.draftId);
  success(await integrate('save', created.draftId, { title: initial.title, sourceIds, sections: initial.sections.map((section, index) => ({ ...section, schedule: { date: `2026-12-${10 + index}` } })) }), 'date-only save');
  success(await integrate('publish', created.draftId, { expectedBundleVersion: 0, reviewed: true, reviewNote: '人工核对两个样例来源与分日安排' }), 'publish v1');
  const publishedV1 = JSON.stringify((await core.load()).integration.versions[0]);
  const left = success(await integrate('create', undefined, { bundleId: created.bundleId }), 'left draft').draftId;
  const right = success(await integrate('create', undefined, { bundleId: created.bundleId }), 'right draft').draftId;
  const leftContent = await content(left), rightContent = await content(right);
  success(await integrate('save', left, { title: leftContent.title, sourceIds, sections: leftContent.sections.map((section, index) => index === 0 ? { ...section, body: section.body + '\n\n补充：入住后确认次日出发安排。' } : section) }), 'save first task change');
  success(await integrate('save', right, { title: rightContent.title, sourceIds, sections: rightContent.sections.map((section, index) => index === 1 ? { ...section, body: section.body + '\n\n补充：自由活动结束后核对返程准备。' } : section) }), 'save second task change');
  const beforeCAS = JSON.stringify((await core.load()).integration);
  const staleWrite = await integrate('save', right, { title: rightContent.title, sourceIds, sections: rightContent.sections }, { expectedRevision: 1 });
  require(!staleWrite.ok && JSON.stringify((await core.load()).integration) === beforeCAS, 'stale revision rejects without mutation');
  const unavailable = await core.reviewIntegration(right, project.projectId);
  if (unavailable.ok) {
    require(unavailable.jobId, 'queued semantic review supplies its persisted job ID');
    const failed = await wait(async () => { const job = (await core.load()).integration.reviewJobs?.[unavailable.jobId]; return job?.status === 'failed' ? job : false; });
    require(failed.actualTokens === 0 && failed.usageFinal === true && !failed.sourceSessionId && !(await core.load()).integration.reviews?.length, 'unconfigured Agent records failure and zero usage without fabricated review');
  } else require(!(await core.load()).integration.reviews?.length, 'rejected semantic review cannot fabricate a passed result');
  success(await integrate('publish', left, { expectedBundleVersion: 1, reviewed: true, reviewNote: '第一天人工核对完成' }), 'publish v2');
  const stalePublish = await integrate('publish', right, { expectedBundleVersion: 2, reviewed: true, reviewNote: 'should be blocked by stale base' });
  require(!stalePublish.ok, 'stale base cannot overwrite newer published result');
  success(await integrate('rebase', right, { expectedBundleVersion: 2, choices: {} }), 'merge independent task changes');
  success(await integrate('publish', right, { expectedBundleVersion: 2, reviewed: true, reviewNote: '已合入第一天更新，并核对第二天与返程安排兼容' }), 'publish v3');
  const snapshot = await core.load();
  const current = snapshot.integration.versions.find(version => version.id === snapshot.integration.bundles[created.bundleId].publishedVersionId);
  require(current.version === 3 && current.sections[0].body.includes('次日出发') && current.sections[1].body.includes('返程准备'), 'both non-overlapping changes survive merge');
  require(JSON.stringify(snapshot.integration.versions[0]) === publishedV1 && JSON.stringify(snapshot.collaboration.artifacts) === artifactsBefore, 'published history and source artifacts stay unchanged');
  require(!snapshot.agents.length && !Object.keys(snapshot.sessions).length && !Object.keys(snapshot.collaboration.runs).length && !(snapshot.integration.reviews ?? []).length, 'manual integration must not fabricate AI sessions or reviews');
  const lookup = await core.queryTaskMemory({ projectId: project.projectId, query: first.taskId, limit: 2 });
  require(lookup.total === 1 && lookup.items[0].taskId === first.taskId && lookup.items[0].summary.includes('办理入住') && lookup.items[0].executions.length === 0, 'exact task lookup provides bounded accepted-result card');
  const persisted = store.read('quandeck.projects.v1');
  require(persisted.projects[project.projectId].integration.versions.length === 3, 'versions persisted to SQLite');
  persisted.projects[project.projectId].integration.versions[0].sections[0].body = 'illegal rewrite';
  let rejected = false; try { store.write('quandeck.projects.v1', persisted); } catch { rejected = true; }
  require(rejected && JSON.stringify(store.read('quandeck.projects.v1').projects[project.projectId].integration.versions[0]) === publishedV1, 'immutable published history rejects direct rewrite');
  await webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '成果')?.click()`);
  await wait(() => webContents.executeJavaScript(`!!document.querySelector('.qd-gallery')`));
  await webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim().startsWith('完整成果'))?.click()`);
  await wait(() => webContents.executeJavaScript(`document.querySelector('.qd-integration-document h2')?.textContent === '泰国两日 · 安装验收完整攻略' && document.querySelectorAll('.qd-integration-timeline .qd-integration-chapter').length === 2`));
  await webContents.executeJavaScript(`document.querySelector('.qd-integration-provenance > summary')?.click()`);
  require(await webContents.executeJavaScript(`document.querySelectorAll('.qd-integration-source-matrix a.is-used').length === 2 && document.querySelector('.qd-integration-route')?.textContent.includes('2026-12-10') && document.querySelector('.qd-integration-document')?.innerText.includes('次日出发') && document.querySelector('.qd-integration-document')?.innerText.includes('返程准备')`), 'real timeline and source coverage render');
  return { ok: true, versionedMerge: true, sourcePreserved: true, casProtected: true, taskLookup: true, rendered: true, immutableHistory: true };
}
