/** Uses only synthetic content and the desktop smoke profile. */
export async function checkKnowledge(store, webContents) {
  const legacyTitle = '安装验证 · 旧笔记';
  const newTitle = '安装验证 · 随手记';
  const noteText = '展览使用东门入场。';
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
      id:'smoke-note-old', title:${JSON.stringify(legacyTitle)}, body:'旧归档的虚构笔记。',
      revision:1, createdAt:'2020-01-01T00:00:00.000Z', updatedAt:'2020-01-01T00:00:00.000Z',
      archivedAt:'2020-01-02T00:00:00.000Z', attachments:[], expansions:[], history:[]
    });
    if (!await host.compareKnowledge(previous, JSON.stringify(library))) throw new Error('无法写入隔离笔记样例');
    if (await host.shareKnowledgeNote({title:'安装验证', text:'只验证分享入口'})) throw new Error('隔离检查不能打开系统分享');
  })()`);
  await wait(() => navigate('帮你记'), '打开帮你记');
  await wait(() => webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(legacyTitle)})`), '显示原有笔记');
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
  await wait(() => webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(newTitle)}) && document.body.innerText.includes(${JSON.stringify(legacyTitle)})`), '知识图谱纳入新旧两条笔记');
  return { ok:true, inlineImage:true, flushOnNavigate:true, wholeLibrary:true };
}
