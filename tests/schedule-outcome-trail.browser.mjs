import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const out=process.env.QUANDECK_UI_OUTPUT || 'output/agenda';
await mkdir(out,{recursive:true});
let page;
try {
  page=await browser.newPage({locale:'zh-CN',timezoneId:'Asia/Shanghai',viewport:{width:1360,height:920}});
  const errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  page.setDefaultTimeout(10000);
  await page.clock.setFixedTime(new Date('2026-11-27T12:05:00+08:00'));
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4546');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async()=>{
    const {localDataSource:api}=await import('/src/data/repository.ts');
    const projectId=(await api.createProject({name:'TokenOps 上市材料',timeZone:'Asia/Shanghai'})).projectId;
    const second=(await api.createProject({name:'独立验收',timeZone:'Asia/Shanghai'})).projectId;
    const dueAt='2026-11-27T13:00:00+08:00', createdAt='2026-11-25T09:10:00+08:00';
    const base={lineIndex:1,createdAt,dueAt}, url='https://example.com/tokenops.pdf';
    const todos=[
      {...base,id:'accept',text:'核对验收结论'},
      {...base,id:'get',lineIndex:2,text:'找黄映乾要材料',completedAt:'2026-11-25T15:00:00+08:00',
        progress:[{id:'g1',at:'2026-11-25T14:00:00+08:00',text:'已联系黄映乾，等他补充原始数据。'}]},
      {...base,id:'next',lineIndex:2,text:'确认黄映乾发送时间',completedAt:'2026-11-26T11:00:00+08:00',
        follows:{parentId:'get',progressId:'g1'},progress:[{id:'g2',at:'2026-11-26T10:00:00+08:00',text:'已收到初稿，结论页还缺一张图。'}]},
      {...base,id:'got',lineIndex:2,text:'收到最终版材料',completedAt:dueAt,
        follows:{parentId:'next',progressId:'g2'},outcome:{text:'TokenOps 客户实践材料',at:dueAt,url,projectId}},
      {...base,id:'other',lineIndex:3,text:'向黄映乾确认报价',completedAt:dueAt,
        outcome:{text:'报价单',at:dueAt,url,projectId:second}},
    ];
    const body='下周要完成的工作\n核对验收结论\n找黄映乾要材料\n向黄映乾确认报价';
    localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,notes:[{
      id:'acceptance',title:'验收',body,createdAt,updatedAt:createdAt,revision:1,attachments:[],expansions:[],history:[],todos}],decisions:[]}));
  });
  await page.evaluate(async()=>{
    const {scheduleEntries}=await import('/src/data/agendaSchedule.ts');
    const {scheduleOutcomeGroups}=await import('/src/data/scheduleOutcomeGroups.ts');
    const {notes}=JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1'));
    const note=notes[0], base=note.todos.find(t=>t.id==='other');
    const file=id=>({id,name:id+'.xlsx',size:1,type:'application/octet-stream'});
    const result=(id,url,files=[])=>({...base,id,text:id,outcome:{...base.outcome,text:'《客户报告》',url,files}});
    note.todos=[result('a','https://example.com/report',[file('template'),file('one')]),
      result('b','https://example.com/report',[file('template'),file('two')]),result('c','https://example.com/report',[file('one'),file('template')]),
      result('d','https://example.com/folders/team'),result('e','https://example.com/folders/team')];
    const groups=scheduleOutcomeGroups(scheduleEntries(notes,[]),notes,[]).map(group=>group.map(e=>e.todoId).sort().join(',')).sort();
    if(JSON.stringify(groups)!==JSON.stringify(['a,c','b','d','e'])) throw Error('Material identity mismatch: '+groups);
    note.todos=[result('same-name-a','https://example.com/shared'),result('same-name-b','https://example.com/shared')];
    for(const todo of note.todos) delete todo.outcome.projectId;
    note.projectQuotes=note.todos.map(t=>({projectId:t.id,id:t.id,lineIndex:t.lineIndex,text:t.text,at:base.dueAt}));
    if(scheduleOutcomeGroups(scheduleEntries(notes,[]),notes,[]).length!==2) throw Error('Implicit project filing crossed a project boundary');
    const {noteProgressRows,projectProgressMarks}=await import('/src/components/knowledge/noteProgressRows.ts');
    const plan={id:'p1',taskId:'task'}, child={id:'p2',follows:{parentId:'p1'},progress:[{id:'update',text:'已确认附件内容',at:base.dueAt}]};
    const project={project:{id:'p'},plans:[child,plan],tasks:{task:{inputs:[{id:'i1',text:'',noteSource:{noteId:note.id,lineIndex:3,todoId:base.id}}]}}};
    const marks=noteProgressRows([base],note.body,projectProgressMarks(note.id,[project]));
    if(marks.length!==1 || marks[0].lineIndex!==3 || marks[0].events[0].id!=='update') throw Error('Project follow-up lost its original note anchor.');
  });
  await page.reload();
  const nav=page.getByRole('navigation',{name:'主导航'});
  const schedule=page.getByRole('region',{name:'日程',exact:true});
  const accept=schedule.locator('[data-agenda-key="note:acceptance:accept"]');
  await accept.getByRole('button',{name:'写进展'}).click();
  const progress='已核对 3 项指标，客户签字页明天下午补齐。';
  await accept.getByRole('textbox').first().fill(progress);
  await accept.getByRole('button',{name:'保存进展'}).click();
  await accept.getByText(progress,{exact:true}).waitFor();
  await nav.getByRole('button',{name:'帮你记',exact:true}).click();
  const annotation=page.locator('[data-schedule-progress]').filter({hasText:progress});
  await annotation.getByText(progress,{exact:true}).waitFor();
  const exact=()=>page.evaluate(()=>[...CSS.highlights.get('qd-schedule-passage')].map(r=>r.toString()));
  assert((await exact()).includes('核对验收结论'));
  assert.equal(await annotation.evaluate(host=>host.textContent),'','Annotations never enter the editable source');
  // Linked follow-up progress appears at its original source paragraph as well.
  const earlier=page.locator('[data-schedule-progress]').filter({hasText:'结论页还缺一张图'});
  await earlier.locator('summary').click();
  await earlier.getByText('已联系黄映乾，等他补充原始数据。').waitFor();
  await page.locator('.qd-writer-sheet').screenshot({path:path.join(out,'note-progress.png')});
  // Save an edit above the source and reopen. The underlying todo shifts together with its annotation.
  const editor=page.getByRole('textbox',{name:'笔记正文'});
  await editor.evaluate(el=>{el.focus();const r=new Range();r.selectNodeContents(el);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);});
  await page.keyboard.insertText('开始记录');
  await page.keyboard.press('Enter');
  await nav.getByRole('button',{name:'首页',exact:true}).click();
  await page.reload();
  await nav.getByRole('button',{name:'帮你记',exact:true}).click();
  await annotation.getByText(progress,{exact:true}).waitFor();
  assert((await exact()).includes('核对验收结论'));
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0]);
  assert(stored.body.includes('开始记录') && !stored.body.includes(progress));
  assert.equal(stored.body.split('\n')[stored.todos.find(x=>x.id==='accept').lineIndex],'核对验收结论');
  await nav.getByRole('button',{name:'首页',exact:true}).click();
  await schedule.getByRole('button',{name:/成果库/}).click();
  const shelf=page.getByRole('region',{name:'日程结果'});
  assert.equal(await shelf.locator('.qh-shelf-item').count(),2,'Same contact and URL in different projects must stay separate');
  const material=shelf.locator('.qh-shelf-item').filter({has:shelf.page().getByRole('heading',{name:'TokenOps 客户实践材料'})});
  assert.equal(await material.locator('details.qh-outcome-path').getAttribute('open'),null);
  await material.locator('.qh-outcome-path summary').click();
  assert.equal(await material.getByRole('list',{name:'关联日程'}).locator(':scope > li').count(),3);
  assert.deepEqual(await material.getByRole('list',{name:'关联日程'}).locator('li > div:first-child > button').allTextContents(),
    ['找黄映乾要材料','确认黄映乾发送时间','收到最终版材料']);
  await material.getByText('已收到初稿，结论页还缺一张图。',{exact:false}).waitFor();
  await shelf.getByRole('searchbox').fill('补充原始数据');
  assert.equal(await shelf.locator('.qh-shelf-item').count(),1);
  await page.getByRole('region',{name:'日程',exact:true}).screenshot({path:path.join(out,'result-lineage.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS saved schedule progress via homepage, read newest + linked earlier events at original underlined text, moved source, reopened, checked Markdown isolation; one material with a searchable three-schedule history, same contact in a different project stayed separate.');
}catch(err){console.error((await page?.locator('body').innerText())?.slice(0,2200));throw err;}finally{await browser.close();}
