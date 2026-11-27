import assert from 'node:assert/strict';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
const paragraphs = Array.from({length: 480}, (_, i) =>
  '展览记录 ' + (i + 1) + '。**开场准备**和*活动说明*。' + '入口的灯光、桌子、麦克风和座位都要逐一核对。'.repeat(3));
const body = paragraphs.join('\n\n');
const key = 'quandeck.personal-knowledge.v1';
try {
  await page.addInitScript(({body,key}) => {
    if (localStorage.getItem(key)) return;
    const at = '2026-11-26T03:00:00.000Z';
    localStorage.setItem(key, JSON.stringify({schema:1,decisions:[],notes:[{id:'long-note',title:'展览运行手册',body,
      revision:1,createdAt:at,updatedAt:at,attachments:[],history:[],expansions:[]}]}));
  },{body,key});
  await page.goto(process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4394');
  const nav = name => page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true});
  await nav('帮你记').click();
  const editor = page.getByRole('textbox',{name:'笔记正文'});
  await editor.getByText('开场准备',{exact:true}).last().waitFor({state:'attached'});
  await editor.evaluate(node => {
    node.focus(); const range = document.createRange();
    range.selectNodeContents(node.lastElementChild); range.collapse(false);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    node.lastElementChild.scrollIntoView({block:'center'});
    window.inputFrames = [];
    node.addEventListener('beforeinput', () => {
      const start = performance.now();
      requestAnimationFrame(() => window.inputFrames.push(performance.now() - start));
    }, true);
  });
  const edited = '加入收场后的设备检查和现场人员确认名单。';
  const samples = Array.from(edited);
  for (let i=0;i<samples.length;i++) {
    await page.keyboard.insertText(samples[i]);
    await page.waitForFunction(n => window.inputFrames.length > n, i);
  }
  const times = await page.evaluate(() => window.inputFrames);
  const ordered = [...times].sort((a,b)=>a-b);
  console.log(JSON.stringify({characters:body.length,paragraphs:paragraphs.length,inputs:times.length,
    medianMs:ordered[Math.floor(ordered.length/2)],p95Ms:ordered[Math.ceil(ordered.length*.95)-1],maxMs:Math.max(...times)}));
  // Select immediately, before idle indexing, including on a repeated passage.
  const picked = await editor.evaluate(node => {
    const paragraph = node.lastElementChild;
    const target = paragraph.querySelector('strong').firstChild;
    const range = new Range(); range.selectNodeContents(target);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    return range.toString();
  });
  assert.equal(picked,'开场准备');
  await page.getByRole('button',{name:'就这段提问'}).waitFor();
  await nav('首页').click(); await nav('帮你记').click();
  assert((await editor.innerText()).includes(edited));
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).notes[0].body.includes('现场人员确认名单'),key);
} finally { await browser.close(); }
