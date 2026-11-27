import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium }=await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.QUANDECK_UI_OUTPUT || 'output/note-clipboard';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1380,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const nav=name=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true});
  const editor=page.getByRole('textbox',{name:'笔记正文'});
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4497');
  await nav('帮你记').click();
  await page.getByRole('button',{name:'新建',exact:true}).click();
  await page.getByRole('textbox',{name:'笔记标题'}).fill('剪贴板验收');
  await editor.fill('行程比较');
  async function paste(data) {
    await editor.evaluate((el,payload)=>{
      el.focus();
      const sel=getSelection(),range=document.createRange();
      range.selectNodeContents(el);range.collapse(false);sel.removeAllRanges();sel.addRange(range);
      const clip=new DataTransfer();
      for(const [type,value] of Object.entries(payload)) clip.setData(type,value);
      el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clip,bubbles:true,cancelable:true}));
    },data);
  }
  await paste({'text/html':'<p>网页摘录</p><table onclick="window.UNSAFE=true"><tr><td>城市</td><td>价格</td></tr><tr><td>京都</td><td>280</td></tr></table><p>含交通费</p>','text/plain':'城市\t价格\r\n京都\t280'});
  await paste({'text/plain':'交通\t起点\t终点\r\n铁路\t京都\t和歌山\r\n'});
  const tables=editor.locator('table');
  assert.equal(await tables.count(),2);
  assert.match(await editor.innerText(),/网页摘录[\s\S]*含交通费/);
  assert.equal(await tables.first().getAttribute('onclick'),null);
  assert.deepEqual(await tables.nth(1).locator('tr').nth(1).locator('td').allTextContents(),['铁路','京都','和歌山']);
  await paste({'text/html':'<!--StartFragment--><tr><td>材料</td><td>份数</td></tr><tr><td>试点报告</td><td>2</td></tr><!--EndFragment-->'});
  await paste({'text/plain':'| 用途 | 项目 |\n| :--- | ---: |\n| 内部\\|外部 | TokenOps |'});
  await paste({'text/plain':'进度\t时间\t负责人\n确认\t11:00\n收件\t12:00\t小黄'});
  assert.equal(await tables.count(), 5);
  assert.equal(await tables.nth(3).locator('td').first().textContent(),'内部|外部');
  assert.deepEqual(await tables.last().locator('tr').nth(1).locator('td').allTextContents(),['确认','11:00','']);
  await tables.last().locator('tr').nth(1).locator('td').nth(1).evaluate(cell=>{
    const r=document.createRange(),sel=getSelection();
    r.selectNodeContents(cell);r.collapse(true);sel.removeAllRanges();sel.addRange(r);
    const clip=new DataTransfer();clip.setData('text/plain','11:30\t小李\n12:30\t小张');
    cell.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clip,bubbles:true,cancelable:true}));
  });
  assert.equal(await tables.count(),5);
  assert.deepEqual(await tables.last().locator('tr').nth(1).locator('td').allTextContents(),['确认','11:30','小李']);
  // Put the caret after the last table to paste an independent image.
  await editor.evaluate(el=>{const r=document.createRange(),s=getSelection();r.selectNodeContents(el);r.collapse(false);s.removeAllRanges();s.addRange(r);});
  await editor.evaluate(async el=>{
    const canvas=document.createElement('canvas');canvas.width=7;canvas.height=4;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#008080';ctx.fillRect(0,0,7,4);
    const blob=await new Promise(done=>canvas.toBlob(done));
    window.fixturePng=Array.from(new Uint8Array(await blob.arrayBuffer()));
    const clip=new DataTransfer();clip.items.add(new File([blob],'小地图.png',{type:'image/png'}));
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clip,bubbles:true,cancelable:true}));
  });
  await editor.locator('img[src^=blob]').waitFor();
  await nav('帮你想').click();await nav('帮你记').click();
  await editor.locator('table').first().waitFor();
  assert.equal(await tables.count(),5);
  assert.deepEqual(await tables.last().locator('tr').nth(2).locator('td').allTextContents(),['收件','12:30','小张']);
  assert.equal(await tables.first().locator('td').last().textContent(),'280');
  const picture=editor.locator('img[src^=blob]').first();
  await picture.waitFor();
  await page.evaluate(()=>{
    // Capture native handoff; running this test must preserve the developer's general pasteboard.
    window.quandeckDesktop={copyKnowledgeImage:async png=>{window.photoCopies=(window.photoCopies??[]).concat([Array.from(new Uint8Array(png))]);}};
  });
  await picture.click();
  await page.getByRole('button',{name:'复制图片',exact:true}).click();
  await page.waitForFunction(()=>window.photoCopies?.length===1);
  await picture.click();
  await page.keyboard.press(process.platform==='darwin'?'Meta+c':'Control+c');
  await page.waitForFunction(()=>window.photoCopies?.length===2);
  await picture.click({button:'right'});
  await page.getByRole('button',{name:'复制图片',exact:true}).click();
  await page.waitForFunction(()=>window.photoCopies?.length===3);
  await page.getByRole('button',{name:'全屏阅读',exact:true}).click();
  const reader=page.getByRole('dialog',{name:'笔记全屏阅读'});
  await reader.locator('img').click();
  await reader.getByRole('button',{name:'复制图片',exact:true}).click();
  await page.waitForFunction(()=>window.photoCopies?.length===4);
  await reader.locator('img').click();
  await page.keyboard.press(process.platform==='darwin'?'Meta+c':'Control+c');
  await page.waitForFunction(()=>window.photoCopies?.length===5);
  await reader.getByRole('button',{name:'退出全屏阅读'}).click();
  const [expected,copies]=await page.evaluate(()=>[window.fixturePng,window.photoCopies]);
  assert.deepEqual(copies, Array(5).fill(expected));
  await writeFile(path.join(out,'copied-qa.png'),Buffer.from(copies[1]));
  await page.screenshot({path:path.join(out,'pasted-tables.png'),animations:'disabled'});
  assert.deepEqual(errors,[]);
  console.log('PASS: pasted HTML, selected rows, TSV with empty cells and Markdown tables; pasted a rectangle into an existing table, reopened all five. Editor click/right-click/shortcut and fullscreen click/shortcut each handed the original PNG bytes to the desktop bridge.');
} finally {await browser.close();}
