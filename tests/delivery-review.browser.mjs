/** Isolated local profile and synthetic project, no source calls or user database. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE||'playwright');
const output=process.env.QUANDECK_UI_OUTPUT||'output/delivery-review/ui';await mkdir(output,{recursive:true});
const url=process.env.QUANDECK_UI_URL||'http://127.0.0.1:4291';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
page.setDefaultTimeout(7000);
await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
try{
  await page.goto(url);
  await page.getByRole('button',{name:'新建项目',exact:true}).first().waitFor();
  const fixture=await page.evaluate(async()=>{
    const {createDeliveryFixture}=await import('/tests/delivery-map.fixture.ts');
    const result=await createDeliveryFixture();
    return {leaf:result.binding('airport'),historic:result.historic,projectId:result.snapshot.project.id};
  });
  await page.reload();
  await page.getByRole('button',{name:'切换项目：曼谷与芭提雅 · 图文旅行',exact:true}).first().waitFor();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'成果',exact:true}).click();
  await page.getByRole('heading',{name:'1 / 4 件必需成果已验收'}).waitFor();
  await page.locator('.qd-map-index button').filter({hasText:'凌晨抵达 · 路线与地图'}).click();
  const form=page.locator('.qd-delivery-review');
  assert.equal(await form.count(),1);
  await form.locator('summary').click();
  assert(await form.getByRole('button',{name:'确认认可',exact:true}).isDisabled());
  assert.equal(await form.getByRole('textbox',{name:'验收说明'}).inputValue(),'');
  for(const box of await form.getByRole('checkbox').all())await box.check();
  for(const width of [320,768,1440,1920]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);await page.screenshot({path:path.join(output,`review-${width}.png`),fullPage:true});}
  await form.getByRole('button',{name:'确认认可',exact:true}).click();
  await page.getByRole('heading',{name:'2 / 4 件必需成果已验收'}).waitFor();
  assert.equal(await page.locator('.qd-delivery-review').count(),0,'accepted artifact has no duplicate review action');
  const accepted=await page.evaluate(()=>{const library=JSON.parse(localStorage.getItem('quandeck.projects.v1'));return library;});
  const project=Object.values(accepted.projects).find(s=>s.project.name==='曼谷与芭提雅 · 图文旅行');
  const latest=project.collaboration.reviews.at(-1),leaf=fixture.leaf;
  assert.equal(latest.key,leaf.key);assert(latest.criteria.every(c=>c.passed));assert.notEqual(project.collaboration.tasks[leaf.taskId].status,'done');
  assert.equal(latest.note,'', 'acceptance needs no invented user comment');
  const openHistoric = async () => {
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'成果',exact:true}).click();
    await page.getByText(/查看任务成果地图 ·/).click();
    await page.getByRole('button',{name:'旧版资料备忘',exact:true}).click();
    await page.getByRole('region',{name:'任务成果汇总'}).waitFor();
    await page.getByRole('button',{name:/旧版路线记录/}).click();
  };
  await openHistoric();
  await form.locator('summary').click();
  const accept=form.getByRole('button',{name:'确认认可',exact:true});
  for(const box of await form.getByRole('checkbox').all())await box.check();
  assert(await accept.isEnabled());
  await page.evaluate(async id=>{
    const {localDataSource:api}=await import('/src/data/repository.ts');
    const s=await api.load(), artifact=s.collaboration.artifacts.find(a=>a.key===id);
    const marked=await api.collaborate({projectId:s.project.id, type:'mark_stale', idempotencyKey:crypto.randomUUID(),
      payload:{artifactId:artifact.id,reason:'合成验收：外部来源已过期'}});
    if(!marked.ok)throw Error(marked.message);
  },fixture.historic);
  await page.reload();
  await openHistoric();
  await form.locator('summary').click();
  for(const box of await form.getByRole('checkbox').all())await box.check();
  await form.getByText(/成果或引用来源已失效/).waitFor();
  assert(await accept.isDisabled(),'already checked criteria never override a stale result');
  const note=form.getByRole('textbox',{name:'验收说明'});
  assert(await form.getByRole('button',{name:'要求修改',exact:true}).isDisabled());
  const hash=await note.evaluate(async target=>{
    const canvas=document.createElement('canvas');
    canvas.width=20;canvas.height=20;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#94331a';ctx.fillRect(0,0,20,20);
    const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const transfer=new DataTransfer();
    transfer.items.add(new File([image],'review-evidence.png',{type:image.type}));
    target.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
    const digest=await crypto.subtle.digest('SHA-256',await image.arrayBuffer());
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  });
  await form.getByRole('list',{name:'待提交验收截图'}).getByText('review-evidence.png').waitFor();
  assert.equal(await note.inputValue(),'');
  assert(await accept.isDisabled(),'a pasted screenshot cannot bypass freshness');
  await page.setViewportSize({width:320,height:960});
  await form.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>innerWidth===320 && document.documentElement.scrollWidth===innerWidth);
  assert.equal(await form.evaluate(node=>node.scrollWidth>node.clientWidth),false);
  await form.screenshot({path:path.join(output,'screenshot-only-return-320.png')});
  await form.getByRole('button',{name:'要求修改',exact:true}).click();
  await page.getByText('已要求修改，原交付和核对记录已保留。',{exact:true}).first().waitFor();
  const returned=await page.evaluate(()=>{const library=JSON.parse(localStorage.getItem('quandeck.projects.v1'));const p=Object.values(library.projects).find(s=>s.project.name==='曼谷与芭提雅 · 图文旅行');return p.collaboration.reviews.at(-1);});
  assert.equal(returned.verdict,'needs_changes');assert.equal(returned.key,fixture.historic);
  assert.equal(returned.attachments.length,1);
  assert.equal(returned.attachments[0].sha256,hash);
  await page.reload();
  await openHistoric();
  await page.getByText('验收截图 · 1 张',{exact:true}).click();
  await page.getByRole('button',{name:'review-evidence.png · 下载',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'retained-review-evidence-320.png')});
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'review-evidence.png · 下载',exact:true}).click();
  const file=await downloaded;
  assert.equal(file.suggestedFilename(),'review-evidence.png');
  assert.equal(createHash('sha256').update(await readFile(await file.path())).digest('hex'),hash);
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'checks.json'),JSON.stringify({criteriaExplicit:true,childScope:true,acceptedNoRepeat:true,blankAcceptance:true,screenshotOnlyReturn:true,downloadMatchesAfterReload:true,staleCannotAccept:true,widths:[320,768,1440,1920],errors},null,2));
  console.log('Delivery review browser: blank acceptance, stale guard, screenshot-only return, persisted download hash, exact child scope and responsive layout passed');
}catch(error){
  console.error((await page.locator('body').innerText()).slice(0,2500),errors);
  await page.screenshot({path:path.join(output,'failure.png')});
  throw error;
}finally{await browser.close();}
