import assert from 'node:assert/strict';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4321';
const baseline = process.env.QUANDECK_BASELINE === '1';
const browser = await chromium.launch({channel:'chrome',headless:true});
const sizes = [600000,500000,650000,230000];
try {
  const samples = [];
  for (let run=0; run<3; run++) {
    const page = await browser.newPage({viewport:{width:1280,height:760}});
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.routeWebSocket(/.*/,()=>{});
    await page.goto(origin);
    await page.getByRole('navigation',{name:'主导航'}).waitFor();
    await page.evaluate(async sizes => {
      const at = new Date().toISOString();
      const files = sizes.map((size,index)=>({id:'img-'+index,type:'image/png',name:'diagram-'+index+'.png',size}));
      const lines = Array.from({length:85},(_,i)=>i % 2 ? '' : '第 '+String(i+1)+' 行。'+ '记录图像中的观察结果。'.repeat(5));
      for(const [index,line] of [2,46,80].entries()) lines[line]='![示意图](attachment:img-'+index+')';
      localStorage.setItem('quandeck.personal-knowledge.v1',JSON.stringify({schema:1,decisions:[],notes:[{
        id:'long',title:'长笔记',body:lines.join('\n'),attachments:files,history:[],expansions:[],revision:22,createdAt:at,updatedAt:at
      }]}));
      const canvas = document.createElement('canvas'); canvas.width=1280; canvas.height=760;
      canvas.getContext('2d').fillRect(10,10,200,150);
      const png = new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve))).arrayBuffer());
      window.pictureReads = [];
      window.quandeckDesktop = {readKnowledge:async()=>localStorage.getItem('quandeck.personal-knowledge.v1'),
        readKnowledgeImage:async(_noteId,id)=>{
          const file = files.find(file=>file.id===id);
          window.pictureReads.push({id,bytes:file.size});
          const bytes = new Uint8Array(file.size); bytes.set(png);
          await new Promise(resolve=>setTimeout(resolve,12));
          return bytes;
        }};
      document.addEventListener('click',e=>{if(e.target.closest('button')?.innerText.includes('帮你记')) window.openNoteAt=performance.now();},true);
      const obs = new MutationObserver(()=>{
        if (!window.notePaint && document.querySelector('.qd-writer-content img')) requestAnimationFrame(()=>{window.notePaint ??= performance.now()-window.openNoteAt;});
      });
      obs.observe(document.body,{subtree:true,childList:true});
    },sizes);
    await page.getByRole('button',{name:'帮你记',exact:true}).click();
    await page.waitForFunction(()=> document.querySelector('.qd-writer-content img')?.naturalWidth === 1280);
    await page.waitForTimeout(120);
    const first = await page.evaluate(()=>({reads:window.pictureReads.slice(),paint:Math.round(window.notePaint)}));
    const frames = await page.evaluate(async()=>{
      const scroll = document.scrollingElement;
      const costs=[];
      let last=performance.now();
      for(let i=0;i<36;i++){
        await new Promise(requestAnimationFrame);
        const now=performance.now();costs.push(now-last);last=now;
        scroll.scrollTop=(scroll.scrollHeight-innerHeight)*i/35;
      }
      return costs.sort((a,b)=>a-b)[Math.floor(costs.length*.95)];
    });
    const bottom = page.locator('.qd-writer-content img').last();
    await bottom.scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.qd-writer-content img')).at(-1)?.naturalWidth===1280);
    const total = await page.evaluate(()=>window.pictureReads);
    samples.push({firstPaintMs:first.paint,firstReads:first.reads.length,firstBytes:first.reads.reduce((sum,item)=>sum+item.bytes,0),scrollP95Ms:Math.round(frames),totalReads:total.length});
    if (!baseline) {
      assert(!first.reads.some(read=>read.id==='img-2'),'offscreen originals are deferred');
      assert.equal(total.filter(read=>read.id==='img-0').length,1,'cover and first image reuse one read');
    }
    await page.close();
  }
  console.log(JSON.stringify({mode:baseline?'baseline':'checked',samples}));
} finally {await browser.close();}
