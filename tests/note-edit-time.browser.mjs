import assert from 'node:assert/strict';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.QUANDECK_UI_URL||'http://127.0.0.1:4321';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({timezoneId:'Asia/Shanghai'});
  const key='quandeck.personal-knowledge.v1', start='2026-11-27T00:45:00.000Z';
  await page.addInitScript(({key,start})=>{
    if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({schema:1,decisions:[],notes:[{
      id:'edit-note',title:'编辑记录',body:'第一行',createdAt:start,updatedAt:start,archivedAt:start,revision:13,
      history:[],attachments:[],expansions:[],todos:[{id:'todo',lineIndex:0,text:'第一行',dueAt:start,createdAt:start}]
    }]}));
  },{key,start});
  await page.routeWebSocket(/.*/,()=>{});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.clock.install({time:new Date('2026-11-27T03:00:00Z')});
  await page.goto(origin);
  const nav=name=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true});
  const body=page.getByRole('textbox',{name:'笔记正文'});
  const row=page.getByRole('complementary',{name:'笔记列表'}).getByRole('button',{name:/编辑记录/});
  const persisted=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)).notes[0],key);
  await nav('帮你记').click();
  await row.getByText('08:45',{exact:true}).waitFor();
  await page.getByRole('checkbox',{name:/完成待办/}).click();
  await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k)).notes[0].updatedAt!=='2026-11-27T00:45:00.000Z',key);
  assert.equal((await persisted()).revision,13,'todo state does not change text citation revision');
  await body.fill('连续编辑 0');
  await row.getByText(/草稿/).waitFor();
  for(let i=1;i<=6;i++){
    await page.clock.fastForward(20000);
    await body.fill('连续编辑 '+i);
  }
  assert.match((await persisted()).body,/连续编辑/,'continuous edits reach the store within two minutes');
  await nav('首页').click();
  await nav('帮你记').click();
  await body.getByText('连续编辑 6',{exact:true}).waitFor();
  await body.evaluate(el=>{
    el.focus();
    const node=document.createTreeWalker(el,NodeFilter.SHOW_TEXT).nextNode();
    const r=document.createRange();r.setStart(node,0);r.setEnd(node,4);
    getSelection().removeAllRanges();getSelection().addRange(r);
  });
  await page.getByRole('button',{name:'加粗',exact:true}).click();
  await nav('首页').click();
  await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k)).notes[0].body.includes('**'),key);
  await page.reload();await nav('帮你记').click();
  await body.locator('strong').getByText('连续编辑',{exact:true}).waitFor();
  assert((await persisted()).updatedAt>start);
  // Conflict across a dirty source and a newer stored revision. A retry must
  // present the current saved text before replacing it with the reviewed draft.
  await body.fill('尚未保存的草稿');
  await page.evaluate(key=>{
    const d=JSON.parse(localStorage.getItem(key)), n=d.notes[0];
    n.revision++;n.body='另一个窗口保存的内容';n.updatedAt=new Date().toISOString();localStorage.setItem(key,JSON.stringify(d));
  },key);
  await page.clock.fastForward(31000);
  await page.getByText('核对保存冲突',{exact:true}).click();
  await page.getByText('另一个窗口保存的内容',{exact:true}).waitFor();
  await page.getByRole('button',{name:'用当前草稿更新已核对版本'}).click();
  await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k)).notes[0].body.includes('尚未保存的草稿'),key);
  await page.reload();await nav('帮你记').click();
  await body.getByText('尚未保存的草稿',{exact:true}).waitFor();
  assert.equal(await row.locator('time').getAttribute('datetime'),(await persisted()).updatedAt);
  console.log('Note timestamps: todo update, bounded continuous editing, formatting, archived note, clock display, conflict recovery and reload passed.');
} finally {await browser.close();}
