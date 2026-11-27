import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4319';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/note-header';
const title = '周末散步摄影手记';
const sections = [
  ['出发前', '包里放一台相机、一块备用电池和一瓶水。先走熟悉的小路，看看清晨的光落在哪里。'],
  ['河边的倒影', '等一艘船慢慢经过，拍下水面刚刚散开的波纹。绕到桥的另一头，让两岸的树梢都在画面里。'],
  ['巷口早餐', '在早餐铺的窗边坐一会儿，记下杯沿上的高光。蒸汽散开以后，再补拍摊主摆碗的手。'],
  ['街角的小店', '从侧面看橱窗的反光，稍微改变站位就能避开玻璃里的自己。给招牌和门前的自行车各拍一张。'],
  ['石桥上的风', '顺着石阶走上桥，把栏杆放在画面下方。等骑车的人经过，留一点远处河面的空白。'],
  ['午后的树荫', '树叶在风里转动，墙上的影子也跟着变。站在同一个位置多等一会儿，比较三张照片里光斑的形状。'],
];
const body = Array.from({length: 5}, (_, day) => {
  return sections.map(([heading, paragraph]) => '## ' + heading + '\n\n' + paragraph + '\n\n' +
    '第' + (day + 1) + '次记录，回家后挑选一张照片，写下最想保留的细节。').join('\n\n');
}).join('\n\n');

await mkdir(output, { recursive:true });
const browser = await chromium.launch({ channel:'chrome', headless:true });
try {
  for (const viewport of [{width:1440,height:900}, {width:390,height:844}]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.route('**/*', route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
    await page.addInitScript(({title,body})=>{
      const at = '2026-11-25T07:00:00Z';
      localStorage.setItem('quandeck.personal-knowledge.v1', JSON.stringify({schema:1, decisions:[], notes:[
        {id:'walk',title,body,createdAt:at,updatedAt:at,revision:1,attachments:[],expansions:[],history:[]},
      ]}));
    },{title,body});
    await page.goto(origin);
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'帮你记'}).click();
    const heading = page.getByRole('textbox',{name:'笔记标题'});
    const toolbar = page.getByRole('toolbar',{name:'笔记格式'});
    const share = page.getByRole('button',{name:'分享笔记'});
    await heading.waitFor();
    assert.equal(await heading.inputValue(), title);

    // A user scrolls the note with the pointer over its actual text. Scroll twice
    // to distinguish a pinned header from one still leaving its initial position.
    const bodyBox = await page.getByRole('textbox',{name:'笔记正文'}).boundingBox();
    const x = bodyBox.x + bodyBox.width / 2;
    await page.mouse.move(x, viewport.height - 45);
    const topAfterScroll = [];
    for (const delta of [900, 720]) {
      const before = await page.evaluate(()=>scrollY);
      await page.mouse.wheel(0, delta);
      await page.waitForFunction(y=>scrollY>=y, before + delta - 2);
      const rect = await toolbar.boundingBox();
      const titleBounds = await heading.boundingBox();
      assert.ok(titleBounds.y >= -1 && titleBounds.y + titleBounds.height <= rect.y + 1, 'The entire title remains above the format controls');
      assert.ok(rect.y + rect.height < viewport.height - 100, 'There is room to read below the toolbar');
      assert.ok(await heading.evaluate(el=>{
        const r = el.getBoundingClientRect();
        return document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)===el;
      }), 'The visible title remains editable');
      topAfterScroll.push({title:titleBounds.y, tools:rect.y});
    }
    for (const key of ['title','tools']) {
      assert.ok(Math.abs(topAfterScroll[0][key]-topAfterScroll[1][key]) <= 1, key + ' stays in place while the body scrolls');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'The page fits the viewport');
    assert.equal((await share.innerText()).trim(),'');
    assert.ok(await share.locator('svg').isVisible());
    assert.ok(await share.evaluate(button=>{
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      return ['borderLeftWidth','borderRightWidth','borderTopWidth','borderBottomWidth'].every(side=>parseFloat(style[side])===0)
        && style.boxShadow==='none' && box.width>=24 && box.height>=24 && box.width<60;
    }),'The share control is an unframed icon with its own click target');
    await page.screenshot({path:path.join(output,'notes-scrolled-'+viewport.width+'.png'),animations:'disabled'});

    await page.evaluate(()=>{
      window.shareCalls = [];
      window.quandeckDesktop = {
        platform:'darwin',readKnowledge:async()=>localStorage.getItem('quandeck.personal-knowledge.v1'),
        shareKnowledgeNote:async payload=>{window.shareCalls.push(payload);return true;},
      };
    });
    const pinnedScroll = await page.evaluate(()=>scrollY);
    const shareBox = await share.boundingBox();
    await page.mouse.click(shareBox.x+shareBox.width/2, shareBox.y+shareBox.height/2);
    await page.waitForFunction(()=>window.shareCalls.length>0);
    const shared = await page.evaluate(()=>{delete window.quandeckDesktop;return window.shareCalls;});
    assert.equal(shared.length,1);
    assert.equal(shared[0].noteId,'walk');
    assert.equal(shared[0].title,title);
    assert.match(shared[0].text,/石桥上的风/);
    const sharedScroll = await page.evaluate(()=>scrollY);
    assert.ok(Math.abs(sharedScroll-pinnedScroll)<=5, 'Sharing moved the viewport from '+pinnedScroll+' to '+sharedScroll);

    const selectedText = await page.getByRole('textbox',{name:'笔记正文'}).evaluate(editor=>{
      const barBottom = document.querySelector('[role=toolbar][aria-label="笔记格式"]').getBoundingClientRect().bottom;
      editor.focus({preventScroll:true});
      for (const p of editor.querySelectorAll('p')) {
        const r = p.getBoundingClientRect();
        if (r.top<barBottom+8 || r.bottom>innerHeight-12 || !p.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))) continue;
        const range = document.createRange();
        range.selectNodeContents(p);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      }
      throw Error('No readable paragraph below the pinned header');
    });
    await toolbar.getByRole('button',{name:'加粗',exact:true}).click();
    await page.waitForFunction(text=>[...document.querySelectorAll('.qd-writer-content :is(b,strong)')].some(node=>node.textContent===text),selectedText);
    assert.ok((await heading.boundingBox()).y>=-1);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({viewport:viewport.width,scroll:pinnedScroll,positions:topAfterScroll,iconShareCalls:shared.length,formatApplied:true}));
    await page.close();
  }
} finally {await browser.close();}
