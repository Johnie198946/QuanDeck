import { strToU8, zipSync } from 'fflate';

/** Uses only synthetic content and the desktop smoke profile. */
export async function checkKnowledge(store, webContents) {
  // This window stays hidden during installation. Drive editor timers and paint
  // at foreground speed so line-end controls and their measured positions settle.
  webContents.setBackgroundThrottling(false);
  const legacyTitle = '安装验证 · 旧笔记';
  const newTitle = '安装验证 · 随手记';
  const noteText = '展览使用东门入场。';
  const longNote = Array.from({length:80}, (_,index) => '展览筹备记录 ' + (index + 1)).join('\n\n');
  const key = 'quandeck.personal-knowledge.v1';
  const read = () => store.read(key, { notes: [], decisions: [] });
  async function wait(predicate, label) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const result = await predicate();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('笔记安装验证未完成：' + label);
  }
  const navigate = name => webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('nav[aria-label="主导航"] button')].find(item => item.textContent.trim() === ${JSON.stringify(name)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await webContents.executeJavaScript(`(async () => {
    const host = window.quandeckDesktop;
    const previous = await host.readKnowledge();
    const library = previous ? JSON.parse(previous) : { schema:1, notes:[], decisions:[] };
    library.notes.push({
      id:'smoke-note-old', title:${JSON.stringify(legacyTitle)}, body:${JSON.stringify(longNote)},
      revision:1, createdAt:'2020-01-01T00:00:00.000Z', updatedAt:'2020-01-01T00:00:00.000Z',
      archivedAt:'2020-01-02T00:00:00.000Z', attachments:[], expansions:[], history:[]
    });
    if (!await host.compareKnowledge(previous, JSON.stringify(library))) throw new Error('无法写入隔离笔记样例');
    if (await host.shareKnowledgeNote({title:'安装验证', text:'只验证分享入口'})) throw new Error('隔离检查不能打开系统分享');
  })()`);
  // An unsaved selection reaches the Agent boundary without a note record.
  const directSelection = await webContents.executeJavaScript(`(async () => {
    try {
      await window.quandeckDesktop.expandKnowledge({ requestId: crypto.randomUUID(), noteId: 'smoke-unsaved',
        selection: { quote: 'East entrance', offset: 0 }, question: '请翻译' });
    } catch (error) {
      return String(error).includes('请先在设置中连接 Agent');
    }
    return false;
  })()`);
  if (!directSelection) throw new Error('草稿选区未送达 Agent 连接入口');
  await wait(() => navigate('帮你记'), '打开帮你记');
  await wait(() => webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(legacyTitle)})`), '显示原有笔记');
  await wait(() => webContents.executeJavaScript(`(() => {
    const body = document.querySelector('[aria-label="笔记正文"]');
    const title = document.querySelector('[aria-label="笔记标题"]');
    const toolbar = document.querySelector('[role="toolbar"][aria-label="笔记格式"]');
    const share = document.querySelector('button[aria-label="分享笔记"]');
    if (!body || title?.value !== ${JSON.stringify(legacyTitle)} || !toolbar || !share || body.clientHeight < innerHeight * 2) return false;
    window.scrollTo(0, innerHeight);
    const box = title.getBoundingClientRect();
    const tools = toolbar.getBoundingClientRect();
    return window.scrollY > innerHeight / 2 && box.top >= 0 && tools.top >= box.bottom && tools.bottom < innerHeight
      && body.getBoundingClientRect().top < 0 && share.childElementCount === 1 && !!share.querySelector('svg')
      && !share.textContent.trim() && getComputedStyle(share).borderTopWidth === '0px';
  })()`), '滚动长笔记后标题、工具栏和分享图标仍可用');
  await webContents.executeJavaScript(`document.querySelector('button[aria-label="全屏阅读"]').click()`, true);
  await wait(() => webContents.executeJavaScript(`(() => {
    const page = document.fullscreenElement;
    if (!page?.matches('.qn-reader-page') || !page.textContent.includes('展览筹备记录 80')) return false;
    page.scrollTop = page.scrollHeight;
    return page.scrollTop > 0;
  })()`), '在真正的全屏中滚动到笔记末尾');
  await webContents.executeJavaScript(`document.querySelector('button[aria-label="退出全屏阅读"]').click()`, true);
  await wait(() => webContents.executeJavaScript(`!document.fullscreenElement && !document.querySelector('dialog.qn-reader-dialog[open]')`), '返回普通笔记');
  await webContents.executeJavaScript('window.scrollTo(0,0)');
  await wait(() => webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('main button')].find(item => item.textContent.trim() === '新建' || item.textContent.trim() === '新建笔记');
    if (!button) return false;
    button.click();
    return true;
  })()`), '新建笔记');
  await wait(() => webContents.executeJavaScript(`(() => {
    const title = document.querySelector('input[aria-label="笔记标题"]');
    const body = document.querySelector('[contenteditable="true"][aria-label="笔记正文"]');
    if (!title || !body) return false;
    title.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, ${JSON.stringify(newTitle)});
    body.focus();
    document.execCommand('insertText', false, ${JSON.stringify(noteText)});
    return true;
  })()`), '填写笔记');
  await webContents.executeJavaScript(`(() => {
    const editor = document.querySelector('[aria-label="笔记正文"]');
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    const start = text.data.indexOf('东门');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 2);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  })()`);
  await wait(() => webContents.executeJavaScript(`(() => {
    const ask = [...document.querySelectorAll('button')].find(button =>
      button.getAttribute('aria-label') === '就这段提问' || button.textContent.trim() === '就这段提问');
    if (!ask || !ask.getClientRects().length) return false;
    const line = window.getSelection().getRangeAt(0).getBoundingClientRect();
    const action = ask.getBoundingClientRect();
    if (Math.abs(action.top - line.bottom) > 72) return false;
    ask.click();
    return true;
  })()`), '提问按钮跟随所选文字');
  await wait(() => webContents.executeJavaScript(`document.activeElement?.getAttribute('aria-label') === '补充问题'`), '原位输入问题');
  webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(() => webContents.executeJavaScript(`!document.querySelector('[aria-label="补充问题"]')`), '退出提问');
  await webContents.executeJavaScript(`(() => {
    const editor = document.querySelector('[aria-label="笔记正文"]');
    editor.focus();
    window.getSelection().selectAllChildren(editor);
    window.getSelection().collapseToEnd();
  })()`);
  await webContents.executeJavaScript(`(async () => {
    const editor = document.querySelector('[contenteditable="true"][aria-label="笔记正文"]');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2260a0';
    context.fillRect(0, 0, 4, 4);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([blob], 'example.png', {type:'image/png'}));
    editor.dispatchEvent(new ClipboardEvent('paste', {clipboardData, bubbles:true, cancelable:true}));
  })()`);
  await wait(() => webContents.executeJavaScript(`!!document.querySelector('[contenteditable="true"][aria-label="笔记正文"] img')`), '正文显示截图');
  await wait(() => navigate('帮你想'), '切换到帮你想');
  const note = await wait(() => read().notes.find(row => row.title === newTitle && row.body.includes(noteText) && row.attachments.length === 1), '离开编辑器时保存');
  const [picture] = note.attachments;
  if (!note.body.includes(picture.id)) throw new Error('已保存的正文明细缺少图片引用');
  const bytes = await store.attachment('personal-knowledge', picture.id);
  if (bytes.length !== picture.size || bytes[0] !== 137) throw new Error('已保存截图内容与引用不一致');
  await wait(() => webContents.executeJavaScript(`(() => {
    const titles=[...document.querySelectorAll('svg [data-note-id]')].map(node=>node.getAttribute('aria-label') || '');
    return ${JSON.stringify([newTitle,legacyTitle])}.every(title=>titles.some(label=>label.startsWith(title+' · ')));
  })()`), '星图纳入新旧两条笔记');
  const click = (name, scope = 'main') => webContents.executeJavaScript(`(() => {
    const buttons = document.querySelectorAll(${JSON.stringify(scope + ' button')});
    const target = [...buttons].find(item => (item.getAttribute('aria-label') || item.textContent.trim()) === ${JSON.stringify(name)});
    if (!target || target.disabled) return false;
    target.click();
    return true;
  })()`);
  await wait(() => click('灵感逻辑'), '进入方法画布');
  for (const title of [legacyTitle,newTitle]) {
    await wait(() => click('新建灵感'), '新建灵感');
    await wait(() => webContents.executeJavaScript(`(() => {
      const input = document.querySelector('dialog input');
      if (!input) return false;
      input.focus(); document.execCommand('insertText',false,${JSON.stringify(title)}); return true;
    })()`),'输入灵感');
    await wait(() => click('加入画布','dialog'),'保存灵感');
    await wait(() => click('画布灵感「'+title+'」'),'显示灵感');
  }
  const cards = read().inspirationCanvas.nodes;
  const startId = cards.find(c => c.idea?.title === legacyTitle).noteId;
  const endId = cards.find(c => c.idea?.title === newTitle).noteId;
  await wait(() => click('从「' + legacyTitle + '」连出'), '选择起点');
  await wait(() => click('连入「' + newTitle + '」'), '连接到终点');
  await wait(() => read().inspirationCanvas?.links.some(link => link.from === startId && link.to === endId), '保存有向连线');
  await wait(() => click('反转方向'), '反转画布连线');
  await wait(() => read().inspirationCanvas?.links.some(link => link.from === endId && link.to === startId), '保存反向关系');
  await wait(() => navigate('帮你记'), '离开画布');
  await wait(() => navigate('帮你想'), '重新打开帮你想');
  await wait(() => click('灵感逻辑'), '重新打开方法画布');
  await wait(() => click(newTitle + ' → 接着 → ' + legacyTitle), '重新读取已保存的反向连线');
  await wait(() => click('存为模板'), '从当前画布新建模板');
  await wait(() => click('保存','dialog'), '保存方法模板');
  const savedMethod = await wait(() => read().methodTemplates?.find(t=>t.board.links.some(e=>e.from===endId && e.to===startId)), '模板保留有向连线');
  await wait(() => click('方法模板库'), '打开方法模板库');
  await wait(() => click('用模板新建', 'dialog'), '套用模板');
  await wait(() => {
    const lib=read();
    return lib.inspirationBoards?.active?.id!=='default' && lib.inspirationBoards?.others.some(b=>b.id==='default') &&
      lib.inspirationCanvas.links.some(e=>e.from===endId && e.to===startId) && lib.methodTemplates?.some(t=>t.id===savedMethod.id);
  }, '套用模板后两张独立画布同时保存在 SQLite');
  // Exercise the installed renderer, native clock parser and SQLite together.
  const todoText = '今天下午四点前核对场地';
  await wait(() => navigate('帮你记'), '打开笔记创建日程');
  await wait(() => click('新建'), '创建日程测试笔记');
  await wait(() => webContents.executeJavaScript(`(() => {
    const body = document.querySelector('[aria-label="笔记正文"]');
    const title = document.querySelector('[aria-label="笔记标题"]');
    if (!body || !title || body.textContent.trim() || title.value) return false;
    title.focus();
    document.execCommand('insertText', false, '日程测试');
    body.focus();
    document.execCommand('insertText', false, ${JSON.stringify(todoText)});
    return true;
  })()`), '输入带时间的一行');
  await webContents.executeJavaScript(`(() => {
    const editor = document.querySelector('[aria-label="笔记正文"]');
    const text = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT).nextNode();
    if (text?.textContent !== ${JSON.stringify(todoText)}) throw Error('测试输入未到达编辑器');
    editor.focus();
    const range = document.createRange();
    range.setStart(text, text.length);
    range.collapse(true);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  })()`);
  await wait(() => click('将此行设为待办'), '从行尾加入待办');
  const savedTodo = await wait(() => read().notes.find(row => row.title === '日程测试')?.todos?.find(todo => todo.text === todoText), '本地保存待办');
  const nativeTime = await webContents.executeJavaScript(`window.quandeckDesktop.resolveNoteTodoDue(${JSON.stringify(todoText)})`);
  if (savedTodo.dueAt !== nativeTime || new Date(nativeTime).getHours() !== 16) throw Error('本机解析的截止时间与笔记不一致');
  await wait(() => navigate('首页'), '打开今天的日程');
  await wait(() => webContents.executeJavaScript(`(() => {
    const board = document.querySelector('[aria-label="任务管理"]');
    const card = [...(board?.querySelectorAll('button') ?? [])].find(b => b.getAttribute('aria-label') === '查看任务 ' + ${JSON.stringify(todoText)});
    if (!card) return false;
    card.click(); return true;
  })()`), '从首页看板打开这条待办的任务简报');
  await wait(() => webContents.executeJavaScript(`(() => {
    const brief = document.querySelector('dialog[open] [aria-label="任务简报"]');
    if (!brief?.textContent.includes(${JSON.stringify(todoText)}) || !brief.textContent.includes('连接 Agent 后可生成简报。')) return false;
    document.querySelector('dialog[open] [aria-label="关闭任务详情"]').click(); return true;
  })()`), '独立配置的桌面工作区显示真实原文与 Agent 状态');
  await wait(() => webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('[aria-label="日程"]');
    if (!panel?.textContent.includes(${JSON.stringify(todoText)}) || !panel.textContent.includes('16:00')) return false;
    const box = panel.querySelector('input[type="checkbox"],[role="checkbox"]');
    if (!box) return false;
    box.click();
    return true;
  })()`), '首页显示并勾选笔记日程');
  await wait(() => webContents.executeJavaScript(`(() => {
    const text = document.querySelector('dialog.qh-outcome-dialog[open] textarea');
    if (!text) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(text, '原文中的展览资料已核对');
    text.dispatchEvent(new Event('input', {bubbles:true}));
    return true;
  })()`), '勾选后填写结果');
  if (read().notes.some(row => row.todos?.some(todo => todo.id === savedTodo.id && todo.completedAt)))
    throw Error('结果提交前，日程应仍待完成');
  await wait(() => click('保存并完成日程'), '保存日程结果');
  await wait(() => read().notes.some(row => row.todos?.some(todo =>
    todo.id === savedTodo.id && todo.completedAt && todo.outcome?.text === '原文中的展览资料已核对')), '结果与完成状态同步到笔记');
  await wait(() => navigate('帮你记'), '打开已完成待办所在笔记');
  await wait(() => webContents.executeJavaScript(`(() => {
    const time = document.querySelector('button.qd-note-time');
    if (!time) return false;
    time.click();
    return true;
  })()`), '显示待办操作');
  await wait(() => click('取消待办'), '还原成普通文字');
  await wait(() => read().notes.some(row => row.title === '日程测试' && row.body.includes(todoText) &&
    !row.todos?.some(todo => todo.id === savedTodo.id)), '取消后保留原文');
  const docName = '展览说明.docx';
  const excerpt = '原件中的集合地点';
  const pdf = await webContents.printToPDF({ pageRanges: '1' });
  const documentBytes = zipSync({ 'word/document.xml': strToU8(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' +
    excerpt + '</w:t></w:r></w:p></w:body></w:document>') });
  await wait(() => navigate('帮你记'), '打开笔记验证附件');
  await wait(() => click('新建'), '新建附件笔记');
  await wait(() => webContents.executeJavaScript(`(() => {
    const body = document.querySelector('[aria-label="笔记正文"]');
    const title = document.querySelector('[aria-label="笔记标题"]');
    if (!body || !title || title.value || body.textContent.trim()) return false;
    title.focus();
    document.execCommand('insertText', false, '附件预览验证');
    body.focus();
    document.execCommand('insertText', false, '场地资料');
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(${JSON.stringify(Array.from(documentBytes))})],
      ${JSON.stringify(docName)}, {type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));
    const pdfBytes = Uint8Array.from(atob(${JSON.stringify(pdf.toString('base64'))}), char => char.charCodeAt(0));
    transfer.items.add(new File([pdfBytes], '场地图.pdf', {type:'application/pdf'}));
    const rect = body.getBoundingClientRect();
    body.dispatchEvent(new DragEvent('drop', {dataTransfer:transfer, bubbles:true,
      cancelable:true, clientX:rect.left+30, clientY:rect.top+12}));
    return true;
  })()`), '拖入 Word 文件');
  const hasInlinePreview = () => webContents.executeJavaScript(`[...document.querySelectorAll('[aria-label="笔记正文"] [data-note-file]')]
    .some(card => card.textContent.includes(${JSON.stringify(docName)}) && card.textContent.includes(${JSON.stringify(excerpt)}))`);
  await wait(hasInlinePreview, '从本机原件读取 Word 正文');
  const hasPdfPage = () => webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('[aria-label="笔记正文"] [data-note-file] canvas[aria-busy="false"]');
    return !!canvas && canvas.width > 0 && canvas.height > 0;
  })()`);
  await wait(hasPdfPage, '在桌面笔记中绘制 PDF 首页');
  await wait(() => navigate('首页'), '保存含附件的笔记');
  const attached = await wait(() => read().notes.find(row => row.title === '附件预览验证' &&
    row.attachments.some(file => file.name === docName && row.body.includes(file.id))), '保存正文中的附件位置');
  if (attached.body.includes(excerpt)) throw Error('预览文字混入了笔记正文');
  await wait(() => navigate('帮你记'), '重新打开附件笔记');
  await wait(hasInlinePreview, '重开后仍可在正文中读取附件');
  await wait(hasPdfPage, '重开后恢复 PDF 预览');
  return { ok:true, directSelection, fullscreenReading:true, removeTodo:true, noteInlineDocument:true, noteInlinePdf:true, noteTodoSchedule:true, taskBriefFromBoard:true, inspirationCanvas:true, methodTemplateReuse:true, planetGraph:true, inlineImage:true, flushOnNavigate:true, wholeLibrary:true, selectionQuestionAtText:true, stickyNoteHeader:true, iconOnlyShare:true };
}
