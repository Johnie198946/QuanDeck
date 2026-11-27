import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4319';
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
try {
  await page.goto(origin);
  await nav('帮你想').click();
  await page.getByRole('heading', { name: '知识图谱' }).waitFor();
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
  const empty = await browser.newPage();
  await empty.goto(origin);
  await empty.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你想',exact:true}).click();
  await empty.getByText('写下第一篇笔记后，这里就会显示它。').waitFor();
  await empty.getByRole('button',{name:'写笔记'}).click();
  await empty.getByRole('heading',{name:'帮你记',exact:true}).waitFor();
  await empty.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], 'graph calculation did not make a network request');
  console.log('Pointer drag, neighbor spring, touch drag under reduced motion, empty graph, zoom, blank dismissal and all seven notes represented; expansion linkage, former archive, drawn edges, keyboard, evidence, dismiss/restore, filtering and 320px verified. Three-note composition and intra-note loops verified with one feedback entry per finding');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'knowledge-graph-failed.png') }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
