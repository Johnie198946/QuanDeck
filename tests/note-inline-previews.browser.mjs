import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const { zipSync, strToU8 } = createRequire(new URL('../desktop/app/package.json', import.meta.url))('fflate');
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4387';
const output = process.env.QUANDECK_UI_OUTPUT || 'output/note-insert';
const office = contents => Array.from(zipSync(Object.fromEntries(Object.entries(contents).map(([entry,xml]) => [entry,strToU8(xml)]))));
const files = [
  ['展览说明.docx', office({'word/document.xml':'<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>入场请走东门</w:t></w:r></w:p></w:body></w:document>'})],
  ['布展预算.xlsx', office({'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="分项" r:id="r1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>灯光租赁</t></is></c><c r="B1"><v>620</v></c></row></sheetData></worksheet>'})],
  ['现场走位.pptx', office({'ppt/presentation.xml':'<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="r1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels':'<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>',
    'ppt/slides/slide1.xml':'<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>舞台与看台</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'})],
];
function pdf() {
  const stream='BT /F1 24 Tf 22 56 Td (Exhibition Plan) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 260 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text='%PDF-1.4\n'; const offsets=[];
  for(const [index,object] of objects.entries()){offsets.push(text.length);text+=(index+1)+' 0 obj\n'+object+'\nendobj\n';}
  const xref=text.length; text+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Array.from(new TextEncoder().encode(text));
}
files.push(['场地平面.pdf',pdf()]);
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1024}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir(output,{recursive:true});
const nav=name=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true});
const editor=page.getByRole('textbox',{name:'笔记正文'});
const attachment=name=>page.getByRole('group',{name:'附件预览 · '+name,exact:true});
try {
  await page.goto(origin); await nav('帮你记').click();await page.getByRole('button',{name:'新建',exact:true}).click();
  await page.getByLabel('笔记标题',{exact:true}).fill('展览现场手册');
  await editor.fill('周五开场前需要确认这些资料。');
  await editor.evaluate((el,items)=>{
    const r=document.createRange(); r.selectNodeContents(el);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);
    const data=new DataTransfer();for(const [name,bytes] of items)data.items.add(new File([new Uint8Array(bytes)],name));
    el.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));
  },files);
  await attachment(files[0][0]).getByText('入场请走东门').waitFor();
  await attachment(files[1][0]).getByRole('cell',{name:'灯光租赁'}).waitFor();
  await attachment(files[2][0]).getByText('舞台与看台').waitFor();
  await attachment(files[3][0]).locator('canvas[aria-busy="false"]').waitFor();
  await attachment(files[0][0]).getByRole('button',{name:/展开预览/}).click();
  await page.getByRole('dialog').getByText('入场请走东门').waitFor(); await page.keyboard.press('Escape');
  const downloadEvent = page.waitForEvent('download');
  await attachment(files[1][0]).getByRole('button',{name:/下载/}).click();
  assert.equal((await downloadEvent).suggestedFilename(),files[1][0]);
  await editor.evaluate(el=>{
    el.focus(); const r=document.createRange(); r.selectNodeContents(el); r.collapse(false);const s=getSelection(); s.removeAllRanges();s.addRange(r);
    const data=new DataTransfer(); data.setData('text/plain','https://example.test/venue');
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  });
  await editor.locator('a.qn-link-card').waitFor();
  await editor.evaluate(async el=>{
    const canvas=document.createElement('canvas');canvas.width=360;canvas.height=64;
    const context=canvas.getContext('2d');
    context.fillStyle='#e9f3fc';context.fillRect(0,0,360,64);
    context.fillStyle='#2a5682';context.font='18px sans-serif';context.fillText('场地动线     东门 → 服务台 → 主厅',16,39);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const clipboardData=new DataTransfer();clipboardData.items.add(new File([blob],'场地动线.png',{type:'image/png'}));
    el.focus();const range=new Range();range.selectNodeContents(el);range.collapse(false);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
  });
  await editor.getByRole('img',{name:'场地动线.png'}).waitFor();
  await nav('首页').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1'))?.notes.some(n=>n.body.includes('example.test')));
  await page.reload();await nav('帮你记').click();
  await attachment(files[0][0]).getByText('入场请走东门').waitFor();
  await editor.locator('a.qn-link-card[href="https://example.test/venue"]').waitFor();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0]);
  assert.equal(saved.attachments.length,5);
  await editor.getByRole('img',{name:'场地动线.png'}).waitFor();
  assert(!saved.body.includes('下载原件') && !saved.body.includes('灯光租赁'),'Card UI must never become note text');
  assert(saved.body.indexOf('展览说明.docx')<saved.body.indexOf('布展预算.xlsx'));
  assert.equal(await page.getByRole('region',{name:'附件',exact:true}).count(),0);
  await attachment(files[3][0]).locator('canvas[aria-busy="false"]').waitFor();
  const leftEdges=await editor.locator('[data-note-file]').evaluateAll(cards=>cards.map(card=>card.getBoundingClientRect().left));
  assert(leftEdges.every(x=>Math.abs(x-leftEdges[0])<1));
  await page.screenshot({path:path.join(output,'note-inline-previews.png'),animations:'disabled'});
  await page.evaluate(()=>{
    const key='quandeck.personal-knowledge.v1';const lib=JSON.parse(localStorage.getItem(key));const note=lib.notes[0];
    const picture=note.attachments.find(file=>file.name==='场地动线.png'),doc=note.attachments.find(file=>file.name.endsWith('.docx'));
    note.body='周五从东门入场。\n\n!['+picture.name+'](attachment:'+picture.id+')\n\n['+doc.name+'](attachment:'+doc.id+')';
    note.attachments=note.attachments.map(({inline,...rest})=>rest);
    // Reproduce the same filename on an old, unplaced image as on the pasted one.
    note.attachments.push({...picture,id:'old-copy',inline:false});
    localStorage.setItem(key,JSON.stringify(lib));
  });
  await page.reload();await nav('帮你记').click();
  await editor.getByRole('group',{name:'附件预览 · '+files[0][0]}).getByText('入场请走东门').waitFor();
  await page.waitForFunction(()=>document.querySelector('[aria-label="笔记正文"] img')?.naturalWidth===360);
  const allCards=page.getByRole('group',{name:/^附件预览 · /});
  assert.equal(await allCards.count(),1);
  await page.screenshot({path:path.join(output,'note-body-only.png'),animations:'disabled'});
  await page.getByRole('button',{name:'全屏阅读',exact:true}).click();
  const reader=page.getByRole('dialog',{name:'笔记全屏阅读'});
  await reader.getByRole('img',{name:'场地动线.png'}).waitFor();
  await reader.getByRole('group',{name:'附件预览 · '+files[0][0]}).waitFor();
  assert.equal(await reader.getByRole('group',{name:/^附件预览 · /}).count(),1);
  await reader.getByRole('button',{name:'退出全屏阅读'}).click();
  await reader.waitFor({state:'detached'});
  assert.deepEqual(errors,[]);
  const droppedUrl='https://example.test/map';
  const accepted=await editor.evaluate((el,url)=>{
    const transfer=new DataTransfer(); transfer.setData('text/plain',url);
    const over=new DragEvent('dragover',{dataTransfer:transfer,bubbles:true,cancelable:true});
    el.dispatchEvent(over);
    el.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
    return over.defaultPrevented;
  },droppedUrl);
  assert(accepted);await editor.locator('a.qn-link-card[href="'+droppedUrl+'"]').waitFor();
  await nav('首页').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0].body.includes('example.test/map'));
  await page.evaluate(()=>{
    const key='quandeck.personal-knowledge.v1',lib=JSON.parse(localStorage.getItem(key)),note=lib.notes[0],file=note.attachments[0];
    if (note.attachments.length!==6 || !note.attachments.some(item=>item.id==='old-copy')) throw Error('Unplaced files were lost on save');
    const other=Array.from({length:19},(_,i)=>({id:'placed-'+i,name:'已插入资料 '+(i+1),size:1,type:'text/plain'}));
    note.attachments=[file,...other,...note.attachments.filter(item=>item.id!==file.id)];
    note.body=['检查入场动线。',...[file,...other].map(item=>'['+item.name+'](attachment:'+item.id+')')].join('\n\n');
    localStorage.setItem(key,JSON.stringify(lib));
  });
  await page.reload();await nav('帮你记').click();
  await attachment(files[0][0]).getByText('入场请走东门').waitFor();
  const dropDocument=()=>editor.evaluate((el,[name,bytes])=>{
    const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],name));
    el.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
  },files[1]);
  const deleteCard=async()=>{
    await editor.locator('[data-note-file]').first().evaluate(el=>{
      const range=new Range(); range.selectNode(el);
      el.closest('[contenteditable="true"]').focus();
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      document.execCommand('delete');
    });
    await attachment(files[0][0]).waitFor({state:'detached'});
  };
  await dropDocument();
  await page.getByText(/每条笔记最多保存 20 个文件/).waitFor();
  await deleteCard();await page.keyboard.press('ControlOrMeta+z');
  await attachment(files[0][0]).getByText('入场请走东门').waitFor();
  await deleteCard();
  // Hold the IndexedDB completion callback to exercise a real pending-file line action.
  await page.evaluate(()=>{
    const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
    Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(handler){
      if (this.mode==='readwrite' && this.db.name==='quandeck-output-files') {
        Object.defineProperty(IDBTransaction.prototype,'oncomplete',descriptor);
        descriptor.set.call(this,function(event){window.releaseFileWrite=()=>handler.call(this,event);});
      } else descriptor.set.call(this,handler);
    }});
  });
  await dropDocument();
  const pending=editor.locator('[data-note-file^="pending-"]').first();
  await pending.waitFor();await pending.hover();
  const todo=page.getByRole('button',{name:'将此行设为待办'});
  await todo.click({timeout:5000,force:true});
  await page.waitForFunction(()=>typeof window.releaseFileWrite==='function');
  await page.evaluate(()=>window.releaseFileWrite());
  await page.waitForFunction(()=>{
    const note=JSON.parse(localStorage.getItem('quandeck.personal-knowledge.v1')).notes[0];
    return note.todos?.some(todo=>note.body.split('\n')[todo.lineIndex].includes('布展预算.xlsx'));
  });
  await attachment(files[1][0]).getByText('灯光租赁').waitFor();
  assert.equal(await page.getByText('原行已变化，请重新选择').count(),0);
  assert.deepEqual(errors,[]);
  console.log('OK: four native-file previews from original bytes, expanded document, original download, link card, save/reload, ordered multi-drop, pasted image, legacy files displayed only at inserted positions in editor and reader, retained unplaced files, plain URL drops, visible-file quota, undo and conversion of a pending document to a todo.');
} catch(e) {
  console.error(await page.locator('main').innerText().catch(()=>'')); await page.screenshot({path:path.join(output,'note-preview-failure.png')}).catch(()=>{}); throw e;
} finally {await browser.close();}
