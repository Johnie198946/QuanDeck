import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.QUANDECK_UI_URL||'http://127.0.0.1:4349', output=process.env.QUANDECK_UI_OUTPUT||'/private/tmp/quandeck-single-delivery-review-ui';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}), errors=[];
try {
  for(const mode of ['review','manual']) for(const count of [1,2]) {
    const context=await browser.newContext(), page=await context.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
    await page.goto(url);
    await page.evaluate(async ({mode,count})=>{const {mountSingleDeliveryReviewFixture}=await import('/tests/single-delivery-review.fixture.tsx'); await mountSingleDeliveryReviewFixture(mode,count);},{mode,count});
    const form=mode==='review'?page.locator('.qd-delivery-review'):page.getByRole('dialog');
    await form.waitFor();if(mode==='review')await form.locator('summary').click();
    const boxes=form.getByRole('checkbox');
    const complete=form.getByRole('button',{name:mode==='review'?'确认认可':'提交待验收',exact:true});
    if(mode==='review') {
      assert.equal(await boxes.count(),count===1?5:13);
      assert.equal(await form.getByRole('checkbox',{checked:true}).count(),0);
      if(count===1)await form.getByText(/当前唯一交付件：guide-1.html/).waitFor();
      await form.getByRole('textbox',{name:'验收说明'}).fill('已核对当前文件与任务范围');
      assert(await complete.isDisabled());
      await boxes.first().focus();await page.keyboard.press('Space');assert(await boxes.first().isChecked());
      assert(await complete.isDisabled(),'one checkbox never accepts the remaining conditions');
      for(const box of await boxes.all())await box.check();assert(await complete.isEnabled());
      await form.getByRole('checkbox',{name:'来源完整',exact:true}).first().uncheck();assert(await complete.isDisabled());
      await form.getByRole('checkbox',{name:'来源完整',exact:true}).first().check();
    } else {
      assert.equal(await boxes.count(),0,'manual submissions have no acceptance controls');
      assert.equal(await form.getByRole('button',{name:'提交并完成任务',exact:true}).count(),0);
      assert(await complete.isEnabled());
    }
    if(count===1)for(const width of [320,768,1024,1440]) {
      await page.setViewportSize({width,height:1000});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${mode} overflow ${width}`);
      assert.equal(await form.evaluate(el=>el.scrollWidth>el.clientWidth),false,`${mode} form overflow ${width}`);
      await page.screenshot({path:path.join(output,`${mode}-${width}.png`),fullPage:true});
    }
    const storeSeparateDraft = mode === 'manual' && count === 2;
    if (storeSeparateDraft) await form.getByRole('button',{name:'存草稿',exact:true}).click();
    else await complete.click();
    await page.waitForFunction(()=>window.singleDeliveryReviewFixture.captured.length===1);
    const state=await page.evaluate(()=>window.singleDeliveryReviewFixture), saved=state.captured[0];
    const payload=mode==='review'?saved.payload:saved;
    if(mode==='review') {
      assert.deepEqual(payload.checks,[true,true,true,true,true]);
      for(const slot of state.slots)assert.deepEqual(payload.deliveryChecks[slot.id],[true,true,true,true]);
    } else {
      assert.equal(payload.status,storeSeparateDraft?'draft':'published');assert.equal(payload.id,undefined,'editing a submitted version keeps the original intact');assert.equal(payload.complete,undefined);
      assert.equal(payload.deliveryChecks,undefined);assert.equal(payload.taskChecks,undefined);
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'checks.json'),JSON.stringify({singleFileFiveInsteadOfNine:true,multipleFilesIndependent:true,taskAndItemPayloads:true,keyboard:true,widths:[320,768,1024,1440],errors},null,2));
  console.log('Single delivery review UI: result/manual forms, five instead of nine, multi-file isolation, explicit checks, original payload arrays, keyboard and four widths passed');
} finally {await browser.close();}
