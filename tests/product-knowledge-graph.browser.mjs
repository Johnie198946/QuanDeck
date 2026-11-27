import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4173';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/knowledge-graph-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const external = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  external.push(route.request().url());
  return route.abort();
});
await page.addInitScript(() => {
  const at = '2026-11-24T10:00:00Z';
  const note = (id, title, body, extra = {}) => ({
    id, title, body, createdAt: at, updatedAt: at, revision: 1, attachments: [], expansions: [], history: [], ...extra,
  });
  const query = new URL(location.href).searchParams;
  if (query.has('personal')) {
    // A real reload must read what the UI saved, rather than re-seeding it.
    if (sessionStorage.getItem('personal-graph-fixture') && localStorage.getItem('quandeck.personal-knowledge.v1')) return;
    sessionStorage.setItem('personal-graph-fixture','ready');
    const notes = [
      note('a','首页问题','# 发现问题\n- 搜索按钮太小\n- 调整字号'),
      note('b','验收记录','## 验收方法\n- 核对截图'),
      note('c','客户端更新','## 更新内容\n- 改进触摸反馈'),
      note('d','发布清单','- 留存测试记录'),
      note('e','页面设计','- 给按钮增加间距'),
      note('f','访谈纪要','- 减少查找时间'),
    ];
    const hint = {from:'a',to:'d',fromRevision:1,toRevision:1,provider:'codex',category:'补充',label:'发布前检查首页',
      explanation:'两篇合成笔记的对照发现。',evidenceKey:'automatic-only',
      anchors:['a','d'].map(noteId=>({noteId,source:'body',revision:1,start:0,end:3,origin:'测试'}))};
    localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,notes,decisions:[],
      agentGraph:{at,provider:'codex',notes:notes.map(({id,revision})=>({id,revision})),edges:[hint],reasoning:{version:2}}}));
    return;
  }
  if (query.has('explore')) {
    // A chain makes every visible layer and connection-count group unambiguous.
    const notes = [
      note('a','合成起点','起点观察记录。'), note('b','合成关联一','一层观察记录。'),
      note('c','合成关联二','二层观察记录。'), note('d','合成关联三','三层观察记录。'),
      note('e','合成关联四','四层观察记录。'), note('isolated','合成独立笔记','独立观察记录。'),
    ];
    const edges = ['a','b','c','d'].map((from,index) => {
      const to = ['b','c','d','e'][index];
      return {from,to,fromRevision:1,toRevision:1,provider:'codex',category:'补充',
        label:'合成链条 '+(index+1),explanation:'两篇合成笔记提供相邻层级的观察。',evidenceKey:'chain-'+index,
        anchors:[from,to].map(noteId=>({noteId,source:'body',revision:1,start:0,end:2,origin:'合成验证'}))};
    });
    localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,notes,decisions:[],
      agentGraph:{at,provider:'codex',notes:notes.map(({id,revision})=>({id,revision})),edges,reasoning:{version:2}}}));
    return;
  }
  if (new URL(location.href).searchParams.has('combined')) {
    const notes = [
      note('route','推理端点','按队列长度选择端点。'), note('travel','旅行路线','排队时换景点。'),
      note('weather','雨天计划','仅前往室内备选点。'), note('inside','开放时间','周一开放。周一闭馆。'),
    ];
    const anchor = (noteId, start, end) => ({noteId, source:'body',revision:1, start, end, origin:'用户记录'});
    const edge = {fromRevision:1,toRevision:1,provider:'codex',explanation:'这里比较的是原文中的具体条件。'};
    const edges = [
      {...edge,from:'route',to:'route',label:'结合现场条件改道',category:'创新',evidenceKey:'combined',
        anchors:[anchor('route',0,2),anchor('route',2,4),anchor('travel',0,6),anchor('weather',0,6)]},
      {...edge,from:'inside',to:'inside',label:'开闭记录相反',category:'矛盾',evidenceKey:'within',
        anchors:[anchor('inside',0,4),anchor('inside',5,9)]},
    ];
    localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,notes,decisions:[],
      agentGraph:{at,provider:'codex',notes:notes.map(({id,revision})=>({id,revision})),edges,reasoning:{version:2}}}));
    return;
  }
  const notes = [
    note('route', '京都赏枫路线', '京都赏枫路线，先订两晚酒店。\n预算：3000 元\nhttps://example.test/route'),
    note('backup', '京都赏枫路线备选', '京都赏枫路线，需要两晚住宿。\n预算：5000 元\nhttps://example.test/route'),
    note('museum', '京都赏枫路线 · 博物馆', '京都赏枫路线的景点清单。'),
    note('river', '河岸鸟类观测', '西岸的候鸟记录。', { archivedAt: at }),
    note('blank', '暂存标题', ''),
    note('expansion', '近郊散步', '本篇只写了时间。', {
      expansions: [{ id: 'ref', at, selection: { quote: '时间', before: '', after: '', offset: 0 }, question: '路线是什么？', answer: '京都赏枫路线和寺院', sourceIds: ['fixture'] }],
    }),
    note('attachment', '出生证明附件', '', { attachments: [{ id: 'mock-image', name: '无敏感内容的示例.png', type: 'image/png', size: 1 }] }),
  ];
  localStorage.setItem('quandeck.personal-knowledge.v1', JSON.stringify({ schema: 1, notes, decisions: [] }));
});
const nav = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true });
const node = id => page.locator(`.qd-library-node[data-note-id="${id}"]`);
const displayedIds = () => page.locator('[data-note-id][role=button]').evaluateAll(nodes => nodes.map(node=>node.dataset.noteId).sort());
const checkbox = name => page.getByRole('checkbox',{name,exact:true});
const assertWhite = async selector => assert.equal(
  await page.locator(selector).evaluate(element=>getComputedStyle(element).backgroundColor),
  'rgb(255, 255, 255)', selector+' keeps the selected white theme',
);
const detailsOnly = process.env.QUANDECK_GRAPH_DETAILS_ONLY === '1';
const focusedNodeId = () => page.evaluate(() => document.activeElement?.getAttribute('data-note-id'));
const worldPositions = () => page.locator('.qd-library-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
  const [, x, y] = /^translate\(([-\d.]+)[ ,]([-\d.]+)\)$/.exec(node.getAttribute('transform')) || [];
  return [node.dataset.noteId, { x:Number(x), y:Number(y) }];
})));
const setRange = async (name, value) => {
  const range = page.getByRole('slider', {name, exact:true});
  await range.focus();
  await range.press('Home');
  for (let at = 40; at < value; at += 10) await range.press('ArrowRight');
  assert.equal(await range.inputValue(), String(value));
};
async function verifyWhiteV2Details() {
  const url = new URL(origin);
  url.searchParams.set('explore','1');
  await page.goto(url.href);
  await nav('帮你想').click();
  await node('a').waitFor();
  const search = page.getByRole('searchbox',{name:'查找图中笔记',exact:true});
  const searchFocused = () => page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='查找图中笔记');
  const pressSlash = async () => {
    await page.keyboard.press('/');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  const drawer = page.getByRole('complementary',{name:'笔记与连线详情',exact:true});
  const canvas = page.getByRole('group',{name:'笔记之间的连线与节点',exact:true});
  assert.equal(await nav('帮你想').evaluate(element=>element===document.activeElement),true,
    'entering from the main navigation leaves focus outside the graph');
  await pressSlash();
  await searchFocused();
  assert.equal(await search.evaluate(element=>element===document.activeElement),true,
    '/ focuses graph search immediately after entering from the main navigation');
  assert.equal(await search.inputValue(),'','the shortcut does not insert a slash into search');
  await search.fill('合成独立');
  await pressSlash();
  assert.equal(await search.inputValue(),'合成独立/','an existing search input keeps normal slash typing');
  await search.fill('');

  // These temporary DOM controls model host inputs and dialogs without touching note data.
  for (const tag of ['input','textarea','contenteditable']) {
    await page.evaluate(tag => {
      const element = document.createElement(tag === 'contenteditable' ? 'div' : tag);
      if (tag === 'contenteditable') element.contentEditable = 'true';
      element.id = 'graph-keyboard-guard';
      element.setAttribute('aria-label','键盘隔离检查');
      element.style.cssText='position:fixed;left:20px;top:20px;width:200px;height:40px;z-index:99999;background:white';
      document.body.append(element);
      element.focus();
    },tag);
    await pressSlash();
    const control = page.locator('#graph-keyboard-guard');
    assert.equal(await control.evaluate(element=>element===document.activeElement),true,tag+' retains focus');
    assert.equal(await control.evaluate(element=>'value' in element ? element.value : element.textContent),'/',tag+' accepts normal slash typing');
    await control.evaluate(element=>element.remove());
  }
  for (const kind of ['native','aria']) {
    await page.evaluate(kind => {
      const dialog = document.createElement(kind === 'native' ? 'dialog' : 'div');
      dialog.id='graph-keyboard-dialog';
      if (kind === 'native') dialog.open=true;
      else dialog.setAttribute('role','dialog');
      dialog.style.cssText='position:fixed;left:20px;top:20px;width:200px;height:60px;z-index:99999;background:white';
      const button=document.createElement('button');
      button.textContent='临时弹窗按钮';
      dialog.append(button);
      document.body.append(dialog);
      button.focus();
    },kind);
    await pressSlash();
    assert.equal(await page.locator('#graph-keyboard-dialog button').evaluate(element=>element===document.activeElement),true,
      kind+' dialog retains focus when / is pressed');
    await nav('帮你想').focus();
    await pressSlash();
    assert.equal(await nav('帮你想').evaluate(element=>element===document.activeElement),true,
      kind+' dialog also blocks the search shortcut when focus is outside it');
    await page.locator('#graph-keyboard-dialog').evaluate(element=>element.remove());
  }
  await page.getByRole('button',{name:'操作说明',exact:true}).click();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='关闭操作说明');
  await nav('帮你想').focus();
  await pressSlash();
  assert.equal(await nav('帮你想').evaluate(element=>element===document.activeElement),true,
    'the open graph help panel blocks the search shortcut');
  await page.getByRole('button',{name:'关闭操作说明',exact:true}).click();
  await page.getByRole('button',{name:'灵感逻辑',exact:true}).click();
  await pressSlash();
  assert.equal(await page.getByRole('button',{name:'灵感逻辑',exact:true}).evaluate(element=>element===document.activeElement),true,
    '/ does not take focus on the inspiration logic view');
  await nav('帮你记').click();
  await pressSlash();
  assert.equal(await nav('帮你记').evaluate(element=>element===document.activeElement),true,
    '/ does not take focus on another product page');
  await nav('帮你想').click();
  await page.getByRole('button',{name:'知识图谱',exact:true}).click();
  await page.getByRole('button',{name:'收起筛选面板',exact:true}).click();
  await nav('帮你想').focus();
  await pressSlash();
  await searchFocused();
  assert.equal(await search.evaluate(element=>element===document.activeElement),true,
    '/ expands a closed desktop filter panel before focusing search');

  await canvas.focus();
  assert.equal(await canvas.getAttribute('tabindex'),'0');
  await page.keyboard.press('ArrowRight');
  let previous=await focusedNodeId();
  assert.ok(previous,'an arrow key on the canvas focuses a visible note node');
  assert.equal(await drawer.count(),0,'arrow navigation does not open note details');
  for (const key of ['ArrowDown','ArrowLeft','ArrowUp','ArrowRight']) {
    await page.keyboard.press(key);
    const current=await focusedNodeId();
    assert.ok(current && current!==previous,key+' switches to another visible note node');
    assert.equal(await drawer.count(),0,'direction changes do not activate a note');
    previous=current;
  }
  await page.keyboard.press('Enter');
  await drawer.waitFor();
  assert.equal(await node(previous).getAttribute('aria-pressed'),'true','Enter opens the keyboard focused node');
  await drawer.press('Escape');

  const layout = page.getByText('布局与引力',{exact:true});
  const repulsion = page.getByRole('slider',{name:'节点斥力',exact:true});
  const elasticity = page.getByRole('slider',{name:'连线弹性',exact:true});
  assert.equal(await repulsion.isVisible(),false,'layout settings start collapsed');
  await layout.click();
  for (const range of [repulsion,elasticity]) {
    assert.equal(await range.inputValue(),'100','the default physics value preserves the existing appearance');
    assert.equal(await range.getAttribute('min'),'40');
    assert.equal(await range.getAttribute('max'),'180');
    assert.equal(await range.getAttribute('step'),'10');
  }
  await repulsion.focus();
  await pressSlash();
  assert.equal(await repulsion.evaluate(element=>element===document.activeElement),true,'/ does not steal focus from a range input');
  const defaults=await worldPositions();
  await setRange('节点斥力',180);
  const repelled=await worldPositions();
  assert.ok(Object.keys(defaults).some(id=>Math.hypot(repelled[id].x-defaults[id].x,repelled[id].y-defaults[id].y)>1),
    'node repulsion changes actual node world positions');
  await page.getByRole('button',{name:'恢复默认引力',exact:true}).click();
  assert.deepEqual(await worldPositions(),defaults,'restoring default physics restores the original node positions');
  assert.equal(await repulsion.inputValue(),'100');

  const measureDrag = async (name, value) => {
    await setRange(name,value);
    const base=await worldPositions();
    const box=await node('a').locator('.qd-planet-ring').boundingBox();
    const point={x:box.x+box.width/2,y:box.y+box.height/2};
    await page.mouse.move(point.x,point.y);
    await page.mouse.down();
    await page.mouse.move(point.x+88,point.y+32,{steps:6});
    await page.waitForFunction(initial=>{
      const [,x,y]=/^translate\(([-\d.]+)[ ,]([-\d.]+)\)$/.exec(document.querySelector('[data-note-id="b"]').getAttribute('transform'));
      return Math.hypot(Number(x)-initial.x,Number(y)-initial.y)>1;
    },base.b);
    // Fixed animation-frame settling gives both settings time to reach their actual drag goal.
    await page.evaluate(()=>new Promise(resolve=>{let left=45;const frame=()=>--left ? requestAnimationFrame(frame) : resolve();requestAnimationFrame(frame);}));
    const held=await worldPositions();
    const distance=id=>Math.hypot(held[id].x-base[id].x,held[id].y-base[id].y);
    const coupling=distance('b')/distance('a');
    await page.evaluate(base=>{
      window.__graphSpringSamples=[];
      let left=30;
      const frame=()=>{
        const transform=document.querySelector('[data-note-id="a"]').getAttribute('transform');
        const [,x,y]=/^translate\(([-\d.]+)[ ,]([-\d.]+)\)$/.exec(transform);
        window.__graphSpringSamples.push(Math.hypot(Number(x)-base.x,Number(y)-base.y));
        if (--left) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },base.a);
    await page.mouse.up();
    await page.waitForFunction(()=>window.__graphSpringSamples.length===30);
    const release=(await page.evaluate(()=>window.__graphSpringSamples)).map(value=>value/distance('a'));
    await page.waitForFunction(initial=>document.querySelector('[data-note-id="a"]').getAttribute('transform')===initial,
      `translate(${base.a.x} ${base.a.y})`);
    assert.equal(await drawer.count(),0,'a physics drag does not select a note');
    return {base,coupling,release};
  };
  await page.emulateMedia({reducedMotion:'no-preference'});
  const soft=await measureDrag('连线弹性',40);
  const firm=await measureDrag('连线弹性',180);
  assert.ok(Object.keys(soft.base).some(id=>Math.hypot(soft.base[id].x-firm.base[id].x,soft.base[id].y-firm.base[id].y)>1),
    'line elasticity changes actual node world positions as well as drag dynamics');
  assert.ok(firm.coupling>soft.coupling*1.2,'line elasticity changes actual neighbor traction during the same drag');
  assert.ok(soft.release.some((value,index)=>Math.abs(value-firm.release[index])>.04),
    'line elasticity changes the released node spring trajectory');
  await page.getByRole('button',{name:'恢复默认引力',exact:true}).click();
  const close=await measureDrag('节点斥力',40);
  const loose=await measureDrag('节点斥力',180);
  assert.ok(close.coupling>loose.coupling*1.2,'node repulsion changes actual neighbor traction during the same drag');
  assert.ok(close.release.some((value,index)=>Math.abs(value-loose.release[index])>.04),
    'node repulsion changes the released node spring trajectory');
  await page.getByRole('button',{name:'恢复默认引力',exact:true}).click();
  assert.deepEqual(await worldPositions(),defaults,'both slider changes can return to the original layout');
  await page.setViewportSize({width:1440,height:1080});
  await page.getByRole('complementary',{name:'图谱筛选',exact:true}).evaluate(element=>{element.scrollTop=0;});
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.screenshot({path:path.join(output,'knowledge-graph-keyboard-layout-desktop.png'),animations:'disabled'});
  await layout.click();
  assert.equal(await repulsion.isVisible(),false,'layout settings can collapse again');

  await page.setViewportSize({width:390,height:844});
  const closeMobileFilter=page.getByRole('button',{name:'关闭筛选',exact:true});
  await page.getByRole('button',{name:'展开筛选面板',exact:true}).waitFor();
  await nav('帮你想').focus();
  await pressSlash();
  await searchFocused();
  assert.equal(await search.evaluate(element=>element===document.activeElement),true,
    '/ opens the narrow-screen filter drawer and focuses graph search');
  await layout.click();
  await setRange('节点斥力',140);
  const mobilePositions=await worldPositions();
  assert.ok(Object.keys(defaults).some(id=>Math.hypot(mobilePositions[id].x-defaults[id].x,mobilePositions[id].y-defaults[id].y)>1),
    'the narrow-screen slider changes the same real graph layout');
  await page.getByRole('button',{name:'恢复默认引力',exact:true}).click();
  assert.deepEqual(await worldPositions(),defaults);
  await page.emulateMedia({colorScheme:'dark'});
  await assertWhite('.qd-planet-field');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'expanded mobile physics settings do not overflow the viewport');
  await page.screenshot({path:path.join(output,'knowledge-graph-keyboard-layout-mobile.png'),animations:'disabled'});
  await closeMobileFilter.click();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='展开筛选面板');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  assert.ok(await focusedNodeId());
  await page.keyboard.press('Enter');
  await drawer.waitFor();
  await drawer.press('Escape');
  await page.emulateMedia({colorScheme:'light'});
  await page.setViewportSize({width:1440,height:900});
  console.log('Verified white v2 details with isolated synthetic notes: main-navigation and collapsed-filter / search; input, textarea, contenteditable, range, native/ARIA dialog, inspiration logic and other-page isolation; canvas directional focus and Enter; collapsed layout controls, real layout change/default restore, neighbor traction and release dynamics at both repulsion and elasticity extremes; 390px filters, keyboard navigation and white theme under dark preference.');
}
async function verifyPersonalGraphs() {
  const url = new URL(origin);
  url.searchParams.set('personal','1');
  const button = name => page.getByRole('button',{name,exact:true});
  const center = page.getByRole('combobox',{name:'中心笔记',exact:true});
  const dialog = page.getByRole('dialog',{name:'关联其他图谱',exact:true});
  const drawer = page.getByRole('complementary',{name:'笔记与连线详情'});
  const range = page.getByRole('group',{name:'看多远',exact:true});
  const chapters = page.locator('[data-content-id]');
  async function openLinks() {
    await button('关联其他图谱').click();
    await dialog.waitFor();
  }
  async function chooseLinks(checked, unchecked = []) {
    await openLinks();
    for (const title of checked) await dialog.getByRole('checkbox',{name:title,exact:true}).check();
    for (const title of unchecked) await dialog.getByRole('checkbox',{name:title,exact:true}).uncheck();
    await dialog.getByRole('button',{name:'更新图谱',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
  }
  async function assertNotes(expected) {
    assert.deepEqual(await displayedIds(),expected,'only confirmed note links count towards this scope');
  }
  await page.goto(url.href);
  await nav('帮你想').click();
  await node('a').waitFor();
  await page.locator('[data-edge-key="automatic-only"]').waitFor();
  await button('局部图谱').click();
  const choose = page.getByRole('dialog',{name:'选择中心笔记',exact:true});
  await choose.waitFor();
  await choose.getByRole('button',{name:'首页问题',exact:true}).click();
  assert.equal(await center.inputValue(),'a');
  await assertNotes(['a']);
  assert.ok(await chapters.count()>0,'the center already includes its own content');
  assert.equal(await page.locator('[data-edge-key="automatic-only"]').count(),0);
  const point = chapters.filter({hasText:'搜索按钮太小'}).first();
  await point.press('Enter');
  await drawer.getByText(/搜索按钮太小/).first().waitFor();
  await drawer.getByText(/首页问题/).first().waitFor();
  await drawer.press('Escape');

  await openLinks();
  assert.equal(await dialog.getByRole('checkbox',{name:'首页问题',exact:true}).count(),0,'a note cannot select itself');
  await dialog.getByRole('checkbox',{name:'客户端更新',exact:true}).check();
  await dialog.getByRole('checkbox',{name:'访谈纪要',exact:true}).check();
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await assertNotes(['a']);
  await openLinks();
  assert.equal(await dialog.getByRole('checkbox',{name:'客户端更新',exact:true}).isChecked(),false);
  await dialog.getByRole('checkbox',{name:'客户端更新',exact:true}).check();
  await dialog.getByRole('checkbox',{name:'访谈纪要',exact:true}).check();
  await page.screenshot({path:path.join(output,'personal-graph-confirm.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'更新图谱',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await assertNotes(['a','c','f']);
  await chapters.filter({hasText:'改进触摸反馈'}).first().waitFor();
  await center.selectOption('c');
  await assertNotes(['a','c']);
  await chooseLinks(['页面设计']);
  await center.selectOption('e');
  await chooseLinks(['验收记录']);
  await center.selectOption('b');
  await chooseLinks(['发布清单']);

  // Re-enter through the public UI. The fixture guard preserves the library across reload.
  await page.reload();
  await nav('帮你想').click();
  await page.locator('[data-edge-key="automatic-only"]').waitFor();
  await node('a').press('Enter');
  await drawer.getByRole('button',{name:'打开本篇图谱',exact:true}).click();
  assert.equal(await center.inputValue(),'a');
  await assertNotes(['a','c','f']);
  await button('再看 1 篇间接关联').click();
  await assertNotes(['a','c','e','f']);
  assert.equal(await range.getByRole('button',{name:'最多 2 步'}).getAttribute('aria-pressed'),'true');
  await button('再看 1 篇间接关联').click();
  await assertNotes(['a','b','c','e','f']);
  assert.equal(await node('d').count(),0,'a fourth hop remains outside the three-step view');
  await node('b').press('Enter');
  assert.equal(await center.inputValue(),'a','reading another note does not change the center');
  const route = drawer.getByText(/首页问题.*客户端更新.*页面设计.*验收记录/);
  await route.first().waitFor();
  assert.equal(await page.locator('[data-on-path="true"]').count(),3,'all three confirmed connections on the chosen path are highlighted');
  await page.screenshot({path:path.join(output,'personal-graph-three-steps.png'),animations:'disabled'});
  await drawer.press('Escape');
  await range.getByRole('button',{name:'直接关联',exact:true}).click();
  await assertNotes(['a','c','f']);

  await page.setViewportSize({width:390,height:844});
  await openLinks();
  await page.screenshot({path:path.join(output,'personal-graph-mobile-select.png'),animations:'disabled'});
  await dialog.getByRole('checkbox',{name:'客户端更新',exact:true}).uncheck();
  await dialog.getByRole('button',{name:'更新图谱',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await assertNotes(['a','f']);
  await page.getByText('已显示全部关联',{exact:true}).first().waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
  await chooseLinks([],['访谈纪要']);
  await assertNotes(['a']);
  assert.ok(await chapters.count()>0,'removing every external link preserves the original note graph');
  await page.setViewportSize({width:1440,height:900});
  await center.selectOption('c');
  await assertNotes(['c','e']);
  await button('全局图谱').click();
  await page.locator('[data-edge-key="automatic-only"]').waitFor();
  await node('a').press('Enter');
  await drawer.getByRole('button',{name:'打开笔记',exact:false}).click();
  await page.getByRole('textbox',{name:'笔记标题',exact:true}).waitFor();
  await button('打开本篇图谱').click();
  assert.equal(await center.inputValue(),'a');
  await assertNotes(['a']);
  assert.equal(await drawer.isVisible(),false,'opening the local graph from the editor leaves the canvas visible');
  console.log('Verified per-note content and provenance, explicit multi-selection and cancellation, symmetric persisted links, independent centers, three shortest-path layers with exact next-note counts, mobile removal, surviving original notes and preserved global evidence.');
}

try {
  await verifyWhiteV2Details();
  if (!detailsOnly) {
  await page.goto(origin);
  await nav('帮你想').click();
  await page.getByRole('heading', { name: '知识图谱' }).waitFor();
  await page.getByText('探索你的知识', {exact:true}).waitFor();
  await page.getByRole('button',{name:'操作说明',exact:true}).click();
  const help = page.getByRole('complementary',{name:'图谱操作说明',exact:true});
  await help.getByText('拖动星球',{exact:true}).waitFor();
  await help.getByRole('button',{name:'关闭操作说明',exact:true}).click();
  assert.equal(await help.count(),0);
  await page.getByText('7 篇笔记', { exact: true }).waitFor();
  await node('river').waitFor();
  await node('blank').waitFor();
  await node('attachment').waitFor();
  assert.equal(await page.locator('.qd-library-node').count(), 7);
  const drawer = page.getByRole('complementary', {name:'笔记与连线详情'});
  assert.equal(await drawer.count(),0);
  await page.mouse.move(1,1);
  await page.screenshot({path:path.join(output,'knowledge-planets.png'),animations:'disabled'});
  const orb = node('route').locator('.qd-planet-ring');
  const start = await orb.boundingBox();
  const originTransform = await node('route').getAttribute('transform');
  const neighborTransform = await node('backup').getAttribute('transform');
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);
  await page.mouse.down();
  await page.mouse.move(start.x+start.width/2+69,start.y+start.height/2+34,{steps:6});
  await page.waitForFunction(original=>document.querySelector('[data-note-id=backup]').getAttribute('transform')!==original,neighborTransform);
  assert.notEqual(await node('route').getAttribute('transform'),originTransform);
  await page.mouse.up();
  await page.waitForFunction(original=>document.querySelector('[data-note-id=route]').getAttribute('transform')===original,originTransform);
  assert.equal(await drawer.count(),0);
  const touch = await page.context().newCDPSession(page);
  const tap = async locator => {
    const box = await locator.boundingBox();
    assert.ok(box,'touch target is visible');
    const point={x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};
    assert.ok(point.y>0 && point.y<await page.evaluate(()=>innerHeight),'touch target is inside the viewport');
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await page.emulateMedia({reducedMotion:'reduce'});
  const center={x:Math.round(start.x+start.width/2),y:Math.round(start.y+start.height/2)};
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[center]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:center.x+82,y:center.y+20}]});
  await page.waitForFunction(original=>document.querySelector('[data-note-id=route]').getAttribute('transform')!==original,originTransform);
  assert.equal(await node('backup').getAttribute('transform'),neighborTransform);
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(original=>document.querySelector('[data-note-id=route]').getAttribute('transform')===original,originTransform);
  await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'放大图谱'}).click();
  await page.getByText('125%',{exact:true}).waitFor();
  await page.getByRole('button',{name:'适应画布'}).click();
  await node('river').press('Enter');
  await drawer.getByText('还没有找到关联。').waitFor();
  await page.locator('.qd-planet-svg').click({position:{x:5,y:5}});
  assert.equal(await drawer.count(),0);
  assert.match(await node('river').textContent(), /暂无连线/);
  assert.doesNotMatch(await node('expansion').textContent(), /暂无连线/);
  const conflictWire = page.locator('[data-edge-key][data-conflict="true"]').first();
  await conflictWire.waitFor();
  assert.ok(await conflictWire.locator('path').first().evaluate(path => path.getTotalLength() > 0));
  await conflictWire.locator('text').click();
  const inspector = page.getByRole('article', { name: '关联依据' });
  assert.deepEqual((await inspector.locator('blockquote').allTextContents()).sort(), ['预算：3000 元','预算：5000 元']);
  await page.getByRole('group', { name: '图谱显示方式' }).getByRole('button', {name:'列表'}).click();
  await page.getByRole('region', {name:'连线列表'}).getByRole('button', {name:/可能冲突/}).click();
  await page.getByRole('group', { name: '图谱显示方式' }).getByRole('button', {name:'图谱'}).click();
  await page.screenshot({ path: path.join(output, 'knowledge-graph-overview.png'), animations: 'disabled' });
  await page.getByText('连线怎么来的？', { exact: true }).click();
  await page.getByText(/本机会比对笔记/).waitFor();
  await page.getByText('连线怎么来的？', { exact: true }).click();
  await node('route').press('Enter');
  await drawer.getByRole('button',{name:/可能冲突/}).click();
  await page.getByRole('heading', { name: '两处「预算」数值不同' }).waitFor();
  await page.getByText('预算：5000 元', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'knowledge-graph-evidence.png'), animations: 'disabled' });
  const areas = await Promise.all([node('route').boundingBox(), node('backup').boundingBox(), node('museum').boundingBox()]);
  assert.notEqual(new Set(areas.map(item => item?.y)).size, 1, 'connected notes are not all in the same row');
  await page.getByRole('button', { name: '忽略', exact: true }).click();
  await page.getByText('已忽略这条发现。').waitFor();
  assert.equal(await page.getByRole('heading', { name: '两处「预算」数值不同' }).count(), 0);
  await page.getByRole('checkbox', { name: '显示已忽略' }).check();
  await page.getByRole('heading', { name: '两处「预算」数值不同' }).waitFor();
  await page.getByRole('button', { name: '重新保留' }).click();
  await page.getByText('已保留这条关联。').waitFor();
  await page.getByRole('searchbox', { name: '查找图中笔记' }).fill('候'); // Body text does not alter title filtering.
  await page.getByText('没有匹配标题的笔记。').waitFor();
  await page.getByRole('searchbox', { name: '查找图中笔记' }).fill('河岸');
  await node('river').waitFor();
  assert.equal(await page.locator('.qd-library-node').count(), 1);
  await page.getByRole('button', { name: '查看全部笔记' }).click();
  await node('backup').waitFor();
  for (const width of [1280, 1100]) {
    await page.setViewportSize({width,height:820});
    await node('backup').press('Enter');
    const [canvas,panel] = await Promise.all([page.locator('.qd-planet-field').boundingBox(),drawer.boundingBox()]);
    assert.ok(canvas.x+canvas.width<=panel.x+1 && panel.x+panel.width<=width);
    await drawer.press('Escape');
    assert.equal(await drawer.count(),0);
  }
  for (const width of [1024, 768, 320]) {
    await page.setViewportSize({ width, height: 820 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.evaluate(() => { document.body.style.zoom = '1.15'; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'knowledge-graph-mobile.png'), animations: 'disabled' });
  await node('backup').press('Enter');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '笔记与连线详情');
  await page.getByRole('heading', { name: '京都赏枫路线备选', exact: true }).waitFor();
  const mobilePanel = await drawer.boundingBox();
  const mobileCanvas = await page.locator('.qd-planet-body').boundingBox();
  const mobileViewportHeight = await page.evaluate(()=>innerHeight);
  assert.ok(Math.abs(mobilePanel.x-mobileCanvas.x)<2 && Math.abs(mobilePanel.width-mobileCanvas.width)<2,
    'narrow-screen details occupy the bottom of the graph surface');
  assert.ok(mobilePanel.y>mobileCanvas.y && mobilePanel.y+mobilePanel.height<=mobileCanvas.y+mobileCanvas.height+2);
  assert.ok(mobilePanel.y+mobilePanel.height<=mobileViewportHeight+1,'mobile details end inside the viewport at 320px and 115%');
  const mobileExpand = drawer.getByRole('button',{name:'打开本篇图谱',exact:true});
  const mobileExpandBox = await mobileExpand.boundingBox();
  assert.ok(mobileExpandBox.y>=0 && mobileExpandBox.y+mobileExpandBox.height<=mobileViewportHeight,
    'the mobile expand button is available without scrolling');
  await page.screenshot({path:path.join(output,'knowledge-graph-mobile-320-zoom-detail.png'),animations:'disabled'});
  await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  await tap(mobileExpand);
  assert.equal(await page.getByRole('button',{name:'局部图谱',exact:true}).getAttribute('aria-pressed'),'true');
  if (await drawer.isVisible()) await tap(drawer.getByRole('button',{name:'关闭说明',exact:true}));
  assert.equal(await drawer.count(),0);
  await page.getByRole('button',{name:'全局图谱',exact:true}).click();
  const pinchField = await page.locator('.qd-planet-field').boundingBox();
  const pinchCenter={x:Math.round(pinchField.x+pinchField.width/2),y:Math.round(pinchField.y+Math.min(80,pinchField.height/3))};
  const beforePinch=await page.locator('.qd-planet-controls output').innerText();
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
    {id:1,x:pinchCenter.x-35,y:pinchCenter.y},{id:2,x:pinchCenter.x+35,y:pinchCenter.y},
  ]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
    {id:1,x:pinchCenter.x-60,y:pinchCenter.y},{id:2,x:pinchCenter.x+60,y:pinchCenter.y},
  ]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.notEqual(await page.locator('.qd-planet-controls output').innerText(),beforePinch,'two-finger pinch changes graph zoom');
  assert.equal(await drawer.count(),0,'a pinch does not select a node');
  await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await page.getByRole('button',{name:'适应画布',exact:true}).click();
  await page.getByRole('button',{name:'展开筛选面板',exact:true}).click();
  await checkbox('显示独立笔记').uncheck();
  await page.getByRole('button',{name:'收起筛选面板',exact:true}).click();
  assert.equal(await node('river').count(),0);
  await page.getByRole('button',{name:'展开筛选面板',exact:true}).click();
  await checkbox('显示独立笔记').check();
  await page.getByRole('button',{name:'收起筛选面板',exact:true}).click();
  await node('river').waitFor();
  await page.evaluate(() => { document.body.style.zoom = ''; });
  await page.setViewportSize({width:390,height:844});
  await node('backup').press('Enter');
  const normalMobileExpand = await drawer.getByRole('button',{name:'打开本篇图谱',exact:true}).boundingBox();
  assert.ok(normalMobileExpand.y>=0 && normalMobileExpand.y+normalMobileExpand.height<=844,
    'the mobile expand button is available at 390px without scrolling');
  await page.screenshot({ path: path.join(output, 'knowledge-graph-mobile-detail.png'), animations: 'disabled' });
  await drawer.press('Escape');
  assert.equal(await drawer.count(),0);
  await page.getByRole('button',{name:'展开筛选面板',exact:true}).click();
  await page.screenshot({path:path.join(output,'knowledge-graph-mobile-filters.png'),animations:'disabled'});
  await page.getByRole('button',{name:'关闭筛选',exact:true}).click();
  assert.equal(await checkbox('显示独立笔记').count(),0);
  await page.setViewportSize({width:1440, height:900});
  const multiUrl = new URL(origin);
  multiUrl.searchParams.set('combined','1');
  await page.goto(multiUrl.href);
  await nav('帮你想').click();
  await node('weather').waitFor();
  for (const id of ['route','travel','weather','inside']) assert.match(await node(id).getAttribute('aria-label'),/1 条连线/);
  assert.equal(await page.locator('.qd-library-isolated').count(),0);
  const groupWire = page.locator('[data-edge-key="combined"]');
  assert.equal(await groupWire.count(),1);
  assert.equal((await groupWire.locator('path').first().getAttribute('d')).match(/M/g).length,2);
  const loop = page.locator('[data-edge-key="within"]');
  assert.ok(await loop.locator('path').first().evaluate(path => path.getTotalLength()>30));
  await node('weather').click();
  await drawer.getByRole('button',{name:/结合现场条件改道/}).click();
  const combined = page.getByRole('article',{name:'关联依据'});
  assert.match(await combined.locator('[aria-label="对象与关系"]').innerText(),/推理端点.*旅行路线.*雨天计划/s);
  assert.equal(await combined.locator('blockquote').count(),4);
  await combined.getByRole('button',{name:'保留这条推断'}).click();
  for (const id of ['route','travel','weather']) {
    await node(id).click();
    await drawer.getByRole('button',{name:/结合现场条件改道/}).click();
    await combined.getByText('已保留',{exact:true}).waitFor();
  }
  await page.getByRole('group',{name:'图谱显示方式'}).getByRole('button',{name:'列表'}).click();
  const list = page.getByRole('region',{name:'连线列表'});
  assert.equal(await list.getByRole('button').count(),2);
  await list.getByRole('button',{name:/推理端点.*旅行路线.*雨天计划/}).click();
  await page.screenshot({path:path.join(output,'combined-evidence.png'),animations:'disabled'});
  await list.getByRole('button',{name:/开放时间.*本篇内的记录/}).click();
  await combined.getByText('这篇笔记里的哪些内容相关').waitFor();
  assert.equal(await combined.locator('blockquote').count(),2);
  await list.getByRole('button',{name:/推理端点.*雨天计划/}).click();
  await combined.getByRole('button',{name:'忽略',exact:true}).click();
  await page.getByText('已忽略这条发现。').waitFor();
  assert.equal(await list.getByRole('button').count(),1);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).decisions.length),1);
  await page.getByRole('group',{name:'图谱显示方式'}).getByRole('button',{name:'图谱'}).click();
  for (const id of ['route','travel','weather']) assert.match(await node(id).getAttribute('aria-label'),/暂无连线/);
  assert.doesNotMatch(await node('inside').getAttribute('aria-label'),/暂无连线/);

  const exploreUrl = new URL(origin);
  exploreUrl.searchParams.set('explore','1');
  await page.goto(exploreUrl.href);
  await nav('帮你想').click();
  await node('isolated').waitFor();
  assert.deepEqual(await displayedIds(),['a','b','c','d','e','isolated']);
  const graphTransform = page.locator('.qd-planet-svg > g');
  const beforePan = await graphTransform.getAttribute('transform');
  const desktopField = await page.locator('.qd-planet-svg').boundingBox();
  const blankPoint={x:desktopField.x+16,y:desktopField.y+16};
  assert.equal(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('[data-note-id],[data-edge-key]'),blankPoint),false,
    'the pan gesture starts on blank graph space');
  await page.mouse.move(blankPoint.x,blankPoint.y);
  await page.mouse.down();
  await page.mouse.move(blankPoint.x+52,blankPoint.y+24,{steps:4});
  await page.mouse.up();
  assert.notEqual(await graphTransform.getAttribute('transform'),beforePan,'dragging blank space pans the graph');
  assert.equal(await drawer.count(),0,'panning does not select a note');
  await page.getByRole('button',{name:'适应画布',exact:true}).click();
  assert.equal(await graphTransform.getAttribute('transform'),beforePan,'reset restores the initial graph position');
  const beforeWheel=await page.locator('.qd-planet-controls output').innerText();
  await page.mouse.move(blankPoint.x,blankPoint.y);
  await page.mouse.wheel(0,-220);
  await page.waitForFunction(original=>document.querySelector('.qd-planet-controls output')?.textContent!==original,beforeWheel);
  assert.ok(parseInt(await page.locator('.qd-planet-controls output').innerText(),10)>parseInt(beforeWheel,10),
    'the wheel zooms in over the graph canvas');
  assert.equal(await drawer.count(),0);
  await page.getByRole('button',{name:'适应画布',exact:true}).click();
  await node('c').locator('.qd-planet-ring').dblclick();
  await page.waitForFunction(()=>document.querySelector('[aria-label="图谱范围"] button:last-child')?.getAttribute('aria-pressed')==='true');
  assert.equal(await page.getByRole('combobox',{name:'中心笔记',exact:true}).inputValue(),'c');
  assert.deepEqual(await displayedIds(),['c'],'each new local graph starts with its own note and its contents');
  assert.ok(await page.locator('[data-content-id]').count()>0);
  await page.screenshot({path:path.join(output,'knowledge-graph-double-click-local.png'),animations:'disabled'});
  await page.getByRole('button',{name:'全局图谱',exact:true}).click();
  if (await drawer.count()) await drawer.press('Escape');
  assert.deepEqual(await displayedIds(),['a','b','c','d','e','isolated']);
  // All classification is derived from the actual stored relationships.
  await checkbox('显示多关联笔记').uncheck();
  assert.deepEqual(await displayedIds(),['a','e','isolated']);
  await checkbox('显示关联笔记').uncheck();
  assert.deepEqual(await displayedIds(),['isolated']);
  await checkbox('显示多关联笔记').check();
  await checkbox('显示关联笔记').check();
  await checkbox('仅看有关联的笔记').check();
  assert.deepEqual(await displayedIds(),['a','b','c','d','e']);
  await checkbox('仅看有关联的笔记').uncheck();
  await checkbox('显示笔记名称').uncheck();
  assert.equal(await node('a').locator('text').isVisible(),false);
  assert.match(await node('a').getAttribute('aria-label'),/合成起点/,'hidden labels retain accessible names');
  await checkbox('显示笔记名称').check();
  assert.equal(await node('a').locator('text').isVisible(),true);
  await page.getByRole('button',{name:'收起筛选面板',exact:true}).click();
  assert.equal(await checkbox('显示多关联笔记').isVisible(),false);
  await page.getByRole('button',{name:'展开筛选面板',exact:true}).click();
  assert.equal(await checkbox('显示多关联笔记').isVisible(),true);
  await node('a').press('Enter');
  await drawer.getByRole('button',{name:'关联笔记 1',exact:true}).click();
  await drawer.getByRole('list',{name:'关联笔记列表'}).getByRole('button',{name:'合成关联一',exact:true}).click();
  await drawer.getByRole('heading',{name:'合成关联一',exact:true}).waitFor();
  await drawer.getByRole('button',{name:'思考演进',exact:true}).click();
  await drawer.getByText('尚无改动记录。',{exact:true}).waitFor();
  await node('a').press('Enter');
  await page.getByRole('searchbox',{name:'查找图中笔记'}).fill('合成独立');
  assert.deepEqual(await displayedIds(),['isolated']);
  await page.getByRole('button',{name:'查看全部笔记',exact:true}).click();
  await node('a').press('Enter');
  await page.emulateMedia({colorScheme:'dark'});
  await assertWhite('.qd-planet-field');
  await assertWhite('.qd-planet-drawer');
  const whiteSidebar = page.getByRole('checkbox',{name:'显示多关联笔记',exact:true}).locator('xpath=ancestor::aside');
  assert.equal(await whiteSidebar.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(255, 255, 255)');
  await page.screenshot({path:path.join(output,'knowledge-graph-white-dark-system.png'),animations:'disabled'});
  await page.emulateMedia({colorScheme:'light'});
  await drawer.getByRole('button',{name:'打开笔记',exact:false}).click();
  await page.getByRole('heading',{name:'帮你记',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'笔记标题',exact:true}).inputValue(),'合成起点');
  assert.equal(await page.getByRole('textbox',{name:'笔记正文',exact:true}).getAttribute('contenteditable'),'true');
  await nav('帮你想').click();
  await page.getByRole('heading',{name:'知识图谱',exact:true}).waitFor();
  const empty = await browser.newPage();
  await empty.goto(origin);
  await empty.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你想',exact:true}).click();
  await empty.getByText('写下第一篇笔记后，这里就会显示它。').waitFor();
  await empty.getByRole('button',{name:'写笔记'}).click();
  await empty.getByRole('heading',{name:'帮你记',exact:true}).waitFor();
  await empty.close();
  await verifyPersonalGraphs();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], 'graph calculation did not make a network request');
  if (!detailsOnly) console.log('Verified isolated synthetic data only: desktop, 390px and 320px at 115%; pointer/touch spring, blank-space pan, wheel and pinch zoom without accidental selection, double-click local exploration, touch expand/close, reduced motion, zoom/reset, connection-derived filters, three exploration layers, closable mobile filters and bottom details with expand button inside the viewport, white theme under dark preference, original editor/navigation, empty graph, evidence decisions, three-note composition and intra-note loops.');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'knowledge-graph-failed.png') }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
