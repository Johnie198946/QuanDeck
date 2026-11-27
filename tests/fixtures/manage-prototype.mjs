/** Populate an empty browser profile with a project like the approved prototype. */
export async function seedManagePrototype(page, origin) {
  await page.goto(origin);
  const ids = await page.evaluate(async () => {
    const {localDataSource: api} = await import('/src/data/repository.ts');
    if (window.quandeckDesktop || (await api.listProjects()).length) throw Error('Use an empty browser profile');
    const ok = receipt => { if (!receipt.ok) throw Error(receipt.message); return receipt; };
    const day = offset => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    };
    async function project(name, description, deadline, color) {
      return ok(await api.createProject({name, description, deadline: day(deadline), ownerName:'林舟', color})).projectId;
    }
    async function schedule(projectId, taskId, itemId, start, end, fields) {
      const snap = await api.load();
      ok(await api.updateProjectPlanning(projectId, {kind:'task',taskId,itemId,
        expectedRevision:snap.projectPlanning?.revision ?? 0,fields:{start:day(start),end:day(end),...fields}}));
    }
    async function task(projectId, title, goal, start, end, fields = {}) {
      const taskId = ok(await api.collaborate({projectId, type:'create_task',idempotencyKey:crypto.randomUUID(),
        payload:{title, goal, criteria:['内容与项目目标一致','交付文件可以直接打开'],owner:'me'}})).resourceId;
      await schedule(projectId,taskId,undefined,start,end,fields);
      return taskId;
    }
    async function deliver(projectId, taskId, title, accepted, workItemId) {
      ok(await api.saveTaskOutput({projectId,taskId,workItemId,title,body:'演讲目标、核心方案与演示案例已整理成稿。',status:'published'}));
      if (!accepted) return;
      const snap=await api.load();
      const record=Object.values(snap.collaboration.tasks).find(row=>row.taskId===taskId && row.workItemId===workItemId);
      const spec=snap.collaboration.specs.find(row=>row.key===record.key && row.revision===record.specRevision);
      ok(await api.collaborate({projectId,taskId,workItemId,type:'review',idempotencyKey:crypto.randomUUID(),expectedVersion:record.version,
        payload:{submissionId:record.latestSubmissionId,verdict:'accepted',checks:spec.criteria.map(()=>true),note:'已逐项核对。'}}));
    }
    const ppt=await project('TokenOps 海外演讲 PPT','向海外客户讲清智能路由的工作原理与业务价值。',16,'#376bbc');
    const outline=await task(ppt,'演讲大纲','确认听众、演讲时长与三项核心信息。',-6,-4,{milestone:true});
    await deliver(ppt,outline,'海外演讲大纲',true);
    const research=await task(ppt,'产品研究','梳理客户、市场与演讲使用的案例。',-5,-2);
    await deliver(ppt,research,'产品研究小结',true);
    const design=await task(ppt,'方案设计','用可演示的例子说明智能路由。',-2,6,{milestone:true,priority:'P0'});
    const routing=ok(await api.addManualSubtask(design,design,'智能路由页面')).itemId;
    await schedule(ppt,design,routing,0,4,{priority:'P0',information:'对照两种路由策略的成本和响应时间。',conclusion:'采用意图识别与规则判断的组合方案。',deliverable:'一页架构图与一页案例对照。'});
    const routeRecord=Object.values((await api.load()).collaboration.tasks).find(record=>record.taskId===design && record.workItemId===routing);
    ok(await api.collaborate({projectId:ppt,taskId:design,workItemId:routing,type:'revise_task',idempotencyKey:crypto.randomUUID(),expectedVersion:routeRecord.version,
      payload:{goal:'用一张图展示复杂路由的工作步骤，让客户看懂如何选择模型。',criteria:['至少对比两种路由策略','图中标注成本与响应时间','演示时页面可直接打开放映'],reason:'完善演示页说明'}}));
    const monitoring=ok(await api.addManualSubtask(design,design,'模型健康巡检')).itemId;
    await schedule(ppt,design,monitoring,3,6,{priority:'P1'});
    const slides=await task(ppt,'PPT 设计与制作','提供演讲源文件和关键页面预览。',5,12,{milestone:true});
    await deliver(ppt,slides,'演示稿初稿',false);
    const rehearsal=await task(ppt,'演讲准备','校对讲稿，完成正式演示前的彩排。',12,16,{milestone:true});
    const deck=await project('QuanDeck 产品迭代','统一项目工作区的阅读和交互方式。',22,'#4d4293');
    await task(deck,'改进任务总览','展示任务负责人、截止时间与交付状态。',0,10);
    const trip=await project('日本九州旅行','整理沿途住宿、拍摄点与温泉路线。',30,'#45855f');
    const route=await task(trip,'确认沿途路线','核对每日交通和行程。',-2,0);
    await deliver(trip,route,'路线与住宿清单',true);
    await api.switchProject(ppt);
    return {ppt,deck,trip,outline,research,design,routing,monitoring,slides,rehearsal};
  });
  await page.reload();
  return ids;
}
