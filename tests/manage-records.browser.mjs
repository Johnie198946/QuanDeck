import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {seedManagePrototype} from './fixtures/manage-prototype.mjs';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.QUANDECK_UI_URL||'http://127.0.0.1:4374';
const output=process.env.QUANDECK_UI_OUTPUT||'output/manage-prototype';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(8000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const ids=await seedManagePrototype(page,origin);
  await page.evaluate(async({ppt,rehearsal,slides})=>{
    const {localDataSource:api}=await import('/src/data/repository.ts');
    const snapshot=await api.load();
    const pending=Object.values(snapshot.collaboration.tasks).find(row=>row.taskId===slides&&!row.workItemId);
    const review=await api.collaborate({projectId:ppt,taskId:slides,type:'review',expectedVersion:pending.version,idempotencyKey:crypto.randomUUID(),
      payload:{submissionId:pending.latestSubmissionId,verdict:'needs_changes',checks:[true,false],note:'请补充每一页的讲述时间。'}});
    if (!review.ok) throw Error(review.message);
    const {saveOutputFile}=await import('/src/data/outputFiles.ts');
    const file=await saveOutputFile(ppt,new File(['页码,主题,分钟\n1,开场,3\n2,路由演示,9\n3,方案收益,5\n4,问答,3\n'],'演示稿页序.csv',{type:'text/csv'}));
    const revised=await api.saveTaskOutput({projectId:ppt,taskId:slides,title:'演示稿页序与时长',status:'published',
      body:'按开场、路由演示、方案收益、问答四个环节分配 20 分钟。',attachments:[file]});
    if (!revised.ok) throw Error(revised.message);
    const result=await api.saveTaskOutput({projectId:ppt,taskId:rehearsal,title:'海外演讲排练手册',status:'published',
      body:'## 演讲目标\n\n用一个客户请求演示模型如何选择，控制全程在 20 分钟。\n\n## 段落与时长\n\n| 环节 | 时长 | 讲述重点 |\n| --- | --- | --- |\n| 场景开场 | 3 分钟 | 客户遇到了什么问题 |\n| 路由演示 | 9 分钟 | 对照两次真实请求 |\n| 方案收益 | 5 分钟 | 时延与成本的取舍 |\n| 问答 | 3 分钟 | 回答听众的问题 |\n\n## 彩排检查\n\n- 核对演示稿与演讲手册。\n- 提前打开演示页面。'});
    if (!result.ok) throw Error(result.message);
  },ids);
  await page.reload();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你管'}).click();
  await page.getByRole('button',{name:'项目工具',exact:true}).click();
  const tabs=page.getByRole('navigation',{name:'项目页签'});
  await tabs.getByRole('button',{name:'成果',exact:true}).click();
  const index=page.getByRole('navigation',{name:'交付件地图'});
  await index.getByRole('button',{name:/海外演讲排练手册/}).click();
  await page.getByRole('table').filter({hasText:'场景开场'}).waitFor();
  assert.ok(await index.getByRole('button').count()>=4,'the project lists task records without a project delivery plan');
  await page.screenshot({path:path.join(output,'results.png')});
  await page.getByRole('searchbox',{name:'搜索成果'}).fill('产品研究');
  assert.equal(await index.getByRole('button').count(),1);
  await page.getByRole('article',{name:'成果：产品研究小结'}).waitFor();
  await page.getByRole('searchbox',{name:'搜索成果'}).fill('不存在的成果');
  await page.getByRole('button',{name:'清除筛选'}).click();
  await page.getByLabel('成果状态').selectOption({label:'待核对'});
  assert.equal(await index.getByRole('button',{name:/海外演讲大纲/}).count(),0);
  await page.getByLabel('成果状态').selectOption('');
  await page.getByLabel('成果类型').selectOption({label:'文档'});
  await page.getByLabel('成果类型').selectOption({label:'表格'});
  assert.equal(await index.getByRole('button').count(),1);
  await page.getByText(/比较成果 · 2 个版本/).click();
  await page.getByRole('region',{name:'成果版本对比'}).getByText('已退回').waitFor();
  await page.screenshot({path:path.join(output,'results-compare.png')});
  await page.getByLabel('按任务查看成果').selectOption({label:'演讲大纲'});
  assert.equal(await index.getByRole('button').count(),1);
  await page.getByLabel('按任务查看成果').selectOption('');
  await page.getByRole('button',{name:'提交成果',exact:true}).click();
  await page.getByRole('region',{name:'选择提交成果的任务'}).getByRole('button',{name:'智能路由页面'}).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await tabs.getByRole('button',{name:'记忆',exact:true}).click();
  const log=page.getByRole('list',{name:'项目时间线'});
  const entry=log.getByRole('button',{name:/提交《海外演讲排练手册》/});
  await entry.click();
  await page.getByRole('heading',{name:'关联任务',exact:true}).waitFor();
  await page.locator('.qm-memory-reader').getByRole('heading',{name:'提交《海外演讲排练手册》',exact:true}).waitFor();
  await log.getByRole('button',{name:/提交《演示稿页序与时长》/}).click();
  const asset=page.locator('.qm-memory-reader').getByRole('button',{name:'演示稿页序.csv'});
  await asset.waitFor();
  await page.screenshot({path:path.join(output,'memory.png')});
  const download=page.waitForEvent('download');
  await asset.click();
  assert.equal((await download).suggestedFilename(),'演示稿页序.csv');
  await entry.click();
  await page.getByText('来源记录',{exact:true}).click();
  await page.locator('.qm-memory-source').getByText(/版本 1/).waitFor();
  await page.locator('.qm-memory-reader').getByRole('button',{name:'演讲准备'}).click();
  assert.equal((await page.getByLabel('按任务查看成果').locator('option:checked').innerText()).trim(),'演讲准备');
  await page.setViewportSize({width:390,height:844});
  await index.getByRole('button').first().click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),'narrow results fit the window');
  await tabs.getByRole('button',{name:'记忆',exact:true}).click();
  await log.getByRole('button').first().click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),'narrow memory fits the window');
  // Two agents answered one task. Switching in the real reader must preserve each draft and recipient.
  await page.evaluate(async({ppt,rehearsal})=>{
    const {localDataSource:api}=await import('/src/data/repository.ts');
    const agents=[['codex','Codex'],['claude','Claude Code']];
    for (const [id,name] of agents) {
      const added=await api.registerAgent({id,name,short:name,color:'#335588'});
      if(!added.ok) throw Error(added.message);
    }
    api.mutateRuntimeProject(ppt,snapshot=>{
      for(const [agentId,name] of agents){
        const id='reader-session-'+agentId,at='2026-11-15T16:00:00.000Z';
        snapshot.tasks[rehearsal].sessionIds.push(id);
        snapshot.sessions[id]={id,agentId,taskId:rehearsal,title:name+' 演讲稿',status:'waiting_reply',
          origin:'dispatch',dispatchPhase:'acknowledged',startedAt:at,lastActivity:at,tokens:null,step:null,subAgents:[],
          rounds:[{id:'round-'+agentId,at,reply:name+' 提交的演讲修订稿'}],
          runtime:{projectId:ppt,taskId:rehearsal,purpose:'execution',runId:'run-'+agentId,sequence:1,eventIds:[],
            context:{taskTitle:'演讲准备',prompt:'准备演讲稿',capturedAt:at},connection:{connectionId:agentId,tool:agentId,projectPath:'/fixture'}}};
      }
    });
  },ids);
  await page.setViewportSize({width:1440,height:900});
  await page.reload();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你管'}).click();
  await page.getByRole('button',{name:'项目工具',exact:true}).click();
  await tabs.getByRole('button',{name:'成果',exact:true}).click();
  await index.getByRole('button',{name:/Codex 演讲稿/}).click();
  const reader=page.getByRole('article',{name:'成果：Codex 演讲稿'});
  const composer=reader.getByRole('form',{name:'回复成果'});
  await composer.getByLabel('回复 Codex').fill('请缩短开场介绍');
  assert.equal(await composer.getByRole('button',{name:'继续修改'}).isEnabled(),true);
  assert.equal(await reader.locator('.qd-delivery-body').evaluate(el=>Boolean(el.compareDocumentPosition(el.parentElement.querySelector('form')) & Node.DOCUMENT_POSITION_FOLLOWING)),true);
  await index.getByRole('button',{name:/Claude Code 演讲稿/}).click();
  const other=page.getByRole('article',{name:'成果：Claude Code 演讲稿'}).getByRole('form',{name:'回复成果'});
  assert.equal(await other.getByLabel('回复 Claude Code').inputValue(),'');
  await other.getByLabel('回复 Claude Code').fill('请补充收尾');
  await index.getByRole('button',{name:/Codex 演讲稿/}).click();
  assert.equal(await composer.getByLabel('回复 Codex').inputValue(),'请缩短开场介绍');
  await page.screenshot({path:path.join(output,'result-reply.png')});
  await tabs.getByRole('button',{name:'任务',exact:true}).click();
  await page.locator('.qp-tree').getByRole('button',{name:'演讲准备',exact:true}).click();
  const taskReturns=page.locator('.qp-task').getByRole('region',{name:'任务成果'});
  await taskReturns.getByText(/其他成果 ·/).click();
  await taskReturns.getByRole('button',{name:'Claude Code 演讲稿'}).click();
  assert.equal(await other.getByLabel('回复 Claude Code').inputValue(),'请补充收尾');
  assert.deepEqual(errors,[]);
  console.log('PASS project-wide results, search and filters, document reading, two-version comparison after return and resubmit, submission dialog, timeline, project-scoped file download, sources, task links narrow layout, task-to-result targeting and per-agent reply drafts');
} finally {await browser.close();}
