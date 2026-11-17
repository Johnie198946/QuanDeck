/** Isolated local profile and synthetic project, no source calls or user database. */
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
const {chromium}=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE||'playwright');
const output=process.env.QUANDECK_UI_OUTPUT||'output/delivery-review/ui';await mkdir(output,{recursive:true});
const url=process.env.QUANDECK_UI_URL||'http://127.0.0.1:4291';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
try{
  await page.goto(url);
  const fixture=await page.evaluate(async()=>{const{createDeliveryFixture}=await import('/tests/delivery-map.fixture.ts');const result=await createDeliveryFixture();return {leaf:result.binding('airport'),historic:result.historic};});
  await page.reload();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'成果',exact:true}).click();
  await page.getByRole('heading',{name:'1 / 4 个章节已认可'}).waitFor();
  await page.locator('.qd-map-index button').filter({hasText:'凌晨抵达 · 路线与地图'}).click();
  const form=page.locator('.qd-delivery-review');
  assert.equal(await form.count(),1);
  await form.locator('summary').click();
  assert(await form.getByRole('button',{name:'确认认可',exact:true}).isDisabled());
  await form.getByRole('textbox',{name:'验收说明'}).fill('逐条对照正文与原任务，来源与交付满足要求。');
  assert(await form.getByRole('button',{name:'确认认可',exact:true}).isDisabled());
  for(const box of await form.getByRole('checkbox').all())await box.check();
  for(const width of [320,768,1440,1920]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);await page.screenshot({path:path.join(output,`review-${width}.png`),fullPage:true});}
  await form.getByRole('button',{name:'确认认可',exact:true}).click();
  await page.getByRole('heading',{name:'2 / 4 个章节已认可'}).waitFor();
  assert.equal(await page.locator('.qd-delivery-review').count(),0,'accepted artifact has no duplicate review action');
  const accepted=await page.evaluate(()=>{const library=JSON.parse(localStorage.getItem('quandeck.projects.v1'));return library;});
  const project=Object.values(accepted.projects).find(s=>s.project.name==='曼谷与芭提雅 · 图文旅行');
  const latest=project.collaboration.reviews.at(-1),leaf=fixture.leaf;
  assert.equal(latest.key,leaf.key);assert(latest.criteria.every(c=>c.passed));assert.notEqual(project.collaboration.tasks[leaf.taskId].status,'done');
  await page.getByRole('button',{name:/旧版路线记录/}).click();
  await form.locator('summary').click();
  await form.getByRole('textbox',{name:'验收说明'}).fill('请补充最新的核对来源。');
  await form.getByRole('button',{name:'要求修改',exact:true}).click();
  await page.getByText('已要求修改，原交付和核对记录已保留。',{exact:true}).first().waitFor();
  const returned=await page.evaluate(()=>{const library=JSON.parse(localStorage.getItem('quandeck.projects.v1'));const p=Object.values(library.projects).find(s=>s.project.name==='曼谷与芭提雅 · 图文旅行');return p.collaboration.reviews.at(-1);});
  assert.equal(returned.verdict,'needs_changes');assert.equal(returned.key,fixture.historic);
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'checks.json'),JSON.stringify({criteriaExplicit:true,childScope:true,acceptedNoRepeat:true,historyReturn:true,widths:[320,768,1440,1920],errors},null,2));
  console.log('Delivery review browser: criteria, note, exact child scope, acceptance, historical current candidate return and responsive layout passed');
}finally{await browser.close();}
