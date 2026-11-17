import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.QUANDECK_UI_URL||'http://127.0.0.1:4342',output=process.env.QUANDECK_UI_OUTPUT||'/private/tmp/quandeck-output-contract-ui';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
try{
 await page.goto(url);await page.evaluate(async()=>{const {mountOutputContractFixture}=await import('/tests/output-contract.fixture.tsx');await mountOutputContractFixture();});
 const dialog=page.getByRole('dialog'),complete=dialog.getByRole('button',{name:'提交并完成任务',exact:true});await dialog.waitFor();
 assert(await complete.isDisabled());assert.equal(await dialog.getByRole('checkbox',{checked:true}).count(),0);
 await dialog.getByRole('textbox',{name:'使用说明交付正文'}).fill('这里是完整、独立的使用说明。');
 assert(await complete.isDisabled());
 await dialog.getByLabel('上传网页文件',{exact:true}).setInputFiles({name:'guide.html',mimeType:'text/html',buffer:Buffer.from('<!doctype html><html><body><h1>实际交付网页</h1></body></html>')});
 assert.equal(await dialog.getByRole('combobox',{name:'网页文件交付文件'}).inputValue().then(v=>v.startsWith('pending:')),true);
 assert(await complete.isDisabled(),'uploaded evidence never auto-checks review criteria');
 const sections=dialog.locator('.qd-output-delivery-item');for(const box of await sections.nth(0).getByRole('checkbox').all())await box.check();for(const box of await sections.nth(1).getByRole('checkbox').all())await box.check();
 assert(await complete.isDisabled(),'item checks do not imply task checks');
 const taskChecks=dialog.getByRole('group',{name:/任务验收条件/}).getByRole('checkbox');
 for(const box of await taskChecks.all())await box.check();
 assert(await complete.isEnabled(),'explicit task and item checks permit completion with an optional blank slot');
 await dialog.getByRole('textbox',{name:'使用说明交付正文'}).fill('修改后的独立说明');assert(await complete.isDisabled(),'editing content invalidates previous checks');
 await sections.nth(0).getByRole('checkbox').check();
 await dialog.getByRole('textbox',{name:'交付说明（选填）'}).evaluate(element=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array([137,80,78,71])],'clipboard.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));});
 assert.equal(await dialog.locator('.qd-output-files').getByText('clipboard.png').count(),1);
 for(const box of await taskChecks.all())assert.equal(await box.isChecked(),false,'new attachment resets task checks');
 for(const box of await taskChecks.all())await box.check();
 for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(80);assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false,`dialog overflow ${width}`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`page overflow ${width}`);const footer=await dialog.locator('footer').boundingBox();assert(footer&&footer.y+footer.height<=1000,`footer remains visible ${width}`);await page.screenshot({path:path.join(output,`output-${width}.png`),fullPage:true});}
 // A real keyboard Tab remains inside the native modal dialog.
 await dialog.getByRole('textbox',{name:'成果标题',exact:true}).focus();await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement.closest('dialog')!==null));
 await complete.click();await dialog.waitFor({state:'detached'});
 const saved=await page.evaluate(()=>window.outputContractFixture.captured.at(-1));assert.equal(saved.complete,true);assert(saved.taskChecks.length>0&&saved.taskChecks.every(value=>value===true));assert.equal(saved.taskSpecRevision,1);assert.equal(saved.deliveryItems.length,2);assert.equal(saved.deliveryItems[0].body,'修改后的独立说明');assert(!saved.deliveryItems[1].attachmentId.startsWith('pending:'),'uploaded file is registered before submitting');assert.equal(saved.attachments.length,2);assert(saved.deliveryChecks[saved.deliveryItems[0].slotId].every(Boolean));assert.equal(saved.deliveryChecks[saved.deliveryItems[1].slotId].length,2);
 await page.evaluate(()=>window.outputContractFixture.mount());await dialog.waitFor();await dialog.getByRole('textbox',{name:'使用说明交付正文'}).fill('还没写完，保留草稿');await dialog.getByRole('button',{name:'存草稿',exact:true}).click();await dialog.waitFor({state:'detached'});
 const draft=await page.evaluate(()=>window.outputContractFixture.captured.at(-1));assert.equal(draft.status,'draft');assert.equal(draft.deliveryItems.length,1);assert.equal(draft.complete,false);assert.equal(draft.taskChecks,undefined);
 await page.evaluate(()=>window.outputContractFixture.mount());await dialog.waitFor();
 await page.evaluate(async()=>{const {api,taskId,projectId}=window.outputContractFixture;const s=await api.load();const result=await api.collaborate({projectId,taskId,type:'revise_task',expectedVersion:s.collaboration.tasks[taskId].version,idempotencyKey:'new-ui-requirements',payload:{goal:'核对完整来源',criteria:['检查更新后的来源','补齐新预算'],reason:'测试期间更新了任务要求'}});if(!result.ok)throw Error(result.message);});
 await dialog.getByText('任务验收条件已更新，请重新打开表单核对后再完成任务。当前内容仍可保存或提交。').waitFor();
 for(const box of await dialog.getByRole('group',{name:/任务验收条件/}).getByRole('checkbox').all())assert(await box.isDisabled());assert(await complete.isDisabled());
 assert(await dialog.getByRole('button',{name:'提交成果',exact:true}).isEnabled(),'updated task requirements still allow a candidate submission');
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'checks.json'),JSON.stringify({isolatedFixture:true,backendCommit:false,requiredAndOptional:true,noAutomaticChecks:true,changedContentResetsChecks:true,taskRevisionChangeBlocksCompletion:true,realBrowserUploadAndPaste:true,draftPayload:true,keyboard:true,widths:[320,768,1024,1440],errors},null,2));console.log('Output contract UI: per-item body/file inputs, upload and paste, explicit checks, reset on edit, partial drafts, keyboard and four widths passed');
}finally{await browser.close();}
