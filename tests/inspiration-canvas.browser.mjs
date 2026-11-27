import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4319';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/inspiration';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());

const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
const nav = name => button(name, page.getByRole('navigation', { name: '主导航' }));
const readLibrary = () => page.evaluate(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')));
const kyoto = '鸭川徒步', osaka = '中之岛游', coast = '海边散步', food = '天满晚餐预留甜点时间';
const samples = [
  ['关西第一周随手记', '沿鸭川散步，把京都站留作下一段的出发点。\n从大阪站开始，先去中之岛，再去天满吃晚饭。'],
  ['我的海岸路线', '从大阪出发，给海边散步留一个下午。'],
  ['其他安排', '给周末留一天休息。'],
  ['同事推荐', '大阪天满晚饭的备选清单，最后一站留给甜点。'],
];
async function writeNotes() {
  await nav('帮你记').click();
  for (const [title, body] of samples) {
    await button('新建').click();
    await page.getByRole('textbox', { name: '笔记标题' }).fill(title);
    await page.getByRole('textbox', { name: '笔记正文' }).fill(body);
  }
  await nav('帮你想').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes.length === 4);
}
async function enterCanvas() {
  await button('灵感逻辑').click();
  await page.locator('.qd-inspiration').waitFor();
}
async function setupExtraction() {
  // Replace only the Electron analysis boundary. The selection, saving and file storage run normally.
  await page.evaluate(({kyoto,osaka,coast}) => {
    window.quandeckDesktop = { extractInspirations: async ids => {
      const notes = JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes.filter(n => ids.includes(n.id));
      delete window.quandeckDesktop;
      return Promise.all(notes.flatMap(n => n.body.split(/\n+/).filter(Boolean).map(async (quote,i) => {
        const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(quote));
        const digest = Array.from(new Uint8Array(hash),b => b.toString(16).padStart(2,'0')).join('');
        const start=n.body.indexOf(quote), title=n.title==='我的海岸路线'?coast:n.title==='其他安排'?'周末休息':i===0?kyoto:osaka;
        const detail=title===kyoto?'沿鸭川散步，再从京都站出发。':title===osaka?'先游中之岛，再去天满吃晚饭。':'给海边散步留一个下午。';
        return {id:'idea-'+n.id+'-'+i,idea:{title,detail,origin:'extracted',source:{noteId:n.id,revision:n.revision,field:'body',start,end:start+quote.length,digest}}};
      })));
    }};
  },{kyoto,osaka,coast});
}
async function clipboard(kind, value) {
  await page.locator('.qd-logic-stage-scroll').focus();
  await page.evaluate(({kind,value}) => {
    const data = new DataTransfer();
    if (kind === 'url') data.setData('text/plain',value);
    else if (kind === 'file') data.items.add(new File(['换乘参考'],value,{type:'text/plain'}));
    else data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlwfLkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],value,{type:'image/png'}));
    const target = document.activeElement;
    target.dispatchEvent(kind==='file' ? new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}) :
      new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  },{kind,value});
}
async function drag(from, to) {
  for (const target of [from, to]) await target.scrollIntoViewIfNeeded();
  const a = await from.boundingBox(), b = await to.boundingBox();
  assert.ok(a && b);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
  await page.mouse.up();
}
const out = title => button('从「' + title + '」连出');
const input = title => button('连入「' + title + '」');
const label = () => page.getByRole('textbox', { name: '连线名称', exact: true });
async function labelSelected(text) {
  await label().fill(text);
  await label().press('Tab');
  await page.locator('.qd-logic-wire-label').filter({ hasText: text }).waitFor();
}
try {
  await page.goto(origin);
  await writeNotes();
  const { notes } = await readLibrary();
  const original = notes.map(({ id, title, body }) => ({ id, title, body }));
  await enterCanvas();
  await button('灵感提炼').click();
  for(const [title] of samples.slice(0,2)) await page.getByRole('checkbox',{name:title}).check();
  await setupExtraction();
  await button('灵感提炼',page.getByRole('dialog')).click();
  await button('加入画布（3）').waitFor();
  const picker=page.getByRole('dialog');
  const ideasFromKyoto=picker.getByRole('group',{name:'关西第一周随手记'});
  assert.equal(await ideasFromKyoto.getByRole('checkbox').count(),2);
  assert.equal(await picker.getByText('关西第一周随手记',{exact:true}).count(),1);
  await ideasFromKyoto.getByText('沿鸭川散步，再从京都站出发。',{exact:true}).waitFor();
  const selectCoast=picker.getByRole('checkbox',{name:/海边散步/});
  await selectCoast.uncheck();
  await button('加入画布（2）').waitFor();
  await selectCoast.check();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await picker.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.setViewportSize({width:1600,height:960});
  await picker.screenshot({path:path.join(output,'extracted-ideas.png'),animations:'disabled'});
  await button('加入画布（3）').click();
  await button('新建灵感').click();
  await page.getByRole('textbox',{name:'灵感',exact:true}).fill(food);
  await button('加入画布',page.getByRole('dialog')).click();
  const card = button('画布灵感「' + food + '」');
  await card.waitFor();
  const foodNode = (await readLibrary()).inspirationCanvas.nodes.find(item => item.idea.title === food);
  const originalY = foodNode.y;
  await card.scrollIntoViewIfNeeded();
  const rect = await card.boundingBox();
  await page.mouse.move(rect.x + 20, rect.y + 20);
  await page.mouse.down();
  await page.mouse.move(rect.x + 115, rect.y + 95, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(({ id, y }) => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).inspirationCanvas.nodes.find(n => n.noteId === id).y > y + 50,
    { id: foodNode.noteId, y: originalY });
  await drag(out(kyoto), input(osaka));
  await labelSelected('前往');
  const note = page.getByRole('textbox', { name: '补充说明', exact: true });
  await note.fill('京都走完后，从京都站出发，接上大阪站的散步路线。');
  await note.press('Tab');
  await button('反转方向').click();
  await button(osaka + ' → 前往 → ' + kyoto).waitFor();
  assert.equal(await note.inputValue(), '');
  assert.match(await page.locator('.qd-logic-sentence').textContent(), /中之岛.*鸭川/);
  await button('反转方向').click();
  await button(kyoto + ' → 前往 → ' + osaka).waitFor();
  assert.match(await note.inputValue(), /从京都站出发/);
  await out(osaka).click();
  await input(coast).click();
  await labelSelected('下一站');
  await out(osaka).click();
  await input(food).click();
  await labelSelected('选餐厅');
  await button(kyoto + ' → 前往 → ' + osaka).click();
  await page.screenshot({ path: path.join(output, 'inspiration-canvas.png'), animations: 'disabled' });
  const before = (await readLibrary()).inspirationCanvas;
  assert.ok(before);
  // An older app saved long text and no detail. Its card already has coordinates and links.
  await page.evaluate(kyoto=>{
    const key='quandeck.personal-knowledge.v1',library=JSON.parse(localStorage.getItem(key));
    const card=library.inspirationCanvas.nodes.find(n=>n.idea?.title===kyoto);
    card.idea.title='沿鸭川徒步并回到京都站是一种可行的行程安排。';
    card.idea.detail='';
    card.idea.source.end-=1;
    const original=library.notes.find(n=>n.id===card.idea.source.noteId).body;
    const passage=original.slice(card.idea.source.start,card.idea.source.end);
    return crypto.subtle.digest('SHA-256',new TextEncoder().encode(passage)).then(hash=>{
      card.idea.source.digest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
      localStorage.setItem(key,JSON.stringify(library));
    });
  },kyoto);
  await page.reload();
  await nav('帮你想').click();
  await enterCanvas();
  await button('画布灵感「沿鸭川徒步并回到京都站是一种可行的行程安排。」').waitFor();
  await button('灵感提炼').click();
  for(const i of [0,2]) await picker.getByRole('checkbox',{name:samples[i][0]}).check();
  await setupExtraction();
  await button('灵感提炼',picker).click();
  const rewrite=picker.getByRole('checkbox',{name:/鸭川徒步.*更新文案/});
  assert.equal(await rewrite.isChecked(),false);
  assert.equal(await picker.getByRole('checkbox',{name:/中之岛游.*已在画布/}).isDisabled(),true);
  await rewrite.check();
  await button('更新画布（2）').waitFor();
  await picker.getByRole('checkbox',{name:/周末休息/}).uncheck();
  await button('更新画布（1）').click();
  await button('画布灵感「'+kyoto+'」').waitFor();
  assert.deepEqual((await readLibrary()).inspirationCanvas,before);
  await page.reload();
  await nav('帮你想').click();
  await enterCanvas();
  await out(kyoto).waitFor();
  const restored=button('画布灵感「'+kyoto+'」');
  await restored.getByText('沿鸭川散步，再从京都站出发。',{exact:true}).waitFor();
  await restored.click();
  await page.locator('.qd-logic-inspector').getByRole('button',{name:'关西第一周随手记'}).waitFor();
  assert.match(await page.locator('.qd-logic-inspector blockquote').innerText(),/沿鸭川散步，把京都站留作下一段的出发点/);
  assert.deepEqual((await readLibrary()).inspirationCanvas, before);
  await button(kyoto + ' → 前往 → ' + osaka).click();
  assert.equal(await label().inputValue(), '前往');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await label().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'inspiration-mobile.png'), animations: 'disabled' });
  assert.deepEqual((await readLibrary()).notes.map(({ id, title, body }) => ({ id, title, body })), original);
  await button('删除连线').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).inspirationCanvas.links.length === 2);
  await button('画布灵感「' + coast + '」').click();
  await button('从画布移除').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).inspirationCanvas.nodes.length === 3);
  assert.equal((await readLibrary()).inspirationCanvas.links.length, 1);
  assert.deepEqual((await readLibrary()).notes.map(({ id, title, body }) => ({ id, title, body })), original);
  await page.setViewportSize({width:1280,height:900});
  await button('画布灵感「'+food+'」').click();
  await clipboard('url','https://example.org/routes');
  await button('画布灵感「example.org」').click();
  await page.getByRole('link',{name:/example.org/}).waitFor();
  await clipboard('file','时刻表.txt');
  await page.getByRole('group',{name:'附件预览 · 时刻表.txt'}).getByText('换乘参考').waitFor();
  await clipboard('screenshot','地图.png');
  await page.getByRole('button',{name:'展开预览 地图.png'}).waitFor();
  await page.reload(); await nav('帮你想').click(); await enterCanvas();
  await button('画布灵感「时刻表.txt」').click();
  await page.getByRole('group',{name:'附件预览 · 时刻表.txt'}).getByText('换乘参考').waitFor();
  await page.screenshot({path:path.join(output,'idea-references.png'),animations:'disabled'});
  assert.deepEqual(errors, []);
  console.log('Two notes yielding three distinct passage-level ideas, one manual idea, pasted URL and screenshot, dropped file read back after reload, mouse and click connections, labels, reversal, reload, mobile layout and source integrity passed.');
} finally {
  await browser.close();
}
