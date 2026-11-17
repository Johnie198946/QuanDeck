import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4356';
const output = process.env.QUANDECK_UI_OUTPUT || '/private/tmp/quandeck-flow-diagram-ui';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage(), errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(url).origin)return route.continue();requests.push(route.request().url());return route.abort();});
try {
 await page.goto(url+'/tests/flow-diagram.preview.html');
 await page.getByRole('heading',{name:'执行方法与台帐流程'}).waitFor();
 assert.equal(await page.locator('.qd-flow-edge.is-return').count(),1);
 assert.equal(await page.locator('script').evaluateAll(nodes=>nodes.some(n=>n.textContent.includes('window.flowUnsafe=1'))),false,'model text never becomes a script element');
 assert.equal(await page.evaluate(()=>window.flowUnsafe),undefined);
 assert.match(await page.getByText(/流程图未生成/).textContent(),/不接受/);
 for(const width of [320,768,1024,1440]) {
  await page.setViewportSize({width,height:1000});
  await page.waitForFunction(() => { const viewport=document.querySelector('.qd-flow-scroll'), node=document.querySelector('.qd-flow-node rect'); const v=viewport.getBoundingClientRect(), n=node.getBoundingClientRect(); return n.left>=v.left&&n.right<=v.right; });
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`no page overflow ${width}`);
  await page.screenshot({path:`${output}/flow-${width}.png`,fullPage:true});
 }
 const launch=page.getByRole('button',{name:'放大流程图'}).first();
 await launch.click();await page.getByRole('dialog').waitFor();
 await page.screenshot({path:`${output}/flow-expanded.png`});
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
 assert.equal(await launch.evaluate(el=>document.activeElement===el),true,'focus restored');
 const node=page.locator('.qd-flow-node[role="button"]').first();
 await node.focus();await page.keyboard.press('Enter');
 await page.getByText('已选择：a',{exact:true}).waitFor();
 await page.locator('.qd-flow-text summary').first().click();
 assert.match(await page.locator('.qd-flow-text').first().textContent(),/不完整 → 未提交/);
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'no remote rendering requests');
 await writeFile(`${output}/checks.json`,JSON.stringify({ok:true,widths:[320,768,1024,1440],keyboard:true,focusRestore:true,returnEdge:true,textFallback:true,noExternalRequests:true,noScriptExecution:true},null,2));
 console.log('flow diagram responsive and accessibility checks passed');
}finally{await browser.close();}
