import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4387';
const out = process.env.QUANDECK_UI_OUTPUT || 'output/note-insert';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const page = await browser.newPage({viewport:{width:1440,height:920}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const nav = name => page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true});
  const editor = page.getByRole('textbox',{name:'笔记正文'});
  const panel = page.getByRole('dialog',{name:'插入内容'});
  const toolbar = page.getByRole('toolbar',{name:'笔记格式'});
  const button = name => toolbar.getByRole('button',{name,exact:true});
  const openInsert = () => button('插入').click();
  await page.addInitScript(() => {
    const key = 'quandeck.personal-knowledge.v1';
    if (localStorage.getItem(key)) return;
    const at = '2026-11-26T01:00:00Z';
    localStorage.setItem(key,JSON.stringify({schema:1,decisions:[],notes:[{
      id:'format',title:'京都行程安排',body:'~~预订京都民宿~~\n\n确认出发时间。',createdAt:at,updatedAt:at,revision:1,attachments:[],expansions:[],history:[]
    }]}));
  });
  await page.goto(origin);
  await nav('帮你记').click();
  async function selectWord(word, collapse=false) {
    await editor.evaluate((ed,{word,collapse}) => {
      ed.focus();
      const walk=document.createTreeWalker(ed,NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        const n=walk.currentNode,start=n.data.indexOf(word);
        if(start<0) continue;
        const r=document.createRange();r.setStart(n,start);r.setEnd(n,start+word.length);
        if(collapse) r.collapse(false);
        getSelection().removeAllRanges();getSelection().addRange(r);return;
      }
      throw Error('missing '+word);
    },{word,collapse});
    await page.evaluate(()=>new Promise(requestAnimationFrame));
  }
  const marked=()=>editor.locator('s,strike,del').allTextContents();
  const strike=button('删除线');
  await selectWord('京都');
  assert.equal(await strike.getAttribute('aria-pressed'),'true');
  await strike.click();
  assert.deepEqual(await marked(),['预订','民宿']);
  await button('撤销').click();
  assert.deepEqual(await marked(),['预订京都民宿']);
  await button('重做').click();
  assert.deepEqual(await marked(),['预订','民宿']);
  await nav('首页').click();
  await nav('帮你记').click();
  assert.deepEqual(await marked(),['预订','民宿']);

  // A mixed selection gets one consistent style, then toggles off in full.
  await editor.evaluate(ed => {
    ed.focus();const r=document.createRange();r.selectNodeContents(ed.firstElementChild);
    getSelection().removeAllRanges();getSelection().addRange(r);
  });
  await strike.click();
  assert.deepEqual(await marked(),[],'mixed selection starting in struck text is cleared in one action');
  await strike.click();
  assert.equal((await marked()).join(''),'预订京都民宿');
  await strike.click();
  assert.deepEqual(await marked(),[]);

  await selectWord('出发时间。',true);
  await strike.click();
  await page.keyboard.insertText('旧安排');
  await strike.click();
  await page.keyboard.insertText('新安排');
  assert.deepEqual(await marked(),['旧安排']);
  await selectWord('新安排',true);
  await openInsert(); await panel.getByRole('button',{name:'表格',exact:true}).click();
  await panel.getByRole('button',{name:'插入 3 行 3 列表格'}).click();
  const table = editor.getByRole('table');
  assert.equal(await table.getByRole('row').count(),3);
  assert.equal(await table.getByRole('columnheader').count(),3);
  await page.keyboard.insertText('日期');
  assert.equal(await table.getByRole('columnheader').first().textContent(),'日期');
  await table.getByRole('columnheader').nth(1).click(); await page.keyboard.insertText('目的地');
  await table.getByRole('cell').nth(1).click(); await page.keyboard.insertText('京都');
  await nav('首页').click(); await nav('帮你记').click();
  assert.equal(await table.getByRole('row').count(),3);
  assert.equal(await table.getByRole('columnheader').nth(1).textContent(),'目的地');
  assert.equal(await table.getByRole('cell').nth(1).textContent(),'京都');
  await openInsert();
  await page.screenshot({path:path.join(out,'insert-menu.png')});
  await panel.getByRole('button',{name:'分隔线'}).click();
  assert.equal(await editor.locator('hr').count(),1);
  for (const name of ['项目符号','编号列表']) {
    assert.equal(await button(name).locator('svg').count(),1);
    assert.equal(await button(name).textContent(),'');
  }
  const insertRule = async () => {
    await openInsert();
    await panel.getByRole('button',{name:'分隔线'}).click();
  };
  async function reopen() {
    await nav('首页').click();
    await nav('帮你记').click();
    await editor.waitFor();
  }
  const afterRule = editor.locator('hr + p').first();
  const savedBody = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes.find(note => note.id === 'format').body);
  await editor.fill('');
  await insertRule();
  await button('撤销').click();
  assert.equal(await editor.locator('hr').count(),0);
  await button('重做').click();
  assert.equal(await editor.locator('hr').count(),1);
  await reopen();
  assert.equal(await savedBody(),'---');
  await afterRule.click();
  const ime = await page.context().newCDPSession(page);
  await ime.send('Input.imeSetComposition',{text:'fen',selectionStart:3,selectionEnd:3});
  await ime.send('Input.insertText',{text:'分割线下的第一句。'});
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('第二句也在下方。');
  await reopen();
  assert.equal(await savedBody(),'---\n\n分割线下的第一句。\n\n第二句也在下方。');
  assert.deepEqual(await editor.locator('hr ~ p').allTextContents(),['分割线下的第一句。','第二句也在下方。']);
  await editor.fill('上午安排');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await insertRule();
  await page.keyboard.insertText('下午安排');
  await reopen();
  assert.equal(await savedBody(),'上午安排\n\n---\n\n下午安排');
  await page.screenshot({path:path.join(out,'divider-typing.png')});
  await selectWord('下午',true);
  await insertRule();
  await page.keyboard.insertText('新安排');
  await reopen();
  assert.equal(await savedBody(),'上午安排\n\n---\n\n下午\n\n---\n\n新安排\n\n安排');
  await page.setViewportSize({width:390,height:760});
  await openInsert();
  const rect=await panel.boundingBox();
  assert(rect.x>=0 && rect.x+rect.width<=390,'insert menu fits on phone');
  await page.keyboard.press('Escape');
  await panel.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('OK: old strikethrough, partial selection, undo/redo, save & reopen, mixed toggling, typing style, editable 3×3 table, menu, rule, mobile, list icons');
} finally {await browser.close();}
