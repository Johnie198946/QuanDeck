import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
const {chromium} = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QUANDECK_UI_OUTPUT || 'output/note-dispatch';
await mkdir(output,{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Asia/Shanghai'});
  const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  page.setDefaultTimeout(7500);
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4321');
  // Match the same Vite module as the running app, including its HMR cache key.
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(5000);
    window.liveRepository=async()=>{
      const modules=performance.getEntriesByType('resource').filter(r=>new URL(r.name).pathname==='/src/data/repository.ts');
      for(const item of modules) {
        const api=(await import(item.name)).localDataSource;
        if(api.listeners.size>0) return api;
      }
      throw Error('Missing active repository: '+modules.map(m=>m.name).join(', '));
    };
  });
  await page.reload();
  await page.getByRole('navigation',{name:'主导航'}).waitFor();
  const ids = await page.evaluate(async()=>{
    const api=await window.liveRepository();
    const {makeSelection}=await import('/src/data/knowledgeNotes.ts');
    const {noteSelectionTaskKey}=await import('/src/data/noteTaskSource.ts');
    const ok=value=>{if(!value.ok)throw Error(value.message);return value;};
    if(window.quandeckDesktop || (await api.listProjects()).length) throw Error('Expected a fresh browser profile');
    const p=ok(await api.createProject({name:'关西慢旅行',description:'整理冬季出行路线和沿途的落脚点。'})).projectId;
    const text='京都多住一晚。\n\n比较从京都去和歌山的两条走法。';
    const prefix='周末和朋友聊了下旅行，想把赶路的时间留给沿途。\n\n';
    const body=prefix+text+'\n\n温泉旅馆以后再看。';
    const at=new Date().toISOString();
    const note=(id,title,body)=>({id,title,body,createdAt:at,updatedAt:at,revision:1,attachments:[],history:[],expansions:[]});
    localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,decisions:[],notes:[
      note('trip','京都到和歌山 · 行前随记',body),note('draft','演示提纲','温泉旅馆以后再看。'),
      note('weather','天气备忘','确认到达当天的天气。'),note('map','路线图','请绘制换乘地图。'),
    ]}));
    const send=async(noteId,noteTitle,sourceBody,quote)=>{
      const offset=sourceBody.indexOf(quote), selection=makeSelection(sourceBody,offset,offset+quote.length);
      const ref={noteId,lineIndex:sourceBody.slice(0,offset).split('\n').length-1,selection};
      const key=noteSelectionTaskKey(ref,quote);
      return ok(await api.createTaskWithAttachments(quote,[],p,{key,title:noteTitle,noteSource:ref,dispatch:{agentId:'codex',logic:[]}}));
    };
    const task=(await send('trip','京都到和歌山 · 行前随记',body,text)).taskId;
    const save=async(title,body)=>ok(await api.saveTaskOutput({taskId:task,projectId:p,title,body,status:'published'}));
    await save('方案 A · 京都经大阪','从京都出发，在大阪换乘一次，傍晚到和歌山。');
    await save('方案 B · 京都经天王寺','京都出发，在天王寺停留半天，再前往和歌山。');
    const weather=(await send('weather','天气备忘','确认到达当天的天气。','确认到达当天的天气。')).taskId;
    ok(await api.updateProjectPlanning(p,{kind:'task',taskId:weather,fields:{end:'2020-01-01'},expectedRevision:(await api.load()).projectPlanning?.revision ?? 0}));
    const unrelated=ok(await api.createTaskWithAttachments(text,[],p)).taskId;
    ok(await api.saveTaskOutput({taskId:unrelated,projectId:p,title:'独立任务的成果',body:'不属于任何笔记。',status:'published'}));
    const map=(await send('map','路线图','请绘制换乘地图。','请绘制换乘地图。')).taskId;
    return {p,task,body,text,map};
  });
  const nav=page.getByRole('navigation',{name:'主导航'});
  const notes=async()=>{await nav.getByRole('button',{name:'帮你记',exact:true}).click();};
  const list=page.getByRole('complementary',{name:'笔记列表'});
  const trip=list.getByRole('button',{name:/京都到和歌山/});
  const badge=page.locator('.qd-knowledge-list li button').filter({hasText:'京都到和歌山'}).locator('.qnr-badge');
  const capsule=page.locator('.qnr-layer .qnr-pill');
  const modal=page.getByRole('dialog',{name:'笔记任务回执'});
  await page.reload();
  await notes();await trip.click();
  await page.waitForFunction(()=>[...(CSS.highlights.get('qd-returned-passage') ?? [])].some(range=>range.toString().includes('京都多住一晚。') && range.toString().includes('比较从京都去和歌山')));
  assert.equal(await badge.innerText(),'2');
  assert.equal(await list.getByRole('button',{name:/演示提纲/}).locator('.qnr-badge').count(),0);
  assert.equal(await capsule.count(),1);
  const end=await page.evaluate(()=>Array.from([...CSS.highlights.get('qd-returned-passage')][0].getClientRects()).filter(r=>r.width>0).at(-1).toJSON());
  const box=await capsule.boundingBox();
  assert(box.x>end.right && Math.abs(box.y+box.height/2-end.top-end.height/2)<4);
  await page.screenshot({path:path.join(output,'note-receipt.png')});
  await capsule.click();
  await modal.getByText('方案 A · 京都经大阪',{exact:true}).waitFor();
  await modal.getByText('方案 B · 京都经天王寺',{exact:true}).waitFor();
  await badge.waitFor({state:'hidden'});
  await modal.screenshot({path:path.join(output,'note-receipt-detail.png')});
  // Keep the selected version readable when a new answer arrives. Its header updates in place.
  const earlier=modal.locator('.qnr-record').filter({has:page.getByText('方案 A · 京都经大阪',{exact:true})});
  const earlierHead=earlier.locator('.qnr-record-head');
  if(await earlierHead.getAttribute('aria-expanded')!=='true') await earlierHead.click();
  await earlier.getByText('从京都出发，在大阪换乘一次，傍晚到和歌山。',{exact:true}).waitFor();
  assert.equal(await modal.getByText('独立任务的成果',{exact:true}).count(),0);
  await page.evaluate(async({task,p})=>{
    const api=await window.liveRepository();
    const r=await api.saveTaskOutput({taskId:task,projectId:p,title:'车票汇总',body:'## 换乘时刻\n\n| 出发 | 到达 |\n| --- | --- |\n| 京都 | 大阪 |\n\n[换乘说明](https://example.org/route)',status:'published'});
    if(!r.ok)throw Error(r.message);
  },ids);
  await badge.waitFor();assert.equal(await badge.innerText(),'1');
  await modal.getByText('车票汇总',{exact:true}).waitFor();
  assert.equal(await earlier.locator('.qnr-record-head').getAttribute('aria-expanded'),'true');
  await modal.locator('li').filter({hasText:'方案 A · 京都经大阪'}).getByRole('button',{name:/打开这版成果/}).click();
  await page.getByText('从京都出发，在大阪换乘一次，傍晚到和歌山。',{exact:true}).filter({visible:true}).first().waitFor();
  await page.reload();await notes();await trip.click();
  assert.equal(await badge.innerText(),'1');
  await capsule.click();await modal.getByText('车票汇总',{exact:true}).waitFor();
  await modal.getByRole('heading',{name:'换乘时刻'}).waitFor();
  await modal.getByRole('cell',{name:'京都'}).waitFor();
  assert.equal(await modal.getByRole('link',{name:'换乘说明'}).getAttribute('href'),'https://example.org/route');
  await modal.getByRole('button',{name:'关闭回执'}).click();
  await badge.waitFor({state:'hidden'});
  const weather=list.getByRole('button',{name:/天气备忘/});
  await weather.click();
  await capsule.click();
  await modal.getByText(/截止日期 2020-01-01/).waitFor();
  await modal.getByRole('button',{name:/处理提醒/}).click();
  await page.getByRole('heading',{name:'帮你盯',exact:true}).waitFor();
  await notes();await trip.click();
  await page.evaluate(async({p,text})=>{
    const api=await window.liveRepository();
    const {makeSelection}=await import('/src/data/knowledgeNotes.ts');
    const {noteSelectionTaskKey}=await import('/src/data/noteTaskSource.ts');
    const {mutateKnowledge}=await import('/src/data/knowledgeStore.ts');
    await mutateKnowledge(l=>{l.notes.find(n=>n.id==='draft').body=text;});
    const ref={noteId:'draft',lineIndex:0,selection:makeSelection(text,0,text.length)};
    const r=await api.createTaskWithAttachments(text,[],p,{title:'演示提纲',key:noteSelectionTaskKey(ref,text),noteSource:ref,dispatch:{agentId:'codex',logic:[]}});
    if(r.dispatchMode!=='joined') throw Error('Expected corresponding tasks to join: '+JSON.stringify(r));
  },ids);
  await badge.waitFor();
  await capsule.click();await modal.getByText('相同事项已交给原任务',{exact:true}).waitFor();
  await modal.getByRole('button',{name:'关闭回执'}).click();
  await list.getByRole('button',{name:/演示提纲/}).click();
  await capsule.click();await modal.getByText('相同事项已交给原任务',{exact:true}).waitFor();
  await modal.getByRole('button',{name:'关闭回执'}).click();
  await page.evaluate(async()=>{
    const {mutateKnowledge}=await import('/src/data/knowledgeStore.ts');
    await mutateKnowledge(l=>{const n=l.notes.find(n=>n.id==='trip');n.body='我今天只写一段新的想法。';n.revision++;});
  });
  await trip.click();
  const detached=page.locator('.qnr-detached button');
  await detached.waitFor();assert.equal(await capsule.count(),0);
  await detached.click();await modal.getByText('方案 A · 京都经大阪',{exact:true}).waitFor();
  await modal.getByText('京都多住一晚。',{exact:false}).first().waitFor();
  await modal.getByRole('button',{name:'关闭回执'}).click();
  await list.getByRole('button',{name:/路线图/}).click();
  await page.evaluate(async({p,map})=>{
    const api=await window.liveRepository();
    const other=await api.createProject({name:'另一个项目'});
    if((await api.load()).project.id!==other.projectId)throw Error('Expected inactive origin project');
    api.mutateRuntimeProject(p,s=>{
      const at=new Date().toISOString();
      s.sessions['source-stop']={id:'source-stop',agentId:'codex',title:'请绘制换乘地图。',taskId:map,origin:'dispatch',dispatchPhase:'acknowledged',
        status:'failed',failure:'模型暂不可用，请切换模型后重试。',lastActivity:at,endedAt:at,startedAt:at,step:{completed:0,total:1,label:'准备执行'},
        rounds:[],subAgents:[],tokens:null};
      s.tasks[map].sessionIds.push('source-stop');
    });
  },ids);
  await list.getByRole('button',{name:/路线图/}).locator('.qnr-badge').waitFor();
  await capsule.click();await modal.getByText('模型暂不可用，请切换模型后重试。',{exact:true}).waitFor();
  await modal.getByRole('button',{name:/处理提醒/}).click();
  await page.getByRole('heading',{name:'帮你盯',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('OK: multi-paragraph original, exact older result, source note badges, live arrival, persistent read, overdue alert, shared-task notice on both notes, replaced source fallback, inactive project receives source failure without a plan.');
} finally {await browser.close();}
